/**
 * Live macOS theme sync for OMP.
 *
 * Polls `defaults read -g AppleInterfaceStyle` every 2 s and calls
 * `ctx.ui.setTheme(name)` on change. The runtime triggers an
 * `invalidate()` after the theme controller swaps the active theme,
 * so the screen re-themes immediately without restarting the session.
 *
 * `defaults` does not require Apple Events / Automation permission,
 * unlike `osascript -e 'tell application "System Events" ...'`, which
 * fails with -1743 in many terminal apps.
 *
 * Theme name resolution (first match wins), from `~/.omp/agent/config.yml`:
 *   1. `theme: { dark: <name>, light: <name> }` mapping
 *   2. `theme: "light/dark-name"` parseAutoThemeSetting syntax
 *   3. Bundled `dark` / `light` as last resort
 * Each name is validated against `ctx.ui.getAllThemes()`; missing
 * names drop with a console warning and the next fallback is tried.
 *
 * Polling cadence: 2 s. Lower it for snappier switch, raise it to
 * save battery.
 *
 * Non-tui modes (rpc / json / print) are skipped — OMP exposes no
 * `ctx.mode` but `ctx.hasUI` is `false` there, and a no-op UI would
 * make `setTheme` fail anyway.
 *
 * Kept as a near-twin of the plain Pi sibling because OMP's runtime
 * is published under `@oh-my-pi/pi-coding-agent` (embedded in the
 * OMP binary via Bun's $bunfs) while plain Pi resolves
 * `@earendil-works/pi-coding-agent` from disk. The two diverge on
 * at least three observable details:
 *   - `ctx.mode` is exposed by Pi but not OMP
 *   - `ctx.ui.getAllThemes()` is sync in Pi, async in OMP
 *   - `ctx.ui.setTheme()` is sync in Pi, async in OMP
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const POLL_MS = 2000;
const FALLBACK_DARK = "dark";
const FALLBACK_LIGHT = "light";
const CONFIG_PATH = "~/.omp/agent/config.yml";

interface OmpThemeConfig {
	dark: string;
	light: string;
}

/** Read `~/.omp/agent/config.yml` and resolve dark/light theme names. */
function loadOmpThemes(): OmpThemeConfig {
	try {
		const raw = readFileSync(CONFIG_PATH.replace("~", process.env.HOME ?? ""), "utf8");
		const themeValue = extractThemeValue(raw);
		return resolveThemeConfig(themeValue);
	} catch (error) {
		console.warn(`[mac-system-theme] could not read ${CONFIG_PATH}:`, error);
		return { dark: FALLBACK_DARK, light: FALLBACK_LIGHT };
	}
}

/**
 * Pull the `theme:` value out of the OMP config.yml as a string, or a
 * `{ dark, light }` mapping as a plain object. The runtime's YAML
 * parser is not exported, so this implements a minimal reader scoped to
 * the `theme` key: supports quoted/unquoted scalars, `key: value`
 * pairs at one indent level under `theme:`, and inline `{ k: v, k: v }`
 * mappings. Anything else yields `undefined`.
 */
function extractThemeValue(yaml: string): unknown {
	const lines = yaml.split(/\r?\n/);
	let inTheme = false;
	let themeIndent = -1;
	const collected: string[] = [];
	let blockScalar: string | null = null;

	for (const line of lines) {
		if (!inTheme) {
			const match = line.match(/^(\s*)theme\s*:\s*(.*)$/);
			if (!match) continue;
			inTheme = true;
			themeIndent = match[1].length;
			const rest = match[2].trim();
			if (rest.length === 0) continue;
			if (rest.startsWith(">") || rest.startsWith("|")) {
				blockScalar = rest === "|" || rest.startsWith("|-") ? "|" : ">";
				continue;
			}
			collected.push(rest);
			inTheme = false;
			break;
		}
		const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
		const trimmed = line.trim();
		if (trimmed === "") continue;
		if (indent <= themeIndent) break;
		if (blockScalar) {
			collected.push(trimmed);
		} else {
			collected.push(line.slice(themeIndent + 2));
		}
	}

	if (collected.length === 0) return undefined;
	const joined = collected.join(blockScalar ? "\n" : " ").trim();
	if (!joined) return undefined;

	const inlineMap = parseInlineMapping(joined);
	if (inlineMap) return inlineMap;

	const nested = parseNestedMapping(joined);
	if (nested) return nested;

	return stripQuotes(joined);
}

