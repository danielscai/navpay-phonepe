from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
MODULE_ROOT = REPO_ROOT / "src/apk/heartbeat_bridge"


def test_heartbeat_bridge_module_layout_exists() -> None:
    expected = [
        MODULE_ROOT / "README.md",
        MODULE_ROOT / "scripts/compile.sh",
        MODULE_ROOT / "scripts/merge.sh",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/protocol/HeartbeatProtocol.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/core/HeartbeatPayloadBuilder.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/core/HeartbeatSchedulePolicy.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/core/HeartbeatCommandCodec.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/core/HeartbeatPingHandler.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/core/HeartbeatCommandRegistry.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatBridgeContract.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatBridgeProvider.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatSender.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatScheduler.java",
        MODULE_ROOT / "src/main/java/com/heartbeatbridge/ModuleInit.java",
    ]

    missing = [str(path.relative_to(REPO_ROOT)) for path in expected if not path.exists()]
    assert not missing, f"missing heartbeat_bridge files: {', '.join(missing)}"


def test_heartbeat_bridge_contract_mentions_async_send_and_scheduler() -> None:
    protocol = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/protocol/HeartbeatProtocol.java").read_text(encoding="utf-8")
    payload_builder = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/core/HeartbeatPayloadBuilder.java").read_text(encoding="utf-8")
    schedule_policy = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/core/HeartbeatSchedulePolicy.java").read_text(encoding="utf-8")
    command_codec = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/core/HeartbeatCommandCodec.java").read_text(encoding="utf-8")
    ping_handler = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/core/HeartbeatPingHandler.java").read_text(encoding="utf-8")
    command_registry = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/core/HeartbeatCommandRegistry.java").read_text(encoding="utf-8")
    provider = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatBridgeProvider.java").read_text(encoding="utf-8")
    sender = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatSender.java").read_text(encoding="utf-8")
    scheduler = (MODULE_ROOT / "src/main/java/com/heartbeatbridge/HeartbeatScheduler.java").read_text(encoding="utf-8")
    legacy_sender = REPO_ROOT / "src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayHeartbeatSender.java"

    assert 'PROTOCOL_VERSION = "1"' in protocol
    assert 'HEADER_PROTOCOL_VERSION = "x-navpay-hb-version"' in protocol
    assert 'HEADER_COMMAND = "x-navpay-hb-command"' in protocol
    assert 'HEADER_COMMAND_ACK = "x-navpay-hb-command-ack"' in protocol
    assert 'FIELD_ANDROID_ID = "androidId"' in protocol
    assert 'COMMAND_TYPE_PING = "ping"' in protocol
    assert 'COMMAND_RESULT_PONG = "pong"' in protocol
    assert "HeartbeatProtocol.FIELD_TIMESTAMP" in payload_builder
    assert "HeartbeatProtocol.APP_NAME_PHONEPE" in payload_builder
    assert "nextDelayMs" in schedule_policy
    assert "heartbeatIntervalMs" in schedule_policy
    assert "parse(" in command_codec
    assert "buildAckHeaderValue" in command_codec
    assert "isPing" in command_codec
    assert "PingResult" in ping_handler
    assert "handle(" in ping_handler
    assert "supportedCommandTypes" in command_registry
    assert "isSupported" in command_registry
    assert "HeartbeatSender.sendHeartbeatAsync" in provider
    assert "HeartbeatSchedulePolicy" in scheduler
    assert "scheduleNext" in scheduler
    assert "HttpURLConnection" in sender
    assert "openConnection()" in sender
    assert 'navpay.heartbeat.endpoint' in sender
    assert "pendingCommandAckId" in sender
    assert "HeartbeatProtocol.HEADER_COMMAND_ACK" in sender
    assert "HeartbeatProtocol.HEADER_COMMAND" in sender
    assert "HeartbeatCommandCodec.parse" in sender
    assert "HeartbeatPingHandler.handle" in sender
    assert "HeartbeatCommandRegistry.isSupported" in sender
    assert "HeartbeatPayloadBuilder.build" in sender
    assert "HeartbeatProtocol.FIELD_ANDROID_ID" not in sender
    assert not legacy_sender.exists()
