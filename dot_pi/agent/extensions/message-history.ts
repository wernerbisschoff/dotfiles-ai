/**
 * message-history.ts — Persistent up/down arrow message history (per-project)
 *
 * Pi's built-in editor forgets prompts when the session ends. This extension
 * layers bash-like, persistent history onto the live editor instead of
 * replacing it — the framework supports a single custom editor factory
 * (last writer wins) and pi-paster registers its own editor after us, so
 * replacing would either lose to it (no history) or displace it (no image
 * paste). Wrapping the winner keeps both features:
 *
 *   • Up on the FIRST visual line     → recall an older message
 *   • Down on the LAST visual line    → recall a newer message
 *   • The in-progress draft is preserved (Down past newest restores it)
 *   • History is persisted to disk per project, so prompts survive
 *     /new, /exit, restarts, and are shared between sessions in the same project
 *
 * Storage: ~/.pi/agent/message-history/cwd-<sha256(projectKey)[:16]>.json
 * (file mode 0600). The key is the git top-level directory when inside a
 * repo, otherwise the cwd. It is hashed so paths don't appear in filenames.
 *
 * Behavior:
 *   • Empty messages and consecutive duplicates are skipped
 *   • Programmatic sends (source === "extension") are excluded; only what the
 *     human typed interactively lands in history
 *   • Up/Down honor the user's keybinding config — if ~/.pi/agent/keybindings.json
 *     binds "ctrl+p" to cursorUp, that binding is used
 *   • History is bypassed while an autocomplete dropdown is open (e.g. the
 *     @ file completer): up/down then navigate the suggestion list instead
 *
 * Concurrency: lock-free. Every session writes; each flush re-reads the disk
 * file and merges unsaved entries on top, so concurrent sessions in the same
 * project never clobber each other. Writes are debounced, and the pending
 * write is awaited on session_shutdown, so prompts typed just before quitting
 * still persist.
 */
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionUIContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

// ─── Configuration ───────────────────────────────────────────────────────────

const HISTORY_DIR = "message-history";
const FILE_EXT = ".json";
const FILE_PREFIX = "cwd-";
/** SHA-256 truncated to 64 bits in hex. ~1 collision per 4B distinct projects. */
const HASH_LEN = 16;
const MAX_ENTRIES = 1000;

// ─── Storage layer ────────────────────────────────────────────────────────────

interface DiskShape {
	/** Most-recent first. Strings only — image-bearing messages drop their images. */
	entries: string[];
	/** Schema version. Bump when the on-disk shape changes. */
	version: 1;
}

const execFileAsync = promisify(execFile);

/**
 * Resolve the history key: git top-level when inside a repo (so every
 * subdirectory of a project shares one history), otherwise the cwd itself.
 */
async function projectKey(cwd: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
			timeout: 2000,
		});
		const root = stdout.trim();
		if (root) return root;
	} catch {
		// Not a git repo (or git missing) — fall back to the cwd.
	}
	return cwd;
}

/**
 * Hash the project key into a short, opaque filename. Truncated SHA-256 keeps
 * the filename short while making the path unrecoverable from the filesystem.
 */
function keyHash(key: string): string {
	return createHash("sha256").update(key).digest("hex").slice(0, HASH_LEN);
}

function historyFile(key: string): string {
	return join(getAgentDir(), HISTORY_DIR, `${FILE_PREFIX}${keyHash(key)}${FILE_EXT}`);
}

async function ensureHistoryDir(): Promise<void> {
	await mkdir(join(getAgentDir(), HISTORY_DIR), { recursive: true, mode: 0o700 });
}

async function readDisk(key: string): Promise<string[]> {
	const file = historyFile(key);
	try {
		const raw = await readFile(file, "utf8");
		const parsed = JSON.parse(raw) as Partial<DiskShape>;
		if (parsed && Array.isArray(parsed.entries)) {
			return parsed.entries.filter((e): e is string => typeof e === "string").slice(0, MAX_ENTRIES);
		}
	} catch (err: unknown) {
		// ENOENT → empty. Anything else → log and start empty.
		if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
			console.warn(`[message-history] failed to read ${file}:`, err);
		}
	}
	return [];
}

