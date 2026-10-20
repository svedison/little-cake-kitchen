'use strict';

// Set this to a name to personalise the game ("made for <name>").
const PLAYER_NAME = '';

const GALLERY_KEY = 'little-cake-kitchen.gallery';

// ============================================================
// Palette & SVG helpers
// ============================================================
const P = {
  cream: '#FFF6E9', pink: '#FFB6C1', cocoa: '#6B4A3A', matcha: '#B9D8A8', butter: '#FFE8A3',
  coffee: '#4B3226', beige: '#F2D8B0', glass: '#DDEFF7', steel: '#C9D3DD', dark: '#2A1810',
};

// Wraps inner markup in an SVG with soft cocoa outlines on everything.
const svg = (vb, inner) =>
  `<svg class="art-svg" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">` +
  `<g fill="none" stroke="${P.cocoa}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${inner}</g></svg>`;

const $ = (sel) => document.querySelector(sel);

// Re-run a CSS animation class on an element.
function retrigger(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const QUALITIES = ['under', 'right', 'over'];

// ============================================================
// Art (all inline SVG)
// ============================================================
const ART = {
  cat(expr = 'idle') {
    const eyes = {
      idle: `<circle cx="46" cy="66" r="4" fill="${P.cocoa}" stroke="none"/><circle cx="74" cy="66" r="4" fill="${P.cocoa}" stroke="none"/>`,
      excited: `<path d="M40 68 q6 -9 12 0"/><path d="M68 68 q6 -9 12 0"/>`,
      ooh: `<circle cx="46" cy="66" r="7" fill="${P.cocoa}" stroke="none"/><circle cx="74" cy="66" r="7" fill="${P.cocoa}" stroke="none"/>` +
           `<circle cx="48" cy="63" r="2.5" fill="#fff" stroke="none"/><circle cx="76" cy="63" r="2.5" fill="#fff" stroke="none"/>`,
      sleepy: `<path d="M40 67 q6 5 12 0"/><path d="M68 67 q6 5 12 0"/>` +
              `<text x="100" y="26" font-size="15" font-weight="700" fill="${P.cocoa}" stroke="none" transform="rotate(-10 100 26)">z z</text>`,
      yum: `<path d="M40 68 q6 -9 12 0"/><path d="M68 68 q6 -9 12 0"/>`,
      meh: `<path d="M40 66 h12"/><path d="M68 66 h12"/>`,
      love: `<path d="M46 60 q-7 -9 -11 0 q3 7 11 12 q8 -5 11 -12 q-4 -9 -11 0 Z" fill="#E8566B"/><path d="M74 60 q-7 -9 -11 0 q3 7 11 12 q8 -5 11 -12 q-4 -9 -11 0 Z" fill="#E8566B"/>`,
    }[expr];
    const mouth = {
      idle: `<path d="M54 78 q3 4 6 0 q3 4 6 0"/>`,
      excited: `<path d="M50 78 q10 13 20 0 Z" fill="${P.pink}"/>`,
      ooh: `<ellipse cx="60" cy="81" rx="4" ry="5" fill="${P.pink}"/>`,
      sleepy: `<path d="M56 79 q4 2 8 0"/>`,
      yum: `<ellipse cx="60" cy="82" rx="9" ry="8" fill="${P.dark}"/><ellipse cx="60" cy="87" rx="5" ry="3" fill="${P.pink}" stroke="none"/>`,
      meh: `<path d="M53 80 h14"/>`,
      love: `<path d="M50 78 q10 13 20 0 Z" fill="${P.pink}"/>`,
    }[expr];
    return svg('0 0 120 120', `
      <path d="M24 58 L14 26 L44 40 Z" fill="${P.beige}"/>
      <path d="M96 58 L106 26 L76 40 Z" fill="${P.beige}"/>
      <circle cx="60" cy="70" r="38" fill="${P.beige}"/>
      <circle cx="40" cy="28" r="12" fill="#fff"/><circle cx="60" cy="18" r="15" fill="#fff"/><circle cx="80" cy="28" r="12" fill="#fff"/>
      <rect x="30" y="34" width="60" height="16" rx="8" fill="#fff"/>
      <circle cx="34" cy="78" r="5" fill="${P.pink}" stroke="none" opacity=".8"/><circle cx="86" cy="78" r="5" fill="${P.pink}" stroke="none" opacity=".8"/>
      <path d="M18 74 h10 M18 82 h10 M92 74 h10 M92 82 h10"/>
      <path d="M57 72 h6 l-3 4 Z" fill="${P.pink}"/>
      ${eyes}${mouth}`);
  },

  logo: () => svg('0 0 120 120', `
    <path d="M26 62 l8 50 h52 l8 -50 Z" fill="${P.pink}"/>
    <path d="M34 72 v36 M48 72 v40 M72 72 v40 M86 72 v36" stroke="#E79AA8"/>
    <path d="M20 62 q0 -22 20 -18 q6 -20 24 -10 q18 -10 24 10 q20 -4 20 18 q0 10 -10 10 h-68 q-10 0 -10 -10 Z" fill="${P.cream}"/>
    <circle cx="60" cy="26" r="8" fill="#E8566B"/><path d="M60 18 q4 -10 10 -10"/>
    <circle cx="40" cy="56" r="2" fill="${P.cocoa}" stroke="none"/><circle cx="62" cy="52" r="2" fill="${P.cocoa}" stroke="none"/><circle cx="82" cy="58" r="2" fill="${P.cocoa}" stroke="none"/>`),

  // --- Tiramisu step art ---
  moka: () => svg('0 0 200 200', `
    ${[72, 100, 128].map((x) => `<g class="unit"><path class="on steam" d="M${x} 50 q-8 -10 0 -20 q8 -10 0 -20" stroke="#B8C4D0" stroke-width="4"/></g>`).join('')}
    <path d="M68 190 L58 118 H142 L132 190 Z" fill="#AEB8C4"/>
    <rect x="54" y="110" width="92" height="14" rx="5" fill="${P.cocoa}"/>
    <path d="M64 110 L74 62 H126 L136 110 Z" fill="${P.steel}"/>
    <path d="M78 62 L84 52 H116 L122 62 Z" fill="${P.steel}"/>
    <circle cx="100" cy="48" r="6" fill="${P.cocoa}"/>
    <path d="M136 72 h16 q10 0 8 12 l-6 22 h-22" fill="${P.cocoa}"/>
    <path d="M68 86 l-14 6 l6 14" fill="${P.steel}"/>`),

  // Bowl whose cream "fluff" grows with --hold. tool: 'whisk' | 'spoon'
  bowl: (tool, fill = P.cream) => {
    const tools = {
      whisk: `<rect x="124" y="4" width="12" height="46" rx="6" fill="${P.cocoa}"/><path d="M130 50 q-34 36 0 68 q34 -32 0 -68 M130 50 q-16 36 0 68 q16 -32 0 -68"/>`,
      spoon: `<rect x="124" y="4" width="12" height="60" rx="6" fill="${P.cocoa}"/><ellipse cx="130" cy="82" rx="16" ry="22" fill="${P.butter}"/>`,
      none: '',
    };
    return svg('0 0 200 200', `
      <ellipse cx="100" cy="188" rx="56" ry="7" fill="#EAD9C3" stroke="none"/>
      <path d="M28 92 q0 86 72 86 q72 0 72 -86 Z" fill="${P.pink}"/>
      <ellipse cx="100" cy="92" rx="72" ry="14" fill="${fill}"/>
      <path class="fluff" d="M38 94 q14 -46 42 -28 q20 -30 40 0 q30 -18 42 28 Z" fill="${fill}"/>
      <g class="tool">${tools[tool] || ''}</g>`);
  },

  cup: () => svg('0 0 130 110', `
    <path class="steam" d="M48 16 q-6 -6 0 -12 M66 16 q-6 -6 0 -12" stroke="#B8C4D0"/>
    <path d="M20 30 v48 q0 22 22 22 h32 q22 0 22 -22 v-48 Z" fill="#fff"/>
    <path d="M96 44 h8 q16 0 16 16 q0 16 -16 16 h-8" fill="#fff"/>
    <ellipse cx="58" cy="30" rx="38" ry="10" fill="${P.coffee}"/>`),

  // Glass dish. opts: base (a finished layer below), fingers (ladyfingers drawn in), paint (cream that follows --paint)
  dish: ({ base = false, fingers = false, paint = false } = {}) => svg('0 0 240 110', `
    <rect x="10" y="18" width="220" height="82" rx="14" fill="${P.glass}"/>
    ${base ? `<rect x="14" y="74" width="212" height="22" rx="8" fill="${P.beige}" stroke="none"/><rect x="14" y="60" width="212" height="16" fill="${P.cream}" stroke="none"/>` : ''}
    ${fingers ? [0, 1, 2, 3].map((i) => `<rect x="${18 + i * 52}" y="40" width="48" height="18" rx="9" fill="${P.beige}"/>`).join('') : ''}
    ${paint ? `<rect class="paint" x="14" y="24" width="212" height="34" rx="10" fill="${P.cream}" stroke="none"/>` : ''}
    <rect x="10" y="18" width="220" height="82" rx="14"/>`),

  ladyfinger: () => svg('0 0 64 26', `
    <rect class="lf" x="3" y="3" width="58" height="20" rx="10" fill="${P.beige}"/>
    <circle cx="18" cy="11" r="1.5" fill="#fff" stroke="none"/><circle cx="32" cy="15" r="1.5" fill="#fff" stroke="none"/><circle cx="46" cy="10" r="1.5" fill="#fff" stroke="none"/>`),

  spatula: () => svg('0 0 80 32', `
    <rect x="2" y="12" width="36" height="8" rx="4" fill="${P.cocoa}"/>
    <path d="M38 6 h30 q10 0 10 10 q0 10 -10 10 h-30 Z" fill="#fff"/>`),

  // Shaker over something to dust. dust: powder colour, body: shaker colour, under: what gets dusted
  // ('dish' = the tiramisu dish with a layer that fills in, or markup of your own).
  shaker: (dust = P.cocoa, body = P.matcha, under = 'dish') => svg('0 0 200 200', `
    ${under === 'dish' ? `<rect x="30" y="130" width="140" height="56" rx="14" fill="${P.glass}"/>
    <rect x="34" y="134" width="132" height="26" rx="10" fill="${P.cream}"/>` : under}
    ${[0, 1, 2, 3, 4].map((i) => `<g class="unit">
      <g class="on dust">${[0, 1, 2, 3].map((j) => `<circle cx="${50 + i * 25 + (j * 7) % 20}" cy="${96 + (j * 9) % 24}" r="2.5" fill="${dust}" stroke="${dust === P.cocoa ? 'none' : '#D9C8B5'}" stroke-width="1.5"/>`).join('')}</g>
      ${under === 'dish' ? `<rect class="on" x="${34 + i * 26.4}" y="134" width="27" height="26" rx="6" fill="${dust}" opacity=".85" stroke="none"/>` : ''}
    </g>`).join('')}
    <rect x="78" y="22" width="44" height="62" rx="10" fill="${body}"/>
    <rect x="82" y="10" width="36" height="16" rx="6" fill="${P.cocoa}"/>
    <circle cx="92" cy="18" r="2" fill="#fff" stroke="none"/><circle cx="100" cy="18" r="2" fill="#fff" stroke="none"/><circle cx="108" cy="18" r="2" fill="#fff" stroke="none"/>
    <path d="M86 50 h28" stroke="#fff"/>`),

  fridge: () => svg('0 0 200 200', `
    <rect class="night" x="0" y="0" width="200" height="200" rx="20" fill="#3B3560" stroke="none"/>
    <g class="stars" fill="#fff" stroke="none"><circle cx="20" cy="30" r="2"/><circle cx="48" cy="18" r="1.5"/><circle cx="30" cy="100" r="2"/><circle cx="180" cy="26" r="2"/></g>
    <circle class="moon" cx="34" cy="150" r="14" fill="${P.butter}"/>
    <rect x="60" y="16" width="92" height="174" rx="14" fill="#fff"/>
    <path d="M60 88 h92"/>
    <rect x="136" y="36" width="7" height="32" rx="3.5" fill="${P.cocoa}"/>
    <rect x="136" y="104" width="7" height="44" rx="3.5" fill="${P.cocoa}"/>
    <circle cx="170" cy="150" r="20" fill="#fff"/>
    <g class="hand"><path d="M170 150 v-13"/></g>
    <path d="M170 150 h8"/>`),

  // --- Basque step art ---
  pan: () => svg('0 0 160 100', `
    <path d="M12 40 v36 q0 14 14 14 h108 q14 0 14 -14 v-36" fill="#7C8794"/>
    <ellipse cx="80" cy="40" rx="68" ry="12" fill="#A3AEBB"/>`),

  parchment: () => svg('0 0 70 60', `
    <path d="M6 10 q10 -6 20 0 q10 -6 20 0 q10 -6 18 0 v40 q-10 6 -20 0 q-10 6 -20 0 q-10 6 -18 0 Z" fill="${P.beige}"/>
    <path d="M18 24 h30 M18 36 h22" stroke="#D9B98C"/>`),

  eggs: () => svg('0 0 200 200', `
    <ellipse cx="100" cy="188" rx="56" ry="7" fill="#EAD9C3" stroke="none"/>
    <path d="M28 108 q0 80 72 80 q72 0 72 -80 Z" fill="${P.pink}"/>
    <ellipse cx="100" cy="108" rx="72" ry="14" fill="${P.cream}"/>
    ${[52, 100, 148].map((x) => `<g class="unit">
      <ellipse class="off" cx="${x}" cy="60" rx="17" ry="22" fill="#fff"/>
      <g class="on">
        <path d="M${x - 17} 56 l6 -8 l5 8 l6 -8 l6 8 l5 -8 l6 8 v8 q0 14 -17 14 q-17 0 -17 -14 Z" fill="#fff"/>
        <circle cx="${x}" cy="66" r="7" fill="${P.butter}"/>
      </g>
    </g>`).join('')}`),

  jug: () => svg('0 0 60 70', `
    <path d="M14 14 h30 v44 q0 8 -8 8 h-14 q-8 0 -8 -8 Z" fill="#fff"/>
    <path d="M14 14 l-8 10 l8 6"/>
    <path d="M44 24 h6 q6 0 6 8 v10 q0 8 -6 8 h-6"/>
    <path d="M18 40 h22" stroke="#DDEFF7" stroke-width="6"/>`),

  flour: () => svg('0 0 60 70', `
    <path d="M8 20 h44 l-6 46 h-32 Z" fill="${P.butter}"/>
    <ellipse cx="30" cy="20" rx="22" ry="7" fill="#fff"/>
    <text x="30" y="50" text-anchor="middle" font-size="12" font-weight="700" fill="${P.cocoa}" stroke="none">flour</text>`),

  pour: (batter = P.butter) => svg('0 0 200 200', `
    <g transform="rotate(-35 70 60)">
      <path d="M30 50 q0 46 40 46 q40 0 40 -46 Z" fill="${P.pink}"/>
      <ellipse cx="70" cy="50" rx="40" ry="8" fill="${batter}"/>
    </g>
    <path class="stream" d="M104 76 q10 30 4 60" stroke="${batter}" stroke-width="10"/>
    <rect x="40" y="130" width="120" height="50" rx="8" fill="#7C8794"/>
    <rect class="batter" x="44" y="134" width="112" height="42" rx="6" fill="${batter}" stroke="none"/>
    <rect x="40" y="130" width="120" height="50" rx="8"/>`),

  // Oven shell; `inner` is what sits on the rack (its colour layers read --hold).
  ovenShell: (inner) => svg('0 0 200 200', `
    <rect x="20" y="30" width="160" height="150" rx="16" fill="#E9D8C8"/>
    <circle cx="50" cy="46" r="5" fill="${P.cocoa}"/><circle cx="70" cy="46" r="5" fill="${P.cocoa}"/><circle cx="150" cy="46" r="5" fill="${P.cocoa}"/>
    <rect x="40" y="62" width="120" height="96" rx="12" fill="#4A3B3B"/>
    <rect class="glow" x="44" y="66" width="112" height="88" rx="10" fill="#FF9A5C" stroke="none"/>
    <path d="M52 134 h96" stroke="#8A7B7B"/>
    ${inner}`),

  oven: (batter = P.butter) => ART.ovenShell(`
    <rect x="60" y="104" width="80" height="30" rx="8" fill="${batter}"/>
    <ellipse cx="100" cy="104" rx="40" ry="10" fill="#F7E0A3"/>
    <ellipse class="top-gold" cx="100" cy="104" rx="40" ry="10" fill="#D99A4E" stroke="none"/>
    <ellipse class="top-burnt" cx="100" cy="104" rx="40" ry="10" fill="${P.cocoa}" stroke="none"/>
    <ellipse class="top-dark" cx="100" cy="104" rx="40" ry="10" fill="${P.dark}" stroke="none"/>`),

  // Basque flavour add-ins (drag items)
  blueberries: () => svg('0 0 60 70', `
    <path d="M30 30 q-4 -14 8 -20" stroke="#5B8A4A"/><path d="M34 16 q10 -6 14 4 q-10 6 -14 -4 Z" fill="${P.matcha}"/>
    <circle cx="20" cy="44" r="12" fill="#6B5B9E"/><circle cx="42" cy="46" r="12" fill="#6B5B9E"/><circle cx="31" cy="30" r="11" fill="#8A78BF"/>
    <path d="M28 27 l3 3 l3 -3" stroke="#3E3266" stroke-width="2"/>`),
  lemon: () => svg('0 0 60 70', `
    <path d="M12 42 q-6 -26 20 -28 q26 -2 24 26 q-4 22 -24 22 q-20 -2 -20 -20 Z" fill="#FFE566"/>
    <circle cx="36" cy="38" r="2" fill="#F2C94C" stroke="none"/><circle cx="24" cy="46" r="2" fill="#F2C94C" stroke="none"/>
    <path d="M30 14 q8 -10 16 -4 q-8 8 -16 4 Z" fill="${P.matcha}"/>`),

  // --- Cream puff step art ---
  pot: () => svg('0 0 200 200', `
    <ellipse cx="100" cy="188" rx="64" ry="7" fill="#EAD9C3" stroke="none"/>
    <path d="M40 96 v64 q0 20 20 20 h80 q20 0 20 -20 v-64 Z" fill="${P.steel}"/>
    <rect x="76" y="118" width="24" height="20" rx="5" fill="${P.butter}"/>
    <ellipse cx="100" cy="96" rx="60" ry="12" fill="${P.glass}" fill-opacity=".85"/>
    <path d="M160 108 h22 q10 0 10 9 q0 9 -10 9 h-22" fill="${P.cocoa}"/>
    ${[66, 100, 134].map((x) => `<g class="unit"><g class="on boil"><circle cx="${x}" cy="86" r="6" fill="#fff"/><circle cx="${x + 12}" cy="74" r="3.5" fill="#fff"/></g></g>`).join('')}`),

  dough: () => svg('0 0 60 50', `
    <path d="M8 42 q-8 -24 20 -22 q4 -14 18 -2 q22 -4 10 24 Z" fill="${P.beige}"/>
    <path d="M40 16 q4 -8 2 -12"/>`),

  sheet: () => svg('0 0 240 110', `
    <rect x="10" y="26" width="220" height="74" rx="12" fill="#A3AEBB"/>
    <path d="M20 36 q10 -5 20 0 q10 -5 20 0 q10 -5 20 0 q10 -5 20 0 q10 -5 20 0 q10 -5 20 0 q10 -5 20 0 q10 -5 20 0 q10 -5 20 0 q10 -5 20 0 v54 h-200 Z" fill="${P.beige}"/>`),

  ovenPuffs: () => ART.ovenShell(
    [66, 100, 134].map((x) => `
      <g class="puff"><circle cx="${x}" cy="118" r="15" fill="#F2DDB4"/><circle cx="${x + 6}" cy="108" r="6" fill="#F2DDB4"/>
      <g class="top-gold" stroke="none"><circle cx="${x}" cy="118" r="15" fill="#E0A85A"/><circle cx="${x + 6}" cy="108" r="6" fill="#E0A85A"/></g>
      <g class="top-dark" stroke="none"><circle cx="${x}" cy="118" r="15" fill="${P.dark}"/><circle cx="${x + 6}" cy="108" r="6" fill="${P.dark}"/></g></g>`).join('')),

  cream: () => svg('0 0 60 50', `
    <path d="M30 6 q24 0 20 20 q-2 12 -20 18 q-18 -6 -20 -18 q-4 -20 20 -20 Z" fill="#fff"/>
    <path d="M22 26 q8 -12 18 -2" stroke="#E8D7C3"/>`),

  // Baked puffs on the sheet, waiting for their cream (the drop zone for the fill step).
  puffTray: () => svg('0 0 240 110', `
    <rect x="10" y="40" width="220" height="60" rx="12" fill="#A3AEBB"/>
    ${[60, 120, 180].map((x) => `<circle cx="${x}" cy="56" r="24" fill="#E0A85A"/><circle cx="${x + 9}" cy="40" r="9" fill="#E0A85A"/><path d="M${x - 20} 60 q20 -8 40 0" stroke="#B9803A" stroke-width="4"/>`).join('')}`),

  puffsUnderShaker: [60, 100, 140].map((x) => `<circle cx="${x}" cy="156" r="22" fill="#E0A85A"/><circle cx="${x + 8}" cy="140" r="8" fill="#E0A85A"/><path d="M${x - 18} 160 q18 -8 36 0" stroke="#fff" stroke-width="5"/>`).join(''),

  // What's left after the cat's taste test.
  plate: () => svg('0 0 200 160', `
    <ellipse cx="100" cy="120" rx="86" ry="18" fill="#fff"/>
    <ellipse cx="100" cy="118" rx="62" ry="10" fill="none" stroke="#EADFD3"/>
    <circle cx="72" cy="116" r="3" fill="${P.beige}" stroke="none"/><circle cx="104" cy="122" r="2.5" fill="${P.beige}" stroke="none"/>
    <circle cx="124" cy="113" r="3" fill="${P.beige}" stroke="none"/><circle cx="88" cy="124" r="2" fill="${P.cocoa}" stroke="none"/>
    <path d="M150 70 l-14 44" stroke="${P.steel}" stroke-width="5"/><path d="M146 62 v12 M152 60 v14 M158 62 v12" stroke="${P.steel}" stroke-width="3"/>`),

  // --- Finished cakes (quality: 'under' | 'right' | 'over') ---
  tiramisu: (q = 'right') => {
    if (!QUALITIES.includes(q)) q = 'right';
    const top = {
      under: `<path d="M24 76 q76 -8 152 0 v2 h-152 Z" fill="${P.cream}"/>`,
      right: `<path d="M24 76 q19 -24 38 0 q19 -24 38 0 q19 -24 38 0 q19 -24 38 0 Z" fill="${P.cream}"/>`,
      over: `<path d="M24 76 l19 -36 l19 36 l19 -36 l19 36 l19 -36 l19 36 l19 -36 l19 36 Z" fill="${P.cream}"/>`,
    }[q];
    const dustY = { under: 72, right: 62, over: 56 }[q];
    return svg('0 0 200 160', `
      <rect x="20" y="52" width="160" height="90" rx="14" fill="${P.glass}"/>
      <rect x="24" y="112" width="152" height="26" rx="8" fill="${P.beige}" stroke="none"/>
      <rect x="24" y="94" width="152" height="20" fill="${P.cream}" stroke="none"/>
      <rect x="24" y="76" width="152" height="20" fill="${P.beige}" stroke="none"/>
      ${top}
      <path d="M32 ${dustY} h136" stroke="${P.cocoa}" stroke-width="4" stroke-dasharray="2 7" opacity=".8"/>
      <rect x="20" y="52" width="160" height="90" rx="14"/>`);
  },

  basque: (q = 'right', flavor = 'classic') => {
    if (!QUALITIES.includes(q)) q = 'right';
    const topColor = { under: '#E8C27A', right: P.cocoa, over: P.dark }[q];
    const edge = { under: '#C9A05A', right: '#3B2416', over: '#120A06' }[q];
    const body = { classic: P.butter, blueberry: '#CDB8EA', lemon: '#FFF2A0' }[flavor] || P.butter;
    const garnish = {
      classic: '',
      blueberry: `<circle cx="70" cy="104" r="5" fill="#6B5B9E" stroke="none"/><circle cx="110" cy="118" r="5" fill="#6B5B9E" stroke="none"/><circle cx="136" cy="98" r="4" fill="#6B5B9E" stroke="none"/>
        <circle cx="146" cy="62" r="7" fill="#6B5B9E"/><circle cx="134" cy="66" r="6" fill="#8A78BF"/>`,
      lemon: `<circle cx="144" cy="60" r="13" fill="#FFE566"/><circle cx="144" cy="60" r="8" fill="#FFF9C8" stroke="#F2C94C" stroke-width="2"/>
        <path d="M144 52 v16 M136 60 h16" stroke="#F2C94C" stroke-width="2"/>`,
    }[flavor] || '';
    return svg('0 0 200 160', `
      <path d="M30 64 q8 -14 16 0 q8 -14 16 0 q8 -14 16 0 q8 -14 16 0 q8 -14 16 0 q8 -14 16 0 q8 -14 16 0 q8 -14 16 0 q8 -14 12 0 v70 q0 12 -12 12 h-128 q-12 0 -12 -12 Z" fill="${P.beige}"/>
      <path d="M44 76 v56 q0 10 10 10 h92 q10 0 10 -10 v-56 Z" fill="${body}"/>
      <path d="M44 76 q56 -46 112 0 Z" fill="${topColor}"/>
      <path d="M44 76 q56 -46 112 0" stroke="${edge}" stroke-width="7"/>
      ${q === 'right' ? `<ellipse cx="86" cy="56" rx="10" ry="4" fill="#9A7050" stroke="none"/><ellipse cx="116" cy="60" rx="7" ry="3" fill="#9A7050" stroke="none"/>` : ''}
      <path d="M58 100 h8 M58 112 h8" stroke="#E8CC7A"/>
      ${garnish}`);
  },

  creampuff: (q = 'right') => {
    if (!QUALITIES.includes(q)) q = 'right';
    const shell = { under: '#F2DDB4', right: '#E0A85A', over: '#8B5A2B' }[q];
    const edge = { under: '#D9B98C', right: '#B9803A', over: '#4A2E14' }[q];
    const puff = (x, y) => `
      <ellipse cx="${x}" cy="${y + 14}" rx="30" ry="16" fill="${shell}" stroke="${edge}"/>
      <path d="M${x - 28} ${y + 6} q7 -10 14 0 q7 -10 14 0 q7 -10 14 0 q7 -10 14 0 v8 h-56 Z" fill="#fff"/>
      <circle cx="${x}" cy="${y - 10}" r="27" fill="${shell}" stroke="${edge}"/>
      <circle cx="${x + 11}" cy="${y - 30}" r="9" fill="${shell}" stroke="${edge}"/>
      <circle cx="${x - 10}" cy="${y - 18}" r="2" fill="#fff" stroke="none"/><circle cx="${x + 4}" cy="${y - 26}" r="2" fill="#fff" stroke="none"/><circle cx="${x + 14}" cy="${y - 10}" r="2" fill="#fff" stroke="none"/>`;
    return svg('0 0 200 160', `
      <ellipse cx="100" cy="138" rx="86" ry="14" fill="#fff"/>
      ${puff(64, 110)}${puff(136, 110)}${puff(100, 72)}`);
  },
};

// ============================================================
// Recipes — pure data. Step kinds: 'tap' | 'hold' | 'drag'.
//   tap:  { target: N taps }            art may contain .unit elements that get .done one per tap
//   hold: { sweet: [lo, hi], duration }  art may read --hold (0..1); result is under | right | over
//   drag: { items, zones }               each item visits its `path` of zone ids in order
// ============================================================
const ladyfinger = () => ({ art: ART.ladyfinger, path: ['coffee', 'dish'] });
const spatula = () => ({ art: ART.spatula, path: ['dish'], paint: true, vanish: true });
const dough = () => ({ art: ART.dough, path: ['sheet'] });
const cream = () => ({ art: ART.cream, path: ['puffs'] });

const RECIPES = [
  {
    id: 'tiramisu',
    name: 'Tiramisu',
    blurb: 'coffee · cream · cocoa',
    cake: ART.tiramisu,
    lines: {
      under: 'The cream is a little soft, but so silky!',
      right: 'Fluffy cream, perfect layers. Bellissimo!',
      over: 'Extra thick cream — very rich!',
    },
    steps: [
      { title: 'Brew the espresso', kind: 'tap', target: 3, art: ART.moka,
        hint: 'Tap the moka pot', mascotLine: 'Tap the pot until it steams!' },
      { title: 'Whisk the mascarpone cream', kind: 'hold', sweet: [0.55, 0.8], art: () => ART.bowl('whisk'), key: true,
        hint: 'Hold to whisk', labels: ['still runny…', 'fluffy!', 'a bit stiff!'], mascotLine: 'Let go when it looks fluffy!' },
      { title: 'Dip the ladyfingers', kind: 'drag', items: [ladyfinger(), ladyfinger(), ladyfinger(), ladyfinger()],
        zones: [{ id: 'coffee', art: ART.cup, timed: true }, { id: 'dish', art: ART.dish, size: 'lg' }],
        hint: 'Coffee first, then into the dish', mascotLine: 'Dip in the coffee, then into the dish!' },
      { title: 'Spread the cream', kind: 'drag', items: [spatula()],
        zones: [{ id: 'dish', art: () => ART.dish({ fingers: true, paint: true }), size: 'lg' }],
        hint: 'Drag the spatula across the dish', mascotLine: 'Swipe the cream all the way across!' },
      { title: 'Second layer', kind: 'drag', ordered: true, items: [ladyfinger(), ladyfinger(), ladyfinger(), spatula()],
        zones: [{ id: 'coffee', art: ART.cup, timed: true }, { id: 'dish', art: () => ART.dish({ base: true, paint: true }), size: 'lg' }],
        hint: 'Dip, lay, then spread again', mascotLine: 'One more layer — you know the drill!' },
      { title: 'Dust with cocoa', kind: 'tap', target: 5, art: ART.shaker,
        hint: 'Tap the shaker', mascotLine: 'Shake shake shake! Let it snow cocoa.' },
      { title: 'Chill in the fridge', kind: 'hold', sweet: [0.5, 1], duration: 4000, art: ART.fridge, expr: 'sleepy', waitForSweet: true, holdSound: 'hum',
        hint: 'Hold to wait…', labels: ['not yet…', 'nicely chilled!', 'nicely chilled!'], mascotLine: 'Hold to wait. The fridge hums… zzz' },
    ],
  },
  {
    id: 'basque',
    name: 'Basque Cheesecake',
    short: 'Basque',
    blurb: 'burnt on purpose!',
    cake: ART.basque,
    lines: {
      under: 'A little pale, but still delicious!',
      right: 'PERFECT burnt top!!',
      over: 'Extra toasty — crunchy edges!',
    },
    // Flavours: an optional extra item to drag into the bowl, plus tints for the batter and the finished cake.
    flavors: [
      { id: 'classic', name: 'Classic', chip: P.butter, batter: P.butter },
      { id: 'blueberry', name: 'Blueberry', chip: '#CDB8EA', batter: '#D9C8F0', item: { art: ART.blueberries, path: ['bowl'] }, addIn: 'blueberries' },
      { id: 'lemon', name: 'Lemon', chip: '#FFE566', batter: '#FFF2A0', item: { art: ART.lemon, path: ['bowl'] }, addIn: 'lemon' },
    ],
    steps: (flavor) => [
      { title: 'Line the pan', kind: 'drag', items: [{ art: ART.parchment, path: ['pan'], fx: 'crumple' }],
        zones: [{ id: 'pan', art: ART.pan, size: 'lg' }],
        hint: 'Drag the parchment onto the pan', mascotLine: 'Crumple the paper into the pan. Messy is good!' },
      { title: 'Mix cream cheese & sugar', kind: 'hold', sweet: [0.55, 0.8], art: () => ART.bowl('spoon', '#FFFDF7'),
        hint: 'Hold to mix', labels: ['still lumpy…', 'smooth!', 'very smooth!'], mascotLine: "Hold to mix until it's smooth!" },
      { title: 'Crack the eggs', kind: 'tap', target: 3, art: ART.eggs,
        hint: 'Tap the eggs', mascotLine: 'Crack the eggs on the rim, one at a time.' },
      { title: flavor.item ? `Cream, flour & ${flavor.addIn}` : 'Pour in cream & flour', kind: 'drag', ordered: true,
        items: [{ art: ART.jug, path: ['bowl'] }, { art: ART.flour, path: ['bowl'] }, ...(flavor.item ? [flavor.item] : [])],
        zones: [{ id: 'bowl', art: () => ART.bowl('none', flavor.batter), size: 'lg' }],
        hint: flavor.item ? 'Drag all three into the bowl' : 'Drag both into the bowl',
        mascotLine: flavor.item ? `Jug, flour, then the ${flavor.addIn}. In they go!` : 'Jug first, then flour. In they go!' },
      { title: 'Pour into the pan', kind: 'hold', sweet: [0.6, 0.85], art: () => ART.pour(flavor.batter), holdSound: null,
        hint: 'Hold to pour', labels: ['keep pouring…', 'just right!', 'to the brim!'], mascotLine: 'Hold to pour. Watch it rise!' },
      { title: 'Bake it HOT', kind: 'hold', sweet: [0.6, 0.85], duration: 4000, art: () => ART.oven(flavor.batter), key: true, expr: 'ooh', holdSound: null,
        colors: ['#F2C55C', '#8B5A2B', P.dark],
        hint: 'Hold to bake', labels: ['still pale…', 'burnt top!', 'very dark!'], mascotLine: 'Hold to bake. We WANT it burnt!' },
    ],
  },
  {
    id: 'creampuff',
    name: 'Cream Puff',
    blurb: 'choux · cream · sugar',
    cake: ART.creampuff,
    lines: {
      under: 'A little pale, but so soft and creamy!',
      right: 'Perfectly puffed and golden!!',
      over: 'Extra crispy shells — crunchy!',
    },
    steps: [
      { title: 'Boil butter & water', kind: 'tap', target: 3, art: ART.pot,
        hint: 'Tap the pot', mascotLine: 'Tap the pot until it bubbles!' },
      { title: 'Stir in the flour', kind: 'hold', sweet: [0.55, 0.8], art: () => ART.bowl('spoon', P.butter),
        hint: 'Hold to stir', labels: ['still sticky…', 'a smooth ball!', 'getting dry!'], mascotLine: 'Stir until the dough comes together!' },
      { title: 'Beat in the eggs', kind: 'tap', target: 3, art: ART.eggs,
        hint: 'Tap the eggs', mascotLine: 'One egg at a time — crack!' },
      { title: 'Pipe the puffs', kind: 'drag', items: [dough(), dough(), dough(), dough()],
        zones: [{ id: 'sheet', art: ART.sheet, size: 'lg' }],
        hint: 'Drag the dough onto the tray', mascotLine: 'Little blobs, nicely spaced!' },
      { title: 'Bake until puffed', kind: 'hold', sweet: [0.6, 0.85], duration: 4000, art: ART.ovenPuffs, key: true, expr: 'ooh', holdSound: null,
        colors: ['#F2C55C', '#D99A4E', P.dark],
        hint: 'Hold to bake', labels: ['still pale…', 'golden & puffy!', 'a bit dark!'], mascotLine: "Hold to bake. Don't peek or they'll sink!" },
      { title: 'Fill with cream', kind: 'drag', items: [cream(), cream(), cream()],
        zones: [{ id: 'puffs', art: ART.puffTray, size: 'lg' }],
        hint: 'Drag the cream into the puffs', mascotLine: 'Squeeze the cream in. Be generous!' },
      { title: 'Dust with sugar', kind: 'tap', target: 5, art: () => ART.shaker('#fff', P.pink, ART.puffsUnderShaker),
        hint: 'Tap the shaker', mascotLine: 'A snowy little finish!' },
    ],
  },
];

// A recipe's steps, resolved for a flavour (steps may be a function of it).
const stepsOf = (recipe, flavor) => (typeof recipe.steps === 'function' ? recipe.steps(flavor || recipe.flavors[0]) : recipe.steps);
// "Blueberry Basque" / "Tiramisu"
const displayName = (recipe, flavorId) => {
  const f = recipe.flavors && recipe.flavors.find((x) => x.id === flavorId);
  return f ? `${f.name} ${recipe.short || recipe.name}` : recipe.name;
};

const CHEERS = {
  right: ['Perfect!', 'Yum!', 'So good!'],
  other: ['Totally fine!', 'No worries!', 'Looks great anyway!'],
  done: ['Nice!', 'Yum!', 'Ooh, lovely!'],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// The cat's taste test, by how the key step went.
const VERDICTS = {
  under: { label: 'ass 💀', color: '#D9C8B5', expr: 'meh', line: '…ass. 💀 But I would still eat another.', sound: 'ding' },
  over: { label: 'mid 😐', color: P.butter, expr: 'idle', line: 'Mid. 😐 Ate the whole thing though.', sound: 'ding' },
  right: { label: 'bussin 🔥', color: P.pink, expr: 'love', line: 'BUSSIN!! 🔥 Best cake I ever had!', sound: 'confetti' },
};

// ============================================================
// Sound — tiny WebAudio beeps, muted by default
// ============================================================
const Sound = {
  on: false,
  ctx: null,
  // [wave, startHz, endHz, seconds, gain]
  table: {
    pop: ['sine', 600, 300, 0.09, 0.25],
    plop: ['triangle', 320, 140, 0.16, 0.3],
    whisk: ['triangle', 180, 220, 0.05, 0.08],
    hum: ['sine', 110, 110, 0.18, 0.06],
    chime: ['sine', 880, 1320, 0.35, 0.2],
    ding: ['sine', 1047, 1047, 0.5, 0.2],
    chomp: ['square', 220, 90, 0.1, 0.1],
  },
  toggle() {
    this.on = !this.on;
    if (this.on && !this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.on && this.ctx.state === 'suspended') this.ctx.resume();
    const btn = $('#sound-toggle');
    btn.textContent = this.on ? '🔈' : '🔇';
    btn.setAttribute('aria-pressed', String(this.on));
    btn.setAttribute('aria-label', this.on ? 'Turn sound off' : 'Turn sound on');
    if (this.on) this.play('pop');
  },
  beep([wave, f0, f1, dur, vol], at = 0) {
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },
  play(name) {
    if (!this.on || !this.ctx) return;
    if (name === 'confetti') {
      [523, 659, 784, 1047].forEach((f, i) => this.beep(['sine', f, f, 0.25, 0.18], i * 0.09));
    } else if (this.table[name]) {
      this.beep(this.table[name]);
    }
  },
};

// ============================================================
// State
// ============================================================
const state = {
  currentRecipe: null,
  flavor: null,    // the chosen flavour object (recipes without flavours: null)
  steps: [],       // the current recipe's steps, resolved for that flavour
  stepIndex: 0,
  stepResults: [],
  gallery: loadGallery(),
  cleanup: null,   // removes the current step's listeners
  stepDone: false,
};

// Reads the saved gallery, dropping anything that is not a well-formed entry.
function loadGallery() {
  try {
    const raw = JSON.parse(localStorage.getItem(GALLERY_KEY));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((g) => g && typeof g === 'object' && RECIPES.some((r) => r.id === g.recipe))
      .map((g, i) => {
        const r = RECIPES.find((x) => x.id === g.recipe);
        const flavor = r.flavors ? (r.flavors.some((f) => f.id === g.flavor) ? g.flavor : r.flavors[0].id) : undefined;
        return {
          n: Number.isFinite(g.n) ? g.n : i + 1,
          recipe: g.recipe,
          flavor,
          quality: QUALITIES.includes(g.quality) ? g.quality : 'right',
          verdict: QUALITIES.includes(g.verdict) ? g.verdict : undefined, // set once the cat has tasted it
          date: Number.isFinite(g.date) ? g.date : Date.now(),
        };
      });
  } catch { return []; }
}
function saveGallery() {
  try { localStorage.setItem(GALLERY_KEY, JSON.stringify(state.gallery)); } catch { /* storage unavailable: gallery lives for this session only */ }
}

// ============================================================
// Mascot
// ============================================================
let bubbleT = 0;
function say(expr, line) {
  const cat = $('#cat');
  cat.innerHTML = ART.cat(expr);
  retrigger(cat, 'bounce');
  const bubble = $('#bubble');
  bubble.textContent = line;
  bubble.classList.remove('fade');
  retrigger(bubble, 'pop-in');
  clearTimeout(bubbleT);
  bubbleT = setTimeout(() => bubble.classList.add('fade'), 4000); // fade once read so it never hides the play card
}

// ============================================================
// Screens
// ============================================================
function go(name) {
  if (state.cleanup) { state.cleanup(); state.cleanup = null; }
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  window.scrollTo(0, 0);
  if (name === 'title') say('idle', 'Hi! Ready to bake?');
  if (name === 'pick') {
    document.querySelectorAll('.flavors').forEach((el) => { el.hidden = true; }); // fresh visit: chips closed
    say('excited', 'Ooh, which one today?');
  }
  if (name === 'gallery') {
    renderGallery();
    const tasted = state.gallery.filter((g) => g.verdict).length;
    say(state.gallery.length ? 'ooh' : 'idle',
      !state.gallery.length ? 'Nothing here yet…' : tasted ? `I tasted ${tasted} of these!` : 'Look at all those cakes!');
  }
}

function renderCards() {
  $('#recipe-cards').innerHTML = RECIPES.map((r, i) => `
    <button class="card" data-recipe="${i}">${r.cake('right')}<span><b>${r.name}</b><small>${r.blurb} · ${stepsOf(r).length} steps</small></span></button>
    ${r.flavors ? `<div class="flavors" data-recipe="${i}" hidden><span>Pick a flavor!</span><div class="row">${r.flavors.map((f) =>
      `<button class="chip" data-recipe="${i}" data-flavor="${f.id}" style="--c:${f.chip}">${f.name}</button>`).join('')}</div></div>` : ''}`
  ).join('');
}

// Tapping a card with flavours opens its chip row instead of starting straight away.
function pickCard(i) {
  const r = RECIPES[i];
  if (!r.flavors) { startRecipe(r); return; }
  document.querySelectorAll('.flavors').forEach((el) => { el.hidden = el.dataset.recipe !== String(i) || !el.hidden; });
  if (!$(`.flavors[data-recipe="${i}"]`).hidden) say('ooh', 'Ooh, which flavor?');
}

// ============================================================
// Baking: step runner
// ============================================================
function startRecipe(recipe, flavor = null) {
  state.currentRecipe = recipe;
  state.flavor = flavor;
  state.steps = stepsOf(recipe, flavor);
  state.stepIndex = 0;
  state.stepResults = [];
  go('bake');
  showStep();
}

function showStep() {
  const { steps, stepIndex } = state;
  const step = steps[stepIndex];
  state.stepDone = false;
  if (state.cleanup) state.cleanup();

  $('#step-count').textContent = `Step ${stepIndex + 1} of ${steps.length}`;
  $('#step-title').textContent = step.title;
  $('#step-dots').innerHTML = steps.map((_, i) =>
    `<i class="${i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}"></i>`).join('');
  $('#next-btn').hidden = true;
  $('#play').dataset.kind = step.kind; // CSS scopes the touch-action lock to hold steps

  const stage = $('#stage');
  stage.innerHTML = '';
  stage.className = 'stage';
  stage.style.setProperty('--hold', 0);
  stage.style.setProperty('--paint', 0);
  $('#foot').innerHTML = '';
  retrigger($('#play'), 'slide-in');

  say(step.expr || 'idle', step.mascotLine);
  state.cleanup = RUNNERS[step.kind](step, finishStep);
}

function finishStep(result) {
  if (state.stepDone) return;
  state.stepDone = true;
  if (state.cleanup) { state.cleanup(); state.cleanup = null; }
  state.stepResults[state.stepIndex] = result;
  Sound.play('ding');
  const step = state.steps[state.stepIndex];
  const label = step.labels ? step.labels[QUALITIES.indexOf(result)] : null;
  const cheer = pick(result === 'right' ? CHEERS.right : result === 'done' ? CHEERS.done : CHEERS.other);
  say(result === 'under' || result === 'over' ? 'ooh' : 'excited', label ? `${label[0].toUpperCase()}${label.slice(1)} ${cheer}` : cheer);
  $('#next-btn').hidden = false;
}

function nextStep() {
  state.stepIndex++;
  if (state.stepIndex < state.steps.length) showStep();
  else reveal();
}

const RUNNERS = {
  // TAP: N taps on the art; each tap bounces, fills a pip and reveals the next .unit.
  tap(step, finish) {
    const stage = $('#stage');
    stage.innerHTML = `<div class="art tappable">${step.art()}</div>`;
    $('#foot').innerHTML = `<div class="meter">${'<i class="pip"></i>'.repeat(step.target)}</div><p class="hint">${step.hint}</p>`;
    const art = stage.querySelector('.art');
    const units = stage.querySelectorAll('.unit');
    const pips = $('#foot').querySelectorAll('.pip');
    let count = 0;
    const onTap = (e) => {
      if (!e.isPrimary) return; // a resting second finger is not a tap
      e.preventDefault();
      if (count >= step.target || e.button !== 0) return;
      count++;
      Sound.play('pop');
      retrigger(art, 'bounce');
      retrigger($('#cat'), 'bounce');
      if (units[count - 1]) units[count - 1].classList.add('done');
      pips[count - 1].classList.add('on');
      if (count === step.target) finish('done');
    };
    art.addEventListener('pointerdown', onTap);
    return () => art.removeEventListener('pointerdown', onTap);
  },

  // HOLD: press anywhere in the play area; a ring fills over `duration` ms.
  // Release inside the sweet zone = 'right', before = 'under', after = 'over'.
  // Reaching the end of the ring releases automatically. A very short press just resets,
  // and so does a release before the sweet zone when step.waitForSweet is set.
  hold(step, finish) {
    const stage = $('#stage');
    const play = $('#play');
    const [lo, hi] = step.sweet;
    const duration = step.duration || 3000;
    const colors = step.colors || [P.pink, P.matcha, P.cocoa];
    const R = 50, CIRC = 2 * Math.PI * R;
    stage.innerHTML = `<div class="art">${step.art()}</div>`;
    $('#foot').innerHTML = `
      <svg class="ring" viewBox="0 0 120 120">
        <circle class="track" cx="60" cy="60" r="${R}" fill="none" stroke-width="12"/>
        <circle class="sweet" cx="60" cy="60" r="${R}" fill="none" stroke-width="12"
          stroke-dasharray="${(hi - lo) * CIRC} ${CIRC}" stroke-dashoffset="${-lo * CIRC}" transform="rotate(-90 60 60)"/>
        <circle class="arc" cx="60" cy="60" r="${R}" fill="none" stroke-width="12" stroke-linecap="round"
          stroke="${colors[0]}" stroke-dasharray="0 ${CIRC}" transform="rotate(-90 60 60)"/>
        <text x="60" y="67" text-anchor="middle">hold</text>
      </svg>
      <p class="hint">${step.hint}</p>`;
    const arc = $('#foot .arc');
    const hint = $('#foot .hint');
    const zoneOf = (v) => (v < lo ? 0 : v > hi ? 2 : 1);
    let t = 0, holding = false, last = 0, raf = 0, chimed = false, lastTick = 0, pid = null;

    const draw = () => {
      arc.setAttribute('stroke-dasharray', `${t * CIRC} ${CIRC}`);
      stage.style.setProperty('--hold', t);
      const z = zoneOf(t);
      arc.style.stroke = colors[z];
      hint.textContent = t > 0 ? step.labels[z] : step.hint;
      if (z === 1 && !chimed) { chimed = true; Sound.play('chime'); }
    };
    const frame = (now) => {
      if (!holding) return;
      t = Math.min(1, t + (now - last) / duration);
      last = now;
      const tick = step.holdSound === undefined ? 'whisk' : step.holdSound;
      if (tick && now - lastTick > 160) { lastTick = now; Sound.play(tick); }
      draw();
      if (t >= 1) release();
      else raf = requestAnimationFrame(frame);
    };
    const press = (e) => {
      if (holding || state.stepDone || e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      pid = e.pointerId;
      holding = true;
      last = performance.now();
      stage.classList.add('holding');
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      holding = false;
      cancelAnimationFrame(raf);
      stage.classList.remove('holding');
    };
    const reset = () => { t = 0; chimed = false; draw(); };
    const release = (e) => {
      if (!holding || (e && e.pointerId !== pid)) return;
      stop();
      if (t < 0.1) { reset(); return; } // a quick tap: not a real attempt
      if (step.waitForSweet && zoneOf(t) === 0) return; // too early: keep progress, try again
      finish(QUALITIES[zoneOf(t)]);
    };
    // A system interruption (notification, palm touch) is not a deliberate release.
    const cancel = (e) => {
      if (!holding || e.pointerId !== pid) return;
      stop();
      reset();
    };
    play.addEventListener('pointerdown', press);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    return () => {
      stop();
      play.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
    };
  },

  // DRAG: items in a tray; each item must visit the zones in its `path`, in order.
  // Dropping near the right zone snaps the item into it. Missing springs it back.
  // Extras: item.paint → --paint follows the horizontal drag over the zone (cream spreading);
  //         zone.timed → items left there over 2 s turn 'soggy' (cosmetic); item.fx → class added on placement;
  //         step.ordered → items must be finished in tray order (later ones are locked until then).
  drag(step, finish) {
    const stage = $('#stage');
    stage.innerHTML = `
      <div class="zones">${step.zones.map((z) =>
        `<div class="zone ${z.size || ''}" data-zone="${z.id}">${z.art()}<div class="zone-items"></div></div>`).join('')}</div>
      <div class="tray">${step.items.map((it) => `<div class="item">${it.art()}</div>`).join('')}</div>`;
    $('#foot').innerHTML = `<p class="hint">${step.hint}</p>`;
    const zoneEl = (id) => stage.querySelector(`.zone[data-zone="${id}"]`);
    let remaining = step.items.length;
    const cleanups = [];
    const els = [...stage.querySelectorAll('.item')];
    const placed = () => step.items.length - remaining;
    const refreshLocks = () => {
      if (step.ordered) els.forEach((el, i) => el.classList.toggle('locked', i > placed()));
    };
    refreshLocks();

    els.forEach((el, i) => {
      const it = step.items[i];
      let stageIdx = 0;      // which zone in it.path comes next
      let enteredAt = 0;     // when it landed in a timed zone
      let soggyT = 0;
      let drag = null;
      let maxPaint = 0;      // furthest the cream was spread during this drag

      const down = (e) => {
        if (stageIdx >= it.path.length || drag || e.button !== 0) return;
        if (step.ordered && i !== placed()) return; // not this one's turn yet
        e.preventDefault();
        maxPaint = 0;
        try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer: capture is optional */ }
        el.classList.add('held'); // first: .held kills any spring-back transition so the rect below is settled
        const r = el.getBoundingClientRect();
        // Remember where the item started so the drop test can use pointer deltas
        // (the element's own rect may lag a frame behind a quick flick).
        drag = { x: e.clientX, y: e.clientY, cx: r.left + r.width / 2, cy: r.top + r.height / 2, id: e.pointerId };
        zoneEl(it.path[stageIdx]).classList.add('want');
        clearTimeout(soggyT);
        if (enteredAt && Date.now() - enteredAt > 2000) el.classList.add('soggy');
      };
      const move = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        el.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;
        if (it.paint) {
          const zr = zoneEl(it.path[stageIdx]).getBoundingClientRect();
          const p = Math.max(0, Math.min(1, (e.clientX - zr.left) / zr.width));
          maxPaint = Math.max(maxPaint, p);
          stage.style.setProperty('--paint', p);
        }
      };
      const letGo = () => {
        drag = null;
        el.classList.remove('held');
        el.style.transform = '';
        zoneEl(it.path[stageIdx]).classList.remove('want');
        if (it.paint) stage.style.setProperty('--paint', 0);
      };
      const up = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const target = zoneEl(it.path[stageIdx]);
        target.classList.remove('want');
        const zr = target.getBoundingClientRect();
        const cx = drag.cx + e.clientX - drag.x, cy = drag.cy + e.clientY - drag.y;
        const pad = 28;
        const hit = (cx > zr.left - pad && cx < zr.right + pad && cy > zr.top - pad && cy < zr.bottom + pad)
          || (it.paint && maxPaint >= 0.9); // a full swipe counts even if it ran off the edge
        if (!hit) { letGo(); return; }
        drag = null;
        el.classList.remove('held');
        // Snap into the zone.
        el.style.transition = 'none';
        el.style.transform = '';
        target.querySelector('.zone-items').appendChild(el);
        void el.offsetWidth;
        el.style.transition = '';
        retrigger(el, 'plop');
        retrigger(target, 'ok');
        retrigger($('#cat'), 'bounce');
        Sound.play('plop');
        const zone = step.zones.find((z) => z.id === it.path[stageIdx]);
        if (zone.timed) {
          enteredAt = Date.now();
          soggyT = setTimeout(() => el.classList.add('soggy'), 2000);
        } else if (enteredAt) { enteredAt = 0; el.classList.add('dipped'); }
        if (it.paint) { stage.style.setProperty('--paint', 1); target.classList.add('covered'); }
        stageIdx++;
        if (stageIdx === it.path.length) {
          el.classList.add('placed');
          if (it.fx) el.classList.add(it.fx);
          if (it.vanish) setTimeout(() => el.classList.add('vanish'), 350);
          remaining--;
          refreshLocks();
          if (remaining === 0) finish('done');
        }
      };
      // An interrupted drag (cancel) is a miss, never a drop.
      const cancel = (e) => { if (drag && e.pointerId === drag.id) letGo(); };
      // move/up live on window so a flick still ends cleanly if pointer capture failed.
      el.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      cleanups.push(() => {
        clearTimeout(soggyT);
        el.removeEventListener('pointerdown', down);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      });
    });
    return () => cleanups.forEach((fn) => fn());
  },
};

