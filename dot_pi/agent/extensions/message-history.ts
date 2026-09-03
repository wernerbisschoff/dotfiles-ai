/**
 * message-history.ts — Persistent up/down arrow message history (per-directory)
 *
 * Pi's built-in editor only recalls recently submitted prompts while the
 * editor is empty (or cursor at column 0), and only for the current session.
 * This extension replaces that with a bash-like, persistent history:
 *
 *   • Up on the FIRST visual line     → recall an older message
 *   • Down on the LAST visual line    → recall a newer message
 *   • The in-progress draft is preserved (Down past newest restores it)
 *   • History is persisted to disk per project directory, so prompts survive
 *     /new, /exit, restarts, and are shared between sessions in the same cwd
 *
 * Storage: ~/.pi/message-history/cwd-<sha256(cwd)[:16]>.json (file mode 0600).
 * The cwd is hashed so project paths don't appear in filenames; the agent
 * directory is the canonical user-level location (matches pi's other state).
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
* Concurrency: the first Pi instance per cwd holds the lock (a dir holding
* its pid); others run read-only. A lock whose owner is dead (crash,
* SIGKILL) is stolen on next start, so one crash cannot wedge history
* read-only forever. The pending debounced write is awaited on
* session_shutdown, so prompts typed just before quitting still persist.
 */
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Configuration ───────────────────────────────────────────────────────────

const HISTORY_DIR = "message-history";
const FILE_EXT = ".json";
const LOCK_EXT = ".lock";
const FILE_PREFIX = "cwd-";
/** SHA-256 truncated to 64 bits in hex. ~1 collision per 4B distinct cwds. */
const HASH_LEN = 16;
/** Pid-less lock older than this is orphaned (crashed between mkdir and pid write). */
const STALE_LOCK_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 1000;

// ─── Storage layer ────────────────────────────────────────────────────────────

interface DiskShape {
	/** Most-recent first. Strings only — image-bearing messages drop their images. */
	entries: string[];
	/** Schema version. Bump when the on-disk shape changes. */
	version: 1;
}

/**
 * Hash the cwd into a short, opaque filename. Truncated SHA-256 keeps the
 * filename short while making the cwd unrecoverable from the filesystem.
 */
function cwdHash(cwd: string): string {
	return createHash("sha256").update(cwd).digest("hex").slice(0, HASH_LEN);
}

function historyFile(cwd: string): string {
	return join(getAgentDir(), HISTORY_DIR, `${FILE_PREFIX}${cwdHash(cwd)}${FILE_EXT}`);
}

function lockFile(cwd: string): string {
	return join(getAgentDir(), HISTORY_DIR, `${FILE_PREFIX}${cwdHash(cwd)}${LOCK_EXT}`);
}

async function ensureHistoryDir(): Promise<void> {
	await mkdir(join(getAgentDir(), HISTORY_DIR), { recursive: true, mode: 0o700 });
}

async function readDisk(cwd: string): Promise<string[]> {
	const file = historyFile(cwd);
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

async function writeDisk(cwd: string, entries: string[]): Promise<void> {
	const file = historyFile(cwd);
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

/*
 * mkdir(2) is atomic on POSIX. Using it as a lockfile is a standard trick:
 * the call either succeeds (we hold the lock) or EEXISTs (someone else does).
 * The owner records its pid inside so a later session can steal the lock
 * when the holder is dead (crash, SIGKILL) instead of staying read-only
 * forever. Returns true if the lock was acquired.
 */
const pidFile = (lock: string): string => join(lock, "pid");

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err: unknown) {
		// ESRCH = dead. EPERM = alive but different user. Anything else = assume alive.
		return (err as NodeJS.ErrnoException)?.code !== "ESRCH";
	}
}

async function claimLock(lock: string): Promise<void> {
	await mkdir(lock);
	await writeFile(pidFile(lock), String(process.pid), { mode: 0o600 });
}

async function lockIsStale(lock: string): Promise<boolean> {
	let raw: string;
	try {
		raw = await readFile(pidFile(lock), "utf8");
	} catch {
		// No pid recorded (pre-pid locks, or crashed between mkdir and write).
		// Only steal when old enough that a live holder would have written it.
		try {
			const st = await stat(lock);
			return Date.now() - st.mtimeMs > STALE_LOCK_MS;
		} catch {
			return false;
		}
	}
	const pid = Number(raw.trim());
	if (!Number.isInteger(pid) || pid <= 0) return true;
	if (pid === process.pid) return false;
	return !isPidAlive(pid);
}