async function writeDisk(key: string, entries: string[]): Promise<void> {
	const file = historyFile(key);
	const tmp = `${file}.tmp.${process.pid}`;

	try {
		await ensureHistoryDir();
		await writeFile(tmp, JSON.stringify({ entries, version: 1 } satisfies DiskShape), {
			mode: 0o600,
		});
		await rename(tmp, file);
	} catch (err) {
		console.warn(`[message-history] failed to write ${file}:`, err);
		// Best-effort cleanup of the temp file. If rename failed because of a
		// concurrent writer, tmp may already be gone — ignore ENOENT.
		try {
			await rm(tmp, { force: true });
		} catch {
			/* ignore */
		}
	}
}

// ─── Editor wrapper ───────────────────────────────────────────────────────────

// `CustomEditor`'s constructor types come from `@earendil-works/pi-tui`, a
// transitive (nested) dependency of `@earendil-works/pi-coding-agent`. Re-derive
// the parameter types from the parent constructor so we don't import pi-tui at
// the call site.
type TUI = ConstructorParameters<typeof CustomEditor>[0];
type EditorTheme = ConstructorParameters<typeof CustomEditor>[1];

type EditorFactory = NonNullable<ReturnType<ExtensionUIContext["getEditorComponent"]>>;
type EditorInstance = ReturnType<EditorFactory>;

/** Public Editor surface history recall needs. Present on every bundled editor. */
interface RecallCaps {
	getText(): string;
	setText(text: string): void;
	getCursor(): { line: number; col: number };
	getLines(): string[];
	isShowingAutocomplete(): boolean;
	handleInput(data: string): void;
}

interface HistoryState {
	entries: string[];
	index: number;
	draft: string | null;
}

/** Per-instance history slots, set by attachHistory before input can arrive. */
interface HistorySlots {
	__mhBaseHandleInput: (data: string) => void;
	__mhKb: KeybindingsManager;
	__mhState: HistoryState;
}

interface HistoryAddon {
	/** Seed history from disk. Most-recent first. */
	loadHistory(this: LayerThis, entries: string[]): void;
	/** Push a freshly submitted message into history. */
	addToHistory(this: LayerThis, text: string): void;
}

type LayerThis = EditorInstance & RecallCaps & Required<HistorySlots>;
type LayeredEditor = EditorInstance & RecallCaps & Required<HistorySlots> & HistoryAddon;

/** Set on the prototype layer so a live instance is wrapped at most once. */
const HISTORY_MARK = "__messageHistoryWrapped";

const historyLayer: HistoryAddon & {
	captureDraft(this: LayerThis): void;
	recall(this: LayerThis, direction: -1 | 1): void;
	cursorOnFirstLine(this: LayerThis): boolean;
	cursorOnLastLine(this: LayerThis): boolean;
	handleInput(this: LayerThis, data: string): void;
} = {
	loadHistory(entries: string[]): void {
		this.__mhState = { entries: entries.slice(0, MAX_ENTRIES), index: -1, draft: null };
	},

	addToHistory(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;
		if (this.__mhState.entries[0] === trimmed) return; // dedup consecutive
		this.__mhState.entries.unshift(trimmed);
		if (this.__mhState.entries.length > MAX_ENTRIES) {
			this.__mhState.entries.length = MAX_ENTRIES;
		}
		// Reset browsing — the new entry is now the most recent.
		this.__mhState.index = -1;
		this.__mhState.draft = null;
	},

	captureDraft(): void {
		if (this.__mhState.index !== -1) return; // already browsing
		this.__mhState.draft = this.getText();
	},

	recall(direction: -1 | 1): void {
		const { entries } = this.__mhState;
		if (entries.length === 0) return;

		this.captureDraft();

		// up (-1) → older (index increases), down (+1) → newer (index decreases)
		const newIndex = this.__mhState.index - direction;
		if (newIndex < -1 || newIndex >= entries.length) return;

		this.__mhState.index = newIndex;

		if (newIndex === -1) {
			// Down past newest → restore draft.
			const draft = this.__mhState.draft;
			this.__mhState.draft = null;
			this.setText(draft ?? "");
			return;
		}

		this.setText(entries[newIndex] ?? "");
	},

	cursorOnFirstLine(): boolean {
		return this.getCursor().line === 0;
	},

	cursorOnLastLine(): boolean {
		const lines = this.getLines();
		return this.getCursor().line >= lines.length - 1;
	},

	handleInput(data: string): void {
		// When an autocomplete dropdown is open (e.g. the @ file completer),
		// up/down must navigate the suggestion list, not recall history. Delegate
		// all input to the base editor, which routes arrows to the list first.
		if (this.isShowingAutocomplete()) {
			this.__mhBaseHandleInput(data);
			return;
		}

		if (this.__mhKb.matches(data, "tui.editor.cursorUp")) {
			if (this.cursorOnFirstLine()) {
				this.recall(-1);
				return;
			}
		}

		if (this.__mhKb.matches(data, "tui.editor.cursorDown")) {
			if (this.__mhState.index > -1 && this.cursorOnLastLine()) {
				this.recall(1);
				return;
			}
		}

		this.__mhBaseHandleInput(data);
	},
};

