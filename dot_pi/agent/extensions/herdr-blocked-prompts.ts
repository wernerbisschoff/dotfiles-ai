/**
 * herdr-blocked-prompts — report Pi dialogs to Herdr as "needs input".
 *
 * Herdr's Pi integration (`herdr-agent-state.ts`) only enters `blocked` on
 * `herdr:blocked` bus events. Our `ask_user` tool emits those, but Pi's own
 * `ctx.ui.select/confirm/input/editor/custom` dialogs (approvals, gates, other
 * extensions) do not, so a pane waiting on a dialog stays `working` and Herdr
 * sends no needs-input notification.
 * Upstream: https://github.com/herdrdev/herdr/issues/4143
 *
 * Pi coalesces `ui_prompt_start`/`ui_prompt_end` into one outer span per wait,
 * so they pair 1:1 with the integration's blocked counter. Emitting outside
 * Herdr is harmless: that integration ignores the event without a TUI session.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("ui_prompt_start", (event) => {
		pi.events.emit("herdr:blocked", {
			active: true,
			label: event.title ?? `ai:${event.kind}`,
		});
	});

	pi.on("ui_prompt_end", () => {
		pi.events.emit("herdr:blocked", { active: false });
	});
}
