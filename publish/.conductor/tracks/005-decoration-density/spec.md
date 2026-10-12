# Spec: Halve decorative population

Goal: reduce bees, lower-soil animals and scattered lower-level rocks/debris to approximately half their current population, as explicitly requested by the user.

Requirements: remove whole decorative instances from readable source, preserving the remaining geometry, motion, spatial/species mix and accessible page content. Include lower artwork soil and continued deep strata. Keep paired inset-rock beds/faces together. Round odd populations down to the nearest whole instance and record exact before/after counts. Preserve responsive density reductions without accidentally changing parity after removals. Remove unused per-bee flight paths if applicable; no new dependencies.

Out of scope: birds, tree/leaves/flowers, structural soil/torn edges, logos, text, dialogs, content model, hosting or deployment.

Done-check: independent counts and preservation comparison, regenerated minified/compressed files and existing delivery checks; desktop/mobile browser appearance and key interaction checks where the browser connection is available. Record unavailable checks honestly. Entry path unchanged; existing launch/visual release gates remain pending.
