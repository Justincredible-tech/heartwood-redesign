# Testing the project

Status: adopted. This document describes the maintained public testing workflow; it does not reshape the
normal `npm run build`.

## Requirements

- Node 22 or newer; the ordinary build needs only the packages locked in `tools/package-lock.json`.
- Python 3.11+ with the packages in `tools/requirements.txt` for the delivery/HTTP checks.
- Optional, for browser journeys: a Chromium build and the separately locked `playwright-core` (see
  "Optional browser setup"). Ordinary builds and the required portable tests never need a browser.

## Required portable checks (no browser)

```sh
cd tools
npm ci --ignore-scripts --no-fund
npm test
npm run test:delivery -- --receipt <new-file.json>
```

`npm test` runs every portable Node regression in its own process under node:test's per-test timeout, and runs
the Python regressions in `tests/*.test.py` together in one process under a single shared deadline (30 s by
default, 120 s with `--native-art`); every file must produce its validated result line — a file that produces
no result, skips its work, or times out fails the run.
`npm run test:delivery` re-validates an exact staged tree in an owned clean folder: lockfile install, normal
build, the required public tests, and the author HTTP delivery checks against its own loopback preview.
**Installation is the one step that can need the registry** — `npm ci` may fetch packages; use the delivery
`--offline` option when the lockfile packages are already cached, and treat prerequisite setup as its own
step. After dependencies are installed, the ordinary build, the required tests and the delivery checks run
without network access; no acceptance suite downloads a browser or calls third-party endpoints, and previews
listen on loopback only.

Pure property suites require the real `fast-check` (4.10.2, with its exact transitive `pure-rand`) from the
same lockfile and keep a nonzero case count with fixed seeds, counterexamples and interruption-as-failure;
they never substitute deterministic stand-ins or skip cases to avoid a dependency. Pure and browser
entrypoints stay separate — a required pure test never depends on the optional browser install.

## Cleanup and device audit gate (optional tooling check)

`node tools/check-cleanup.mjs --static` is a maintained-tooling gate, not part of `npm test`: it inspects the
checkout's own tool/test source for unreviewed resource acquisitions and file reviews. It needs a reviewed
cleanup policy supplied with `--policy <file>`; the default `tools/cleanup-policy.json` is maintained release
data and is absent here, and without either one every acquisition and file reports unreviewed and the gate
exits nonzero. `rg` (ripgrep) is needed only while the historical `output/playwright` tree exists. The
capability catalog (`--catalog`, default `tools/tool-capability-catalog.json`) is enforced when its data is
present and otherwise reported as not configured, never as coverage. The live form
`node tools/check-cleanup.mjs --runtime -- <command> [args...]` audits one bounded command for process,
listener, temp and optional device residue; the device detail needs `adb` on `PATH` with an already-running
adb server (the audit never starts one; `HW_ADB` overrides the command name) and the macOS `xcrun simctl`
tooling for simulator inventory. Missing prerequisites, a missing device or any observed residue fail the
audit; none of this runs under `npm test`.

## Optional browser setup

Browser journeys (mobile acceptance, desktop/taste guards, abuse benches) additionally need the optional,
separately locked `playwright-core` (1.64.0), `sharp` (0.35.5), `pngjs` (7.0.0) and `pixelmatch` (7.2.0),
resolved as normal packages from `tools/browser/` (never a manually selected folder), plus a Chromium build:

```sh
cd tools/browser
npm ci                                      # optional, separately locked browser/pixel packages
npx playwright-core install chromium        # prerequisite step; no suite downloads a browser itself
cd ..                                       # back in tools/
npm run build                               # builds publish/ (all experiences; ordinary, browser-free)
node verify-mobile.mjs --site ../publish/mobile [--source-root ..] [--out <dir>] [--only frames|fling] [--theme day|night|both]
node verify-taste.mjs                       # needs optimized/ beside optimized-taste/ under HW_SITE_ROOT (comparison variants the standard publish/ build does not yet emit); Dark Reader via HW_DARKREADER (optional, loud)
node test-abuse.mjs --quick                 # bounded abuse sampling; --full runs the long matrix
```

