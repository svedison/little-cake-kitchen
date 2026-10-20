---
status: accepted
date: 2026-10-19
---

# Batter, cream and pours are deformable meshes and particles, never a fluid simulation

Solids (eggs, ladyfingers, tools, trays) are rigid bodies in Rapier. Everything soft is faked: a pour is a particle ribbon that bends with the jug and splashes where it lands; the batter in the bowl and the cream on a cake are deformable surface meshes that react to the whisk, the spatula and the finger. There is no particle-fluid or soft-body simulation anywhere, and there never will be in this codebase.

The reason is that the player only ever touches the surface of these things, so a responsive surface is indistinguishable from a fluid to her, while a real fluid solver would not hold 60 fps on a phone browser and would take weeks to tune. A future reader who sees the batter "cheating" should not fix it.

Related rule: because there is no fail state, nothing ever overflows or spills onto the counter. Pouring past "just right" raises the level and darkens the surface, and the Result is simply "over".
