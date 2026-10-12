# Repository Guidelines

## Project Structure & Module Organization

- Readable source lives in `../source/` (HTML and artwork, CSS, JavaScript with the `SITE` content model, fonts, logos, grain tiles). `heartwood-site.html` in this folder is **build output** from `../tools/build-site.mjs`; never edit it by hand. See `../README.md` and `../tools/README.md`.
- `_core.md` defines shared delivery standards; `conductor.md` describes task tracking and handoffs.
- `agents/` contains Markdown role prompts, not application modules. Project state lives in `../.conductor/` at the repository root (`project.md`, `tracks.md`, one folder per track). The v2 rebuild plan is in `../docs/ROADMAP.md`.
- Fonts are self-hosted; some content images and outgoing links load from heartwood.org. Check their availability during review.

## Build, Test, and Development Commands

Run from this directory in PowerShell:

```powershell
Start-Process .\heartwood-site.html
python -m http.server 8000 --bind 127.0.0.1
```

The first command opens the page in the default browser. The second serves this folder locally; visit `http://127.0.0.1:8000/heartwood-site.html` and stop with Ctrl+C. Use an available port. Serve only this publish folder, because directory listings expose its files.

There is no package manifest, build step, lint command, or automated test runner. Do not assume `npm install` or `npm test` applies.

## Coding Style & Naming Conventions

Match surrounding formatting: two-space indentation inside CSS blocks and JavaScript functions, single-quoted JavaScript strings, and semicolons. Preserve section comments and compact generated artwork markup; avoid reformatting the entire HTML file.

Reuse CSS custom properties for colors and animation. Follow class patterns such as `.card__title` and `.btn--quiet`, camelCase function names, and kebab-case content IDs such as `forest-watch`. Update `SITE` for content changes and preserve IDs referenced by interaction attributes. No formatter or linter is configured.

## Testing Guidelines

No test framework or coverage threshold is configured. Validate changes in a browser at desktop and mobile widths. Exercise navigation, tree leaves, content dialogs, member-group interactions, and outgoing links. Check keyboard access, Escape dismissal, focus restoration, reduced-motion behavior, and console errors. Include screenshots for visual changes and record unverified behavior.

## Commit & Pull Request Guidelines

This directory has no Git metadata or accessible commit history. If version control is initialized, use concise imperative subjects, such as `Fix mobile dialog focus`, and keep changes focused.

PR descriptions should explain what changed, why, and how it was verified; link applicable issues or specs, disclose AI involvement, and include before/after screenshots for UI changes. Follow `_core.md` human-review requirements for merges and deployment.

## Security & Content

Keep credentials, customer records, and private estimates out of this publish folder. Use synthetic test data. Verify public claims and destination URLs before release.
