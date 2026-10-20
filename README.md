# Creme's Kitchen 🍰

A cute, tactile 3D cake-baking game for the browser, made for Creme. One continuous kitchen, one finger, eggs that really crack and batter that really pours.

**Status:** vertical slice. The title card, the counter, and one step: crack three eggs into the bowl.

## Run it

```
npm install
npm run dev
```

Open the printed URL on your phone (same Wi-Fi) or laptop. Add `?fps` to the URL to see the frame rate.

`npm run build` writes a static site to `dist/`; pushes to `main` deploy it to GitHub Pages.

## Design

- [SPEC.md](./SPEC.md): what the game is and the build order
- [CONTEXT.md](./CONTEXT.md): the words we use (Kitchen, Station, Step, Gesture, Result, Shelf, Nudge)
- [docs/adr](./docs/adr): the decisions behind the 3D rebuild

The original 2D version lives in git history before the rebuild.

## Stack

three.js for rendering, Rapier for physics, TypeScript, Vite. No backend.
