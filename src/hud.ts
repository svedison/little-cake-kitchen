// Everything drawn in HTML over the Kitchen: step header, meters, hints, the cat's
// bubble, the finger cue, the recipe book and the Shelf lightbox.
import type { Flavor } from './recipes';
import { sound } from './sound';

// The ring is an inline SVG, and SVGElement has no `hidden` property: assigning one just
// makes an expando and the attribute never changes. Everything that hides or shows a
// HUD element goes through toggleAttribute so the SVG and the HTML behave the same.
const $ = <T extends HTMLElement | SVGElement = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
const CIRC = 2 * Math.PI * 50;
const BUBBLE_GAP = 8;       // px kept between the bubble and the step header
const BUBBLE_FADE_MS = 200; // matches .bubble.away in style.css
const TITLE_OUT_MS = 150;   // matches .ghost in style.css

/**
 * The flavour chips' little pictures, drawn inline so they look the same everywhere (an emoji
 * blueberry is a missing-glyph box on Windows 10). 24 x 24, in the game's palette.
 */
const CHIP_ICONS: Record<Flavor['id'], string> = {
  // a wedge of Basque: creamy inside, the burnt top along its back edge
  classic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17 L19 8 L21 17 Z" fill="#ffe8a3" stroke="#6b4a3a" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 8 L21 17 L20.2 17 L18.4 9.4 Z" fill="#8a5a3c"/><path d="M3 17 L19 8" stroke="#8a5a3c" stroke-width="2.4" stroke-linecap="round"/><path d="M2.5 19.5 H21.5" stroke="#ffb6c1" stroke-width="2.2" stroke-linecap="round"/></svg>',
  // two blueberries, each with its little star-shaped crown
  blueberry: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="14" r="5.5" fill="#5b6fb5" stroke="#3d4a80" stroke-width="1.4"/><circle cx="15.5" cy="10" r="5.5" fill="#6f84c9" stroke="#3d4a80" stroke-width="1.4"/><path d="M14 8.6 L17 11.4 M17 8.6 L14 11.4" stroke="#2f3866" stroke-width="1.4" stroke-linecap="round"/><circle cx="13.6" cy="7.6" r="1.1" fill="#fff" opacity="0.7"/><path d="M7 12.6 L10 15.4 M10 12.6 L7 15.4" stroke="#2f3866" stroke-width="1.4" stroke-linecap="round"/></svg>',
  // a lemon with a leaf
  lemon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13 C4 8 8 5 12.5 5 C17 5 20 8.5 20 12.5 C20 17 16 20 11.5 20 C7 20 4 17.5 4 13 Z" fill="#ffe066" stroke="#c9a227" stroke-width="1.5"/><path d="M3 13 L5 13 M19.2 12.4 L21 12" stroke="#c9a227" stroke-width="1.6" stroke-linecap="round"/><path d="M12 5.2 C13 2.6 16 2 17.6 3 C16.6 5 14.4 5.8 12 5.2 Z" fill="#b9d8a8" stroke="#7aa866" stroke-width="1.2" stroke-linejoin="round"/><ellipse cx="9.5" cy="10" rx="2" ry="1.2" fill="#fff" opacity="0.6"/></svg>',
};

/** One cake in the "and N more" list. */
export interface MoreRow { n: number; name: string; date: string; verdict: { label: string; color: string } | null }

/** Restart a one-shot CSS animation class (removing and re-adding it alone does not replay it). */
function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).getBoundingClientRect();
  el.classList.add(cls);
}

export interface HudButton { label: string; ghost?: boolean; onClick(): void }

