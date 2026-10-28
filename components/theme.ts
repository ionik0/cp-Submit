import { useEffect, useSyncExternalStore } from 'react';
import type { ThemePref } from '@/lib/settings';
import { findTheme, THEMES, themeVars } from '@/lib/themes';

const query = window.matchMedia('(prefers-color-scheme: dark)');
const subscribe = (cb: () => void) => {
  query.addEventListener('change', cb);
  return () => query.removeEventListener('change', cb);
};
const ALL_VARS = [...new Set(THEMES.flatMap((t) => Object.keys(themeVars(t))))];

/** Applies the theme to <html> (Tailwind `dark:` variant, palette variables) and names the matching Monaco theme. */
export function useTheme(pref: ThemePref): { dark: boolean; editorTheme: string } {
  const systemDark = useSyncExternalStore(subscribe, () => query.matches);
  const custom = findTheme(pref);
  const dark = custom ? custom.dark : pref === 'dark' || (pref === 'system' && systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    ALL_VARS.forEach((v) => root.style.removeProperty(v));
    if (custom) Object.entries(themeVars(custom)).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [dark, custom]);

  return { dark, editorTheme: custom ? `cp-${custom.id}` : dark ? 'vs-dark' : 'light' };
}
