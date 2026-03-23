import json
import tempfile
import unittest
from pathlib import Path

MANDATORY_PROBE_KEYS = (
    "launch_ok",
    "login_activity_seen",
    "sigbypass_tag",
    "https_tag",
    "pphelper_tag",
    "crash_detected",
)


def ensure_behavior_parity_probe_schema(probe_json_path: Path) -> None:
    payload = json.loads(probe_json_path.read_text(encoding="utf-8"))
    missing = [key for key in MANDATORY_PROBE_KEYS if key not in payload]
    if missing:
        raise KeyError(f"Missing mandatory behavior probe keys: {', '.join(missing)}")
    invalid_types = [
        key
        for key in MANDATORY_PROBE_KEYS
        if not isinstance(payload.get(key), bool)
    ]
    if invalid_types:
        raise TypeError(
            "Mandatory behavior probe keys must be boolean: "
            + ", ".join(invalid_types)
        )


class BehaviorParitySchemaTest(unittest.TestCase):
    def test_probe_schema_contains_all_mandatory_keys(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            probe_path = Path(temp_dir) / "probe.json"
            probe_path.write_text(
                json.dumps({key: False for key in MANDATORY_PROBE_KEYS}),
                encoding="utf-8",
            )

            ensure_behavior_parity_probe_schema(probe_path)

    def test_probe_schema_missing_mandatory_key_raises(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            probe_path = Path(temp_dir) / "probe.json"
            payload = {key: False for key in MANDATORY_PROBE_KEYS}
            del payload["https_tag"]
            probe_path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaises(KeyError) as exc:
                ensure_behavior_parity_probe_schema(probe_path)

            self.assertIn("https_tag", str(exc.exception))

    def test_probe_schema_non_boolean_mandatory_value_raises(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            probe_path = Path(temp_dir) / "probe.json"
            payload = {key: False for key in MANDATORY_PROBE_KEYS}
            payload["launch_ok"] = "true"
            probe_path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaises(TypeError) as exc:
                ensure_behavior_parity_probe_schema(probe_path)

            self.assertIn("launch_ok", str(exc.exception))


if __name__ == "__main__":
    unittest.main()
