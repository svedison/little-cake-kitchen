import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Kitchen } from '../kitchen';
import type { Bowl } from '../bowl';
import type { Hud } from '../hud';
import type { Cat } from '../cat';
import type { Flavor } from '../recipes';

export type Result = 'under' | 'right' | 'over';

/** Things a Step leaves behind (yolks, berries) that the Kitchen clears when the recipe ends. */
export interface Leftover { mesh: THREE.Object3D; body?: RAPIER.RigidBody }

/** Everything a Step can touch. Steps never reach past this. */
export interface StepContext {
  k: Kitchen;
  bowl: Bowl;
  hud: Hud;
  cat: Cat;
  flavor: Flavor;
  pan: THREE.Group;
  oven: THREE.Group;
  /** x of the Station this Step happens at. */
  station: number;
  leftovers: Leftover[];
  done(result?: Result): void;
}

export interface StepRunner {
  start(): void;
  update(dt: number, t: number): void;
  dispose(): void;
  /** World points a test driver can aim at. */
  targets?(): Record<string, THREE.Vector3>;
}

export const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
