from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
PHONEPEHELPER_ROOT = REPO_ROOT / "src/apk/phonepehelper"
DOC_PATH = REPO_ROOT / "docs/checksum_content_provider_api.md"


def _read(relative_path: str) -> str:
    return (PHONEPEHELPER_ROOT / relative_path).read_text(encoding="utf-8")


def _assert_order(text: str, snippets: list[str]) -> None:
    positions = []
    for snippet in snippets:
        index = text.find(snippet)
        assert index >= 0, f"missing snippet: {snippet}"
        positions.append(index)
    assert positions == sorted(positions), f"snippets out of order: {snippets}"


def test_provider_contract_includes_environment_methods_and_keeps_legacy_methods() -> None:
    contract = _read("src/main/java/com/phonepehelper/NavpayBridgeContract.java")
    provider = _read("src/main/java/com/phonepehelper/NavpayBridgeProvider.java")

    assert 'METHOD_SET_ENVIRONMENT = "setEnvironment"' in contract
    assert 'METHOD_GET_ENVIRONMENT = "getEnvironment"' in contract
    assert 'EXTRA_ENV_NAME = "envName"' in contract
    assert 'EXTRA_ENV_BASE_URL = "baseUrl"' in contract
    assert 'EXTRA_ENV_UPDATED_AT = "updatedAt"' in contract

    assert "setenvironment" in provider
    assert "getenvironment" in provider
    assert "buildSetEnvironmentBundle" in provider
    assert "buildGetEnvironmentBundle" in provider
    assert "tokenrefresh" in provider
    assert "checksum" in provider


def test_db_helper_contract_persists_single_environment_row() -> None:
    contract = _read("src/main/java/com/phonepehelper/NavpayBridgeContract.java")
    db_helper = _read("src/main/java/com/phonepehelper/NavpayBridgeDbHelper.java")

    assert 'DATABASE_VERSION = 2' in contract
    assert 'TABLE_ENVIRONMENT' in db_helper
    assert 'COLUMN_ENV_NAME' in db_helper
    assert 'COLUMN_ENV_BASE_URL' in db_helper
    assert 'COLUMN_ENV_UPDATED_AT' in db_helper
    assert 'persistEnvironment' in db_helper
    assert 'queryEnvironment' in db_helper


def test_snapshot_uploader_prefers_provider_state_over_property_then_fallback() -> None:
    uploader = _read("src/main/java/com/phonepehelper/NavpaySnapshotUploader.java")

    _assert_order(
        uploader,
        [
            "String persistedEndpoint = resolveProviderEndpoint(context);",
            'String endpointOverride = System.getProperty(ENDPOINT_PROPERTY, "").trim();',
            "if (isLikelyEmulator())",
            "return new String[] { EMULATOR_ENDPOINT, DEVICE_ENDPOINT };",
            "return new String[] { DEVICE_ENDPOINT, EMULATOR_ENDPOINT };",
        ],
    )
    assert "NavpayBridgeDbHelper.queryEnvironment" in uploader
    assert "uploadSnapshotAsync(Context context" in uploader


def test_content_provider_api_doc_mentions_environment_methods_and_examples() -> None:
    doc = DOC_PATH.read_text(encoding="utf-8")

    assert "setEnvironment" in doc
    assert "getEnvironment" in doc
    assert "envName" in doc
    assert "baseUrl" in doc
    assert "updatedAt" in doc
    assert "adb shell content call" in doc
    assert "checksum" in doc
