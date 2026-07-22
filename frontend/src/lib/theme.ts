// Design tokens lifted verbatim from the prototype design handoff so the
// rebuild matches pixel-for-pixel. The Sales Rep app supports light/dark;
// the Inventory Dashboard is dark-only (as in the prototypes).

export const THEMES = {
  dark: {
    bg: '#0a0e0d',
    bgSide: '#0d1412',
    bgElevated: '#111a17',
    bgCard: '#111a17',
    border: '#182420',
    borderLight: '#1c2924',
    rowBorder: '#131c19',
    chipBg: '#131c19',
    chipBgAlt: '#182420',
    text: '#ffffff',
    textMuted: 'oklch(65% 0.01 150)',
    textFaint: 'oklch(55% 0.01 150)',
    textFainter: 'oklch(48% 0.01 150)',
  },
  light: {
    bg: '#f6f5f1',
    bgSide: '#ffffff',
    bgElevated: '#ffffff',
    bgCard: '#ffffff',
    border: '#e6e3db',
    borderLight: '#ebe8e0',
    rowBorder: '#efece4',
    chipBg: '#f0eee7',
    chipBgAlt: '#e8e5db',
    text: '#171a18',
    textMuted: 'oklch(42% 0.01 150)',
    textFaint: 'oklch(52% 0.01 150)',
    textFainter: 'oklch(58% 0.01 150)',
  },
} as const;

export type ThemeName = keyof typeof THEMES;
export type Theme = (typeof THEMES)[ThemeName];

// Brand accent green — constant across both themes.
export const ACCENT = 'oklch(78% 0.13 240)';
export const ACCENT_SOFT = 'oklch(78% 0.13 240 / 0.18)';
export const GREEN = 'oklch(75% 0.14 150)';
export const AMBER = 'oklch(75% 0.14 80)';
export const RED = 'oklch(70% 0.17 30)';
export const BLUE = 'oklch(75% 0.13 250)';

export const AVATAR_COLORS = [
  '#48bfe3', '#5b8def', '#8b6de8', '#bc6fe8', '#e36fb1', '#e88f6c',
  '#62a3d8', '#6f85c8', '#a777c7', '#d8789e', '#b9755b', '#4c9ca6',
  '#8877b8', '#c27fa3',
];

const REP_COLORS: Record<string, string> = {
  Surbhi: '#48bfe3', Karan: '#5b8def', Parth: '#8b6de8', Dhruvil: '#bc6fe8',
  Harsh: '#e36fb1', Jash: '#e88f6c', Keyush: '#62a3d8', Fadi: '#6f85c8',
  Parthik: '#a777c7', 'Parth (LA)': '#d8789e', Romil: '#b9755b', Ajay: '#4c9ca6',
  Sahil: '#8877b8',
};

export const SHAPES = ['Round', 'Oval', 'Princess', 'Emerald', 'Cushion', 'Pear'];
export const COLOR_ORDER = ['D', 'E', 'F', 'G', 'H', 'I'];
export const CLARITY_ORDER = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
export const BRANCHES = ['NY', 'LA', 'CH'] as const;
export const BRANCH_NAMES: Record<string, string> = {
  NY: 'New York',
  LA: 'Los Angeles',
  CH: 'Chicago',
};

export function avatarColor(seed: number) {
  return AVATAR_COLORS[seed % AVATAR_COLORS.length];
}

export function repColor(name: string) {
  return REP_COLORS[name] || avatarColor(name.length);
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
