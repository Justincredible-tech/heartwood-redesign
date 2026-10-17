# Phone source and reviewed art

Ordinary composition is standard-library Node. Run `node tools/build-mobile.mjs --out output/phone`; it reuses reviewed PNG master metadata and encoded image bytes. It does not launch a browser, decode source photographs, load an encoder or rebuild art. The direct standalone CLI has a 120-second ceiling and progress messages; it starts no worker, guardian or parent-process watcher. `npm --prefix tools run build:phone:supervised` opts into the stronger independent guardian. Library callers retain the direct composition API and must bound their own whole-run lifetime.

Wording changes do not imply an art bake. A member-group count change affects the Day and Night roots recipes. When a recipe changes, the build identifies the missing/stale piece and fails rather than silently rebaking it or using mismatched art.

Inspect selected recipes without native dependencies:

```sh
node tools/regenerate-mobile-art.mjs --plan --only roots,roots-night
```

Rendering/encoding is optional explicit author work. Install the separate reviewed package with `npm --prefix tools/mobile-art ci`; the command itself never installs or downloads anything. It uses pinned Playwright-core and Sharp, an explicitly supplied installed browser, and the original public art recipes at3x. Current native ownership supports macOS with an installed compiler and output on the same filesystem as owned scratch. Windows/Linux native regeneration is explicitly unsupported; ordinary composition stays Node only.

Create an existing output parent and select a fresh bundle directory:

```sh
mkdir -p output
node tools/regenerate-mobile-art.mjs --only roots,roots-night --out output/roots-review --browser '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

The current native job admits that explicit browser and optional package even when all selected masters are reusable; it launches/loads rendering and encoding only for actual misses. Prefer the resource-free plan and ordinary composition when no recipe changed. An unchanged master or derivative is copied exactly, never requantized. Select `--photos cover,poster` only when those derivatives need generation; original source photographs remain local source, not phone payload.

A bundle records complete files, exact source inputs, recipe/master/encoding bindings and observed toolchain receipts. Large toolchain inventories are shared by SHA reference. Existing pinned bytes do not prove their historical renderer or encoder. A composition receipt establishes current source-to-output identity; it does not certify visual fidelity, phone behavior, a complete pre-entry module cache or every OS/GPU/system dependency.

Inspect any newly rendered result against the original paper art before applying it. Source application is explicit:

```sh
node tools/apply-mobile-art-bundle.mjs --bundle output/roots-review
node tools/build-mobile.mjs --out output/phone-review
```

Application rechecks current source and complete bundle recipes, preserves unrelated regular files and directories (including empty/Unicode names), and uses an owned no-replace directory transaction with crash recovery. A missing, stale or inconsistent receipt fails. No source update is implicit in planning, regeneration or ordinary composition. A successful source update is not visual or device acceptance; review and focused current-device checks remain separate.

Optional native jobs use an independent guardian for source/tool admission (up to60seconds per admission phase) and the selected work; regeneration has a660-second total ceiling and application120seconds. These are deadlines, not minimum waits. The guardian allocates and records scratch before exposing it to the worker. Control inputs are regular, descriptor-bounded reads: Csource1MiB, nativebinary2MiB, registry8MiB, small manifests/timeouts8KiB and ownership markers4KiB.

New native receipts record both the lifecycle core and the actual optional caller/direct public composer and planning input bytes. Complete successful bundles require a matching final disk epoch, and every new renderer/encoder SHA reference must resolve to the canonical receipt. Old retained bytes with no native history remain explicitly unproved; no past renderer history is invented.

Application preserves supported regular-file and directory permission modes, including executable/read-only files and empty Unicode directories. Read-only roots and nonempty read-only directories fail before replacement because marker/backup cleanup is not yet supported safely. Owner, ACL, extended attributes, timestamps and hardlink relationships are not copied or attested.

Optional art commands and preparation APIs currently require the selected project to be the same real canonical project as their executing tools. `--root` may use a canonical alias of that project; another project is rejected before source imports/reads or native work. Run that other project’s own copied tools there until true target-module loading is implemented. The co-location helper is included in optional source and producer disk receipts. Ordinary composition records the actual readable composer and asset-validation inputs in `PHONE_COMPOSERS`; optional supervisor modules are outside that normal producer closure. A source-closure change requires a fresh current composition receipt; a prior input count alone does not establish the current closure. Ordinary composition remains standard-library Node and reuses reviewed art bytes.

Art recovery follows actual directory inodes, including crashes between a move and its phase update. Before the new tree is promoted, recovery keeps or restores the old tree. After the new tree is coherently promoted, recovery may retain that complete new tree even if a later final input-epoch check or COMMITTED update fails; the command still fails and this is not unconditional rollback. Changed or incoherent author/foreign data is preserved and reported as an error. This describes the existing cutover policy, not a newly verified policy defect.