export class Hud {
  private readonly hud = $('hud');
  private readonly header = $('step-head');
  private readonly count = $('step-count');
  private readonly title = $('step-title');
  private readonly pips = $('pips');
  private readonly ring = $<SVGSVGElement>('ring');
  private readonly arc = document.querySelector<SVGCircleElement>('#ring .arc')!;
  private readonly sweet = document.querySelector<SVGCircleElement>('#ring .sweet')!;
  private readonly heart = document.querySelector<SVGGElement>('#ring .ring-heart')!;
  private readonly bakeEl = $('bake');
  private bakeStage = -1;
  private bakeLabels: HTMLElement[] = [];
  private readonly hintEl = $('hint');
  private readonly footEl = document.querySelector<HTMLElement>('#hud .foot')!;
  private readonly buttonsEl = $('buttons');
  private readonly bubbleEl = $('bubble');
  private readonly verdictEl = $('verdict');
  private readonly tagEl = $('tag');
  private readonly bookEl = $('book');
  private readonly lightboxEl = $('lightbox');
  private readonly moreEl = $('more');
  private readonly chevronsEl = $('chevrons');
  private readonly cueEl = document.createElement('div');
  private bubbleTimer = 0;
  private hintText = '';
  /** Screen rect (CSS px) of the prop the finger is handling: the cat's bubble never sits over it. */
  avoid: { x: number; y: number; w: number; h: number } | null = null;