Package installation is setup, not acceptance evidence — ordinary installs may need the registry once;
afterward the ordinary build, the required tests and the delivery checks run without network access. No
acceptance suite downloads a browser or calls third-party endpoints, and previews listen on loopback only.

If the browser dependency, a browser binary, or a required input artifact is missing, the requested suite
exits non-zero and reports UNSUPPORTED — it never passes on absent evidence. Browser runs never send
third-party traffic (loopback guard); a suite that observes a blocked third-party request fails by design.

Browser visibility is managed, not caller-selected: `managedLaunch` and the fixture force headless after
caller options, so an explicit `headless:false` or an inherited `HW_HEADLESS=0` cannot open an ordinary
window. The only exemption is a named native window-state requirement passed as `requiresVisibleWindow`
(`os-focus`, `window-occlusion`, `os-lifecycle`), validated before any server or process allocation; such
checks belong in short dedicated runs and never in repeated mobile/visual/performance loops. Visibility
arguments (`--headless`, `--headful`, `--headed`, `--no-headless`), `devtools:true` and removal of the
default headless arguments are refused before allocation. Fixtures expose the actual
`headless`/`requiresVisibleWindow` mode; reports must state that actual mode, and borrowed CDP connections
report unknown. Explicit device/emulator checks remain separately scoped and never run in routine local
suites.

Tests that can only run with those optional prerequisites (a browser, the native custody seam while the
portable owner client is still being integrated, or the checked-in site source for the source-bound taste suites) live in an explicit optional
group, driven by `node tools/run-optional-tests.mjs` (`--list` shows the groups; `--group
browser|native|artifacts|posix-python|all` runs one). Discovery happens inside Node, so it works on Windows
without shell glob expansion, and the mandatory `tests/*.test.mjs` discovery never includes these files —
there are no silently skipped tests: a requested group with missing prerequisites fails UNSUPPORTED. Every executed file runs under the shared public reporter/validator with a 15-minute per-file bound inside a 45-minute overall budget, so empty, skipped, incomplete or unsupported results can never report PASS.

The native identity helper builds from `tools/process-identity.c` with the local C compiler found on `PATH`
(`CC` overrides the default `cc`). That compiler is an explicitly optional POSIX prerequisite: the standard
build and every required portable test remain compiler-free, and Windows native custody is UNTESTED.

## Selection and scoping

- Mobile journeys: `node tools/verify-mobile.mjs --site <built-mobile> [--source-root <repo>] [--only frames|fling] [--theme day|night|both]`; the ordinary build emits the phone under `publish/mobile/`.
- Desktop/taste: `node tools/test-browser-all.mjs --quick [--only <stage>] [--site-root <built-site>]` (or `--full`); the site root defaults to the built `publish/` tree, and comparison stages require a site root providing their `local/` and `optimized/` inputs.
- Abuse: `--quick` is a bounded smoke scope, never presented as full acceptance; the full default sampling
  (multi-second windows, dozens of leak cycles, chaos sequences) runs only when explicitly requested.

## Evidence semantics

- Frame and input budgets and the sampling durations are the reviewed originals; scoped `--quick` runs are
  labeled and are never reported as full acceptance.
- Every suite fails rather than passes on empty, skipped, timed-out or incomplete evidence, and a cleanup
  failure fails the run.
- CPU emulation is not real-phone proof; physical-device behavior needs physical devices.

## Platform support

- The public migration's browser journeys are **NOT_RUN** until the first integrated public run records actual
  hashes and counts. Existing focused browser evidence under the private review tooling is development proof
  for specific files and trees, not current public suite acceptance — do not read older functional checks as
  the current result.
- macOS: the current development environment; some native-asset steps remain macOS-only and are separately
  opt-in. Device-specific checks (Android, and the iOS tooling) are optional commands with explicit
  prerequisites and honest unsupported scope where no device is present.
- Linux / Windows: UNTESTED for browser journeys; ordinary builds and the portable tests are expected to work.
