// Recipes are data: a list of Steps, each naming its Gesture, Station and runner.
import type { StationId } from './camera';
import type { StepContext, StepRunner, Result } from './steps/step';
import { LinePanStep } from './steps/linepan';
import { StirStep } from './steps/stir';
import { EggStep } from './steps/eggs';
import { PourStep } from './steps/pour';
import { PourPanStep } from './steps/pourpan';
import { BakeStep } from './steps/bake';

export interface Flavor {
  id: 'classic' | 'blueberry' | 'lemon';
  name: string;
  addIn?: 'berries' | 'lemon';
}

export interface StepDef {
  /** At most 24 characters, so it stays on one line in a 390 px phone's header. */
  title: string;
  hint: string;
  station: StationId;
  /** The Step whose Result decides the cake's look and the cat's verdict. */
  key?: boolean;
  /** What the cat says when the Step starts. */
  line: string;
  make(ctx: StepContext): StepRunner;
}

export interface Recipe {
  id: string;
  name: string;
  short: string;
  flavors: Flavor[];
  steps(flavor: Flavor): StepDef[];
  lines: Record<Result, string>;
}

export const BASQUE: Recipe = {
  id: 'basque',
  name: 'Basque Cheesecake',
  short: 'Basque',
  flavors: [
    { id: 'classic', name: 'Classic' },
    { id: 'blueberry', name: 'Blueberry', addIn: 'berries' },
    { id: 'lemon', name: 'Lemon', addIn: 'lemon' },
  ],
  steps: (flavor) => [
    { title: 'Line the pan', hint: 'Drag the parchment onto the pan', station: 'counter', line: 'Tuck it in nice and snug!', make: (ctx) => new LinePanStep(ctx) },
    { title: 'Mix cream cheese & sugar', hint: 'Circle your finger in the bowl', station: 'counter', line: 'Round and round until it\'s smooth~', make: (ctx) => new StirStep(ctx) },
    { title: 'Crack the eggs', hint: 'Pick up an egg, tap it on the rim', station: 'counter', line: 'Knock them on the edge!', make: (ctx) => new EggStep(ctx) },
    {
      title: flavor.addIn === 'berries' ? 'Cream, flour, berries' : flavor.addIn === 'lemon' ? 'Cream, flour & lemon' : 'Pour in cream & flour',
      hint: 'Press and hold the jug, slide down to tip', station: 'counter', line: 'Slow and steady pour!', make: (ctx) => new PourStep(ctx),
    },
    { title: 'Pour into the pan', hint: 'Press and hold the bowl, slide down to tip', station: 'counter', line: 'All of it into the pan!', make: (ctx) => new PourPanStep(ctx) },
    { title: 'Bake it HOT', hint: 'Drag the pan into the oven, then hold', station: 'stove', key: true, line: 'Basque cheesecake is SUPPOSED to be burnt on top!', make: (ctx) => new BakeStep(ctx) },
  ],
  lines: {
    under: 'Golden, not burnt yet: mid.',
    right: 'Burnt top: PERFECT!',
    over: 'Charred past burnt: ass.',
  },
};

export const RECIPES: Recipe[] = [BASQUE];

export function displayName(recipe: Recipe, flavorId?: string) {
  const f = recipe.flavors.find((x) => x.id === flavorId);
  return f && f.id !== 'classic' ? `${f.name} ${recipe.short}` : recipe.name;
}

export const VERDICTS: Record<Result, { label: string; color: string; expr: 'meh' | 'idle' | 'love'; line: string }> = {
  // The grade follows the bake's order: golden is short of the goal (mid), charred is past it (ass).
  under: { label: 'mid 😐', color: '#FFE8A3', expr: 'idle', line: 'Mid. 😐 Ate the whole thing though.' },
  over: { label: 'ass 💀', color: '#D9C8B5', expr: 'meh', line: 'Hmm… ass. 💀 But I would still eat another.' },
  right: { label: 'bussin 🔥', color: '#FFB6C1', expr: 'love', line: 'BUSSIN!! 🔥 Best cake I ever had!' },
};

export const CHEERS = ['Yay!', 'So good!', 'Ooh nice!', 'Perfect!', 'Lovely!', 'Mmm!'];
