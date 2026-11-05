/**
 * session-naming.ts — Name sessions after the line you actually typed.
 *
 * The resume picker shows the session name, and otherwise the first user
 * message. With skills that first message is the expanded skill body, so a
 * project full of `/skill:archon-query` sessions shows pages of identical
 * preamble and no way to tell them apart.
 *
 * The `input` event fires before skill and template expansion, so it still
 * sees the raw text. Naming the session there keeps what you typed:
 *
 *   /skill:archon-query what are the core concepts of this book?
 *
 * Rules:
 *   • The first human input names the session.
 *   • A name that is only a bare command (`/skill:archon-ingest`) carries no
 *     request, so the next input with content replaces it.
 *   • Any other existing name was chosen by a human (`/name`, picker rename)
 *     and is never overwritten.
 *   • Sessions created before this extension are named on load, reconstructed
 *     from their first human message as `/skill:<name> <request>`.
 */
import { parseSkillBlock, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Flatten to a single line; the picker clips at the terminal width. */
function toName(text: string): string | undefined {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat || undefined;
}

/** `/skill:foo` with no arguments says nothing about the request. */
function isBareCommand(name: string): boolean {
	return /^\/\S+$/.test(name);
}

export default function (pi: ExtensionAPI) {
	pi.on("input", (event) => {
		// Extension-injected prompts are not human intent.
		if (event.source === "extension") return;

		const name = toName(event.text);
		if (!name) return;

		const current = pi.getSessionName();
		if (current !== undefined && !isBareCommand(current)) return;
		if (name === current) return;

		pi.setSessionName(name);
	});

	pi.on("session_start", (_event, ctx) => {
		if (pi.getSessionName()) return;

		const firstUser = ctx.sessionManager
			.getEntries()
			.find((entry) => entry.type === "message" && entry.message.role === "user");
		if (!firstUser || firstUser.type !== "message") return;

		const content = firstUser.message.content;
		const text =
			typeof content === "string"
				? content
				: content.map((block) => (block.type === "text" ? block.text : "")).join(" ");
		const skill = parseSkillBlock(text);
		const name = toName(skill ? `/skill:${skill.name} ${skill.userMessage ?? ""}` : text);
		if (name) pi.setSessionName(name);
	});
}
