# phonepehelper workflow requirements

This file defines mandatory execution rules for implementing `phonepehelper` in this repository.

1. Source of truth
- Must use `/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/docs/pev70注入代码详细分析.md` section `## 4. com.PhonePeTweak.Def 核心Hook层` as the behavioral baseline.

2. Implementation target
- Code changes must be applied under `/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/apk/phonepehelper`.

3. APK reference
- The reference sample is `/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/samples/pev70.apk`.

4. Decompile cache policy
- Reverse-engineering outputs should be stored in `/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/cache`.
- Reuse cache artifacts when available; avoid scattering decompile outputs in other locations.

5. Execution order (mandatory)
- First inspect app logs to confirm whether token-related behavior is already visible.
- In this phase, do not evaluate log-upload behavior.
- Then align implementation with the core methods from the source-of-truth section.

6. Verification command policy
- Must use `yarn test` for compile + install + runtime verification.
- Do not replace this with custom flows that remove/overwrite the original APK package unexpectedly.

7. Parallel development default
- Treat parallel development as the default requirement.
- Decompose independent work into concurrent tracks whenever possible.
- Use sequential execution only when there is a hard dependency or an explicit user requirement.
