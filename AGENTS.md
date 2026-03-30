# Repository Guidelines

yarn orch apk --fresh 是完全删除旧包，然后重新安装。 这个命令是极其危险的，如果你要用这个命令，必须要停下来征求我的统一，否则默认都是用 yarn orch apk 的方式打包

## Project Structure & Module Organization

This repository is a security research and reverse‑engineering workspace for Android malware targeting UPI apps.

- `docs/`: analysis reports (Chinese). Use these as the source of truth for findings.
- `samples/`: APK samples (often large; may be kept out of Git by `.gitignore`).
- `decompiled/`: generated output from apktool/jadx (gitignored).
- `tools/`: helper scripts, notably `tools/decompile.sh`.
- `src/https_interceptor/`: Android demo app reproducing network interception behavior.
- `src/signature_bypass/`: Java-based signature bypass module with scripts.
- `src/log_server/`: Node.js log server used by the interceptor demo.

## Build, Test, and Development Commands

- `./tools/decompile.sh --all`: regenerate all decompiled artifacts into `decompiled/`.
- `./tools/decompile.sh pev70`: decompile a single sample (see `--help` for options).
- Latest APK release workflow (required):
  - Build only from repo root with `yarn apk`.
  - Install/verify on emulator with `yarn test` (which runs the orchestrated test/install flow).
  - Do **not** treat `src/apk/https_interceptor` as an independently shippable APK path for final validation.
- `cd src/https_interceptor && ./gradlew assembleDebug`: build the demo APK.
- `cd src/log_server && npm run start`: run the log server (use `npm run dev` for watch mode).
- `cd src/log_server && ./start.sh`: convenience script (installs deps, sets `adb reverse`, starts server).
- `cd src/signature_bypass && ./tools/compile.sh`: build the bypass DEX/smali.
- `cd src/signature_bypass && ./tools/merge.sh /path/to/decompiled/base`: inject into a decompiled APK.

## Coding Style & Naming Conventions

- Match existing conventions per module: Java uses `PascalCase` classes and `camelCase` methods; shell scripts are Bash and prefer lowercase file names.
- Keep scripts POSIX‑friendly where possible; avoid non‑ASCII in new file names.
- No repository‑wide formatter is enforced; keep changes minimal and readable.

## Testing Guidelines

- There is no automated test suite.
- Validate changes with manual checks (e.g., `adb logcat -s SigBypass` for the signature bypass, or app/log server interaction for the interceptor demo).
- When modifying analysis, cross‑check against `decompiled/*_jadx/` sources and cite file paths in docs.

## Commit & Pull Request Guidelines

- Git history is minimal (single `init` commit), so no formal commit convention is established.
- Use clear, imperative commit messages with a scope, e.g., `docs: add pev70 token flow diagram`.
- PRs should include: summary, affected samples, reproduction steps (commands), and any safety considerations.

## Security & Handling Notes

- This repo contains malware samples and tooling. Handle artifacts responsibly and only in authorized research contexts.
- Keep large/generated artifacts in `decompiled/` and avoid committing new binaries unless explicitly required.
