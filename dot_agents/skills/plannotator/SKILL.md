---
name: plannotator
description: Open a human decision or feedback review in Plannotator and handle its outcome. Use when the user requests Plannotator or a consequential decision needs human sign-off.
---

Follow the active approval policy. If a workflow runner owns the gate, use its workflow; do not open a second review.

- Announce what to review and what decision or feedback is needed. Use a review tool when it explicitly returns the decision to the review owner. A browser launch or saved stdout is not a callback.
- Otherwise run one of the following in a foreground, blocking tool call owned by the reviewing agent. Use no timeout if supported, otherwise at least 1800 seconds. Do not detach, end the turn while it waits, or cancel mid-review.

  ```sh
  plannotator annotate <file> --gate --json
  plannotator review --patch-file <patch> --gate --json
  ```

  Add `--no-git-remote-check` to `review` if remote authentication is interactive. For requested feedback only, use annotation without `--gate`; it cannot authorize dependent work. Gated `annotate` supports `--result-file <path>` for recovery; use a distinct path per review.

- Read the JSON in the same turn. Branch on `decision`, not message wording: `approved` authorizes only the stated decision; on `annotated`, read and address or clarify the feedback; `dismissed`, abort, failure, or a missing decision leaves the gate unresolved. If interrupted, recover any saved result for the same review and revision before reopening or continuing.
