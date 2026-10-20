#!/usr/bin/env python3
import json
import os
import subprocess
import sys


def run(args, *, capture_output=False, cwd=None):
    return subprocess.run(
        args,
        check=True,
        text=True,
        capture_output=capture_output,
        cwd=cwd,
    )


def main():
    pane_id = os.environ.get("HERDR_PANE_ID")
    if not pane_id:
        raise SystemExit("Run this action from an agent pane")

    herdr = os.environ.get("HERDR_BIN_PATH", "herdr")
    pane = json.loads(run([herdr, "pane", "get", pane_id], capture_output=True).stdout)
    cwd = pane["result"]["pane"]["cwd"]
    review = json.loads(run(["plannotator", "review", "--json"], capture_output=True, cwd=cwd).stdout)
    feedback = review.get("message", "").strip()
    if review.get("decision") not in ("annotated", "approved") or not feedback:
        return

    run([herdr, "agent", "prompt", pane_id, feedback, "--wait"])


if __name__ == "__main__":
    main()
