import json
import importlib.util
import os
import signal
import subprocess
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

path = Path(__file__).resolve().parents[2] / "dot_config/herdr/plugins/plannotator-review/review.py"
spec = importlib.util.spec_from_file_location("review", path)
assert spec is not None and spec.loader is not None
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ReviewTests(unittest.TestCase):
    def test_success(self):
        process = MagicMock(returncode=0)
        process.communicate.return_value = ('{"decision":"approved","message":"ok"}', "")
        with patch.object(review.subprocess, "Popen") as popen:
            popen.return_value.__enter__.return_value = process
            with patch.dict(os.environ, {"PLANNOTATOR_REVIEW_TIMEOUT_SECONDS": "42"}):
                self.assertEqual(review.run_review(".")["message"], "ok")
            process.communicate.assert_called_once_with(timeout=42)
            self.assertEqual(
                popen.call_args.args[0],
                ["plannotator", "review", "--diff-type", "uncommitted", "--no-git-remote-check", "--json"],
            )

    def test_timeout_and_cancellation_kill_process_group(self):
        for error, reason in [
            (subprocess.TimeoutExpired("plannotator", 1), "expired"),
            (KeyboardInterrupt(), "cancelled"),
        ]:
            with self.subTest(reason=reason):
                process = MagicMock(pid=123)
                process.communicate.side_effect = [error, ("", "")]
                previous = signal.getsignal(signal.SIGTERM)
                with patch.object(review.subprocess, "Popen") as popen, patch.object(review.os, "killpg") as killpg:
                    popen.return_value.__enter__.return_value = process
                    with self.assertRaisesRegex(SystemExit, f"Review {reason}; no feedback sent"):
                        review.run_review(".")
                    killpg.assert_called_once_with(123, signal.SIGKILL)
                self.assertEqual(signal.getsignal(signal.SIGTERM), previous)

    def test_invalid_timeout_does_not_start_review(self):
        with patch.dict(os.environ, {"PLANNOTATOR_REVIEW_TIMEOUT_SECONDS": "0"}), patch.object(review.subprocess, "Popen") as popen:
            with self.assertRaisesRegex(SystemExit, "positive integer"):
                review.run_review(".")
            popen.assert_not_called()


class ReviewPromptTests(unittest.TestCase):
    def test_review_messages_preserve_feedback_without_git_instructions(self):
        config = Path(__file__).resolve().parents[2] / "dot_plannotator/config.json"
        prompts = json.loads(config.read_text())["prompts"]["review"]
        self.assertEqual(set(prompts), {"approved", "approvedWithNotes", "denied"})
        self.assertIn("{" * 2 + "feedback" + "}" * 2, prompts["approvedWithNotes"])
        for name, prompt in prompts.items():
            with self.subTest(prompt=name):
                self.assertNotIn("git add", prompt)
                self.assertIn("Workflow ownership:", prompt)
        self.assertIn("Questions are not requests to edit", prompts["denied"])
        self.assertIn("Concerns are not repair authorization", prompts["denied"])


if __name__ == "__main__":
    unittest.main()
