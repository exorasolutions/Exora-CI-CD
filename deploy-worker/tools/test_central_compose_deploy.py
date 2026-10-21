import runpy
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path


HELPER = Path(__file__).with_name("central-compose-deploy")


def helper_module():
    return runpy.run_path(str(HELPER), run_name="central_compose_deploy_tests")


def loomrun_policy():
    return {
        "targetId": "loomrun-production",
        "projectId": "loomrun",
        "candidateContextPolicy": "loomrun-source-root-v1",
    }


def make_release(root: Path):
    required_files = [
        "compose.yaml",
        "compose.prod.yaml",
        "apps/web/Dockerfile",
        "apps/web/package.json",
        "apps/web/package-lock.json",
        "apps/web/nginx.conf",
        "apps/api/Dockerfile",
        "apps/api/requirements.lock.txt",
        "prisma/schema.prisma",
    ]
    required_dirs = ["apps/api/loomrun_api", "apps/web/src", "apps/web/public", "n8n", "prisma"]
    for relative in required_files:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fixture\n", encoding="utf-8")
    for relative in required_dirs:
        (root / relative).mkdir(parents=True, exist_ok=True)


def make_staging_policy(root: Path):
    compose = root / "staging-compose.yaml"
    compose.write_text(
        "services: {}\n"
        "networks:\n"
        "  default:\n"
        "    name: loomrun-staging-test-network\n"
        "volumes:\n"
        "  loomrun-staging-test-storage:\n"
        "  loomrun-staging-test-database:\n"
        "x-env: staging.env\n",
        encoding="utf-8",
    )
    artifact = root / "artifact.tar.gz"
    artifact.write_bytes(b"staging-artifact")
    marker = root / ".central-cicd" / "staging-marker.json"
    marker.parent.mkdir(parents=True)
    marker.write_text(json.dumps({"targetId": "loomrun-staging-test", "deploymentId": "deployment-test"}), encoding="utf-8")
    policy = {
        "schemaVersion": 1,
        "deploymentId": "deployment-test",
        "releaseId": "release-test",
        "projectId": "loomrun",
        "targetId": "loomrun-staging-test",
        "environment": "staging",
        "commitSha": "a" * 40,
        "artifactPath": str(artifact),
        "artifactSha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        "targetRoot": str(root),
        "composeProject": "loomrun-staging-test",
        "composeWorkingDir": str(root),
        "composeFiles": [str(compose)],
        "composeServices": ["web", "api", "redis", "postgres"],
        "builtServices": ["api", "web"],
        "healthServices": ["api", "web"],
        "containers": ["loomrun-staging-test-api-1", "loomrun-staging-test-web-1"],
        "persistentMounts": "staging-only",
        "publicBindings": "127.0.0.1:18107->80",
        "preservePolicy": "staging-only",
        "candidateContextPolicy": "loomrun-source-root-v1",
        "healthContract": "loomrun-web-root-api-ready-v1",
        "stagingRoot": str(root),
        "lockRoot": str(root / ".central-cicd" / "locks"),
        "stagingNetwork": "loomrun-staging-test-network",
        "stagingVolumes": ["loomrun-staging-test-storage", "loomrun-staging-test-database"],
        "stagingMarker": str(marker),
    }
    policy_path = root / ".central-cicd" / "staging-policy.json"
    policy_path.write_text(json.dumps(policy), encoding="utf-8")
    return policy_path, policy


