/**
 * local-env — project-local .env + $PI_DEFAULT_MODEL.
 *
 * Loads the nearest `.env` before Pi initializes providers. API keys and
 * PI_DEFAULT_MODEL then work in interactive, print, MCP, and RPC modes.
 * PI_MODEL is reserved for Pi session metadata. Use PI_DEFAULT_MODEL to
 * select the startup model without conflicting with child-process metadata.
 *
 * The droid wrapper still uses `_load_ai_env` (droid has no extension
 * mechanism). The `claude-*` wrappers rely on the file-level
 * `source "$HOME/.env"` at shell startup, so they're unaffected.
 *
 * Why module-top-level env mutation:
 *   Pi constructs providers BEFORE emitting `session_start`, so an event
 *   handler is too late. The extension factory runs at load time: module
 *   code first, then `await factory(api)`. Anything done at module scope
 *   lands in process.env before the agent binds, so `ctx.env(name)` inside
 *   `provider-composer.js` finds the new values via `process.env[name]`.
 *
 * Why `session_start` for setModel:
 *   `setModel()` calls `_modelRuntime.checkAuth()` which requires the API
 *   key to already be in process.env. Module-level env injection handles
 *   that, but we still need `ctx.modelRegistry` to be bound, which only
 *   happens after bindCore(). `session_start` is the earliest event with
 *   a fully-bound ctx.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ─── .env parsing ───────────────────────────────────────────────────────────

/**
 * Minimal KEY=VALUE parser. We avoid `dotenv` to keep the extension a
 * single file with no runtime deps — Pi extensions load via jiti and any
 * extra import is a footgun if the runtime doesn't bundle it.
 *
 * Supports:
 *   - `KEY=value` and `KEY="quoted value"`
 *   - `#` and `//` line comments (no inline `# value` yet — shells differ)
 *   - `export KEY=...` prefix
 *   - blank lines
 * Does NOT support: variable expansion (`$OTHER` / `${OTHER}`), multiline
 * values, escape sequences. Those should be handled by the calling shell
 * before the value reaches here.
 */
function parseEnvFile(contents: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || line.startsWith("//")) continue;

		const stripped = line.startsWith("export ") ? line.slice(7).trim() : line;
		const eq = stripped.indexOf("=");
		if (eq <= 0) continue;

		const key = stripped.slice(0, eq).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

		let value = stripped.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
			(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
		) {
			value = value.slice(1, -1);
		}

		out[key] = value;
	}
	return out;
}

/**
 * Walk up from `start` looking for the nearest `.env` file. Returns the
 * first match or undefined. Stops at the filesystem root or when the
 * parent directory equals the current one (no progress → stop).
 */
function findNearestEnv(start: string): string | undefined {
	let dir = isAbsolute(start) ? start : dirname(start);
	if (!existsSync(dir)) return undefined;

	// Cap walk at a sensible depth (matches the shell wrapper's behavior).
	const MAX_DEPTH = 32;
	for (let i = 0; i < MAX_DEPTH; i++) {
		const candidate = join(dir, ".env");
		if (existsSync(candidate) && !candidate.includes("\0")) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

/**
 * Merge a parsed env file onto process.env without clobbering values that
 * are already set. Mirrors `_load_ai_env`'s "local overrides ~/.env, but
 * never wipes an explicit process.env" semantics.
 */
function mergeEnv(parsed: Record<string, string>, source: string): void {
	for (const [key, value] of Object.entries(parsed)) {
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
	// Tag the source so debugging is easier when both paths load .env files.
	process.env.LOCAL_ENV_SOURCE = source;
}

// ─── Module-level: load .env before any factory work ────────────────────────
//
// This runs at import time — BEFORE Pi calls `factory(api)`, BEFORE the
// provider composer constructs any auth handlers. Any key found here is
// visible to `ctx.env(name)` via the `process.env[name]` fallback in
// `resolve-config-value.js:49`.

(function loadProjectEnv(): void {
	const cwd = process.cwd();

	// 1. ~/.env first (lower precedence).
	if (process.env["HOME"]) {
		const homeEnv = join(process.env["HOME"], ".env");
		if (existsSync(homeEnv)) {
			try {
				mergeEnv(parseEnvFile(readFileSync(homeEnv, "utf8")), homeEnv);
			} catch {
				// Swallow — broken ~/.env shouldn't kill the session.
			}
		}
	}

	// 2. Nearest .env walking up from cwd (higher precedence).
	const projectEnv = findNearestEnv(cwd);
	if (projectEnv) {
		try {
			mergeEnv(parseEnvFile(readFileSync(projectEnv, "utf8")), projectEnv);
		} catch {
			// Same: never crash on a malformed file.
		}
	}
})();

// ─── PI_DEFAULT_MODEL resolution ─────────────────────────────────────────────

/**
 * Resolve `$PI_DEFAULT_MODEL` to a model in the registry. Bare IDs that match
 * multiple providers are rejected. This matches Pi's CLI ambiguity policy.
 */
function resolveDefaultModel(registry: {
	getAll(): { provider: string; id: string }[];
	find(provider: string, modelId: string): unknown;
}): { provider: string; id: string } | undefined {
	const pattern = process.env["PI_DEFAULT_MODEL"]?.trim();
	if (!pattern) return undefined;

	const slash = pattern.indexOf("/");
	if (slash > 0 && slash < pattern.length - 1) {
		const provider = pattern.slice(0, slash);
		const modelId = pattern.slice(slash + 1);
		const found = registry.find(provider, modelId) as
			| { provider: string; id: string }
			| undefined;
		return found;
	}

	// Bare id — disambiguate across providers.
	const matches = registry.getAll().filter((m) => m.id === pattern);
	if (matches.length === 1) return matches[0];
	return undefined;
}

// ─── Extension factory ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		// Respect an explicit choice (CLI --model, settings.json, model picker).
		const current = ctx.model;
		const desired = resolveDefaultModel(ctx.modelRegistry);
		if (!desired) return;
		if (current && current.provider === desired.provider && current.id === desired.id) {
			return;
		}

		const target = ctx.modelRegistry.find(desired.provider, desired.id) as
			| Parameters<typeof pi.setModel>[0]
			| undefined;
		if (!target) {
			console.warn(
				`[local-env] PI_DEFAULT_MODEL=${process.env["PI_DEFAULT_MODEL"]} did not match any configured model.`,
			);
			return;
		}

		// setModel() rejects when no API key is configured. Module-level
		// env injection should have placed the key in process.env already,
		// so a rejection here means PI_DEFAULT_MODEL selects a provider with no
		// key in either ~/.env or the project .env.
		// Surface a clean warning instead of an unhandled rejection.
		void pi.setModel(target).catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[local-env] Could not apply PI_DEFAULT_MODEL: ${message}`);
		});
	});
}