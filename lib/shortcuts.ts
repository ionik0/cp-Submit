export type ShortcutAction = 'run' | 'submit' | 'reset';

const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;

// Same defaults as Codeforces Lite.
export const SHORTCUTS: { action: ShortcutAction; label: string; keys: string; match: (e: KeyboardEvent) => boolean }[] = [
  { action: 'run', label: 'Run tests', keys: "Ctrl + '", match: (e) => mod(e) && e.key === "'" },
  { action: 'submit', label: 'Submit', keys: 'Ctrl + Enter', match: (e) => mod(e) && !e.shiftKey && e.key === 'Enter' },
  { action: 'reset', label: 'Reset code', keys: 'Shift + Alt + R', match: (e) => e.shiftKey && e.altKey && e.code === 'KeyR' },
];
