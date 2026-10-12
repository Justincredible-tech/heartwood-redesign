# Decoration reduction implementation evidence

The user-authorized populations were removed as whole source instances. The source HTML and CSS were the only application files edited; JavaScript matches before.js exactly. Independent review and browser checks belong to the reviewers.

| Population | Before | After |
|---|---:|---:|
| Bees | 9 | 4 |
| Moving soil animals | 26 | 13 |
| Static bedrock fossils | 2 | 1 |
| Physical rocks | 509 | 254 |
| Rock face/bed DOM elements | 729 | 359 |
| Physical rocks visible at 561–900px | 318 | 158 |
| Physical rocks visible at 560px or narrower | 241 | 118 |
| Source HTML elements | 3919 | 3248 |

Scene rocks changed from 91 to 45; subsoil rocks from 248 to 124; clay, sand, gravel, shale and bedrock from 34 to 17 each. Each region retains all six original rock colours. Counts round down independently by region, including the original responsive visibility buckets. The visible figures describe the existing breakpoint rules before runtime text-collision clearing.

The retained bee paths are bee-0, bee-2, bee-5 and bee-7, preserving both flight directions. Only the five unused individual flight keyframes were deleted. Moving animals are retained as 7 in the scene, 5 in subsoil and 1 in clay. Scene and subsoil each retain ants, beetles, pill bugs, centipedes and worms. On narrow screens, the existing beside-the-text hiding rule leaves 3 subsoil animals, down from 7.

Rock selection uses original visibility buckets, proportional colour quotas and evenly distributed positions. Inset rocks retain matching original bed/face indices. Retained deep stones receive stable classes matching their original even and divisible-by-three indices; the two existing responsive selectors now use those classes. No remaining geometry, timing, texture or shadow declaration was changed.

Preservation checks passed: every retained animal subtree is byte-identical; retained stone style/geometry values match the before snapshot; tree, leaves, birds, flowers, forests, wood, roots, mycelium, structural soil, clouds, hills, bands, paper, torn edges, content layers, header and footer subtrees are byte-identical. JavaScript is unchanged.

HTML: 931,574 to 815,691 bytes; final SHA-256 265d74822ac447aede75497c83d612689b3463f47a5394c6ab1f4a4aa028704b.

CSS: 73,405 to 65,195 bytes; final SHA-256 13f38581dc6571caec5165ff6c240a8c277f20bfca0321cfba73b1c077d680bd.

The exact physical-instance and animal ledger is removal-ledger.json. density_inventory.py reads the preserved baseline. halve-decoration.py is the one-shot source edit reproducer and refuses to run if canonical source differs from the before snapshot. It does not modify publish or build files.
