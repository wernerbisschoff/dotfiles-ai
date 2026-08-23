/**
 * Starship-style footer (Pi extension).
 *
 * Replaces Pi's default footer with a single, compact, icon-rich status line
 * inspired by pi-zentui:
 *
*   foo on  main [!+?⇡1] via  v20.10.0       12.3k • $0.042
 *
 * Left side, separated by ` | `:
*   • cwd           — basename only (`~` at home, otherwise just the dir name)
 *   • git branch    — Starship `on <icon> <branch>`, omit `on` when no repo
 *   • git status    — `[!?+✘»=$⇡⇣⇕]` Nerd Font indicator block
 *   • runtime       — `via <icon> <version>` for detected toolchain
 *
 * Right side (drops first when too narrow):
 *   • tokens • cost   — context-window usage + session cost
* Width-aware shedding (applied in order until the line fits `width`):
*   1. Drop `model` from the right side
*   2. Drop `tokens` (left side only)
*   3. Wrap to two lines (cwd + status + runtime on L1, branch on L2)
*   4. If right (model • tokens) doesn't fit on L2: drop it to a 3rd line (left-aligned)
*   5. Truncate `branch` in L2 with `…` (60 → 50 → 40 → 30 → 20 → 15 → 12 → 10 → 8)
*   6. Hard truncate L2; right (if any) on a final L3 (last resort)
 * Reactive:
 *   • git branch   → footerData.onBranchChange (Pi's built-in watcher)
 *   • git status   → re-read after agent_end, tool_execution_end,
 *                    session_info_changed, or branch change
 *   • runtime      → re-detect on cwd change (session-level)
 *
 * Hidden chrome (kept from previous version):
 *   • Default header (logo + keybinding hints)
 *
 * Restored chrome (changed from previous version):
 *   • Default editor (no more `setEditorComponent` powerline wrapper)
 *
 * Permission-mode circle (●) is shown when the gatekeeper extension emits
 * `perm:changed` events; hides gracefully when idle.
 *
 * Requires a Nerd Font for the language icons; without one they render as
 * empty space (the trailing space we include keeps alignment intact).
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Git branch icon — Starship/pi-zentui Nerd Font preset (U+F415). Three UTF-8
 * bytes (ef 90 95) plus a trailing space for natural alignment.
 */
const GIT_BRANCH_ICON = "\u{F418} ";
const VERSION_TIMEOUT_MS = 2500;
const GIT_TIMEOUT_MS = 2000;

// ─── Runtime detection table ─────────────────────────────────────────────────
//
// Starship Nerd Font preset (Private Use Area codepoints). Each icon includes
// a trailing space for natural spacing. Theme color name picks from the
// existing Pi palette. Coverage mirrors pi-zentui but trimmed to a common set.
// Nerd-Font presets used:
//   https://starship.rs/presets/nerd-font  (icons)
//   https://starship.rs/config/             (color conventions)

type ThemeColor =
	| "success"
	| "warning"
	| "error"
	| "accent"
	| "muted"
	| "dim"
	| "text";

type DetectionRule = {
	files?: readonly string[];
	folders?: readonly string[];
	extensions?: readonly string[];
	excludeFiles?: readonly string[];
};

type RuntimeDef = {
	id: string;
	label: string;
	icon: string;
	color: ThemeColor;
	rule: DetectionRule;
	versionCmd?: readonly string[];
};

