# Behavior Parity Checklist (Baseline vs Candidate)

## Mandatory probes (probe.json required keys)

`probe.json` MUST include these keys for both baseline and candidate:

- `launch_ok` (boolean)
- `login_activity_seen` (boolean)
- `sigbypass_tag` (boolean)
- `https_tag` (boolean)
- `pphelper_tag` (boolean)
- `crash_detected` (boolean)

## Acceptable differences

- `login_activity_seen` may differ when login state/session differs across runs.
- Metadata fields (for example `timestamp_utc`, `serial`, file paths) may differ.

All other mandatory probe keys are expected to be behavior-parity signals and should match.

## Failure criteria

Treat behavior parity check as failed when any of the following occurs:

- Missing mandatory key in baseline or candidate `probe.json`.
- `compare_behavior.sh` reports mismatch for any required comparison key.
- `crash_detected=true` in candidate when baseline is `false`.
- Probe artifact generation is incomplete (`probe.json` or `probe.log` missing).

## Evidence artifacts (must retain)

For each run directory, preserve:

- `meta.json`
- `apk.sha256`
- `probe.log`
- `probe.json`

For parity review, additionally retain:

- Baseline run path and candidate run path used by compare command.
- Exact compare command invocation and terminal output.