  constructor() {
    // The finger cue: a soft white dot that presses and rings where the Step wants a touch.
    // Drawn over the bubble, so a line floating over a prop never hides where to press.
    this.cueEl.className = 'cue';
    this.cueEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.cueEl);
    $('lightbox-close').addEventListener('click', () => { this.lightboxEl.hidden = true; sound.play('book', { gain: 0.3, rate: 1.3 }); });
    $('book-close').addEventListener('click', () => { this.bookEl.hidden = true; sound.play('book', { gain: 0.4, rate: 1.15 }); });
    $('more-close').addEventListener('click', () => { this.moreEl.hidden = true; sound.play('book', { gain: 0.3, rate: 1.3 }); });
  }

  show() { this.hud.hidden = false; }

  /**
   * Header for a Step: the old title slides up and fades while the new one pops in, and the
   * count pill bounces.
   */
  step(index: number, total: number, title: string) {
    const wasHidden = this.header.hasAttribute('hidden');
    this.header.toggleAttribute('hidden', false);
    const count = `Step ${index + 1} of ${total}`;
    if (this.count.textContent !== count) {
      this.count.textContent = count;
      replay(this.count, 'bounce');
    }
    if (this.title.textContent === title) return;
    if (this.title.textContent && !wasHidden) {
      const ghost = this.title.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('id');
      ghost.className = 'ghost';
      ghost.style.top = `${this.title.offsetTop}px`;
      ghost.setAttribute('aria-hidden', 'true');
      this.header.appendChild(ghost);
      window.setTimeout(() => ghost.remove(), TITLE_OUT_MS + 30);
    }
    replay(this.title, 'pop');
    this.title.textContent = title;
  }

  /** Header with a title and an optional little pill above it (reveal, idle); never has a meter under it. */
  heading(title: string | null, count = '') {
    this.header.toggleAttribute('hidden', title === null);
    this.count.textContent = title === null ? '' : count;
    if (title && this.title.textContent !== title) replay(this.title, 'pop');
    this.title.textContent = title ?? '';
    this.meter('none');
  }

  /** The hint under the Kitchen; a new line cross-fades in, the same line does nothing. */
  hint(text: string) {
    if (text === this.hintText && this.hintEl.textContent === text) return;
    this.hintText = text;
    if (text) {
      this.hintEl.classList.remove('pop');
      replay(this.hintEl, 'swap');
    }
    this.hintEl.textContent = text;
    this.hintEl.hidden = !text;
  }

  /** The Nudge for a swipe that went nowhere: the hint (or the one given) pops to catch the eye. */
  nudgeHint(fallback = '') {
    if (!this.hintText) this.hint(fallback);
    this.hintEl.classList.remove('swap');
    replay(this.hintEl, 'pop');
  }

  /** Show one meter (or none); a meter that appears pops in. */
  meter(kind: 'none' | 'pips' | 'ring' | 'bake') {
    const show = (el: Element, on: boolean) => {
      const was = !el.hasAttribute('hidden');
      el.toggleAttribute('hidden', !on);
      if (on && !was) replay(el, 'meter-in');
    };
    show(this.pips, kind === 'pips');
    show(this.ring, kind === 'ring');
    show(this.bakeEl, kind === 'bake');
    if (kind !== 'ring') this.ring.classList.remove('in-sweet');
    if (kind !== 'bake') this.bakeEl.classList.remove('in-goal');
  }

  /**
   * Lay out the bake gauge: one band per stage (in its colour, as wide as its share of the
   * hold), a label under each, and the goal stage ringed, its label over it ("BURNT: let go
   * here"), so the narrow bands either side keep room for theirs.
   */
  bakeGauge(stages: { label: string; color: string; until: number; goal?: boolean }[]) {
    const track = document.createElement('div');
    track.className = 'track';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const labels = document.createElement('div');
    labels.className = 'labels';
    const extra: HTMLElement[] = [];
    this.bakeLabels = [];
    let from = 0;
    for (const s of stages) {
      const w = (s.until - from) * 100;
      const band = document.createElement('span');
      band.className = 'band';
      band.style.flex = `0 0 ${w}%`;
      band.style.background = s.color;
      bar.appendChild(band);
      const label = document.createElement(s.goal ? 'div' : 'span');
      label.style.left = `${from * 100 + w / 2}%`;
      if (s.goal) {
        label.className = 'goal-top';
        label.textContent = `♥ ${s.label}: let go here`;
        const ring = document.createElement('div');
        ring.className = 'goal-ring';
        ring.style.left = `calc(${from * 100}% - 3px)`;
        ring.style.width = `calc(${w}% + 6px)`;
        extra.push(ring, label);
      } else {
        label.textContent = s.label;
        labels.appendChild(label);
      }
      this.bakeLabels.push(label);
      from = s.until;
    }
    const needle = document.createElement('div');
    needle.className = 'needle';
    track.append(bar, labels, ...extra, needle);
    this.bakeEl.replaceChildren(track);
    this.bakeStage = -1;
  }

  /** Move the bake gauge's needle to a progress (0..1) and light the label of the stage it is in. */
  setBake(progress: number, stage: number) {
    const needle = this.bakeEl.querySelector<HTMLElement>('.needle');
    if (needle) needle.style.left = `${Math.min(1, Math.max(0, progress)) * 100}%`;
    if (stage === this.bakeStage) return;
    this.bakeStage = stage;
    this.bakeLabels.forEach((l, i) => l.classList.toggle('on', i === stage));
    if (this.bakeLabels[stage]?.classList.contains('goal-top')) replay(this.bakeEl, 'in-goal');
    else this.bakeEl.classList.remove('in-goal');
  }

  setPips(total: number, done: number) {
    while (this.pips.children.length < total) this.pips.appendChild(document.createElement('span'));
    while (this.pips.children.length > total) this.pips.lastChild?.remove();
    Array.from(this.pips.children).forEach((p, i) => {
      const on = i < done;
      if (on && !p.classList.contains('on')) replay(p, 'fill');
      p.classList.toggle('on', on);
    });
  }

  setRing(progress: number, sweet: [number, number]) {
    this.arc.setAttribute('stroke-dasharray', `${progress * CIRC} ${CIRC}`);
    this.sweet.setAttribute('stroke-dasharray', `${(sweet[1] - sweet[0]) * CIRC} ${CIRC}`);
    this.sweet.setAttribute('stroke-dashoffset', `${-sweet[0] * CIRC}`);
    const inSweet = progress >= sweet[0] && progress <= sweet[1];
    this.ring.classList.toggle('in-sweet', inSweet);
    // the heart in the middle of the wedge, turned back upright against the svg's quarter turn
    const a = ((sweet[0] + sweet[1]) / 2) * Math.PI * 2;
    const x = 60 + 50 * Math.cos(a), y = 60 + 50 * Math.sin(a);
    this.heart.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(90) scale(${inSweet ? 1.35 : 1})`);
  }

  /** Is the ring meter showing right now (for the test driver's probe). */
  get ringVisible() { return !this.ring.hasAttribute('hidden'); }

  buttons(list: HudButton[]) {
    this.buttonsEl.replaceChildren();
    for (const b of list) {
      const el = document.createElement('button');
      el.className = b.ghost ? 'btn btn-ghost' : 'btn';
      el.textContent = b.label;
      el.addEventListener('click', b.onClick);
      this.buttonsEl.appendChild(el);
    }
  }

  /** The little pill over the hint that names how a Step came out, with a swatch of its colour; null hides it. */
  tag(text: string | null, color?: string) {
    this.tagEl.hidden = !text;
    if (!text) return;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    if (color) sw.style.background = color;
    this.tagEl.replaceChildren(...(color ? [sw] : []), document.createTextNode(text));
  }

  verdict(v: { label: string; color: string } | null) {
    this.verdictEl.hidden = !v;
    if (v) { this.verdictEl.textContent = v.label; this.verdictEl.style.background = v.color; }
  }

  bubble(text: string, seconds = 3.5) {
    this.bubbleEl.textContent = text;
    this.bubbleEl.hidden = false;
    this.bubbleEl.style.visibility = '';
    this.bubbleEl.classList.remove('pop', 'away');
    void this.bubbleEl.offsetWidth;
    this.bubbleEl.classList.add('pop');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.hideBubble(), seconds * 1000);
  }

  /** Put a showing bubble away now (its fade still plays). */
  dismissBubble() {
    if (this.bubbleVisible) { clearTimeout(this.bubbleTimer); this.hideBubble(); }
  }

  /** The bubble shrinks and fades out rather than blinking off; it is out of the way once the fade is done. */
  private hideBubble() {
    this.bubbleEl.classList.remove('pop');
    this.bubbleEl.classList.add('away');
    this.bubbleTimer = window.setTimeout(() => { this.bubbleEl.style.visibility = 'hidden'; }, BUBBLE_FADE_MS);
  }

  get bubbleVisible() {
    return !this.bubbleEl.hidden && this.bubbleEl.style.visibility !== 'hidden' && !this.bubbleEl.classList.contains('away');
  }

  /**
   * Anchor the bubble beside a screen point (the side of the cat's head), inside the viewport
   * and never over the step header: if its natural spot crosses the header it flips to the
   * other side of the head when there is room there, else it drops below the header. With the
   * cat out of view (the Stove, the Fridge), or no room beside the head that keeps clear of the
   * prop the finger is handling (`avoid`), it docks bottom-left, above the foot.
   */
  bubbleAt(x: number, y: number, offscreen = false, hat?: { x: number; y: number }) {
    const el = this.bubbleEl;
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 44;
    // The bubble is drawn translated up by 70% of its height: its visual top is top - 0.7 h.
    const lift = 0.7 * h;
    // First choice: over the hat, in the band between the header and the cat, where it covers nothing.
    const above = offscreen || !hat ? null : this.overHat(hat.x, hat.y, w, h, lift);
    el.classList.toggle('above', !!above);
    if (above) {
      el.classList.remove('docked', 'flip');
      el.style.left = `${Math.round(above.left)}px`;
      el.style.top = `${Math.round(above.top)}px`;
      return;
    }
    const spot = offscreen ? null : this.besideHead(x, y, w, h, lift);
    el.classList.toggle('docked', !spot);
    if (!spot) {
      el.classList.remove('flip');
      const foot = this.footEl.getBoundingClientRect();
      el.style.left = '12px';
      el.style.top = `${Math.round(foot.top - BUBBLE_GAP - h + lift)}px`;
      return;
    }
    el.classList.toggle('flip', spot.flip);
    el.style.left = `${Math.round(spot.left)}px`;
    el.style.top = `${Math.round(spot.top)}px`;
  }

  /**
   * The bubble over the hat top at (x, y), its tail pointing down at the cat: only when it fits
   * between the step header and the hat and clear of `avoid`. null: try beside the head.
   */
  private overHat(x: number, y: number, w: number, h: number, lift: number) {
    const head = this.header.getBoundingClientRect();
    const headShown = !this.header.hasAttribute('hidden');
    const a = this.avoid;
    const visTop = y - BUBBLE_GAP - 9 - h; // 9 px of tail under it
    if (visTop < 8 || (headShown && visTop < head.bottom + BUBBLE_GAP)) return null;
    const left = Math.max(8, Math.min(x - 28, window.innerWidth - w - 8));
    if (a && left < a.x + a.w && left + w > a.x && visTop < a.y + a.h && visTop + h > a.y) return null;
    return { left, top: visTop + lift };
  }

  /**
   * Where the bubble goes beside the head at (x, y): right of it, or flipped to its left, clear
   * of the step header and of `avoid` (the prop the finger is handling). null: no room, dock it.
   */
  private besideHead(x: number, y: number, w: number, h: number, lift: number) {
    const head = this.header.getBoundingClientRect(); // keeps its box even when hidden
    const headShown = !this.header.hasAttribute('hidden');
    const a = this.avoid;
    const crossesHead = (l: number, t: number) => headShown && t - lift < head.bottom + BUBBLE_GAP && l < head.right && l + w > head.left;
    const crossesProp = (l: number, t: number) => !!a && l < a.x + a.w && l + w > a.x && t - lift < a.y + a.h && t - lift + h > a.y;
    let top = Math.max(8 + lift, Math.min(y, window.innerHeight - 8 - (h - lift)));
    const right = Math.max(8, Math.min(x + 18, window.innerWidth - w - 8));
    const flipLeft = x - 18 - w;
    if (crossesHead(right, top) && !(flipLeft >= 8 && !crossesHead(flipLeft, top))) top = head.bottom + BUBBLE_GAP + lift;
    if (!crossesHead(right, top) && !crossesProp(right, top)) return { left: right, top, flip: false };
    if (flipLeft >= 8 && !crossesHead(flipLeft, top) && !crossesProp(flipLeft, top)) return { left: flipLeft, top, flip: true };
    return null;
  }

  /** Show the finger cue at a screen point (CSS px), or hide it with null. */
  cue(x: number | null, y = 0) {
    const on = x !== null;
    this.cueEl.classList.toggle('on', on);
    if (on) this.cueEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  /** The cue's box on screen while it shows (for the test driver), else null. */
  get cueRect() {
    if (!this.cueEl.classList.contains('on')) return null;
    const r = this.cueEl.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }

  /** The recipe book overlay. */
  book(flavors: Flavor[], onPick: (f: Flavor) => void) {
    const chips = $('book-flavors');
    chips.replaceChildren();
    let chosen = flavors[0];
    const chipEls = flavors.map((f, i) => {
      const el = document.createElement('button');
      el.className = 'chip';
      el.innerHTML = CHIP_ICONS[f.id]; // static markup from this file
      el.append(f.name);
      el.addEventListener('click', () => {
        chosen = f;
        chipEls.forEach((c) => c.classList.toggle('on', c === el));
        sound.play('chip', { gain: 0.5, rate: 1 + i * 0.12 }); // each chip its own note, rising along the row
      });
      chips.appendChild(el);
      return el;
    });
    chipEls[0].classList.add('on');
    const bake = $('book-bake');
    const fresh = bake.cloneNode(true) as HTMLElement;
    bake.replaceWith(fresh);
    fresh.addEventListener('click', () => { this.bookEl.hidden = true; sound.play('book', { gain: 0.6, rate: 1.15 }); onPick(chosen); });
    this.bookEl.hidden = false;
  }

/** The swipe hints at the screen edges; they fade out rather than blink off. */
  chevrons(on: boolean) { this.chevronsEl.hidden = !on; }

  get chevronsVisible() { return !this.chevronsEl.hidden; }

  /** Every cake past the Shelf's dozen, oldest first, in a scrolling list. */
  moreList(rows: MoreRow[]) {
    const list = $('more-list');
    list.replaceChildren(...rows.map((r) => {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `#${r.n}`;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = r.name;
      const v = document.createElement('span');
      v.className = r.verdict ? 'pill' : 'pill pill-none';
      v.textContent = r.verdict ? r.verdict.label : 'not tasted';
      if (r.verdict) v.style.background = r.verdict.color;
      const date = document.createElement('span');
      date.className = 'date';
      date.textContent = r.date;
      li.append(n, name, v, date);
      return li;
    }));
    list.scrollTop = 0;
    this.moreEl.hidden = false;
  }

  lightbox(title: string, date: string, verdict: { label: string; color: string } | null, picture: string | null = null) {
    const img = $('lightbox-img') as HTMLImageElement;
    img.hidden = !picture;
    if (picture) img.src = picture;
    $('lightbox-title').textContent = title;
    $('lightbox-date').textContent = date;
    const v = $('lightbox-verdict');
    v.textContent = verdict ? verdict.label : 'not tasted';
    v.className = verdict ? 'pill' : 'pill pill-none';
    v.style.background = verdict ? verdict.color : '';
    this.lightboxEl.hidden = false;
  }
}
