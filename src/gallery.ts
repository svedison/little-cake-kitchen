// Every cake ever made, in local storage. Same key as the original 2D game so earlier
// cakes still show up on the Shelf.
import type { Result } from './steps/step';

export const GALLERY_KEY = 'little-cake-kitchen.gallery';
const QUALITIES: Result[] = ['under', 'right', 'over'];

export interface CakeEntry {
  n: number;
  recipe: string;
  flavor?: string;
  quality: Result;
  verdict?: Result;
  date: string;
}

export function loadGallery(): CakeEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(GALLERY_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is CakeEntry =>
      e && typeof e.n === 'number' && typeof e.recipe === 'string' && QUALITIES.includes(e.quality) && typeof e.date === 'string')
      .map((e) => ({ ...e, verdict: QUALITIES.includes(e.verdict as Result) ? e.verdict : undefined }));
  } catch {
    return [];
  }
}

export function saveGallery(entries: CakeEntry[]) {
  try { localStorage.setItem(GALLERY_KEY, JSON.stringify(entries)); } catch { /* private mode: the shelf just won't persist */ }
}
