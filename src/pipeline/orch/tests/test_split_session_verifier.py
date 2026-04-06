import subprocess


def test_verifier_requires_base_apk(tmp_path):
    cmd = [
        "python3",
        "scripts/verify_phonepe_split_session_install.py",
        "--base-apk", str(tmp_path / "missing-base.apk"),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    assert proc.returncode != 0
    assert "base apk not found" in (proc.stdout + proc.stderr).lower()