// Nerd Font glyphs (PUA) written as \u{XXXXX} escapes to keep this file pure
// ASCII. JS engines unescape these at parse time so callers see the right
// codepoints. The trailing space keeps a 1-cell gap after each icon.
const RUNTIMES: readonly RuntimeDef[] = [
	// Common runtimes (checked first)
	{
		id: "nodejs",
		label: "node",
		icon: " ", // node logo
		color: "success",
		rule: {
			files: ["package.json", ".node-version", ".nvmrc"],
			excludeFiles: ["bunfig.toml", "bun.lock", "bun.lockb"],
		},
		versionCmd: ["node", "--version"],
	},
	{
		id: "deno",
		label: "deno",
		icon: " ",
		color: "success",
		rule: { files: ["deno.json", "deno.jsonc", "deno.lock"] },
		versionCmd: ["deno", "--version"],
	},
	{
		id: "bun",
		label: "bun",
		icon: " ",
		color: "warning",
		rule: { files: ["bun.lock", "bun.lockb"], folders: [] },
		versionCmd: ["bun", "--version"],
	},
	{
		id: "python",
		label: "py",
		icon: " ",
		color: "warning",
		rule: {
			files: [
				"requirements.txt",
				".python-version",
				"pyproject.toml",
				"Pipfile",
				"setup.py",
				"setup.cfg",
			],
		},
		versionCmd: ["python3", "--version"],
	},
	{
		id: "rust",
		label: "rs",
		icon: "󱘗 ",
		color: "error",
		rule: { files: ["Cargo.toml"] },
		versionCmd: ["rustc", "--version"],
	},
	{
		id: "golang",
		label: "go",
		icon: " ",
		color: "accent",
		rule: { files: ["go.mod", "go.sum", "glide.yaml", "Gopkg.yml"] },
		versionCmd: ["go", "version"],
	},
	{
		id: "java",
		label: "java",
		icon: " ",
		color: "error",
		rule: { files: [".java-version", "pom.xml", "build.gradle"] },
		versionCmd: ["java", "-version"],
	},
	{
		id: "ruby",
		label: "rb",
		icon: " ",
		color: "error",
		rule: { files: ["Gemfile", ".ruby-version", ".rvmrc"] },
		versionCmd: ["ruby", "--version"],
	},
	{
		id: "php",
		label: "php",
		icon: " ",
		color: "muted",
		rule: { files: ["composer.json", "composer.lock"] },
		versionCmd: ["php", "--version"],
	},
	{
		id: "elixir",
		label: "ex",
		icon: " ",
		color: "accent",
		rule: { files: ["mix.exs", "mix.lock"] },
		versionCmd: ["elixir", "--version"],
	},
	{
		id: "scala",
		label: "scala",
		icon: " ",
		color: "error",
		rule: {
			extensions: ["scala", "sbt"],
			files: [".scalaenv", ".sbtenv", "build.sbt"],
		},
		versionCmd: ["scala", "-version"],
	},
	{
		id: "kotlin",
		label: "kt",
		icon: " ",
		color: "accent",
		rule: { extensions: ["kt", "kts"] },
		versionCmd: ["kotlinc", "-version"],
	},
	{
		id: "swift",
		label: "swift",
		icon: " ",
		color: "warning",
		rule: { extensions: ["swift"], files: ["Package.swift"] },
		versionCmd: ["swift", "--version"],
	},
	{
		id: "dart",
		label: "dart",
		icon: " ",
		color: "accent",
		rule: {
			extensions: ["dart"],
			files: ["pubspec.yaml", "pubspec.yml"],
			folders: [".dart_tool"],
		},
		versionCmd: ["dart", "--version"],
	},
	{
		id: "julia",
		label: "jl",
		icon: " ",
		color: "accent",
		rule: {
			extensions: ["jl"],
			files: ["Project.toml", "Manifest.toml"],
		},
		versionCmd: ["julia", "--version"],
	},
	{
		id: "haskell",
		label: "hs",
		icon: " ",
		color: "accent",
		rule: {
			extensions: ["hs", "cabal"],
			files: ["stack.yaml", "cabal.project"],
		},
		versionCmd: ["ghc", "--numeric-version"],
	},
	{
		id: "lua",
		label: "lua",
		icon: " ",
		color: "accent",
		rule: {
			extensions: ["lua"],
			files: ["stylua.toml", ".luarc.json", ".lua-version"],
		},
		versionCmd: ["lua", "-v"],
	},
	{
		id: "zig",
		label: "zig",
		icon: " ",
		color: "warning",
		rule: { extensions: ["zig"], files: ["build.zig", "build.zig.zon"] },
		versionCmd: ["zig", "version"],
	},
	{
		id: "ocaml",
		label: "ml",
		icon: " ",
		color: "warning",
		rule: {
			extensions: ["opam", "ml", "mli"],
			files: ["dune", "dune-project"],
		},
		versionCmd: ["ocaml", "-version"],
	},
	{
		id: "cpp",
		label: "cpp",
		icon: " ",
		color: "text",
		rule: { extensions: ["cpp", "cc", "cxx", "hpp", "hh", "hxx"] },
		versionCmd: ["c++", "--version"],
	},
	{
		id: "c",
		label: "c",
		icon: " ",
		color: "text",
		rule: { extensions: ["c", "h"] },
		versionCmd: ["cc", "--version"],
	},
	{
		id: "docker",
		label: "docker",
		icon: " ",
		color: "accent",
		rule: { files: ["Dockerfile", "docker-compose.yml", "compose.yaml"] },
		versionCmd: ["docker", "--version"],
	},
] as const;

