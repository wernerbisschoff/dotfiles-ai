"""Check deployment scope without changing the user's home directory."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class DeploymentTests(unittest.TestCase):
    def test_apply_forwards_arguments_and_uses_its_own_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "checkout with spaces"
            script = source / ".chezmoitemplates/scripts/apply.sh"
            script.parent.mkdir(parents=True)
            shutil.copyfile(ROOT / ".chezmoitemplates/scripts/apply.sh", script)
            binary = root / "bin/chezmoi"
            binary.parent.mkdir()
            binary.write_text(
                "#!/usr/bin/env python3\n"
                "import json, sys\n"
                "print(json.dumps(sys.argv[1:]))\n"
            )
            binary.chmod(0o755)
            env = {**os.environ, "PATH": f"{binary.parent}:{os.environ['PATH']}"}
            result = subprocess.run(
                ["bash", str(script), ""], cwd=root, env=env,
                capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            targets = [str(root / "home/.pi/agent/AGENTS.md"), str(root / "a b.md")]
            for arguments in ([], targets, ["--exclude=scripts", *targets]):
                with self.subTest(arguments=arguments):
                    result = subprocess.run(
                        ["bash", str(script), *arguments], cwd=root, env=env,
                        capture_output=True, text=True, check=True,
                    )
                    self.assertEqual(json.loads(result.stdout), [
                        "-S", str(source.resolve()), "apply", *arguments,
                    ])

    def test_runtime_artifacts_are_not_managed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            shutil.copyfile(ROOT / ".chezmoiignore", source / ".chezmoiignore")
            paths = [
                "root.pyc", "root.pyo", "__pycache__/module.pyc",
                "dot_config/herdr/plugins/review/__pycache__/module.pyc",
                "dot_config/herdr/plugins/review/module.pyo",
                "dot_agents/skills/example/__pycache__/module.pyc",
                "dot_pi/agent/extensions/__pycache__/module.pyc",
                ".zvec-grep/state", ".codebase-index/state",
                "dot_agents/skills/example/SKILL.md",
            ]
            for name in paths:
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture\n")
            result = subprocess.run(
                ["chezmoi", "-S", str(source), "-D", str(root / "home"),
                 "managed", "--include=files"],
                capture_output=True, text=True, check=True,
            )
            self.assertEqual(result.stdout.splitlines(), [".agents/skills/example/SKILL.md"])

    def test_pi_model_defaults_are_host_specific(self):
        for hostname, provider, model in (
            ("Werners-Work", "openai-codex", "gpt-6.1-sol"),
            ("personal-laptop", "opencode-go", "deepseek-v4.1-flash"),
        ):
            with self.subTest(hostname=hostname):
                result = subprocess.run(
                    ["chezmoi", "-S", str(ROOT), "--override-data",
                     json.dumps({"chezmoi": {"hostname": hostname}}),
                     "execute-template", "--file",
                     str(ROOT / "dot_pi/agent/settings.json.tmpl")],
                    capture_output=True, text=True, check=True,
                )
                settings = json.loads(result.stdout)
                self.assertEqual(settings["defaultProvider"], provider)
                self.assertEqual(settings["defaultModel"], model)


    def test_skill_templates_render_without_runtime_placeholders(self):
        for path in sorted((ROOT / "dot_agents/skills").glob("*/SKILL.md.tmpl")):
            with self.subTest(skill=path.parent.name):
                result = subprocess.run(
                    ["chezmoi", "-S", str(ROOT), "execute-template", "--file", str(path)],
                    capture_output=True, text=True, check=True,
                )
                body = result.stdout
                self.assertTrue(body.startswith("---\n"))
                self.assertIn("\nname: ", body)
                self.assertIn("\ndescription: ", body)
                self.assertNotIn("$ARGUMENTS", body)


if __name__ == "__main__":
    unittest.main()
