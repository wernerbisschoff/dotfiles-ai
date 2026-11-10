/**
 * opencode-session-header — give out-of-band provider calls a session id.
 *
 * Pi attaches `x-opencode-session` only when the caller passes `sessionId` to
 * the provider request (`ModelRuntime.prepareRequest`). The agent's own stream
 * does. Extensions that call `ctx.modelRegistry.complete()` directly do not, so
 * opencode answers 400 MissingSessionID. ACP's summary model is such a caller.
 *
 * Fill the option in once per session so those callers work unchanged. Providers
 * that do not use the header ignore the extra option.
 */

import type { ExtensionAPI, ModelRegistry } from "@earendil-works/pi-coding-agent";

type CompleteArgs = Parameters<ModelRegistry["complete"]>;
type RegistryOptions = CompleteArgs[2];
type SessionOptions = NonNullable<RegistryOptions> & { sessionId?: string };

export default function (pi: ExtensionAPI): void {
	const patched = new WeakSet<object>();

	pi.on("session_start", (_event, ctx) => {
		const registry = ctx.modelRegistry;
		if (patched.has(registry)) return;
		patched.add(registry);

		const complete = registry.complete.bind(registry);

		registry.complete = ((
			model: CompleteArgs[0],
			context: CompleteArgs[1],
			options?: SessionOptions,
		) =>
			complete(model, context, {
				...options,
				sessionId: options?.sessionId ?? ctx.sessionManager.getSessionId(),
			} as RegistryOptions)) as typeof registry.complete;
	});
}
