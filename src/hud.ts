// Everything drawn in HTML over the Kitchen: step header, meters, hints, the cat's
// bubble, the recipe book and the Shelf lightbox.
import type { Flavor } from './recipes';

// The ring is an inline SVG, and SVGElement has no `hidden` property: assigning one just
// makes an expando and the attribute never changes. Everything that hides or shows a
// HUD element goes through toggleAttribute so the SVG and the HTML behave the same.
const $ = <T extends HTMLElement | SVGElement = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
const CIRC = 2 * Math.PI * 50;
const BUBBLE_GAP = 8;       // px kept between the bubble and the step header
const BUBBLE_FADE_MS = 200; // matches .bubble.away in style.css

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
  private readonly hintEl = $('hint');
  private readonly footEl = document.querySelector<HTMLElement>('#hud .foot')!;
  private readonly buttonsEl = $('buttons');
  private readonly bubbleEl = $('bubble');
  private readonly verdictEl = $('verdict');
  private readonly bookEl = $('book');
  private readonly lightboxEl = $('lightbox');
  private bubbleTimer = 0;
  private hintText = '';

  constructor() {
    $('lightbox-close').addEventListener('click', () => { this.lightboxEl.hidden = true; });
    $('book-close').addEventListener('click', () => { this.bookEl.hidden = true; });
  }

  show() { this.hud.hidden = false; }

  /** Header for a Step. */
  step(index: number, total: number, title: string) {
    this.header.toggleAttribute('hidden', false);
    this.count.textContent = `Step ${index + 1} of ${total}`;
    this.title.textContent = title;
  }

  /** Header with a title and an optional little pill above it (reveal, idle); never has a meter under it. */
  heading(title: string | null, count = '') {
    this.header.toggleAttribute('hidden', title === null);
    this.count.textContent = title === null ? '' : count;
    this.title.textContent = title ?? '';
    this.meter('none');
  }

  hint(text: string) {
    this.hintText = text;
    this.hintEl.textContent = text;
    this.hintEl.hidden = !text;
  }

  /** The Nudge for a swipe that went nowhere: the hint (or the one given) pops to catch the eye. */
  nudgeHint(fallback = '') {
    if (!this.hintText) this.hint(fallback);
    this.hintEl.classList.remove('pop');
    void this.hintEl.offsetWidth;
    this.hintEl.classList.add('pop');
  }

  meter(kind: 'none' | 'pips' | 'ring') {
    this.pips.toggleAttribute('hidden', kind !== 'pips');
    this.ring.toggleAttribute('hidden', kind !== 'ring');
    if (kind !== 'ring') this.ring.classList.remove('in-sweet');
  }

  setPips(total: number, done: number) {
    while (this.pips.children.length < total) this.pips.appendChild(document.createElement('span'));
    while (this.pips.children.length > total) this.pips.lastChild?.remove();
    Array.from(this.pips.children).forEach((p, i) => p.classList.toggle('on', i < done));
  }

  setRing(progress: number, sweet: [number, number]) {
    this.arc.setAttribute('stroke-dasharray', `${progress * CIRC} ${CIRC}`);
    this.sweet.setAttribute('stroke-dasharray', `${(sweet[1] - sweet[0]) * CIRC} ${CIRC}`);
    this.sweet.setAttribute('stroke-dashoffset', `${-sweet[0] * CIRC}`);
    this.ring.classList.toggle('in-sweet', progress >= sweet[0] && progress <= sweet[1]);
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
   * cat out of view (the Stove, the Fridge) it docks bottom-left, above the foot.
   */
  bubbleAt(x: number, y: number, offscreen = false) {
    const el = this.bubbleEl;
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 44;
    // The bubble is drawn translated up by 70% of its height: its visual top is top - 0.7 h.
    const lift = 0.7 * h;
    el.classList.toggle('docked', offscreen);
    if (offscreen) {
      el.classList.remove('flip');
      const foot = this.footEl.getBoundingClientRect();
      el.style.left = '12px';
      el.style.top = `${Math.round(foot.top - BUBBLE_GAP - h + lift)}px`;
      return;
    }
    const head = this.header.getBoundingClientRect(); // keeps its box even when hidden
    const headShown = !this.header.hasAttribute('hidden');
    let left = Math.max(8, Math.min(x + 18, window.innerWidth - w - 8));
    let top = Math.max(8 + lift, Math.min(y, window.innerHeight - 8 - (h - lift)));
    let flip = false;
    const crossesHead = (l: number, t: number) => headShown && t - lift < head.bottom + BUBBLE_GAP && l < head.right && l + w > head.left;
    if (crossesHead(left, top)) {
      const flipLeft = x - 18 - w;
      if (flipLeft >= 8 && !crossesHead(flipLeft, top)) { flip = true; left = flipLeft; }
      else top = head.bottom + BUBBLE_GAP + lift;
    }
    el.classList.toggle('flip', flip);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  /** The recipe book overlay. */
  book(flavors: Flavor[], onPick: (f: Flavor) => void) {
    const chips = $('book-flavors');
    chips.replaceChildren();
    let chosen = flavors[0];
    const chipEls = flavors.map((f) => {
      const el = document.createElement('button');
      el.className = 'chip';
      el.textContent = `${f.chip} ${f.name}`;
      el.addEventListener('click', () => { chosen = f; chipEls.forEach((c) => c.classList.toggle('on', c === el)); });
      chips.appendChild(el);
      return el;
    });
    chipEls[0].classList.add('on');
    const bake = $('book-bake');
    const fresh = bake.cloneNode(true) as HTMLElement;
    bake.replaceWith(fresh);
    fresh.addEventListener('click', () => { this.bookEl.hidden = true; onPick(chosen); });
    this.bookEl.hidden = false;
  }

  lightbox(title: string, date: string, verdict: { label: string; color: string } | null) {
    $('lightbox-title').textContent = title;
    $('lightbox-date').textContent = date;
    const v = $('lightbox-verdict');
    v.textContent = verdict ? verdict.label : 'not tasted';
    v.className = verdict ? 'pill' : 'pill pill-none';
    v.style.background = verdict ? verdict.color : '';
    this.lightboxEl.hidden = false;
  }
}