class LoomrunContextTests(unittest.TestCase):
    def test_prepares_root_api_and_web_contexts(self):
        module = helper_module()
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory)
            make_release(release)
            contexts = module["prepare_build_contexts"](loomrun_policy(), release)
            self.assertEqual(contexts["web"]["context"], str((release / "apps/web").resolve()))
            self.assertEqual(contexts["web"]["dockerfile"], "Dockerfile")
            self.assertEqual(contexts["api"]["context"], str(release.resolve()))
            self.assertEqual(contexts["api"]["dockerfile"], "apps/api/Dockerfile")

    def test_prepares_contexts_for_explicit_loomrun_staging_target(self):
        module = helper_module()
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory)
            make_release(release)
            policy = loomrun_policy()
            policy["targetId"] = "loomrun-staging-test"
            contexts = module["prepare_build_contexts"](policy, release)
            self.assertEqual(contexts["api"]["dockerfile"], "apps/api/Dockerfile")
            self.assertEqual(contexts["web"]["context"], str((release / "apps/web").resolve()))

    def test_rejects_identity_mismatch(self):
        module = helper_module()
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory)
            make_release(release)
            bad = loomrun_policy()
            bad["projectId"] = "cab"
            with self.assertRaisesRegex(RuntimeError, "not approved"):
                module["prepare_build_contexts"](bad, release)

    def test_rejects_missing_required_input_without_writing_release(self):
        module = helper_module()
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory)
            make_release(release)
            (release / "n8n").rmdir()
            with self.assertRaisesRegex(RuntimeError, "n8n"):
                module["prepare_build_contexts"](loomrun_policy(), release)
            self.assertEqual(list(release.rglob("*.central-cicd*")), [])

    def test_rejects_symlinked_required_path(self):
        module = helper_module()
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory) / "release"
            outside = Path(directory) / "outside-n8n"
            release.mkdir()
            make_release(release)
            outside.mkdir()
            (release / "n8n").rmdir()
            try:
                (release / "n8n").symlink_to(outside, target_is_directory=True)
            except OSError as error:
                self.skipTest(f"symlink creation unavailable: {error}")
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                module["prepare_build_contexts"](loomrun_policy(), release)

    def test_cleanup_removes_only_the_staging_deployment(self):
        module = helper_module()
        with tempfile.TemporaryDirectory() as directory:
            staging_root = Path(directory) / "staging"
            module["cleanup_staging"].__globals__["STAGING_ROOT"] = staging_root
            policy = {"targetId": "loomrun-production", "deploymentId": "42"}
            path = staging_root / policy["targetId"] / policy["deploymentId"]
            path.mkdir(parents=True)
            (path / "artifact.tar.gz").write_bytes(b"fixture")
            module["cleanup_staging"](policy)
            self.assertFalse(path.exists())
            self.assertTrue((staging_root / policy["targetId"]).exists())

    def test_loomrun_rollback_restores_images_without_touching_runtime_mounts(self):
        module = helper_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy = {
                "targetId": "loomrun-production",
                "deploymentId": "42",
                "releaseId": "cicd-test-42",
                "targetRoot": str(root),
                "composeProject": "loomrun",
                "builtServices": ["api", "web"],
                "healthServices": ["web", "api"],
                "composeServices": ["web", "api", "redis"],
                "composeWorkingDir": str(root),
                "composeFiles": [str(root / "compose.yaml"), str(root / "compose.prod.yaml")],
                "persistentMounts": "/srv/apps/loomrun/.env:/app/.env:ro,/srv/apps/loomrun/data/storage:/loomrun-storage",
                "networks": "loomrun_default,shared",
            }
            state = {
                "status": "deployed",
                "activationStarted": True,
                "oldImages": {
                    "api": {"imageId": "sha256:" + "a" * 64},
                    "web": {"imageId": "sha256:" + "b" * 64},
                },
            }
            module["write_state"](policy, state)
            commands = []

            def fake_run(args, **kwargs):
                commands.append(args)
                return ""

            def fake_docker(args, capture=False):
                if args[:2] == ["image", "inspect"]:
                    return "sha256:" + ("a" if "api" in args[2] else "b") * 64
                return ""

            module["rollback_locked"].__globals__["run"] = fake_run
            module["rollback_locked"].__globals__["docker"] = fake_docker
            module["rollback_locked"].__globals__["compose_config"] = lambda *args, **kwargs: None
            module["rollback_locked"].__globals__["wait_services"] = lambda *args, **kwargs: None
            module["rollback_locked"](policy)

            restored = module["state_path"](policy)
            self.assertEqual(module["json"].loads(restored.read_text())["status"], "rolled_back")
            override = root / ".central-cicd" / "compose-state" / "override-cicd-test-42-rollback.yaml"
            override_text = override.read_text()
            self.assertIn("loomrun-api:recovery-42", override_text)
            self.assertIn("loomrun-web:recovery-42", override_text)
            self.assertIn("build: !reset null", override_text)
            self.assertNotIn("down", " ".join(" ".join(command) for command in commands))
            self.assertEqual(policy["persistentMounts"], "/srv/apps/loomrun/.env:/app/.env:ro,/srv/apps/loomrun/data/storage:/loomrun-storage")
            self.assertEqual(policy["networks"], "loomrun_default,shared")

    def test_loomrun_updates_api_before_web(self):
        module = helper_module()
        self.assertEqual(
            module["compose_deployment_order"]({"targetId": "loomrun-production", "builtServices": ["web", "api"]}),
            ["api", "web"],
        )

    def test_loomrun_prisma_migration_uses_candidate_before_activation(self):
        module = helper_module()
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            return ""

        module["run_loomrun_prisma_migrations"].__globals__["run"] = fake_run
        module["run_loomrun_prisma_migrations"].__globals__["Path"] = lambda _value: type("EnvFile", (), {
            "__str__": lambda self: "/srv/apps/loomrun/.env",
            "is_symlink": lambda self: False,
            "is_file": lambda self: True,
        })()
        module["run_loomrun_prisma_migrations"](
            {"targetId": "loomrun-production", "migrationPolicy": "loomrun-prisma-5-forward-only-v1"},
            {"api": "loomrun-api:cicd-" + "a" * 12 + "-42"},
        )
        args, kwargs = calls[0]
        self.assertIn("loomrun-api:cicd-" + "a" * 12 + "-42", args)
        self.assertEqual(args[-4:], ["migrate", "deploy", "--schema", "prisma/schema.prisma"])
        self.assertEqual(kwargs["timeout"], 1800)

    def test_staging_policy_requires_explicit_isolated_identity(self):
        module = helper_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "staging-run"
            root.mkdir(parents=True)
            policy_path, policy = make_staging_policy(root)
            old_root = os.environ.get(module["STAGING_ROOT_ENV"])
            os.environ[module["STAGING_ROOT_ENV"]] = str(Path(directory))
            try:
                resolved, loaded = module["validate_staging_policy"](policy_path)
                self.assertEqual(resolved, policy_path.resolve())
                self.assertEqual(loaded["environment"], "staging")
                policy["targetRoot"] = "D:/srv/apps/loomrun"
                policy["stagingRoot"] = "D:/srv/apps/loomrun"
                policy_path.write_text(json.dumps(policy), encoding="utf-8")
                with self.assertRaisesRegex(RuntimeError, "staging target root must be a child"):
                    module["validate_staging_policy"](policy_path)
            finally:
                if old_root is None:
                    os.environ.pop(module["STAGING_ROOT_ENV"], None)
                else:
                    os.environ[module["STAGING_ROOT_ENV"]] = old_root

    def test_staging_policy_rejects_production_compose_identity(self):
        module = helper_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "staging-run"
            root.mkdir(parents=True)
            policy_path, policy = make_staging_policy(root)
            policy["composeProject"] = "loomrun"
            policy_path.write_text(json.dumps(policy), encoding="utf-8")
            old_root = os.environ.get(module["STAGING_ROOT_ENV"])
            os.environ[module["STAGING_ROOT_ENV"]] = str(Path(directory))
            try:
                with self.assertRaisesRegex(RuntimeError, "invalid Loomrun staging Compose project"):
                    module["validate_staging_policy"](policy_path)
            finally:
                if old_root is None:
                    os.environ.pop(module["STAGING_ROOT_ENV"], None)
                else:
                    os.environ[module["STAGING_ROOT_ENV"]] = old_root

    def test_production_commands_still_use_live_guard(self):
        module = helper_module()
        module["guard_live_mutation"].__globals__["approved_live_targets"] = lambda: set()
        self.assertIn("loomrun-production", module["LIVE_MUTATION_TARGETS"])
        with self.assertRaisesRegex(RuntimeError, "blocked"):
            module["guard_live_mutation"]("deploy", "loomrun-production")
        with self.assertRaisesRegex(RuntimeError, "blocked"):
            module["guard_live_mutation"]("rollback", "cab-production")

    def test_loomrun_requires_verified_contract_after_live_opt_in(self):
        module = helper_module()
        module["guard_live_mutation"].__globals__["approved_live_targets"] = lambda: {"loomrun-production"}
        self.assertIsNone(module["guard_live_mutation"]("deploy", "loomrun-production"))

        disabled = {
            "targetId": "loomrun-production",
            "projectId": "loomrun",
            "targetRoot": "/srv/apps/loomrun",
            "composeProject": "loomrun",
            "composeWorkingDir": "/srv/apps/loomrun",
            "composeFiles": ["/srv/apps/loomrun/compose.yaml", "/srv/apps/loomrun/compose.prod.yaml"],
            "composeServices": ["web", "api", "redis"],
            "builtServices": ["web", "api"],
            "healthServices": ["web", "api"],
            "containers": ["loomrun-web-1", "loomrun-api-1", "loomrun-redis-1"],
            "persistentMounts": "/srv/apps/loomrun/.env:/app/.env:ro,/srv/apps/loomrun/data/storage:/loomrun-storage",
            "publicBindings": "127.0.0.1:8107->80",
            "networks": "loomrun_default,shared",
            "internalPorts": "api:8002,redis:6379",
            "preservePolicy": "preserve-storage-env-redis-shared-network",
            "candidateContextPolicy": "loomrun-source-root-v1",
            "healthContract": "loomrun-web-root-api-ready-v1",
            "migrationPolicy": "loomrun-prisma-5-forward-only-v1",
            "deploymentStatus": "disabled-compose-helper-not-production-installed",
            "composeHealthPolicy": "blocked-pending-verified-health-contract",
        }
        with self.assertRaisesRegex(RuntimeError, "not approved for live helper execution"):
            module["validate_approved_contract"](disabled)


if __name__ == "__main__":
    unittest.main()