// ─── cwd helpers ────────────────────────────────────────────────────────────

function formatCwd(cwd: string, home: string | undefined): string {
const resolvedCwd = resolve(cwd);
if (home && resolve(home) === resolvedCwd) return "~";
return basename(resolvedCwd);
}

// ─── runtime detection + version probing ────────────────────────────────────

function hasAnyFile(cwd: string, names: readonly string[]): boolean {
	return names.some((n) => existsSync(resolve(cwd, n)));
}

function hasAnyFolder(cwd: string, names: readonly string[]): boolean {
	return names.some((n) => {
		try {
			return existsSync(resolve(cwd, n)); // also matches files with that name (extend if needed)
		} catch {
			return false;
		}
	});
}

function entryHasExtension(entry: string, exts: readonly string[]): boolean {
	const dot = entry.lastIndexOf(".");
	if (dot < 0) return false;
	const e = entry.slice(dot + 1);
	return exts.includes(e);
}

function matchesRule(
	cwd: string,
	entries: readonly string[],
	rule: DetectionRule,
): boolean {
	if (rule.excludeFiles && hasAnyFile(cwd, rule.excludeFiles)) return false;
	if (rule.files && hasAnyFile(cwd, rule.files)) return true;
	if (rule.folders && hasAnyFolder(cwd, rule.folders)) return true;
	if (rule.extensions && rule.extensions.length > 0) {
		if (entries.some((e) => entryHasExtension(e, rule.extensions ?? []))) return true;
	}
	return false;
}

type RuntimeInfo = {
	def: RuntimeDef;
	version?: string;
};

const VERSION_RE = /(?:v|version\s*)?(\d+\.\d+(?:\.\d+)?)/i;

async function probeVersion(cmd: readonly string[]): Promise<string | undefined> {
	try {
		const { stdout, stderr } = await execFileAsync(cmd[0]!, cmd.slice(1), {
			timeout: VERSION_TIMEOUT_MS,
		});
		const text = `${stdout}\n${stderr}`.trim();
		const m = text.match(VERSION_RE);
		return m?.[1] ? `v${m[1]}` : undefined;
	} catch {
		return undefined;
	}
}

const runtimeCache = new Map<string, RuntimeInfo | null>();

async function detectRuntime(cwd: string): Promise<RuntimeInfo | null> {
	let entries: string[];
	try {
		entries = readdirSync(cwd);
	} catch {
		return null;
	}
	const fingerprint = entries.slice().sort().join("\0");
	const key = `${cwd}\0${fingerprint}`;
	const cached = runtimeCache.get(key);
	if (cached !== undefined) return cached;

	let info: RuntimeInfo | null = null;
	for (const def of RUNTIMES) {
		if (matchesRule(cwd, entries, def.rule)) {
			const version = def.versionCmd ? await probeVersion(def.versionCmd) : undefined;
			info = { def, version };
			break;
		}
	}
	runtimeCache.set(key, info);
	return info;
}

