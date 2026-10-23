// One finger. A pointer-down is offered to the active handlers first (a Step grabbing an
// egg, say); if nobody claims it, it becomes a swipe (turning between Stations) or a tap.

import { sound } from './sound';

export interface PointerHandler {
  /** Return true to claim this pointer until it is released. */
  down(x: number, y: number): boolean;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
}

export interface SwipeTarget {
  drag(dx: number): void;
  /** The finger left; vx is its speed in px/s (0 when it had stopped before lifting). */
  release(vx: number): void;
}

const TAP_SLOP = 10;   // px a finger may wander and still be a tap
const STALE_MS = 80;   // a finger that paused this long before lifting has no momentum

export class Pointer {
  readonly handlers: PointerHandler[] = [];
  readonly taps: ((x: number, y: number) => void)[] = [];
  /** A pointer-down nobody claimed. */
  readonly misses: ((x: number, y: number) => void)[] = [];
  /** A pointer-down a handler claimed (the Kitchen's flow hears every grab and hold). */
  readonly claims: ((h: PointerHandler) => void)[] = [];
  swipe: SwipeTarget | null = null;
  private active: PointerHandler | null = null;
  private id = -1;
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0, t: 0 };
  private vx = 0;
  private moved = false;
  private swiping = false;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
  }

  private down(e: PointerEvent) {
    sound.wake(); // a context iOS suspended comes back on the next touch
    if (this.id !== -1) return;
    this.id = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    this.start = { x: e.clientX, y: e.clientY };
    this.last = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.vx = 0;
    this.moved = false;
    this.swiping = false;
    this.active = null;
    for (const h of this.handlers) {
      if (h.down(e.clientX, e.clientY)) {
        this.active = h;
        for (const c of this.claims) c(h);
        return;
      }
    }
    for (const m of this.misses) m(e.clientX, e.clientY);
  }

  /** Is a finger down right now. */
  get busy() { return this.id !== -1; }

  private move(e: PointerEvent) {
    if (e.pointerId !== this.id) return;
    if (Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > TAP_SLOP) this.moved = true;
    if (this.active) { this.active.move(e.clientX, e.clientY); return; }
    const now = performance.now();
    const dt = Math.max(now - this.last.t, 1) / 1000;
    const dx = e.clientX - this.last.x;
    this.vx += ((dx / dt) - this.vx) * 0.5;
    this.last = { x: e.clientX, y: e.clientY, t: now };
    this.swiping = true;
    this.swipe?.drag(dx);
  }

  private up(e: PointerEvent) {
    if (e.pointerId !== this.id) return;
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    this.id = -1;
    if (this.active) { const h = this.active; this.active = null; h.up(e.clientX, e.clientY); return; }
    if (!this.moved) for (const t of this.taps) t(e.clientX, e.clientY);
    // The rail heard every move, so it hears the release too (a jittery tap glides back from a millimetre away).
    if (this.swiping) {
      const stale = performance.now() - this.last.t > STALE_MS;
      this.swipe?.release(this.moved && !stale ? this.vx : 0);
    }
  }
}
