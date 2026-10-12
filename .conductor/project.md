# Heartwood production preparation

Goal: take the existing Heartwood website mockup toward production readiness for Heartwood visitors and maintainers, in small verified slices.

Current stack: generated static HTML, fingerprinted CSS and classic browser JavaScript, preserved HTML/SVG artwork, self-hosted exact Google font subsets and selected remote Heartwood images. Readable authoring files are in source; repeatable build/preview tooling is in tools, outside publish. Browser support and hosting targets remain to be confirmed for the release track.

Track003 build tools (outside publish): Node22, pinned Terser5.51.2, clean-css5.3.3 and html-minifier-terser7.2.0 for safe minification; Python3.13 plus installed Brotli for lossless precompression/preview. npm installs use --ignore-scripts and a saved lockfile. These are build-only tools authorized by the user's request to do whatever is needed for compression; no npm code or tool files are served as application dependencies. Readable source and tool instructions live outside publish. Production hosting remains unchanged until human deployment.

Rules: preserve the current design and content during extraction; no new application dependencies; no private data or estimates in publish; no deployment or merge without human review. Follow AGENTS.md, _core.md, conductor.md and the role prompts. The user's explicit first-task instruction authorizes this local extraction; broader production decisions remain provisional.

Team for track 001:
- Conductor (primary): scope, sequencing, durable task state and handoff.
- Product engineer: HTML/CSS/JavaScript extraction only.
- Quality engineer: independent baseline and browser verification, evidence outside publish.
- Tech lead: independent extraction review and technical findings.

Other roles are read and available when their scope arises: product manager, designer, platform, security, support, engagement, agent operations, junior engineer and specialist coordinator. Human approvals and specialist assessments remain human responsibilities.
