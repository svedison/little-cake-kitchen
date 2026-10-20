# Creme's Kitchen — Spec

A cute, **Tactile** 3D cake-baking game for the browser, made for Creme. One continuous kitchen, one finger, real-feeling eggs, batter and cream, real kitchen sounds. Vocabulary is in [CONTEXT.md](./CONTEXT.md); the big decisions are in [docs/adr](./docs/adr).

This replaces the 2D version (see git history before the 3D rebuild). Its recipes, verdict lines and cat expressions carry over.

## Goals

- **Tactile.** Things feel real because they *respond* like the real thing: the egg cracks where you hit it, the stream bends when you move the jug, the whisk sound rises with your speed. Not photoreal; the look stays soft and cute.
- **Easy.** One finger, four gestures learned once, no instructions, no fail state. A cake takes a few minutes.
- **Cute.** Pastel palette, rounded everything, the chef cat in the room with you.

Non-goals: photorealism, true fluid simulation (ADR-0002), scoring, accounts, anything with a server.

## The Kitchen

Everything happens in one 3D room, seen from a fixed camera on a rail with three **Stations**. A horizontal swipe on empty space turns you to the next one; a Step always faces its Station when it starts.

| Station | What's there | Steps that happen here |
|---|---|---|
| **Counter** | bowl, whisk, spatula, egg carton, jug, flour, sugar, the recipe book, the cat | crack, mix, stir, pour, fill, dust |
| **Stove** | hob with pot and moka pot, oven with a window | boil, brew, bake |
| **Fridge** | fridge (chill, cold ingredients), pantry, the **Shelf** | chill, fetch cream, browse past cakes |

**Session start:** a two-second title card ("Creme's Kitchen", hides loading) fades into the Counter. The cat waves. The recipe book on the counter is how you pick a recipe: flip pages, tap one to start (Basque shows its three flavor chips). After a reveal, the cat nudges the book to bake another.

## Gestures (four, learned once)

| Gesture | Motion | Used for |
|---|---|---|
| **Tap** | hit a thing | crack an egg on the rim, press the oven button, shake the shaker |
| **Hold** | keep your finger down; something sustained happens | hold the jug over the bowl and it tilts and pours; hold the oven and it bakes |
| **Drag** | pick up and carry | ladyfinger to the dish, tray into the oven, parchment onto the pan |
| **Stir** | circle your finger | whisk, mix, spread cream |

Hold and Stir produce a **Result**: under / just right / over, decided by duration only. A wobbly circle never counts against you.

Touching something that isn't part of the current Step gets a **Nudge**: a cute wiggle, nothing else. Nothing ever overflows, burns to ruin, or fails.

## Physics and softness (ADR-0002)

- Solids are rigid bodies (Rapier): eggs, shells, ladyfingers, tools, trays, the cake once baked.
- Pours are particle ribbons that follow the jug and splash on landing.
- Batter in the bowl and cream on a cake are deformable surface meshes: they slosh under the whisk, bunch ahead of the spatula, dimple under a finger, rise as you pour.
- Dusting (cocoa, sugar) is a particle sprinkle that settles onto the surface.

## Sound

Recorded kitchen sounds, several takes each with slight pitch variation, no music. Sound is **tied to the physics**: the whisk gets louder as you stir faster, the pour stops the instant you lift the jug, the crack plays at the moment of contact. On by default (the first tap unlocks audio), with a mute button. Total audio budget about 3 MB.

## The cat

Same chef cat, now a round 3D body with a flat cartoon face that swaps the seven expressions (idle, excited, ooh, sleepy, yum, meh, love). Sits on the Counter, turns to follow the camera, paws point at the next object. Built in code, no rig. The chomp is the one hand-animated moment. The cat uses Creme's name once at the reveal.

## Reveal, taste test, Shelf

All in-world. The cake comes out of the oven onto the counter with confetti; drag it to the cat for the taste test; it chomps and rates it **bussin 🔥 / mid 😐 / ass 💀** from the key Step's Result. Every cake then appears on the **Shelf** at the Fridge Station as a small model with its verdict tag; the latest dozen sit on the Shelf, the rest behind a tap. Saved in local storage under the same key as the 2D game, so earlier cakes show up too.

## Recipes

Step lists are unchanged from the 2D game; each step is now a physical action at a Station.

### Basque Cheesecake (first, and the reference recipe)

1. **Line the pan** — Drag parchment onto the pan (Counter).
2. **Mix cream cheese & sugar** — Stir. Sweet spot = smooth.
3. **Crack the eggs** — Tap each egg on the bowl rim; shell halves, yolk plops in.
4. **Pour in cream & flour** (and blueberries / lemon for those flavors) — Hold the jug, then the flour cup, over the bowl.
5. **Pour into the pan** — Hold to pour; batter rises in the pan.
6. **Bake it HOT** — Hold at the Stove; watch the top scorch through the oven window. Sweet spot = burnt top (key Step).

### Tiramisu

Brew the espresso (Tap moka, Stove) · Whisk the mascarpone (Stir) · Dip ladyfingers (Drag, dunk then dish; soggy timer is cosmetic) · Spread cream (Stir with the spatula) · Second layer · Dust with cocoa (Tap) · Chill (Hold at the Fridge; key Step).

### Cream Puff

Boil butter & water (Tap, Stove) · Stir in the flour (Stir) · Beat in the eggs (Tap) · Pipe the puffs (Drag) · Bake until puffed (Hold, Stove; key Step) · Fill with cream (Drag) · Dust with sugar (Tap).

## Art

- **Props and furniture:** a CC0 low-poly kit (Kenney / Poly Pizza) so the room is coherent from day one. Any prop can be swapped later.
- **Soft things and cakes:** procedural meshes in code, because they have to deform anyway.
- **Cat:** in code.
- Palette: cream `#FFF6E9`, pink `#FFB6C1`, cocoa `#6B4A3A`, matcha `#B9D8A8`, butter `#FFE8A3`. Font: Fredoka.

## Tech

- three.js + Rapier (WebAssembly), TypeScript, Vite. Static build deployed to GitHub Pages.
- Target: a recent flagship phone, portrait, 60 fps. Real-time shadows and generous particles are in budget; the game may scale them down on slower devices but is not designed for them.
- Recipes stay **data**: a list of Steps `{ title, gesture, station, target, key? }`; the Kitchen runs them.

## Build order

1. **Vertical slice:** title card → Counter → crack three eggs into the bowl. Real physics, shell crack sound, yolk plop, 60 fps on Creme's phone. Nothing else. This proves gestures, physics, sound and performance in the smallest thing.
2. **Full Basque, rough:** all six Steps across three Stations, reveal, taste test, Shelf, placeholder props and sounds.
3. **Polish Basque to the Tactile bar**, step by step.
4. **Tiramisu, then Cream Puff**, reusing everything.

## Out of scope

Walking around, free camera, true fluids, recipe recognition / free-form cooking, difficulty, shop, multiplayer, anything needing a server.
