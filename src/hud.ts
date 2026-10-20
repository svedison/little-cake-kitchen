// Everything drawn in HTML over the Kitchen: step header, meters, hints, the cat's
// bubble, the recipe book and the Shelf lightbox.
import type { Flavor } from './recipes';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const CIRC = 2 * Math.PI * 50;

export interface HudButton { label: string; ghost?: boolean; onClick(): void }

export class Hud {
  private readonly hud = $('hud');
  private readonly header = $('step-head');
  private readonly count = $('step-count');
  private readonly title = $('step-title');
  private readonly pips = $('pips');
  private readonly ring = $('ring');
  private readonly arc = document.querySelector<SVGCircleElement>('#ring .arc')!;
  private readonly sweet = document.querySelector<SVGCircleElement>('#ring .sweet')!;
  private readonly hintEl = $('hint');
  private readonly buttonsEl = $('buttons');
  private readonly bubbleEl = $('bubble');
  private readonly verdictEl = $('verdict');
  private readonly tagEl = $('tag');
  private readonly bookEl = $('book');
  private readonly lightboxEl = $('lightbox');
  private bubbleTimer = 0;

  constructor() {
    $('lightbox-close').addEventListener('click', () => { this.lightboxEl.hidden = true; });
    $('book-close').addEventListener('click', () => { this.bookEl.hidden = true; });
  }

  show() { this.hud.hidden = false; }

  /** Header for a Step. */
  step(index: number, total: number, title: string) {
    this.header.hidden = false;
    this.count.textContent = `Step ${index + 1} of ${total}`;
    this.title.textContent = title;
  }

  /** Header with just a title (reveal, idle). */
  heading(title: string | null) {
    this.header.hidden = title === null;
    this.count.textContent = '';
    this.title.textContent = title ?? '';
  }

  hint(text: string) {
    this.hintEl.textContent = text;
    this.hintEl.hidden = !text;
  }

  meter(kind: 'none' | 'pips' | 'ring') {
    this.pips.hidden = kind !== 'pips';
    this.ring.hidden = kind !== 'ring';
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

  tag(text: string | null) {
    this.tagEl.hidden = !text;
    this.tagEl.textContent = text ?? '';
  }

  verdict(v: { label: string; color: string } | null) {
    this.verdictEl.hidden = !v;
    if (v) { this.verdictEl.textContent = v.label; this.verdictEl.style.background = v.color; }
  }

  bubble(text: string, seconds = 3.5) {
    this.bubbleEl.textContent = text;
    this.bubbleEl.hidden = false;
    this.bubbleEl.classList.remove('pop');
    void this.bubbleEl.offsetWidth;
    this.bubbleEl.classList.add('pop');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => { this.bubbleEl.hidden = true; }, seconds * 1000);
  }

  /** Anchor the bubble beside a screen point, kept inside the viewport. */
  bubbleAt(x: number, y: number, offscreen = false) {
    const left = Math.max(8, Math.min(x + 18, window.innerWidth - 226));
    const top = Math.max(96, Math.min(y, window.innerHeight - 120));
    this.bubbleEl.style.left = `${Math.round(left)}px`;
    this.bubbleEl.style.top = `${Math.round(top)}px`;
    this.bubbleEl.style.visibility = offscreen ? 'hidden' : '';
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
