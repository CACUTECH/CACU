# Dependency security remediation: alerts 443 and 445

Reviewed 4 November 2026. These are transitive development-tool dependencies, not direct application imports. No accounting, business data, database schema or provider configuration changes are needed.

## Alert 445: minimatch globparts amplification

Reference: https://github.com/advisories/GHSA-g3hv-75wg-m249
Upstream fix: https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8

The installed affected path was `eslint-config-next -> @typescript-eslint/parser -> @typescript-eslint/typescript-estree -> minimatch@10.2.6`. Override only `minimatch@>=7.0.0 <11.0.1` to `11.0.1`. The npm audit response observed during this work identifies that affected range. Legacy `3.1.5` consumers do not contain this optimiser and must retain their callable CommonJS API; a global major-version override would break consumers such as ESLint and Jest's glob tooling.

The security test resolves minimatch from the actual TypeScript ESLint consumer and compiles the upstream repeated `**/../a/b` pattern at optimisation level 2 with a 64-pattern cap. It runs in a subprocess with a timeout and also checks normal matching and the legacy API.

## Alert 443: deepmerge prototype poisoning

Reference: https://github.com/advisories/GHSA-gcqx-w48m-w2h4
Report and payloads: https://github.com/TehShrike/deepmerge/issues/273

The installed path was `jest -> jest-config -> deepmerge@4.3.1`. The npm registry still reports 4.3.1 as latest; the advisory lists no patched release. The latest Jest configuration package also still depends on that release. Do not run `npm audit fix --force`: its proposed older Jest version is not a compatible security fix for this application.

Pin deepmerge to 4.3.1 for a reproducible `patch-package` patch. Reject `__proto__`, `constructor` and `prototype` before copying target keys or merging source keys, in the source, CommonJS distribution and UMD distribution. This follows the report's proposed key-name guard and covers the otherwise-unguarded target-copy loop. These property names are deliberately discarded; ordinary nested merging, arrays, symbols and custom merge options are preserved.

The payloads were reproduced before patching (six regression failures); after patching, the suite passes. The tests check the actual returned object's prototype and inherited values, not only global Object.prototype pollution.

## Installation and CI

- Use normal `npm ci`; postinstall applies the committed patch using the already-installed patch-package tool.
- The patch is named `deepmerge+4.3.1.dev.patch` because this is a transitive development dependency. Production installs omitting Jest can skip the absent package when `NODE_ENV=production`; development/CI installs still apply it.
- Patch application errors fail installation (`--error-on-fail`). Do not use `--ignore-scripts` as a verified installation procedure.
- `npm run test:security` runs the focused security and compatibility tests; `npm run ci` includes them before Jest.
- Commit package.json, package-lock.json, the patch, security test and this note together.
- A local patch does not change the published deepmerge version. npm audit and Dependabot may continue to list alert 443 despite the tested mitigation. This is documented mitigation, not proof GitHub has closed the alert. Do not dismiss it as fixed solely to obtain a green dashboard. Replace the patch with a verified upstream patched release when available, regenerate the lockfile, and rerun these tests.
- Alert changes on GitHub require the fix to reach the default branch and the dependency scanner to refresh. No GitHub alert was dismissed during this task.

## Rollback

Revert only this remediation's manifest/lockfile, patch, test and documentation changes together, then run npm ci. This restores the vulnerable versions/behaviour, so rollback requires an explicit security decision. Preserve unrelated reconciliation and billing work.

## Verification results

- Clean `npm ci`: passed, including automatic deepmerge patch application.
- `npm run ci -- --runInBand`: passed (full repository lint, TypeScript, 10 security checks and 348 Jest tests across 46 suites).
- Browser regression suite: 51 passed.
- Next.js production build: passed.
- npm audit: minimatch no longer reported; no moderate/high/critical findings. Seven low entries remain in the deepmerge/Jest dependency chain because the audit is version-based. These are not seven distinct newly discovered vulnerabilities.
- Diff whitespace check: passed.
