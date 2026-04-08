# PhonePe Snapshot Collection Runbook

## Purpose

Collect PhonePe APK snapshots by a deterministic device matrix, keep execution serial, and persist resumable run reports.

## Matrix File

Use `src/pipeline/orch/device_matrix.example.json` as baseline.

Required top-level fields:
- `bootstrap_target_id`
- `targets` (non-empty array)

Required per-target fields:
- `target_id`
- `serial_alias`

Current baseline keeps only:
- `emu_arm64_xhdpi` (320)
- `emu_arm64_xxhdpi` (480 override / xxhdpi bucket)

`xxxhdpi` remains on-demand extension only.

## Commands

- Start collection:
  - `yarn collect:phonepe`
- Explicit matrix command:
  - `python3 src/pipeline/orch/orchestrator.py collect --matrix src/pipeline/orch/device_matrix.example.json --package com.phonepe.app`
- Resume an interrupted run:
  - `python3 src/pipeline/orch/orchestrator.py collect --matrix src/pipeline/orch/device_matrix.example.json --resume <run_id> --package com.phonepe.app`

## Outputs

Run directory:
- `cache/phonepe/snapshots/runs/<run_id>/run_state.json`
- `cache/phonepe/snapshots/runs/<run_id>/gap-report.json`
- `cache/phonepe/snapshots/runs/<run_id>/summary.json`

Snapshot archive:
- `cache/phonepe/snapshots/<package>/<versionCode>/<signingDigest>/captures/<target_id>/`
  - `base.apk`
  - `split_config.arm64_v8a.apk`
  - `split_config.xxhdpi.apk`
  - `device_meta.json`
  - `capture_meta.json`

Global index:
- `cache/phonepe/snapshots/index.json`

## Blocker Workflow

When Google Play account login is missing/unavailable:
- collector writes:
  - `blocker-report.json`
  - `blocker-report.md`
- collector exits with code `20`
- downstream targets stop immediately

Recovery:
1. Complete Play login manually on the blocked target.
2. Re-run with `--resume <run_id>`.

## Safety Notes

- Collection must be serial; do not run multiple emulators for the same run at once.
- Do not use `yarn orch apk --fresh` or any fresh variant in collection workflow.
