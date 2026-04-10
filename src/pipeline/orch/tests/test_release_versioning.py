import sys
from datetime import datetime
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def test_compute_next_release_version_starts_from_zero_for_today_when_no_today_release():
    rows = [
        {"versionName": "26.04.09.9"},
        {"versionName": "bad.version"},
        {"versionName": ""},
    ]
    out = orch.compute_next_release_version(rows, now=datetime(2026, 4, 10, 9, 0, 0))
    assert out == "26.04.10.0"


def test_compute_next_release_version_increments_latest_today_patch():
    rows = [
        {"versionName": "26.04.10.0"},
        {"versionName": "26.04.10.8"},
        {"versionName": "26.04.10.2"},
        {"versionName": "26.04.09.11"},
    ]
    out = orch.compute_next_release_version(rows, now=datetime(2026, 4, 10, 20, 1, 0))
    assert out == "26.04.10.9"


def test_resolve_release_version_name_prefers_explicit_version():
    rows = [{"versionName": "26.04.10.3"}]
    out = orch.resolve_release_version_name("26.04.10.7", rows, now=datetime(2026, 4, 10, 8, 0, 0))
    assert out == "26.04.10.7"
