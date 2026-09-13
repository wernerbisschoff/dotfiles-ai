/**
 * message-history.ts — Persistent up/down arrow message history (per-project)
 *
 * Pi's built-in editor only recalls recently submitted prompts while the
 * editor is empty (or cursor at column 0), and only for the current session.
 * This extension replaces that with a bash-like, persistent history:
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

interface HistoryState {
	entries: string[];
	index: number;
	draft: string | null;
}

class MessageHistoryEditor extends CustomEditor {
	private historyState: HistoryState = { entries: [], index: -1, draft: null };
	// `keybindings` is private on CustomEditor. Hold our own reference so we can
	// match user-config-bound keys (e.g. ctrl+p → cursorUp).
	private kb: KeybindingsManager;

	constructor(tui: TUI, theme: EditorTheme, kb: KeybindingsManager) {
		super(tui, theme, kb);
		this.kb = kb;
	}

	/** Seed history from disk. Most-recent first. */
	loadHistory(entries: string[]): void {
		this.historyState.entries = entries.slice(0, MAX_ENTRIES);
		this.historyState.index = -1;
		this.historyState.draft = null;
	}

	/** Push a freshly submitted message into history. */
	addToHistory(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;
		if (this.historyState.entries[0] === trimmed) return; // dedup consecutive
		this.historyState.entries.unshift(trimmed);
		if (this.historyState.entries.length > MAX_ENTRIES) {
			this.historyState.entries.length = MAX_ENTRIES;
		}
		// Reset browsing — the new entry is now the most recent.
		this.historyState.index = -1;
		this.historyState.draft = null;
	}

	private captureDraft(): void {
		if (this.historyState.index !== -1) return; // already browsing
		this.historyState.draft = this.getText();
	}

	private recall(direction: -1 | 1): void {
		const { entries } = this.historyState;
		if (entries.length === 0) return;

		this.captureDraft();

		// up (-1) → older (index increases), down (+1) → newer (index decreases)
		const newIndex = this.historyState.index - direction;
		if (newIndex < -1 || newIndex >= entries.length) return;

		this.historyState.index = newIndex;

		if (newIndex === -1) {
			// Down past newest → restore draft.
			const draft = this.historyState.draft;
			this.historyState.draft = null;
			this.setText(draft ?? "");
			return;
		}

		this.setText(entries[newIndex] ?? "");
	}

	override handleInput(data: string): void {
		// When an autocomplete dropdown is open (e.g. the @ file completer),
		// up/down must navigate the suggestion list, not recall history. Delegate
		// all input to the base editor, which routes arrows to the list first.
		if (this.isShowingAutocomplete()) {
			super.handleInput(data);
			return;
		}

		if (this.kb.matches(data, "tui.editor.cursorUp")) {
			if (this.cursorOnFirstLine()) {
				this.recall(-1);
				return;
			}
		}

		if (this.kb.matches(data, "tui.editor.cursorDown")) {
			if (this.historyState.index > -1 && this.cursorOnLastLine()) {
				this.recall(1);
				return;
			}
		}

		super.handleInput(data);
	}

	// Cursor-position helpers (the base Editor's same-named methods are private
	// and we re-implement here using only the public getCursor/getLines API).
	// Using logical-line index is sufficient: the user is on the first logical
	// line whenever they're at the top of any wrapped paragraph, and the
	// built-in editor applies the same heuristic for history navigation.
	private cursorOnFirstLine(): boolean {
		return this.getCursor().line === 0;
	}

	private cursorOnLastLine(): boolean {
		const lines = this.getLines();
		return this.getCursor().line >= lines.length - 1;
	}
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
	let activeEditor: MessageHistoryEditor | null = null;

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

	const makeEditor = (
		tui: TUI,
		theme: EditorTheme,
		kb: KeybindingsManager,
	): MessageHistoryEditor => {
		const editor = new MessageHistoryEditor(tui, theme, kb);
		activeEditor = editor;
		// Seed editor's in-memory view with the cached entries. The editor
		// holds its own copy so it can mutate (rotate the index) freely.
		editor.loadHistory(persistence.entries);
		return editor;
	};

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;

		const key = await projectKey(ctx.cwd);
		persistence.key = key;
		persistence.unsaved = [];
		persistence.dirty = false;

		// Read existing history. Always allowed — every session reads and writes.
		persistence.entries = await readDisk(key);

		ctx.ui.setEditorComponent(makeEditor);
	});

	// Persist any pending writes on shutdown.
	pi.on("session_shutdown", async () => {
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
