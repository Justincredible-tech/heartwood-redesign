# Spec: Extract CSS and JavaScript

## Goal
Implement the user's first task: split heartwood-site.html into HTML plus appropriately located CSS and JavaScript files, retaining the current rendered design and interactions.

## Requirements
- Move the complete stylesheet block into css/heartwood-site.css and reference it at its original position in the head.
- Move the two classic script bodies unchanged into one js/heartwood-site.js, concatenated in their original order. Load it as one ordinary classic script at the end of the body. One request avoids a new interval where leaf handlers exist before content handlers.
- Preserve stylesheet and script contents, SITE content, generated artwork, IDs, attributes and existing runtime behavior.
- Preserve inline artwork geometry, custom properties and runtime-generated element styles in this slice; this extraction targets the embedded stylesheet and script blocks.
- Introduce no module conversion, bundler, new dependency or application behavior change.
- Local HTTP and direct-file loading must work. Validate desktop/mobile navigation, leaf/card dialogs, keyboard/Escape/focus restoration, member search, reduced motion and remote asset availability.
- Create a valid .conductor/launch.json mapping and record whether Astelier Projects launch was actually verified.

## Out of scope
Redesign, copy changes, new CRM integrations, production deployment, broad accessibility/security repairs and converting generated artwork into a different representation.

## Risks / data touched
Public mockup content only. Relative CSS URLs and script execution order may affect loading. Remote resources and existing mockup defects must be distinguished from extraction regressions. No private estimates or customer records added.

## Done-check
Independent comparison with the pre-change snapshot proves only the stylesheet and script-block replacements changed; the CSS body and both concatenated script bodies remain byte-identical. JavaScript syntax checks and browser checks provide evidence. Existing issues and any unavailable Astelier launch test are recorded explicitly; this track does not claim the whole site is production ready.

Scope source: user's explicit extraction instruction. Implementation candidates remain subject to human review before production release.
