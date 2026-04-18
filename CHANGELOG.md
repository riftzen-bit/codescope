# Changelog

All notable changes to CodeScope are documented in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-04-17

Quality-and-hardening release. Addresses all ten findings from the 1.0.0 code
review (quality score 86/100), redesigns the app icon to match the Ember
identity, fixes page-header spacing across the UI, and ships the first round
of review-engine enhancements (diff, cache, SARIF export, metrics, trend,
cost, redaction, rules, ignore, retry).

### Fixed

- **Idle-timeout message interpolation** (`electron/main/providers.ts`):
  `runChat` and `runStream` no longer hard-code "15 minutes" in the rejection
  message. The string now derives from `IDLE_TIMEOUT` so the UI stays in sync
  if the constant changes.
- **Abort in-flight review on project removal** (`electron/main/ipc/handlers.ts`):
  `PROJECT_REMOVE` now aborts any in-flight review whose watcher points at the
  removed path and cleans up the watcher state, preventing a zombie stream
  from writing to a destroyed window.
- **Deduplicate `ALLOWED_PROVIDERS`** (`electron/main/ipc/handlers.ts`): The
  handler now imports the single source of truth from `settings/store.ts`
  instead of defining a parallel list that could drift.
- **Write-queue error hook** (`electron/main/settings/writeQueue.ts`): Added
  an optional `onError(key, err)` callback so store-layer code can observe
  atomic-write failures (fsync / rename) without reading the console.
- **Explicit field pick in `history:add`** (`electron/main/ipc/handlers.ts`):
  Replaced the object spread with an explicit allowlist, including a
  validated `tokensUsed` shape. Prevents unknown caller-supplied fields from
  reaching the history store.
- **Skip `realpathSync` on the non-symlink fast path**
  (`electron/main/ipc/handlers.ts`): `assertInsideBaseResolved` now accepts
  an `isSymlink` flag; hot loops pass `dirent.isSymbolicLink()` so the guard
  runs `realpathSync` only when actually needed. The symlink-escape guarantee
  is preserved for every symlink.
- **Log VERSION fallback to stderr** (`apps/cli/src/index.ts`): When the CLI
  cannot load its own `package.json` version, it now prints a one-shot
  warning with the reason before falling back to `0.0.0-unknown`, instead of
  failing silently.
- **Emit `null` on large diff ticks** (`electron/main/ipc/handlers.ts`): The
  mtime poller now counts mutations per snapshot; if more than five paths
  changed in one tick, it emits `null` (instead of an arbitrary single path)
  so the renderer does not display a misleading "changed: …" string.
- **Drop `destroyListenerBound`** (`electron/main/ipc/handlers.ts`): Replaced
  the parallel `Set` with a direct check against `windowApprovedPaths`
  captured before `approveForWindow`. One less piece of state to keep
  coherent.

### Added

- **Model-catalog update cadence docs**
  (`apps/desktop/src/components/settings/providers.ts`): The provider/model
  list now documents its update policy (audit each release cycle; update
  `DEFAULT_SETTINGS.providers` when a default model id is removed) so a stale
  id does not silently break first-run.
- **Review engine extensions** (`packages/core/src/review/*`): diff-based
  review, result cache, SARIF exporter, metrics/trend/sparkline reporting,
  cost estimation, secret redaction, custom rules, ignore rules, retry/
  back-off, fingerprinting, and a filter/aggregate pipeline. All with unit
  tests.
- **Dashboard view** (`apps/desktop/src/components/DashboardView.tsx`,
  `ScoreTrendChart.tsx`): Project score trend, recent runs, and quick stats.
- **Toast hook** (`apps/desktop/src/hooks/useToasts.ts`): Lightweight
  notification surface for IPC errors and background events.

### Changed

- **Icon redesign** (`scripts/generate-icons.mjs`,
  `apps/desktop/resources/icon.svg`, `.png`, `icon-256.png`): New palette
  matches the app's Ember identity — warm plum ink, amber ember teardrop,
  cream curly brackets — with a pressed-tile inner ring and amber baseline
  with three dim finding dots.
- **Page-header spacing** (`apps/desktop/src/styles/globals.css`): Bumped
  top padding on `.settings-view`, `.project-view`, `.guide-view` from
  `--space-10` to `--space-12`, and header bottom margin on `.sv-header` /
  `.pv-header` from `--space-8` to `--space-10`. Headers no longer sit
  flush against the first content block.

### Verified

- `pnpm run lint` (tsc --noEmit across core, cli, desktop): 4/4 green.
- `pnpm run test`: 242 core tests + 11 CLI tests passing.
- `pnpm --filter @code-review/desktop build`: clean.
- `pnpm run build` (turbo): 3/3 packages green.

## [1.0.0] - Initial public release
