export type ThemeId = 'volcano' | 'cherry' | 'midnight' | 'deepsea' | 'sunset';

export interface ThemeDef {
  id: ThemeId;
  label: string;
  dark: boolean;
  /** Replaces Tailwind's zinc scale (50 … 950) — the UI's neutral palette. */
  neutral: string[];
  /** Replaces Tailwind's blue 300/400/500/600/800 — the UI's accent. */
  accent: string[];
  /** Page background for light themes (replaces `white`). */
  paper?: string;
  editor: { bg: string; fg: string; comment: string; keyword: string; string: string; number: string; type: string };
}

export const THEMES: ThemeDef[] = [
  {
    id: 'volcano',
    label: 'Volcano',
    dark: true,
    neutral: ['#fbeaea', '#f3d4d4', '#e3b0b0', '#c98a8a', '#a86868', '#8a4f4f', '#6b3a3a', '#4f2626', '#3a1919', '#2a1010', '#1c0909'],
    accent: ['#ffb199', '#ff8a65', '#f4511e', '#d84315', '#8c2a0d'],
    editor: { bg: '#1c0909', fg: '#f3d4d4', comment: '#8a5a5a', keyword: '#ff6e5a', string: '#ffb37a', number: '#ff9e80', type: '#ffd38a' },
  },
  {
    id: 'cherry',
    label: 'Cherry Blossom',
    dark: false,
    neutral: ['#fdf2f5', '#fae6ec', '#f2ccd8', '#e5a9bc', '#cf7f99', '#b0607d', '#8f4a63', '#6f3a4d', '#52293a', '#3a1d29', '#24111a'],
    accent: ['#f9a8c4', '#f472a6', '#ec4899', '#db2777', '#9d174d'],
    paper: '#fff8f9',
    editor: { bg: '#fff8f9', fg: '#4a2733', comment: '#c49aa8', keyword: '#d6336c', string: '#8e5a9e', number: '#c2410c', type: '#a8436b' },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    dark: true,
    neutral: ['#eef0f8', '#dde1f0', '#b9c0dc', '#8e97bd', '#69739c', '#4d5680', '#383f62', '#272c48', '#1a1e33', '#12152a', '#0a0c1a'],
    accent: ['#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#5b21b6'],
    editor: { bg: '#0a0c1a', fg: '#dde1f0', comment: '#4d5680', keyword: '#a78bfa', string: '#86efac', number: '#f9a8d4', type: '#7dd3fc' },
  },
  {
    id: 'deepsea',
    label: 'Deep Sea',
    dark: true,
    neutral: ['#e6f4f8', '#cce8f0', '#99d0e0', '#66b3cc', '#3d8fad', '#2a6f8c', '#1d556e', '#143f54', '#0d2d3e', '#08202e', '#04131d'],
    accent: ['#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#155e75'],
    editor: { bg: '#04131d', fg: '#cce8f0', comment: '#3d6f85', keyword: '#22d3ee', string: '#5eead4', number: '#93c5fd', type: '#7dd3fc' },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    dark: true,
    neutral: ['#f6eef8', '#ecdcf1', '#d7b8e0', '#bb8fc9', '#9a6aab', '#7c4f8e', '#5f3a70', '#472a55', '#331d3f', '#24142d', '#170c1e'],
    accent: ['#fdba74', '#fb923c', '#f97316', '#ea580c', '#9a3412'],
    editor: { bg: '#170c1e', fg: '#ecdcf1', comment: '#7c5f8e', keyword: '#fb923c', string: '#f9a8d4', number: '#fcd34d', type: '#c4b5fd' },
  },
];

const NEUTRAL_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const ACCENT_SHADES = [300, 400, 500, 600, 800];

export const findTheme = (id: string) => THEMES.find((t) => t.id === id);

/** Tailwind 4 utilities read `--color-*` variables, so swapping them re-tints the whole UI. */
export function themeVars(t: ThemeDef): Record<string, string> {
  const vars: Record<string, string> = {};
  NEUTRAL_SHADES.forEach((s, i) => (vars[`--color-zinc-${s}`] = t.neutral[i]!));
  ACCENT_SHADES.forEach((s, i) => (vars[`--color-blue-${s}`] = t.accent[i]!));
  if (t.paper) vars['--color-white'] = t.paper;
  return vars;
}
