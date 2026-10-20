# Creme's Kitchen

A small, cute, Tactile 3D cake-baking game made for Creme. This glossary holds the words we use for the game's concepts so design discussions and code agree.

## Language

**Tactile**:
The game's quality bar: a thing feels real because it responds like the real thing (how it moves, pours, spreads, cracks, and sounds), not because it looks photographic. The look stays stylized and cute.
_Avoid_: Realistic, photoreal, lifelike

**Kitchen**:
The one continuous 3D space the whole game happens in. Ingredients, tools, the oven and the cat all live here; there are no separate "screens" for baking.
_Avoid_: Stage, scene, level

**Station**:
One of the three fixed views of the Kitchen: Counter (mixing), Stove (boiling and baking), Fridge (chilling, cold ingredients). The player swipes between them; a Step always faces its Station when it starts.
_Avoid_: Area, zone, room, camera position

**Step**:
One physical action in a recipe, done in recipe order (crack the eggs, pour the cream). The player performs it on real objects in the Kitchen; the cat points at what's next.
_Avoid_: Task, phase, minigame

**Gesture**:
One of the four things the player's finger can do, learned once and reused by every Step: **Tap** (hit a thing), **Hold** (keep the finger down while something sustained happens: pouring, baking), **Drag** (pick up and carry), **Stir** (circle the finger to whisk, mix or spread). How long a Hold or Stir lasts decides its Result; how neat the motion was never does.
_Avoid_: Control, input, action, minigame type

**Result**:
How a Hold or Stir Step turned out: under, just right, or over. Only duration counts. Never a failure; it only changes how the cake looks and what the cat says.
_Avoid_: Score, grade, accuracy

**Shelf**:
The wall display at the Fridge Station where every cake the player has made sits as a small model with the cat's verdict. It is the Cake History, seen in-world; the most recent dozen are on the Shelf, the rest behind a tap.
_Avoid_: Gallery, history screen, grid

**Nudge**:
What happens when the player touches something that isn't part of the current Step: a cute wiggle and nothing else. The Kitchen never lets a wrong action through and never punishes it.
_Avoid_: Error, fail, mistake, penalty
