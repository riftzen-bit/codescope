# CodeScope 1.0.1

Quality and hardening release. Closes every item from the 1.0.0 code review,
redesigns the app icon, tightens page-header spacing, and ships the first
round of review-engine extensions.

## Highlights

- **All ten code-review findings fixed** — idle-timeout message, project-remove
  cancellation, write-queue error hook, history field pick, symlink-aware
  path guard fast path, CLI version fallback log, diff-burst poller, and
  more. See `CHANGELOG.md` for one-line summaries of each.
- **New Ember icon** — warm plum tile, amber ember teardrop, cream curly
  brackets. Generated fresh across all target sizes.
- **Breathing-room headers** — the Settings, Project, and Guide pages no
  longer sit flush against the top of the window; spacing now uses the
  `--space-12` / `--space-10` rhythm tokens.
- **Review engine upgrades** — diff-based review, result cache, SARIF
  export, metrics / trend / sparkline reporting, cost estimation, secret
  redaction, custom rule files, ignore rules, retry with back-off.
- **Dashboard view** — project score trend chart, recent runs, quick stats.

## Downloads

Built installers are attached to this release:

- `Code Review-Setup-1.0.1.exe` — Windows installer (NSIS, x64)
- `Code Review-1.0.1-arm64.dmg` / `Code Review-1.0.1-x64.dmg` — macOS DMGs
- `Code Review-1.0.1.AppImage` — Linux AppImage (x64)

## Upgrade notes

- No settings-schema changes; 1.0.0 data loads as-is.
- No breaking API changes in `@code-review/core`.
- If you maintain a fork and have customized `PROVIDER_CONFIGS`, re-read the
  new `UPDATE CADENCE` doc block in
  `apps/desktop/src/components/settings/providers.ts`.

## Verification

All checks green locally on this commit:

- `pnpm run lint` — 4/4 typechecks pass.
- `pnpm run test` — 242 core + 11 cli tests pass.
- `pnpm --filter @code-review/desktop build` — clean.
- `pnpm run build` — 3/3 tasks green.