/**
 * Layer history recall onto a live editor instance. The instance keeps its
 * own prototype chain (pi-paster's image paste, completions, keybindings)
 * and gains the history methods; re-running on the same instance only
 * refreshes its entries.
 */
function attachHistory(
	editor: EditorInstance,
	kb: KeybindingsManager,
	entries: string[],
): LayeredEditor {
	const target = editor as LayeredEditor;
	const proto = Object.getPrototypeOf(editor) as {
		handleInput?: (this: RecallCaps, data: string) => void;
		[HISTORY_MARK]?: true;
	};
	if (!proto[HISTORY_MARK]) {
		const baseHandleInput = proto.handleInput?.bind(editor) ?? (() => {});
		const layer = Object.create(proto);
		Object.assign(layer, historyLayer);
		layer[HISTORY_MARK] = true;
		Object.setPrototypeOf(editor, layer);
		target.__mhBaseHandleInput = baseHandleInput;
	}
	target.__mhKb = kb;
	target.loadHistory(entries);
	return target;
}

// ─── Persistence controller ───────────────────────────────────────────────────

interface PersistenceState {
	/** Project key (git root, or cwd outside a repo). Set at session_start. */
	key: string | null;
	/** In-memory mirror of the on-disk file. Most-recent first. */
	entries: string[];
	/** Entries added since the last flush, newest first. Merged over disk on flush. */
	unsaved: string[];
	/** Set when an addition is pending flush. */
	dirty: boolean;
	/** Flush timer for debounced writes. */
	flushTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Coalesce a burst of additions into a single write. Bash-style: a few hundred
 * milliseconds is enough to fold rapid prompts while still feeling snappy if
 * the user actually quits.
 */
const FLUSH_DEBOUNCE_MS = 250;

/** Re-check cadence while late editor installs (e.g. pi-paster) settle. */
const SETTLE_POLL_MS = 5000;
/** Stop re-asserting after this many stable polls (~15s). */
const SETTLE_STABLE_POLLS = 3;
/** Give up re-asserting after this many polls (~90s). */
const SETTLE_MAX_POLLS = 18;

function makePersistence(): PersistenceState {
	return { key: null, entries: [], unsaved: [], dirty: false, flushTimer: null };
}

// ─── Text extraction ──────────────────────────────────────────────────────────

function extractText(content: string | unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (
			block &&
			typeof block === "object" &&
			"type" in block &&
			(block as { type: unknown }).type === "text" &&
			"text" in block &&
			typeof (block as { text: unknown }).text === "string"
		) {
			parts.push((block as { text: string }).text);
		}
	}
	return parts.join("\n").trim();
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	const persistence = makePersistence();
	let activeEditor: LayeredEditor | null = null;
	let latestFactory: EditorFactory | null = null;
	let settleTimer: ReturnType<typeof setInterval> | null = null;
	let epoch = 0;