// ============================================================
// Reveal & gallery
// ============================================================
function reveal() {
  const r = state.currentRecipe;
  const keyIndex = state.steps.findIndex((s) => s.key);
  const quality = state.stepResults[keyIndex] || 'right';
  const entry = { n: state.gallery.reduce((m, g) => Math.max(m, g.n), 0) + 1, recipe: r.id, quality, date: Date.now() };
  if (state.flavor) entry.flavor = state.flavor.id;
  state.gallery.push(entry);
  state.lastEntry = entry; // gets its verdict if the cat is fed
  saveGallery();

  go('reveal');
  $('#reveal-cake').innerHTML = r.cake(quality, entry.flavor);
  retrigger($('#reveal-cake'), 'reveal-cake');
  $('#cake-tag').textContent = `Cake #${entry.n} · ${displayName(r, entry.flavor)}`;
  confetti();
  Sound.play('confetti');
  const line = r.lines[quality];
  $('#reveal-line').textContent = line;
  say('excited', PLAYER_NAME ? `${PLAYER_NAME}, look! ${line}` : line);
  clearTimeout(bubbleT); // the sweet line stays while the cake is admired

  $('#reveal-cake').className = 'reveal-cake feedable';
  $('#feed-hint').hidden = false;
  $('#verdict').hidden = true;
  state.cleanup = feedCat(quality);
}

