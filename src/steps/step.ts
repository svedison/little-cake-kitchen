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
  /** How far along the Step's Hold or Stir is (0..1) and which stage it is in. */
  progress?(): { progress: number; stage?: string };
  /** The Hold meter behind progress(), if the Step has one. */
  meterInfo?(): { duration: number; sweet: [number, number] };
  /** Internal numbers worth seeing from a test driver; merged into __game.state(). */
  debug?(): Record<string, unknown>;
  /** The props this Step put in the Kitchen, by name, for overlap checks. */
  boxes?(): Record<string, THREE.Object3D>;
  /** Tidy the Step's props away with an animation before the next Step starts. */
  leave?(): Promise<void>;
}

/** The Steps' ease lives in the motion toolkit now; re-exported so existing imports keep working. */
export { ease } from '../motion';