	/**
	 * Merge unsaved entries over a fresh disk read, then write. Starting from
	 * disk (not the in-memory mirror) keeps entries saved by concurrent
	 * sessions in the same project.
	 */
	const flushToDisk = async (): Promise<void> => {
		const key = persistence.key;
		if (!key || !persistence.dirty) return;
		persistence.dirty = false;
		const fresh = persistence.unsaved.slice().reverse(); // oldest first
		persistence.unsaved = [];
		const merged = await readDisk(key);
		for (const item of fresh) {
			if (merged[0] !== item) merged.unshift(item); // dedup consecutive
		}
		if (merged.length > MAX_ENTRIES) merged.length = MAX_ENTRIES;
		persistence.entries = merged;
		await writeDisk(key, merged);
	};

	const scheduleFlush = (): void => {
		if (!persistence.key) return;
		persistence.dirty = true;
		if (persistence.flushTimer) return;
		persistence.flushTimer = setTimeout(() => {
			persistence.flushTimer = null;
			void flushToDisk();
		}, FLUSH_DEBOUNCE_MS);
	};

	const flushNow = (): Promise<void> => {
		if (persistence.flushTimer) {
			clearTimeout(persistence.flushTimer);
			persistence.flushTimer = null;
		}
		// Awaited by the session_shutdown handler (pi awaits it before exit),
		// so prompts typed just before quitting still reach disk.
		return flushToDisk();
	};

	/**
	 * Install the history layer onto the live editor. Wraps whatever factory
	 * is currently registered (pi-paster's, if it already ran) so no feature
	 * is lost, and falls back to a default editor when none is registered.
	 */
	const install = (ctx: ExtensionContext): void => {
		const prev = ctx.ui.getEditorComponent();
		const base = prev && prev !== latestFactory ? prev : undefined;
		const makeEditor: EditorFactory = (tui, theme, kb) => {
			const inner = base ? base(tui, theme, kb) : new CustomEditor(tui, theme, kb);
			activeEditor = attachHistory(inner, kb, persistence.entries);
			return activeEditor;
		};
		latestFactory = makeEditor;
		ctx.ui.setEditorComponent(makeEditor);
	};

	const stopSettling = (): void => {
		if (settleTimer) {
			clearInterval(settleTimer);
			settleTimer = null;
		}
	};

	/**
	 * Late installers replace the factory — and with it, history recall.
	 * Re-layer onto the winner until the registration settles.
	 */
	const watchSettling = (ctx: ExtensionContext, runEpoch: number): void => {
		stopSettling();
		let stable = 0;
		let polls = 0;
		settleTimer = setInterval(() => {
			try {
				if (runEpoch !== epoch) return stopSettling();
				polls += 1;
				if (polls > SETTLE_MAX_POLLS) return stopSettling();
				if (ctx.ui.getEditorComponent() === latestFactory) {
					stable += 1;
					if (stable >= SETTLE_STABLE_POLLS) stopSettling();
					return;
				}
				stable = 0;
				install(ctx);
			} catch {
				stopSettling();
			}
		}, SETTLE_POLL_MS);
		settleTimer.unref?.();
	};

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		epoch += 1;
		stopSettling();

		const key = await projectKey(ctx.cwd);
		persistence.key = key;
		persistence.unsaved = [];
		persistence.dirty = false;

		// Read existing history. Always allowed — every session reads and writes.
		persistence.entries = await readDisk(key);

		install(ctx);
		watchSettling(ctx, epoch);
	});

	// Persist any pending writes on shutdown.
	pi.on("session_shutdown", async () => {
		stopSettling();
		await flushNow();
	});

	// Capture every interactive user submission. `input` fires after extension
	// commands but before skill/template expansion — we want the raw typed text,
	// not the expanded form. Programmatic sends (`sendUserMessage`) carry
	// `source: "extension"` and are skipped.
	pi.on("input", (event) => {
		if (event.source !== "interactive") return;
		const text = extractText(event.text);
		if (!text) return;

		// Update the on-disk cache first, then the editor's view, then schedule
		// a debounced flush. The cache and editor stay in lockstep so that
		// history persists across session replacements even if the process is
		// killed before the debounce fires.
		if (persistence.entries[0] !== text) {
			persistence.entries.unshift(text);
			if (persistence.entries.length > MAX_ENTRIES) {
				persistence.entries.length = MAX_ENTRIES;
			}
			persistence.unsaved.unshift(text);
			scheduleFlush();
		}

		activeEditor?.addToHistory(text);
	});
}