async function tryAcquireLock(cwd: string): Promise<boolean> {
	const lock = lockFile(cwd);
	try {
		await ensureHistoryDir();
		await claimLock(lock);
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") {
			// EROFS / EACCES / etc — treat as read-only. The user can still cycle.
			console.warn(`[message-history] lock acquisition failed for ${lock}:`, err);
			return false;
		}
		// Held by someone else — steal it only when the holder is gone.
		try {
			if (!(await lockIsStale(lock))) return false;
			await rm(lock, { recursive: true, force: true });
			await claimLock(lock);
			return true;
		} catch (stealErr) {
			// Lost a race with another session starting up — stay read-only.
			if ((stealErr as NodeJS.ErrnoException)?.code !== "EEXIST") {
				console.warn(`[message-history] lock steal failed for ${lock}:`, stealErr);
			}
			return false;
		}
	}
}

async function releaseLock(cwd: string): Promise<void> {
	const lock = lockFile(cwd);
	try {
		// Only release our own lock — never a new owner's after a steal race.
		const raw = await readFile(pidFile(lock), "utf8").catch(() => null);
		if (raw !== null && Number(raw.trim()) !== process.pid) return;
		await rm(lock, { recursive: true, force: true });
	} catch {
		/* ignore — best-effort */
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
	/** In-memory cache mirroring the on-disk file. Most-recent first. */
	entries: string[];
	/** True if we own the lock and may write. */
	canWrite: boolean;
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
	return { entries: [], canWrite: false, dirty: false, flushTimer: null };
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

	const cwdForCtx = (ctx: ExtensionContext): string => ctx.cwd;

	const scheduleFlush = (ctx: ExtensionContext): void => {
		if (!persistence.canWrite) return;
		persistence.dirty = true;
		if (persistence.flushTimer) return;
		persistence.flushTimer = setTimeout(() => {
			persistence.flushTimer = null;
			if (!persistence.dirty) return;
			persistence.dirty = false;
			void writeDisk(cwdForCtx(ctx), persistence.entries);
		}, FLUSH_DEBOUNCE_MS);
	};

const flushNow = (ctx: ExtensionContext): Promise<void> => {
if (persistence.flushTimer) {
clearTimeout(persistence.flushTimer);
persistence.flushTimer = null;
}
if (!persistence.dirty) return Promise.resolve();
persistence.dirty = false;
// Awaited by the session_shutdown handler (pi awaits it before exit),
// so prompts typed just before quitting still reach disk.
return writeDisk(cwdForCtx(ctx), persistence.entries);
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

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		const cwd = cwdForCtx(ctx);

		// Read existing history. Always allowed — even if the lock is held.
		persistence.entries = await readDisk(cwd);

		// Try to acquire the write lock. If another Pi instance holds it, we
		// still cycle through the on-disk history but skip persistence.
		persistence.canWrite = await tryAcquireLock(cwd);

		ctx.ui.setEditorComponent(makeEditor);

		if (!persistence.canWrite) {
			ctx.ui.notify(
				"message-history: another Pi session holds the lock for this directory — running read-only",
				"info",
			);
		}
	});

	// Persist any pending writes on shutdown.
pi.on("session_shutdown", async (_event, ctx) => {
await flushNow(ctx);
if (persistence.canWrite) {
await releaseLock(cwdForCtx(ctx));
}
});

	// Capture every interactive user submission. `input` fires after extension
	// commands but before skill/template expansion — we want the raw typed text,
	// not the expanded form. Programmatic sends (`sendUserMessage`) carry
	// `source: "extension"` and are skipped.
	pi.on("input", (event, ctx) => {
		if (event.source !== "interactive") return;
		const text = extractText(event.text);
		if (!text) return;

		// Update the on-disk cache first, then the editor's view, then schedule
		// a debounced flush. The cache and editor stay in lockstep so that
		// history persists across session replacements even if the process is
		// killed before the debounce fires.
		if (persistence.canWrite) {
			const trimmed = text;
			if (persistence.entries[0] !== trimmed) {
				persistence.entries.unshift(trimmed);
				if (persistence.entries.length > MAX_ENTRIES) {
					persistence.entries.length = MAX_ENTRIES;
				}
				scheduleFlush(ctx);
			}
		}

		activeEditor?.addToHistory(text);
	});
}