# Little Cake Kitchen — Spec

A tiny, cozy browser game about making cakes. Three recipes: **Tiramisu**, **Basque Cheesecake** (in three flavors) and **Cream Puff**.

## Goals

- **Easy.** Anyone can finish a cake in 2–3 minutes with no instructions. No fail state, no timers that punish, no lives.
- **Cute.** Soft pastel palette, rounded everything, a little mascot who cheers you on. Every action should feel satisfying (a wobble, a sparkle, a soft sound).
- **Small.** One HTML file + one CSS + one JS, no framework, no build step, no backend. Runs on phone and laptop by opening the file or a static link.

Non-goals: scoring leaderboards, accounts, monetization, realistic baking.

## Screens

1. **Title** — logo, mascot, one button: *Let's bake!* (plus a small *History* link so saved cakes are reachable without baking)
2. **Recipe pick** — three big cards (Tiramisu, Basque, Cream Puff). Tap one. Basque opens a little row of flavor chips (*Classic · Blueberry · Lemon*) under its card; tap a chip to start.
3. **Baking** — the recipe plays as a sequence of steps (below). One step at a time, full screen, big "Next" transition once the step is done.
4. **Reveal** — the finished cake slides in, confetti, mascot says something sweet, cake gets a little name tag ("Cake #3 · Tiramisu"). Then the **taste test**: drag the cake into the cat's mouth. The cat chomps, the cake vanishes, and the cat rates it by how the key step went — *ass* 💀 (under), *mid* 😐 (a bit much), *bussin* 🔥 (just right) — as a big pill plus a line in its speech bubble. Feeding is optional; *Bake another* / *History* are always there. The verdict is saved on the cake's history entry.
5. **History** — grid of every cake made so far, newest first, saved in `localStorage`. Each card shows the cake, its name and the cat's rating pill (*ass* / *mid* / *bussin*, or a dashed *not tasted* if it was never fed to the cat). Tap a cake to see it bigger with its date and rating. Reached from the title screen and the reveal screen.

## Interactions (only 3 kinds)

Every step in both recipes uses one of these, so the player learns them once:

| Kind | How it works | Feel |
|---|---|---|
| **Tap** | Tap the thing N times (e.g. crack eggs, tap to pour). A small meter fills. | Each tap = a little bounce + "pop" |
| **Hold** | Press and hold to whisk / bake. A ring fills up; release when it's in the "just right" zone. Overshooting just makes it "a bit much" — never a fail. | Rumble/wobble while holding, chime at the sweet spot |
| **Drag** | Drag an item from a tray onto the bowl/pan (ladyfingers, cream layers, into the oven). Snaps when close. | Item wiggles while held, "plop" when dropped |

## Recipes

### Tiramisu (7 steps)

1. **Brew the espresso** — Tap the moka pot 3 times. Steam rises.
2. **Whisk the mascarpone cream** — Hold to whisk. Sweet spot = fluffy.
3. **Dip ladyfingers** — Drag 4 ladyfingers into the coffee, then into the dish. (Hold them in too long and they go "soggy" — cosmetic only.)
4. **Spread cream** — Drag the spatula across the dish (horizontal swipe, snaps to full coverage).
5. **Second layer** — Repeat steps 3 and 4, faster (3 ladyfingers).
6. **Dust with cocoa** — Tap the shaker 5 times. Cocoa falls like snow.
7. **Chill in the fridge** — Hold to "wait." The fridge hums, a moon rises, a clock spins. Release anytime after the sweet spot.

### Basque Cheesecake (6 steps)

1. **Line the pan** — Drag the parchment onto the pan. It crumples cutely.
2. **Mix cream cheese & sugar** — Hold to mix. Sweet spot = smooth.
3. **Crack the eggs** — Tap 3 eggs, one at a time, on the bowl rim.
4. **Pour in cream & flour** — Drag the jug, then the flour cup, into the bowl.
5. **Pour into the pan** — Hold to pour. Batter rises in the pan.
6. **Bake it HOT** — Hold to bake. The ring runs from pale → golden → **burnt-top brown** (the sweet spot — basque is supposed to look burnt!). Going past it just makes it darker.