// ─── git status parsing (porcelain=2) ────────────────────────────────────────
//
// Inspired by pi-zentui's parseGitStatusPorcelain; trimmed to the eight
// indicators that Pi's footer can show compactly:
//   `! ? + ✘ » = $`   (modified, untracked, staged, deleted, renamed,
//                      conflicted, stashed)
//   `⇡ ⇣ ⇕` ahead/behind/diverged (replaces the merge-point label).

type GitStatusSummary = {
	modified: number;
	staged: number;
	deleted: number;
	renamed: number;
	untracked: number;
	conflicted: number;
	stashed: number;
	ahead: number;
	behind: number;
	operation?: "REBASING" | "MERGING" | "CHERRY-PICKING" | "REVERTING" | "BISECTING";
};

const EMPTY_GIT: GitStatusSummary = {
	modified: 0,
	staged: 0,
	deleted: 0,
	renamed: 0,
	untracked: 0,
	conflicted: 0,
	stashed: 0,
	ahead: 0,
	behind: 0,
};

function parsePorcelain(stdout: string, stashCount: number): GitStatusSummary {
	const sum: GitStatusSummary = { ...EMPTY_GIT, stashed: stashCount };
	for (const raw of stdout.split(/\r?\n/)) {
		if (!raw) continue;
		if (raw.startsWith("#")) {
			const ab = raw.match(/# branch\.ab \+(\d+) -(\d+)/);
			if (ab) {
				sum.ahead = Number(ab[1] ?? 0);
				sum.behind = Number(ab[2] ?? 0);
			}
			continue;
		}
		// Conflict: `u XY sub <path>`
		if (raw.startsWith("u ")) {
			sum.conflicted += 1;
			continue;
		}
		// Untracked: `? <path>`
		if (raw.startsWith("? ")) {
			sum.untracked += 1;
			continue;
		}
		// Modified entries start with `1 XY ...` or `2 XY ...`
		const xy = raw.split(" ")[1];
		if (!xy || xy.length < 2) continue;
		const x = xy[0];
		const y = xy[1];
		if (x === "R") sum.renamed += 1;
		else if (x === "D") sum.deleted += 1;
		else if (x !== "." && x !== " ") sum.staged += 1;
		if (y === "M") sum.modified += 1;
		else if (y === "D") sum.deleted += 1;
	}
	return sum;
}

async function readGitStatus(cwd: string): Promise<GitStatusSummary | null> {
	try {
		const [{ stdout }, { stdout: stashOut }, opState] = await Promise.all([
			execFileAsync("git", ["status", "--porcelain=2", "--branch"], {
				cwd,
				timeout: GIT_TIMEOUT_MS,
			}),
			execFileAsync("git", ["stash", "list"], {
				cwd,
				timeout: GIT_TIMEOUT_MS,
			}).catch(() => ({ stdout: "" })),
			readGitOperationState(cwd),
		]);
		const stashCount = String(stashOut)
			.split(/\r?\n/)
			.filter((l) => l.trim().length > 0).length;
		return { ...parsePorcelain(String(stdout), stashCount), operation: opState };
	} catch {
		return null;
	}
}

async function readGitOperationState(
	cwd: string,
): Promise<GitStatusSummary["operation"]> {
	const probe = async (file: string): Promise<string | undefined> => {
		try {
			const { stdout } = await execFileAsync(
				"git",
				["rev-parse", "--git-path", file],
				{ cwd, timeout: GIT_TIMEOUT_MS },
			);
			const path = String(stdout).trim();
			if (!path) return undefined;
			return path.startsWith("/") ? path : resolve(cwd, path);
		} catch {
			return undefined;
		}
	};
	const [rebaseMerge, rebaseApply, mergeHead, cherryPick, revert, bisect] =
		await Promise.all([
			probe("rebase-merge"),
			probe("rebase-apply"),
			probe("MERGE_HEAD"),
			probe("CHERRY_PICK_HEAD"),
			probe("REVERT_HEAD"),
			probe("BISECT_LOG"),
		]);
	if (existsSync(rebaseMerge ?? "") || existsSync(rebaseApply ?? ""))
		return "REBASING";
	if (existsSync(mergeHead ?? "")) return "MERGING";
	if (existsSync(cherryPick ?? "")) return "CHERRY-PICKING";
	if (existsSync(revert ?? "")) return "REVERTING";
	if (existsSync(bisect ?? "")) return "BISECTING";
	return undefined;
}

// ─── Permissions (gatekeeper integration, preserved from previous version) ──

type GatekeeperMode = "allow" | "ask" | "deny" | "off";

let permExtensionActive = false;
let currentPermMode: GatekeeperMode = "ask";

function getPermCircle(theme: Theme): string | null {
	if (!permExtensionActive) return null;
	const color =
		currentPermMode === "allow"
			? "success"
			: currentPermMode === "deny"
				? "error"
				: currentPermMode === "off"
					? "muted"
					: "warning";
	return theme.fg(color, "●");
}

// ─── Token / cost helpers (preserved from previous version) ─────────────────

function formatTokensK(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

// ─── Line rendering ─────────────────────────────────────────────────────────

function coloredCount(theme: Theme, color: ThemeColor, text: string): string {
	return theme.fg(color, text);
}

function buildGitStatusIndicators(
	theme: Theme,
	sum: GitStatusSummary,
): string {
	const parts: string[] = [];
	const c = (color: ThemeColor, glyph: string): string =>
		theme.fg(color, glyph);

	if (sum.conflicted > 0) parts.push(c("error", "="));
	if (sum.stashed > 0)
		parts.push(c("warning", "$"));
	if (sum.deleted > 0) parts.push(c("error", "✘"));
	if (sum.renamed > 0) parts.push(c("accent", "»"));
	if (sum.modified > 0) parts.push(c("warning", "!"));
	if (sum.staged > 0) parts.push(c("success", "+"));
	if (sum.untracked > 0) parts.push(c("muted", "?"));
	if (sum.ahead > 0 && sum.behind > 0) {
		parts.push(c("accent", "⇕"));
	} else if (sum.ahead > 0) {
		parts.push(c("accent", "⇡"));
	} else if (sum.behind > 0) {
		parts.push(c("accent", "⇣"));
	}
	if (parts.length === 0) return "";
	return `[${parts.join("")}]`;
}

function buildRuntimeSegment(
	theme: Theme,
	rt: RuntimeInfo | null,
): string {
	if (!rt) return "";
	const icon = rt.def.icon;
	const label = rt.version ? `${icon}${rt.version}` : icon.trimEnd();
	return `${coloredCount(theme, "muted", "via")} ${coloredCount(theme, rt.def.color, label)}`;
}

function buildTokenSegment(
	theme: Theme,
	usage: { tokens?: number | null; percent?: number | null } | undefined,
): string | null {
	if (!usage || usage.tokens === null || usage.tokens === undefined) return null;
	const tokens = formatTokensK(usage.tokens);
	const pct = usage.percent;
	const color =
		pct === null || pct === undefined
			? "muted"
			: pct > 90
				? "error"
				: pct > 70
					? "warning"
					: "success";
	return theme.fg(color, tokens);
}

/**
 * Build the model segment (right side). Returns null when no model is loaded
 * so renderLine() can drop it without leaving a leading separator.
 */
function buildModelSegment(
	theme: Theme,
	modelId: string | undefined,
): string | null {
	if (!modelId) return null;
	return theme.fg("accent", modelId);
}

/**
* Lay out the segments within `width`. Returns one or two lines.
*
* Single-line strategies (tried first):
*   full layout, then drop model, then drop tokens.
*
* Wrap to two lines (preferred over truncating the branch in single-line):
*   line 1: cwd + status + runtime
*   line 2: on <branch>, with right-side padding (model • tokens)
*
* Falls back to truncating the branch in line 2 if even line 2 overflows.
* Last resort: hard truncate both lines.
*/
function renderLine(
theme: Theme,
width: number,
parts: {
cwd: string;
branch: string | null;
gitIndicators: string;
runtime: string;
tokens: string | null;
model: string | null;
},
): string[] {
const sep = theme.fg("dim", " | ");
const gapMin = 2;

const fitsWithGap = (l: string, r: string): boolean => {
if (!r) return visibleWidth(l) <= width;
return visibleWidth(l) + visibleWidth(r) + gapMin <= width;
};
const pad = (l: string, r: string): string => {
if (!r) return l;
const gap = Math.max(gapMin, width - visibleWidth(l) - visibleWidth(r));
return `${l}${" ".repeat(gap)}${r}`;
};

const rightWithModel = [parts.model, parts.tokens]
.filter(Boolean)
.join(theme.fg("dim", " • "));
const rightTokensOnly = parts.tokens ?? "";

// Build single-line candidates. `branchText` overrides the branch segment.
const buildLeft = (branchText: string | null): string => {
const blocks: string[] = [parts.cwd];
if (parts.branch) {
const b = branchText ?? (parts.branch === "HEAD" ? "detached" : parts.branch);
const branchStyled = theme.fg("mdLink", GIT_BRANCH_ICON + b);
blocks.push(`${theme.fg("muted", "on")} ${branchStyled}`);
}
if (parts.gitIndicators) blocks.push(parts.gitIndicators);
if (parts.runtime) blocks.push(parts.runtime);
return blocks
.filter(Boolean)
.join(sep)
.replace(/\s*\|\s*\|\s*/g, " | ")
.replace(/^\s*\|\s*/, "")
.replace(/\s*\|\s*$/, "");
};
const leftFull = buildLeft(null);

// 1. Single-line strategies.
if (fitsWithGap(leftFull, rightWithModel)) return [pad(leftFull, rightWithModel)];
if (fitsWithGap(leftFull, rightTokensOnly)) return [pad(leftFull, rightTokensOnly)];
if (fitsWithGap(leftFull, "")) return [leftFull];

// 2. Wrap to two lines. Line 1: cwd + status + runtime. Line 2: branch.
const otherLeft = [parts.gitIndicators, parts.runtime].filter(Boolean).join(sep);
const line1 = otherLeft ? `${parts.cwd}${sep}${otherLeft}` : parts.cwd;
// Only wrap when line 1 fits AND there's a branch to wrap. Otherwise
// wrap adds no value — hard truncate the single line.
if (!parts.branch || visibleWidth(line1) > width) {
return [truncateToWidth(leftFull, width, "")];
}

const branchText = parts.branch === "HEAD" ? "detached" : parts.branch;
const buildLine2 = (b: string): string => {
const branchStyled = theme.fg("mdLink", GIT_BRANCH_ICON + b);
return `${theme.fg("muted", "on")} ${branchStyled}`;
};
const left2Full = buildLine2(branchText);
// Right side treated as a unit for wrap mode: model • tokens together,
// moved to a 3rd line (left-aligned) when it doesn't fit on line 2.
const right = rightWithModel;
const tryLayout = (left2: string): string[] | null => {
if (right && fitsWithGap(left2, right)) {
return [line1, pad(left2, right)];
}
if (right && fitsWithGap(left2, "")) {
return [line1, left2, right];
}
if (fitsWithGap(left2, "")) {
return [line1, left2];
}
return null;
};
let layout = tryLayout(left2Full);
if (layout) return layout;

// 3. Line 2 still overflows — truncate the branch progressively.
for (const maxLen of [60, 50, 40, 30, 20, 15, 12, 10, 8]) {
if (visibleWidth(branchText) <= maxLen) break;
const sb = truncateToWidth(branchText, maxLen, "…");
layout = tryLayout(buildLine2(sb));
if (layout) return layout;
}

// 4. Last resort: hard truncate line 2; right (if any) goes to line 3.
if (right) {
return [line1, truncateToWidth(left2Full, width, ""), right];
}
return [line1, truncateToWidth(left2Full, width, "")];
}


// ─── Extension ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Subscribe to gatekeeper permission-level changes (preserved from prior version)
	pi.events.on("perm:changed", (data: { mode: string }) => {
		permExtensionActive = true;
		currentPermMode = data.mode as GatekeeperMode;
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		const cwd = ctx.sessionManager.getCwd();

		// Footer state caches (kept across renders, refreshed on triggers).
		let cachedGit: GitStatusSummary | null = null;
		let cachedRuntime: RuntimeInfo | null = null;

		const tuiRef = { current: null as unknown as { requestRender: () => void } | null };
		const refreshGit = async (): Promise<void> => {
			const next = await readGitStatus(cwd);
			cachedGit = next;
			tuiRef.current?.requestRender();
		};
		const refreshRuntime = async (): Promise<void> => {
			cachedRuntime = await detectRuntime(cwd);
		};

		// ── Hide default chrome (synchronous — no awaits before these) ────────
		// Header (logo + keybinding hints): hidden so the footer line below the
		// editor is the only status surface.
		ctx.ui.setHeader(() => ({
			render: () => [],
			invalidate: () => {},
		}));
		// Restore the default editor (drop the previous powerline wrapper).
		ctx.ui.setEditorComponent(undefined);

		// ── Custom footer ───────────────────────────────────────────────────

		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef.current = tui;
			const unsubBranch = footerData.onBranchChange(() => {
				// branch change ⇒ status is stale (set up/tear down branches
				// can change which files appear dirty). Re-read and re-render.
				void refreshGit();
			});

			return {
				dispose: unsubBranch,
				invalidate() {
					// Per-render caching would go here; we always re-read for
					// the next render so a no-op invalidate is fine.
				},
render(width: number): string[] {
if (width <= 0) return [""];
const lines = renderLine(theme, width, {
cwd: theme.fg("warning", formatCwd(cwd, process.env["HOME"])),
branch: footerData.getGitBranch(),
gitIndicators: cachedGit
? buildGitStatusIndicators(theme, cachedGit)
: "",
runtime: buildRuntimeSegment(theme, cachedRuntime),
tokens: buildTokenSegment(theme, ctx.getContextUsage()),
model: buildModelSegment(theme, ctx.model?.id),
});
// Attach op-state suffix to the branch line (git context), not the last line.
// For 1-line layouts: line 1 (only line). For 2/3-line wraps: line 2.
const op = cachedGit?.operation;
if (!op) return lines;
const tail = ` ${theme.fg("accent", op)}`;
const target = lines.length >= 2 ? 1 : 0;
lines[target] = truncateToWidth(lines[target] + tail, width, "");
return lines;
},
			};
		});

		// Keep git status fresh on terminal activity that can change tracked files
		pi.on("tool_execution_end", () => {
			void refreshGit().then(() => refreshRuntime());
		});
		pi.on("agent_end", () => {
			void refreshGit();
		});
		pi.on("session_info_changed", () => {
			void refreshRuntime();
			void refreshGit();
		});

		// Initial scan — fire and forget. The chrome overrides above are already
		// installed, so the first render() below sees cwd + branch immediately.
		// Once git status + version probes complete, we re-render and the icons
		// fill in.
		void (async () => {
			const [git, runtime] = await Promise.all([
				readGitStatus(cwd),
				detectRuntime(cwd),
			]);
			cachedGit = git;
			cachedRuntime = runtime;
			tuiRef.current?.requestRender();
		})();
	});
}
