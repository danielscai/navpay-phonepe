from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
MODULE_ROOT = REPO_ROOT / "src/apk/heartbeat_bridge"


def test_heartbeat_bridge_module_layout_exists() -> None:
    expected = [
        MODULE_ROOT / "README.md",
        MODULE_ROOT / "scripts/compile.sh",
        MODULE_ROOT / "scripts/merge.sh",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatBridgeContract.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatBridgeProvider.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatSender.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatScheduler.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/ModuleInit.java",
    ]

    missing = [str(path.relative_to(REPO_ROOT)) for path in expected if not path.exists()]
    assert not missing, f"missing heartbeat_bridge files: {', '.join(missing)}"


def test_heartbeat_bridge_contract_mentions_async_send_and_scheduler() -> None:
    provider = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatBridgeProvider.java").read_text(encoding="utf-8")
    sender = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatSender.java").read_text(encoding="utf-8")
    scheduler = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatScheduler.java").read_text(encoding="utf-8")
    contract = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatBridgeContract.java").read_text(encoding="utf-8")
    navpay_sender = (REPO_ROOT / "src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayHeartbeatSender.java").read_text(
        encoding="utf-8"
    )

    assert "HeartbeatSender.sendHeartbeatAsync" in provider
    assert "scheduleAtFixedRate" in scheduler
    assert "30_000L" in scheduler
    assert "HttpURLConnection" in sender
    assert "openConnection()" in sender
    assert 'navpay.heartbeat.endpoint' in sender
    assert 'EXTRA_ANDROID_ID = "androidId"' in contract
    assert "EXTRA_CLIENT_DEVICE_ID" not in contract
    assert "EXTRA_ANDROID_ID" in sender
    assert '"androidId"' in navpay_sender
    assert '"clientDeviceId"' not in navpay_sender
