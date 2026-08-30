/**
 * local-env — project-local .env loading.
 *
 * Loads the nearest `.env` before Pi initializes providers. API keys
 * work in interactive, print, MCP, and RPC modes.
 *
 * Model selection is Pi-native: `defaultProvider`/`defaultModel` in
 * settings.json. The current active model is exposed to child processes
 * as $PI_MODEL session metadata — extensions must not set it.
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
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
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

// ─── Extension factory ──────────────────────────────────────────────────────
//
// The loader rejects modules without a default factory, so export a no-op.
// All real work (env loading) happens at import time above.
export default function (): void {}

