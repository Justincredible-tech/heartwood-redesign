# Spec: Grain, delivery and the client showcase

Status: APPROVED 2026-10-12 (recorded after the fact; the work was requested and approved by Justin in session)

## Goal
Make the Living Tree page faster without changing how it looks, package it beside the other concepts as a client
showcase, and publish it at https://justincredible.tech/heartwood/ with every upload gated on Justin's approval.

## Requirements
- [x] Faster first paint and less GPU work, with the design visually unchanged (measured A/B against the previous build).
- [x] Packaging keeps the design-concepts landing page as `index.html`, with Living Tree beside it as `living-tree.html`.
- [x] Tree favicon, and link-preview images instead of the host's placeholder.
- [x] Landing-page previews show the current design.
- [x] FTPS deploy confined to `public_html/heartwood/`, with a backup first and a desktop confirmation before anything is sent.

## Out of scope
- Restructuring the artwork or stylesheet (the v2 rebuild, tracks 008-014).

## Risks / data touched
- FTP credentials are read in place, never printed, copied or committed. FTP changes are gated by the Claude Code
  hook and the deploy script's confirmation dialog.

## Done-check
- `python tools/test-delivery.py` against a local preview, review-evidence/007-grain-and-motion-20261012/, and the
  live delivery and browser checks recorded in PRs #1 and #2.