function parseInlineMapping(text: string): Record<string, string> | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
	const body = trimmed.slice(1, -1);
	const out: Record<string, string> = {};
	const re = /([A-Za-z_][\w-]*)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,}\s][^,}]*)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(body)) !== null) {
		const key = match[1];
		const value = stripQuotes(match[2].trim());
		if (key && value) out[key] = value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseNestedMapping(text: string): Record<string, string> | undefined {
	const out: Record<string, string> = {};
	const re = /^([A-Za-z_][\w-]*)\s*:\s*(.+)$/;
	const parts = text.split(/\s+(?=[A-Za-z_][\w-]*\s*:)/);
	if (parts.length < 2) return undefined;
	let any = false;
	for (const raw of parts) {
		if (!raw) continue;
		const match = raw.match(re);
		if (!match) return undefined;
		out[match[1]] = stripQuotes(match[2].trim());
		any = true;
	}
	return any ? out : undefined;
}

function stripQuotes(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return value.slice(1, -1);
		}
	}
	return value;
}

/**
 * Map a `theme` value to a dark/light pair. Accepts:
 *   - `{ dark, light }` object
 *   - `"light/dark"` parseAutoThemeSetting string
 *   - any other string treated as the dark theme (preserves legacy scalar)
 */
function resolveThemeConfig(theme: unknown): OmpThemeConfig {
	if (theme && typeof theme === "object" && !Array.isArray(theme)) {
		const obj = theme as { dark?: unknown; light?: unknown };
		if (typeof obj.dark === "string" && typeof obj.light === "string") {
			return { dark: obj.dark, light: obj.light };
		}
	}
	if (typeof theme === "string") {
		const slash = theme.indexOf("/");
		if (slash > 0 && slash < theme.length - 1) {
			const light = theme.slice(0, slash).trim();
			const dark = theme.slice(slash + 1).trim();
			if (light && dark) return { dark, light };
		}
		if (theme.length > 0) {
			return { dark: theme, light: FALLBACK_LIGHT };
		}
	}
	return { dark: FALLBACK_DARK, light: FALLBACK_LIGHT };
}

/** macOS-only probe: true when "Use dark mode" is on. */
function readMacDarkMode(): boolean {
	try {
		const stdout = execFileSync("defaults", ["read", "-g", "AppleInterfaceStyle"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return stdout.trim() === "Dark";
	} catch {
		return false;
	}
}

/** Pick the first theme name that the runtime recognises; warn on misses. */
function pickAvailable(
	requested: string,
	fallback: string,
	available: ReadonlySet<string>,
	label: "dark" | "light",
): string {
	if (available.has(requested)) return requested;
	console.warn(
		`[mac-system-theme] configured ${label} theme "${requested}" is not installed; falling back to "${fallback}".`,
	);
	return available.has(fallback) ? fallback : (available.values().next().value ?? fallback);
}

export default function (pi: ExtensionAPI) {
	let active = false;
	let current: string | null = null;
	let timer: NodeJS.Timeout | undefined;
	let inFlight = false;

	pi.on("session_start", async (_event, ctx) => {
		// New session: reset all per-session state so a stale in-flight
		// promise from a previous session can't reschedule after teardown.
		active = true;
		current = null;
		inFlight = false;

		// OMP exposes `hasUI` (boolean) on the context; plain Pi exposes
		// `mode: "tui"|"rpc"|"json"|"print"`. The Pi semantics we want are
		// "has a real UI" — so on Pi, mode==="tui" maps to hasUI===true.
		const hasUI = ctx.hasUI ?? ctx.mode === "tui";
		if (!hasUI) {
			active = false;
			return;
		}

		// OMP's getAllThemes() is async; plain Pi's is sync. Awaiting works for both.
		const allThemes = await ctx.ui.getAllThemes();
		const available = new Set(allThemes.map((t) => t.name));
		const configured = loadOmpThemes();
		const themes: OmpThemeConfig = {
			dark: pickAvailable(configured.dark, FALLBACK_DARK, available, "dark"),
			light: pickAvailable(configured.light, FALLBACK_LIGHT, available, "light"),
		};

		const tick = () => {
			timer = undefined;
			if (!active) return;
			if (inFlight) {
				timer = setTimeout(tick, POLL_MS);
				return;
			}
			inFlight = true;
			const next = readMacDarkMode() ? themes.dark : themes.light;
			if (next === current) {
				inFlight = false;
				if (active) timer = setTimeout(tick, POLL_MS);
				return;
			}
			void ctx.ui
				.setTheme(next)
				.then((result) => {
					if (result.success) {
						current = next;
					} else {
						console.warn(`[mac-system-theme] setTheme("${next}") failed:`, result.error);
					}
				})
				.catch((error) => {
					console.warn(`[mac-system-theme] setTheme("${next}") threw:`, error);
				})
				.finally(() => {
					inFlight = false;
					if (active) timer = setTimeout(tick, POLL_MS);
				});
		};

		tick();
	});

	pi.on("session_shutdown", () => {
		active = false;
		if (timer) {
			clearTimeout(timer);
			timer = undefined;
		}
	});
}