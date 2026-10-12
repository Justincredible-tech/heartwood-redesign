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
python preview.py --port 8003             # then open http://127.0.0.1:8003/heartwood-site.html
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

## Where to change what

| To change | Edit | Then |
|---|---|---|
| Words, links, leaves, member groups, cards | the `SITE` content model in `source/js/heartwood-site.js` | build |
| Interactions | `source/js/heartwood-site.js` | build |
| Layout, colour, type, motion | `source/css/heartwood-site.css` | build |
| Artwork (paper shapes) | `source/heartwood-site.html` | build |
| Paper grain (flecks and fibres) | `--grain-fine` in the stylesheet | `python render-grain.py`, then build |
| Logos | replace the files in `finalLogos/` | `python import-logos.py`, then build |
| The client landing page | `showcase/index.html` | package |

Never edit anything the build writes into `publish/` (`heartwood-site.html`, `css/`, `js/`, `assets/`) or an
upload folder. The next build or package overwrites it, and a hand edit next to a stale `.br` / `.gz` copy is
served as the old version.

`source/heartwood-site.html` is about 800 KB of hand-placed artwork geometry. Don't run a formatter over it,
and keep its inline styles as they are; the tests check that the build preserves every artwork element and
attribute.

## Shipping to the web server

```bash
cd tools
npm run build
python package-upload.py --name upload-ready-v3     # any new folder name; it never overwrites one
```

Upload the **contents** of `publish/<folder>/`, including the hidden `.htaccess`, to the site directory. The
default package is the client showcase:

- `index.html`: the landing page
- `living-tree.html`: the built Living Tree site
- `mockups/`: the five alternatives
- `assets/`: fonts, grain tiles and preview images

Once the client has chosen, `python package-upload.py --site-only --name site-v1` packages Living Tree alone as
`index.html`.

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

- **Performance.** The page draws about 3,600 elements of cut-paper artwork, so first paint and GPU load matter on
  cheap phones. The paper grain's fine layers are pre-drawn into small tiles, and animations pause when off
  screen or in a hidden tab. Measurements and methods are in `review-evidence/` (start with
  `007-grain-and-motion-20261012/`). Profile before and after any change that adds artwork, filters or motion.
- **Reduced motion** is respected: with `prefers-reduced-motion`, the creatures settle.
- **Ports.** If another copy of this project is running a preview, a test pointed at its port silently checks the
  wrong files. Set `HEARTWOOD_PREVIEW` to your own preview.
- **Opening files directly** (`file://`) works for a quick look, but Chrome blocks the font preloads there. Use
  the preview for anything you measure or test.
- Some content (the Heartbeat cover image, outgoing links) loads from heartwood.org and is not checked by the
  tests.

## Ownership and licence

All rights reserved. This repository is public so collaborators can see the work. It is not open-source licensed.
Heartwood's name, logo and content belong to Heartwood. The fonts (Young Serif, Instrument Sans) are under the
SIL Open Font License; see `source/assets/fonts/*-OFL.txt`.