// The finished cake can be dragged into the cat's mouth; dropping it there starts the taste test.
function feedCat(quality) {
  const cake = $('#reveal-cake');
  const cat = $('#cat');
  let drag = null;
  const down = (e) => {
    if (drag || e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    try { cake.setPointerCapture(e.pointerId); } catch { /* capture is optional */ }
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    cake.classList.add('held');
    say('ooh', 'Is that… for me?');
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    cake.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;
  };
  const letGo = () => { drag = null; cake.classList.remove('held'); cake.style.transform = ''; };
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = cat.getBoundingClientRect(), pad = 30;
    const hit = e.clientX > r.left - pad && e.clientX < r.right + pad && e.clientY > r.top - pad && e.clientY < r.bottom + pad;
    if (!hit) { letGo(); return; }
    drag = null; // keep the translate so the cake vanishes at the cat, not back at the top
    cleanup();
    eat(quality);
  };
  const cancel = (e) => { if (drag && e.pointerId === drag.id) letGo(); };
  cake.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  const cleanup = () => {
    cake.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    state.cleanup = null;
  };
  return cleanup;
}

function eat(quality) {
  const v = VERDICTS[quality] || VERDICTS.right;
  if (state.lastEntry) { state.lastEntry.verdict = quality; saveGallery(); }
  $('#reveal-cake').className = 'reveal-cake eaten';
  $('#feed-hint').hidden = true;
  retrigger($('#cat'), 'chomp');
  say('yum', 'nom nom nom…');
  Sound.play('chomp');
  setTimeout(() => Sound.play('chomp'), 240);
  setTimeout(() => { // the empty plate takes the cake's spot
    const cake = $('#reveal-cake');
    cake.style.transform = '';
    cake.innerHTML = ART.plate();
    cake.className = 'reveal-cake';
  }, 650);
  setTimeout(() => {
    if (!$('#screen-reveal').classList.contains('active')) return; // they left before the verdict
    const el = $('#verdict');
    el.textContent = v.label;
    el.style.setProperty('--c', v.color);
    el.hidden = false;
    say(v.expr, v.line);
    clearTimeout(bubbleT); // the verdict stays
    Sound.play(v.sound);
  }, 1300);
}

