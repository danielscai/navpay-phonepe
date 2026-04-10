import sys
import json
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def _write_release_env_config(tmp_path: Path) -> Path:
    config_path = tmp_path / "release_envs.json"
    config_path.write_text(
        json.dumps(
            {
                "dev": {
                    "base_url_envs": ["RELEASE_DEV_BASE_URL", "RELEASE_BASE_URL"],
                    "token_envs": ["RELEASE_DEV_TOKEN", "RELEASE_TOKEN"],
                    "fallback_base_url": "http://localhost:3000",
                    "fallback_token": "nprt_local_phonepe_publisher",
                    "placeholder": False,
                },
                "test": {
                    "base_url_envs": ["RELEASE_TEST_BASE_URL", "RELEASE_BASE_URL"],
                    "token_envs": ["RELEASE_TEST_TOKEN", "RELEASE_TOKEN"],
                    "fallback_base_url": "",
                    "fallback_token": "",
                    "placeholder": False,
                },
                "prod": {
                    "base_url_envs": ["RELEASE_PROD_BASE_URL"],
                    "token_envs": ["RELEASE_PROD_TOKEN"],
                    "fallback_base_url": "",
                    "fallback_token": "",
                    "placeholder": True,
                },
            }
        ),
        encoding="utf-8",
    )
    return config_path


def test_resolve_release_env_settings_test_prefers_test_scoped_env(monkeypatch, tmp_path):
    config_path = _write_release_env_config(tmp_path)
    monkeypatch.setattr(orch, "RELEASE_ENV_CONFIG_PATH", config_path)
    monkeypatch.setenv("RELEASE_TEST_BASE_URL", "https://test.example.com/")
    monkeypatch.setenv("RELEASE_TEST_TOKEN", "token_test")
    monkeypatch.setenv("RELEASE_BASE_URL", "https://shared.example.com")
    monkeypatch.setenv("RELEASE_TOKEN", "token_shared")

    out = orch.resolve_release_env_settings("test")

    assert out == {
        "env_name": "test",
        "base_url": "https://test.example.com",
        "token": "token_test",
    }


def test_resolve_release_env_settings_test_falls_back_to_shared_env(monkeypatch, tmp_path):
    config_path = _write_release_env_config(tmp_path)
    monkeypatch.setattr(orch, "RELEASE_ENV_CONFIG_PATH", config_path)
    monkeypatch.delenv("RELEASE_TEST_BASE_URL", raising=False)
    monkeypatch.delenv("RELEASE_TEST_TOKEN", raising=False)
    monkeypatch.setenv("RELEASE_BASE_URL", "https://shared.example.com/")
    monkeypatch.setenv("RELEASE_TOKEN", "token_shared")

    out = orch.resolve_release_env_settings("test")

    assert out == {
        "env_name": "test",
        "base_url": "https://shared.example.com",
        "token": "token_shared",
    }


def test_resolve_release_env_settings_test_requires_configuration(monkeypatch, tmp_path):
    config_path = _write_release_env_config(tmp_path)
    monkeypatch.setattr(orch, "RELEASE_ENV_CONFIG_PATH", config_path)
    monkeypatch.delenv("RELEASE_TEST_BASE_URL", raising=False)
    monkeypatch.delenv("RELEASE_TEST_TOKEN", raising=False)
    monkeypatch.delenv("RELEASE_BASE_URL", raising=False)
    monkeypatch.delenv("RELEASE_TOKEN", raising=False)

    try:
        orch.resolve_release_env_settings("test")
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "missing base URL configuration" in str(exc)


def test_resolve_release_env_settings_uses_selected_env_from_json(monkeypatch, tmp_path):
    config_path = _write_release_env_config(tmp_path)
    monkeypatch.setattr(orch, "RELEASE_ENV_CONFIG_PATH", config_path)
    monkeypatch.delenv("RELEASE_TEST_BASE_URL", raising=False)
    monkeypatch.delenv("RELEASE_TEST_TOKEN", raising=False)
    monkeypatch.setenv("RELEASE_DEV_BASE_URL", "https://dev.example.com/")
    monkeypatch.setenv("RELEASE_DEV_TOKEN", "dev_token")

    out = orch.resolve_release_env_settings("dev")

    assert out == {
        "env_name": "dev",
        "base_url": "https://dev.example.com",
        "token": "dev_token",
    }
