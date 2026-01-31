# Tools Usage Conventions

This directory contains runnable helper scripts.

## Conventions (apply to new scripts going forward)
- Every runnable script should have a matching yarn alias in `package.json`.
- The yarn alias should run the script with **no parameters by default**.
- If parameters are needed, scripts should provide sensible defaults and allow overrides via flags/env vars.

## Example
- `yarn login` -> `./tools/step5_auto_login.sh`
  - defaults to `$LOGIN_PHONE` or `6338933055`
  - optional: `--phone <number>` and `-s <serial>`
