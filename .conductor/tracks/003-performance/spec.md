# Spec: Lossless load and runtime optimization

Goal: reduce initial download/loading work and end-user lag as far as evidence supports, preserving the approved design, artwork quality, content and interaction behavior.

Requirements:
- Measure current local asset bytes, compressibility, browser DOM/animation/render/layout/startup costs at fixed desktop/mobile widths before implementation.
- Preserve readable maintainable source outside publish and provide a repeatable build for optimized publish artifacts.
- Minify/compress safely without rasterizing artwork, simplifying geometry, removing content, disabling visible normal animation or weakening accessibility.
- Reduce offscreen/background decorative animation and unnecessary DOM/layout work. Retain normal visible motion, dialog animation, keyboard/focus/Escape, navigation/deep links, member search and reduced-motion behavior.
- Preserve the approved Roots gap: 32px desktop at 1440px, 20px mobile at 390px.
- Serve/prebuild compression and cache settings suitable for hosted delivery; verify actual compression negotiation locally. Do not claim server compression is live in production before deployment.
- Verify smaller output and material measured runtime improvement independently. Include visual/functional browser evidence and explicit limits.

Scope: HTML/CSS/JS, lossless static artwork delivery when exact fidelity is proven, build/preview tools and static hosting configuration. No new application dependencies, public copy edits, CRM integration or production deployment. Existing production and launch gates remain recorded separately.

Risks: generated artwork is a large DOM with CSS grain/filters; blanket containment or animation removal can alter design, scrolling or offscreen leaf dialogs. Browser measurements must identify network-cache/throttling/viewport conditions. Keep originals and evidence outside publish.

Authorization: user's explicit instruction to compress and optimize load time and lag without quality loss. Human production deployment remains a later gate.
