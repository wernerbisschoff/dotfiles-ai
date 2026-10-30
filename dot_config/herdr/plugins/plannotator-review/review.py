#!/usr/bin/env python3
import json
import os
import signal
import subprocess
from contextlib import suppress


def run(args, *, capture_output=False, cwd=None):
    return subprocess.run(
        args,
        check=True,
        text=True,
        capture_output=capture_output,
        cwd=cwd,
    )


def run_review(cwd):
    try:
        timeout = int(os.environ.get("PLANNOTATOR_REVIEW_TIMEOUT_SECONDS", "3600"))
        if timeout <= 0:
            raise ValueError
    except ValueError:
        raise SystemExit("PLANNOTATOR_REVIEW_TIMEOUT_SECONDS must be a positive integer") from None

    def cancel(signum, frame):
        raise KeyboardInterrupt

    previous = signal.signal(signal.SIGTERM, cancel)
    try:
        with subprocess.Popen(
            ["plannotator", "review", "--json"],
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        ) as process:
            try:
                stdout, stderr = process.communicate(timeout=timeout)
            except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
                with suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                process.communicate()
                reason = "expired" if isinstance(error, subprocess.TimeoutExpired) else "cancelled"
                raise SystemExit(f"Review {reason}; no feedback sent") from None
            if process.returncode:
                raise SystemExit(stderr.strip() or f"Review failed ({process.returncode})")
            return json.loads(stdout)
    finally:
        signal.signal(signal.SIGTERM, previous)


def main():
    pane_id = os.environ.get("HERDR_PANE_ID")
    if not pane_id:
        raise SystemExit("Run this action from an agent pane")

    herdr = os.environ.get("HERDR_BIN_PATH", "herdr")
    pane = json.loads(run([herdr, "pane", "get", pane_id], capture_output=True).stdout)
    cwd = pane["result"]["pane"]["cwd"]
    review = run_review(cwd)
    feedback = review.get("message", "").strip()
    if review.get("decision") not in ("annotated", "approved") or not feedback:
        return

    run([herdr, "agent", "prompt", pane_id, feedback, "--wait"])


if __name__ == "__main__":
    main()
