/**
 * mise-env — apply directory-specific mise variables to Bash tool processes.
 *
 * Pi starts Bash with its own long-lived process environment. A later `cd`
 * does not run the interactive mise hook. Resolve mise for each Bash call so
 * tools such as DeviaTDD receive the target worktree environment.
 *
 * PI_MODEL remains Pi session metadata. Project PI_MODEL is exposed as
 * PI_DEFAULT_MODEL for compatibility while projects migrate to that name.
 */

import { spawnSync } from "node:child_process";

import {
	createBashTool,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const MISE_TIMEOUT_MS = 5_000;
const PI_SESSION_KEYS = [
	"PI_SESSION_ID",
	"PI_SESSION_FILE",
	"PI_PROVIDER",
	"PI_MODEL",
	"PI_REASONING_LEVEL",
] as const;

function resolveMiseEnv(cwd: string): NodeJS.ProcessEnv | undefined {
	const result = spawnSync("mise", ["env", "--json"], {
		cwd,
		encoding: "utf8",
		timeout: MISE_TIMEOUT_MS,
		windowsHide: true,
	});
	if (result.status !== 0 || !result.stdout) return undefined;

	try {
		const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
		return Object.fromEntries(
			Object.entries(parsed).filter((entry): entry is [string, string] => {
				return typeof entry[1] === "string";
			}),
		);
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI): void {
	const bashTool = createBashTool(process.cwd(), {
		spawnHook: ({ command, cwd, env }) => {
			const miseEnv = resolveMiseEnv(cwd);
			if (!miseEnv) return { command, cwd, env };

			const sessionEnv = Object.fromEntries(
				PI_SESSION_KEYS.flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]]])),
			);
			const defaultModel = miseEnv.PI_DEFAULT_MODEL ?? miseEnv.PI_MODEL;

			return {
				command,
				cwd,
				env: {
					...env,
					...miseEnv,
					...(defaultModel ? { PI_DEFAULT_MODEL: defaultModel } : {}),
					...sessionEnv,
				},
			};
		},
	});

	pi.registerTool({
		...bashTool,
		promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
		promptGuidelines: [
			"Inspect PI_* environment variables for current model and session details.",
		],
	});
}