function confetti() {
  const colors = [P.pink, P.matcha, P.butter, '#E8566B', P.glass];
  $('#confetti').innerHTML = Array.from({ length: 60 }, (_, i) =>
    `<i style="--x:${Math.random() * 100}%;--c:${colors[i % colors.length]};--d:${Math.random() * 0.8}s"></i>`).join('');
}

// The cat's rating pill for a history entry.
const verdictPill = (g) => g.verdict
  ? `<span class="pill" style="--c:${VERDICTS[g.verdict].color}">${VERDICTS[g.verdict].label}</span>`
  : `<span class="pill pill-none">not tasted</span>`;

function renderGallery() {
  const grid = $('#gallery-grid');
  $('#gallery-empty').hidden = state.gallery.length > 0;
  grid.innerHTML = state.gallery.slice().reverse().map((g) => {
    const r = RECIPES.find((x) => x.id === g.recipe);
    return r ? `<button data-n="${g.n}">${r.cake(g.quality, g.flavor)}<small>#${g.n} ${displayName(r, g.flavor)}</small>${verdictPill(g)}</button>` : '';
  }).join('');
}

function openLightbox(n) {
  const g = state.gallery.find((x) => x.n === n);
  const r = g && RECIPES.find((x) => x.id === g.recipe);
  if (!r) return;
  $('#lightbox-cake').innerHTML = r.cake(g.quality, g.flavor);
  $('#lightbox-tag').textContent = `Cake #${g.n} · ${displayName(r, g.flavor)} · ${new Date(g.date).toLocaleDateString()}`;
  $('#lightbox-verdict').innerHTML = `Chef cat says: ${verdictPill(g)}`;
  $('#lightbox').hidden = false;
}

// ============================================================
// Wiring
// ============================================================
function init() {
  $('#logo').innerHTML = ART.logo();
  if (PLAYER_NAME) {
    $('#made-for').textContent = `made for ${PLAYER_NAME}`;
    $('#made-for').hidden = false;
  }
  renderCards();

  document.addEventListener('click', (e) => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) { go(goBtn.dataset.go); return; }
    const chip = e.target.closest('.chip');
    if (chip) {
      const r = RECIPES[chip.dataset.recipe];
      startRecipe(r, r.flavors.find((f) => f.id === chip.dataset.flavor));
      return;
    }
    const card = e.target.closest('.card');
    if (card) { pickCard(Number(card.dataset.recipe)); return; }
    const cake = e.target.closest('#gallery-grid button');
    if (cake) { openLightbox(Number(cake.dataset.n)); return; }
    if (e.target.id === 'lightbox' || e.target.id === 'lightbox-close') $('#lightbox').hidden = true;
  });
  $('#next-btn').addEventListener('click', nextStep);
  $('#sound-toggle').addEventListener('click', () => Sound.toggle());
  $('#play').addEventListener('contextmenu', (e) => e.preventDefault()); // long holds must not open a menu
  go('title');
}

init();