**Flavors:** Classic, Blueberry, Lemon. A flavor only changes small things: Blueberry and Lemon add a third item to drag into the bowl in step 4 (and the step title becomes "Cream, flour & blueberries"), the batter/bowl/pour/oven are tinted, and the finished cake gets a tinted body plus a little garnish. The name tag reads "Blueberry Basque". The steps, timing and sweet spots are identical.

### Cream Puff (7 steps)

1. **Boil butter & water** — Tap the pot 3 times. Bubbles rise.
2. **Stir in the flour** — Hold to stir. Sweet spot = "a smooth ball".
3. **Beat in the eggs** — Tap 3 eggs.
4. **Pipe the puffs** — Drag 4 dough blobs onto the baking sheet.
5. **Bake until puffed** — Hold to bake. The puffs swell and turn golden; sweet spot = golden, past it = a bit dark. (Key step for the reveal.)
6. **Fill with cream** — Drag 3 cream swirls onto the baked puffs.
7. **Dust with sugar** — Tap the shaker 5 times. Snow!

## Finished cake variations

The reveal shows a cake whose look depends on the Hold steps:

- **Under / just right / a bit much** on 1–2 key steps changes the drawing slightly (e.g. tiramisu cream flatter vs. fluffy; basque top pale vs. perfectly scorched vs. extra dark; cream puff shells pale vs. golden vs. dark).
- Mascot comment matches: "A little pale, but still delicious!" / "PERFECT burnt top!!" / "Extra toasty — crunchy edges!"
- No numeric score. The cake is always a success.

## Visual style

- **Palette:** cream `#FFF6E9`, strawberry pink `#FFB6C1`, cocoa brown `#6B4A3A`, matcha green `#B9D8A8`, butter yellow `#FFE8A3`. Dark mode not needed.
- **Shapes:** everything rounded (border-radius 16–24px), thick soft outlines, chunky buttons with a drop shadow that "presses" on tap.
- **Font:** one rounded display font (e.g. *Fredoka* or *Baloo 2* from Google Fonts) for everything.
- **Art:** simple inline SVG or emoji-scale illustrations. Hand-drawn feel over polished. Can be upgraded later without touching logic.
- **Mascot:** a round cat (or whatever she likes) in a chef hat, bottom-left corner, ~140px wide so it's always clearly visible (page content keeps a bottom margin for it). Expressions: idle, excited, "ooh", sleepy (fridge step), yum (chewing), meh (ass verdict), love (bussin verdict).
- **Motion:** CSS transitions/keyframes only. Bounce on tap, wobble on hold, slide-in between steps, confetti on reveal.
- **Sound:** 5–6 tiny sounds (pop, plop, whisk, chime, ding, confetti). Muted by default with a toggle; works fully without sound.

## Tech

- `index.html`, `style.css`, `game.js`. Vanilla JS. No dependencies except the Google Font.
- Recipes are **data, not code**: each recipe is an array of step objects `{ title, kind: 'tap'|'hold'|'drag', target, art, mascotLine }`. The step runner handles the three kinds. Adding another cake = adding an array + its art. A recipe with `flavors` may give `steps` as a function of the chosen flavor.
- State: `currentRecipe`, `flavor`, `steps`, `stepIndex`, `stepResults[]`, `gallery[]` (persisted to `localStorage`; entries remember their flavor and the cat's verdict).
- Works on touch and mouse (pointer events). Portrait phone layout first, scales up on desktop.
- Target: no step needs more than one gesture type; whole file set under ~200 KB.

## Nice-to-haves (only after the above feels good)

- A personal touch: title screen says "made for [her name]" and the mascot uses her name once.
- Her own hand-drawn cake art swapped in for the SVGs.
- More cakes or flavors she picks.

## Out of scope

Difficulty levels, ingredients inventory, shop/currency, multiplayer, tutorials (the game *is* the tutorial), anything that needs a server.
