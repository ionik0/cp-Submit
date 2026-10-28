import { storage } from 'wxt/utils/storage';
import type { ThemeId } from './themes';
import type { LangFamily, PlatformId, Problem } from './types';

export type ThemePref = 'system' | 'light' | 'dark' | ThemeId;

export interface EditorPrefs {
  fontSize: number;
  tabSize: number;
  keyBinding: 'standard' | 'vim';
  minimap: boolean;
  wordWrap: boolean;
  autoSuggest: boolean;
  lineNumbers: 'on' | 'relative' | 'off';
  cursorStyle: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin';
  smoothCaret: 'off' | 'explicit' | 'on';
}

export interface Settings extends EditorPrefs {
  preferredFamily: LangFamily;
  theme: ThemePref;
  /** Last language id picked per platform, so the dropdown sticks. */
  lastLanguage: Partial<Record<PlatformId, string>>;
}

export const DEFAULT_SETTINGS: Settings = {
  preferredFamily: 'cpp',
  theme: 'system',
  fontSize: 14,
  tabSize: 4,
  keyBinding: 'standard',
  minimap: false,
  wordWrap: false,
  autoSuggest: true,
  lineNumbers: 'on',
  cursorStyle: 'line',
  smoothCaret: 'off',
  lastLanguage: {},
};

export const settingsItem = storage.defineItem<Settings>('sync:settings', { fallback: DEFAULT_SETTINGS });

/** Stored settings merged over defaults, so fields added in later versions get sane values. */
export function withDefaults(s: Partial<Settings> | null | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...s };
}

// local (not sync): CP templates easily exceed sync's 8 KB per-item quota.
export const templatesItem = storage.defineItem<Partial<Record<LangFamily, string>>>('local:templates', {
  fallback: {},
});

export interface Draft {
  langId: string;
  family?: LangFamily;
  /** Code per language family, so switching languages never loses work. */
  codes: Partial<Record<LangFamily, string>>;
}

// Saved code per problem survives tab changes and browser restarts. The index keeps keys in
// least-recently-used order; beyond MAX_SAVED problems the oldest are dropped.
const MAX_SAVED = 500;
const indexItem = storage.defineItem<string[]>('local:codeIndex', { fallback: [] });
const codeKey = (problemKey: string): `local:${string}` => `local:code:${problemKey}`;

export const loadCode = (problemKey: string) => storage.getItem<Draft>(codeKey(problemKey));

export async function saveCode(problemKey: string, draft: Draft) {
  await storage.setItem(codeKey(problemKey), draft);
  const index = (await indexItem.getValue()).filter((k) => k !== problemKey);
  index.push(problemKey);
  const evicted = index.splice(0, Math.max(0, index.length - MAX_SAVED));
  await Promise.all([indexItem.setValue(index), storage.removeItems(evicted.map(codeKey))]);
}

export async function clearSavedCode(): Promise<number> {
  const index = await indexItem.getValue();
  await storage.removeItems(index.map(codeKey));
  await indexItem.setValue([]);
  return index.length;
}

export const savedCount = async () => (await indexItem.getValue()).length;

/** The last problem opened, so the panel can still show its code from other pages or after a restart. */
export const lastProblemItem = storage.defineItem<Problem | null>('local:lastProblem', { fallback: null });
