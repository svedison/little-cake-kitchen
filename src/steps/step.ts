import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Kitchen } from '../kitchen';
import type { Bowl } from '../bowl';
import type { Hud } from '../hud';
import type { Cat } from '../cat';
import type { Flavor } from '../recipes';

export type Result = 'under' | 'right' | 'over';

/** Bodies a Step leaves behind that the Kitchen clears when the recipe ends. */
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
  /**
   * Bring the Step's props in (they pop, drop or slide in) and start listening. A promise
   * resolves once they have arrived; Game ends its transition then.
   */
  start(): void | Promise<void>;
  update(dt: number, t: number): void;
  /** Pure cleanup, called once leave() has resolved: everything is out of sight by then. */
  dispose(): void;
  /** World points a test driver can aim at. */
  targets?(): Record<string, THREE.Vector3>;
  /** How far along the Step's Hold or Stir is (0..1) and which stage it is in. */
  progress?(): { progress: number; stage?: string };
  /** The Hold meter behind progress(), if the Step has one. */
  meterInfo?(): { duration: number; sweet: [number, number] };
  /** Internal numbers worth seeing from a test driver; merged into __game.state(). */
  debug?(): Record<string, unknown>;
  /**
   * The prop the finger is handling right now (carried, held over the bowl, tipped), or null.
   * The cat's bubble keeps clear of it and the cat makes room for it.
   */
  focus?(): THREE.Object3D | null;
  /** The props this Step put in the Kitchen, by name, for overlap checks. */
  boxes?(): Record<string, THREE.Object3D>;
  /**
   * Tidy the Step's props away with an animation (they pop out, slide off or are set down)
   * before the next Step starts. Game calls it after its little reaction beat; update()
   * keeps running until it resolves, but the Step gets no more input.
   */
  leave?(): Promise<void>;
}

/** The Steps' ease lives in the motion toolkit now; re-exported so existing imports keep working. */
export { ease } from '../motion';
