# Heartwood website redesign

Design concepts and a working front end for a new website for
[Heartwood](https://heartwood.org), a grassroots network of people and groups protecting the forests of the eastern
United States. Prepared by Justin Sparks ([justincredible.tech](https://justincredible.tech)).

**This is concept work under client review. It is not the live Heartwood website.**

It contains:

- **Living Tree**, the recommended design: a hand-cut-paper illustration of one tree in a meadow, with its roots
  running down the page. Every leaf opens a piece of Heartwood (a campaign, a gathering, a news story, a member
  group), and birds, bees and soil animals move through the scene. It is a real, interactive front end with a
  build, tests and an upload package.
- **Five alternative directions** (Evergreen, Rally, Fieldnotes, Atlas, Rings) as single-file mockups.
- **A landing page** that presents Living Tree first and the alternatives below it, so the client can compare them
  and choose.

## Repository map

| Path | What it is |
|---|---|
| `source/` | **Living Tree, readable source.** Edit here. `heartwood-site.html` is the markup and paper artwork; `css/heartwood-site.css` the styles; `js/heartwood-site.js` the interactions and the `SITE` content model; `assets/` self-hosted fonts, logo symbols and the paper-grain tiles. |
| `source/mobile/` | The phone composition: a tall cut-paper tulip poplar, tap previews, category branches, detail sheets and compact roots. Includes reviewed day/night raster masters and encoded derivatives. |
| `source/taste/` | The optional desktop scene: night artwork and the additional tree/network interactions, composed from the authored site. |
| `tools/` | Build, local preview, delivery tests, packaging and asset tools. Details in [`tools/README.md`](tools/README.md). |
| `showcase/` | The client landing page (`index.html`) and its preview images. |
| `mockups/` | The five alternative designs, plus logo explorations in `mockups/logo/`. |
| `publish/` | Hosting config (`.htaccess`) and the project's working docs (`AGENTS.md`, `_core.md`, `conductor.md`, `agents/`). Build output lands here too and is not committed. |
| `finalLogos/` | The final supplied logo files, kept unchanged. `tools/import-logos.py` turns them into the symbols in `source/`. |
| `review-evidence/` | QA, performance and visual evidence, one folder per piece of work, with before/after screenshots and raw measurements. |
| Root `heartwood-site.html`, `logo*`, `simpleLogo*`, `screenshot*.png` | Earlier single-file iterations, kept for reference. |

## Quick start

You need **Node 22** with npm and **Python 3.13**. Commands run from `tools/`.

```bash
cd tools
npm ci --ignore-scripts --no-fund         # build-only packages, pinned in package-lock.json
pip install -r requirements.txt           # brotli (always); playwright + pillow (only to redraw the grain)
npm run build                             # source/ -> publish/: minified, fingerprinted, precompressed
python preview.py --port 8003             # then open http://127.0.0.1:8003/
```

In a second terminal, with the preview running:

```bash
# bash
HEARTWOOD_PREVIEW=http://127.0.0.1:8003/ python test-delivery.py
# PowerShell
$env:HEARTWOOD_PREVIEW = "http://127.0.0.1:8003/"; python test-delivery.py
```

Use the compressed preview, not `python -m http.server`: it serves only the built public files, negotiates
Brotli/gzip like the real host, and refuses a port that is already taken. Pick any free port; the tests default
to 8001.

## Day, night and phone scenes

The public site entry selects the scene before requesting its artwork. Desktop follows the system colour
preference; `taste/` starts at night. Use `?theme=light` or `?theme=dark` for an explicit choice, or the desktop
Day/Night link. Phones automatically receive the vertical phone composition. The main entry follows their
system preference; `taste/` starts at night on phones too, with `?theme=light` selecting day explicitly.
Add `?view=desktop` to use the desktop composition
on a phone. Selection retains the query and fragment used for categories, search and leaf links.

The build writes an assetless `experience-entry.html`, which packaging installs as the public site entry.
`desktop-day.html` and `taste/scene.html` contain the desktop scenes; their browser addresses resolve back to
the corresponding public entry while preserving state. `mobile/` selects fixed `mobile/day.html` and
`mobile/night.html` pages, so an explicit choice uses the appropriate artwork even when it differs from the
system preference. Both phone themes share the same layout, content and tap interactions.

## Where to change what

| To change | Edit | Then |
|---|---|---|
| Words, links, leaves, member groups, cards | the `SITE` content model in `source/js/heartwood-site.js` | build |
| Interactions | `source/js/heartwood-site.js` | build |
| Layout, colour, type, motion | `source/css/heartwood-site.css` | build |
| Artwork (paper shapes) | `source/heartwood-site.html` | build |
| Optional desktop night scene and interactions | `source/taste/` | build |
| Phone layout and interactions | `source/mobile/page.mjs`, `mobile.css`, `app.js` | build |
| Phone paper artwork | `source/mobile/art.mjs`, `night.mjs`, `reference-paper.css` | regenerate affected reviewed masters and derivatives, then build |
| Paper grain (flecks and fibres) | `--grain-fine` in the stylesheet | `python render-grain.py`, then build |
| Logos | replace the files in `finalLogos/` | `python import-logos.py`, then build |
| Favicon, link-preview (share) images | `tools/render-meta-images.py` (drawn from the tree mark and the built hero) | build, `python render-meta-images.py`, build again |
| The client landing page | `showcase/index.html` | package |

Never edit anything the build writes into `publish/` (`heartwood-site.html`, `css/`, `js/`, `assets/`) or an
upload folder. The next build or package overwrites it, and a hand edit next to a stale `.br` / `.gz` copy is
served as the old version.

`source/heartwood-site.html` is about 800 KB of hand-placed artwork geometry. Don't run a formatter over it,
and keep its inline styles as they are; the tests check that the build preserves every artwork element and
attribute.

Ordinary phone builds verify and copy the committed art; they do not run a browser or image encoder.
Changing its art recipe requires a separate render of the affected masters and matching AVIF/WebP
derivatives, with updated recipe and byte hashes. The build rejects stale masters or altered inputs. See
[`tools/README.md`](tools/README.md) for the source checks and asset regeneration boundary.

All features are enabled by the ordinary build. To omit selected features from the generated site, run
`npm run build -- --exclude=night,phone,tree-effects,network-effects` from `tools/`, listing only the ones to
remove. `night` produces Day-only scenes; `phone` omits the phone routes and dispatch; `tree-effects` and
`network-effects` omit their additional interactions while retaining the original art, baseline leaf hover,
and phone navigation. Unknown, empty, or duplicate exclusions fail before building. The optional
`npm run build:supervised` accepts the same flag. A programmatic `buildSite({exclude:['night']})` follows the
same policy. A direct phone build may exclude Night and effects, but cannot exclude its own phone output.

Packaging uses the generated feature manifest, so excluded routes and assets are not uploaded. Delivery
tests expect the complete build by default; for a deliberately reduced build, set `HEARTWOOD_BUILD_EXCLUDE`
to the same comma-separated list before running `test-delivery.py`. The recorded policy must match this
explicit expectation, and excluded resources must actually be absent.

## Shipping to the web server

```bash
cd tools
npm run build
python package-upload.py --name upload-ready-v3     # any new folder name; it never overwrites one
```

Upload the **contents** of `publish/<folder>/`, including the hidden `.htaccess`, to the site directory. The
default package is the client showcase:

- `index.html`: the landing page
- `living-tree.html`: the scene-selecting Living Tree entry
- `desktop-day.html`, `taste/`, `mobile/`: the desktop and phone scene documents
- `mockups/`: the five alternatives
- `assets/`: fonts, grain tiles and preview images

Once the client has chosen, `python package-upload.py --site-only --name site-v1` packages Living Tree alone as
`index.html`.

To publish to https://justincredible.tech/heartwood/, use `python deploy-ftp.py ../publish/<folder>`. It is a dry
run until you add `--go`. With `--go` nothing is sent until the site owner clicks Yes in a confirmation dialog on
their Windows desktop (default No; it closes as No after five minutes), so deploys can never happen automatically.
It writes only inside `public_html/heartwood/`, backs up what is there first to
`deploy-backups/`, and reads FTP credentials from the environment or a file outside the repository (see the
script's header). Link previews use absolute URLs for that address. If the site moves, rerun
`render-meta-images.py --base <new address>`. Facebook, Slack and iMessage cache previews, so a link already shared
can show the old one until their cache refreshes.

The `.htaccess` serves the precompressed `.br` / `.gz` files and long-caches fingerprinted assets. It needs
Apache with `mod_rewrite`, `mod_headers` and `mod_mime`. It has only been tested against the local preview, not
on the real host, so check status codes, `Content-Encoding` and cache headers after the first upload.

## Working together: who does what

Everyone works under their own GitHub account, so every change is attributed:

- `git log` and the GitHub history show who made each commit.
- `git blame <file>` shows who last changed each line.
- Each pull request records who proposed a change, who reviewed it and why it was made.

How we work:

1. **Track work as issues.** Assign an issue to yourself before you start it, so we never both pick up the same
   thing.
2. **Branch per task** from `main`: `<your-name>/<short-task>`, e.g. `justin/leaf-dialog-focus`.
3. **Open a pull request** into `main` and link the issue (`Closes #12`). `main` is protected: changes reach it
   through pull requests, not direct pushes.
4. Fill in the PR template: what changed, why, how you checked it, and before/after screenshots for anything
   visual (desktop and phone).
5. Merge when the build and `test-delivery.py` pass and the other person has had a chance to look.

The details, including commit-message style and how to note AI-assisted work, are in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Notes and gotchas

- **Performance.** The desktop scene draws about 3,600 elements of cut-paper artwork, so first paint and GPU load matter on
  cheap phones. The paper grain's fine layers are pre-drawn into small tiles, and animations pause when off
  screen or in a hidden tab. Measurements and methods are in `review-evidence/` (start with
  `007-grain-and-motion-20261012/`). Profile before and after any change that adds artwork, filters or motion.
- **Reduced motion** is respected: with `prefers-reduced-motion`, the creatures settle.
- **Ports.** If another copy of this project is running a preview, a test pointed at its port silently checks the
  wrong files. Set `HEARTWOOD_PREVIEW` to your own preview.
- **Opening files directly** (`file://`) works for a quick look, but Chrome blocks the font preloads there. Use
  the preview for anything you measure or test.
- The Heartbeat cover and Forest Council poster retain their authoritative heartwood.org URLs on desktop
  and phone. Local responsive copies provide the initial/offline image; visible photos revalidate through the
  browser cache and replace it only after the original decodes. Checks are coalesced per URL, with six hours
  between successful checks and ten minutes after a failure; no idle polling runs. The first source load can
  transfer/decode the publisher's full JPEG because it does not currently permit cross-origin image resizing.
  Ordinary tests use local photo fixtures and block external traffic; their results do not prove live asset
  freshness or the availability of outgoing destinations. Live diagnostics require separate bounded access.

## Ownership and licence

All rights reserved. This repository is public so collaborators can see the work. It is not open-source licensed.
Heartwood's name, logo and content belong to Heartwood. The fonts (Young Serif, Instrument Sans) are under the
SIL Open Font License; see `source/assets/fonts/*-OFL.txt`.
