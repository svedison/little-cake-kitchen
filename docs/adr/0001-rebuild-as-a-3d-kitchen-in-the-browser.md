---
status: accepted
date: 2026-10-19
---

# Rebuild the game as one continuous 3D kitchen, in the browser, replacing the 2D version

The finished 2D game (flat SVG, one HTML file, no build step) hit its goal of "easy, cute, small", but the new goal is Tactile: the player should feel like she is really cracking, pouring and stirring. We decided to rebuild from scratch as a single 3D Kitchen rendered with three.js and Rapier physics, authored in TypeScript with Vite, deployed as a static site, and to replace the 2D game at the repo root rather than keep both. The 2D version stays in git history as the reference for recipes, verdict lines and cat expressions.

## Considered options

- **Keep the HTML shell, swap only the baking stage for a 3D canvas.** Least work and least risk, but it keeps "screens" and never gives the sense of being in one room, which is the point of going 3D.
- **A game engine (Godot/Unity).** Better soft-body and fluid tooling, but web exports are heavy and unreliable on phone browsers, and the game would effectively become an installed app. The "here's a link, play it now" property was worth more.
- **Keep the 2D game served alongside.** Rejected to avoid maintaining two games; the link simply points at the new one.

## Consequences

- The "one HTML file, no build step" goal is gone; there is now a `npm run build` and a deploy step to GitHub Pages.
- The target device is a recent flagship phone at 60 fps, portrait, one finger. Budgets (shadows, particles, mesh density) are set for that and nothing older.
- Until the 3D game has all three recipes, the public link offers less than the old 2D game did. Accepted.
