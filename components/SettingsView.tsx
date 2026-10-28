import { useEffect, useState } from 'react';
import { CodeEditor } from './CodeEditor';
import { DEFAULT_TEMPLATES, FAMILIES, monacoLanguage } from '@/lib/languages';
import { clearSavedCode, savedCount, type Settings, templatesItem, type ThemePref } from '@/lib/settings';
import { SHORTCUTS } from '@/lib/shortcuts';
import { THEMES } from '@/lib/themes';
import type { LangFamily } from '@/lib/types';

type Templates = Partial<Record<LangFamily, string>>;

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  templates: Templates;
  editorTheme: string;
}

// [id, label, background, accent] for the theme picker swatches.
const THEME_SWATCHES: [ThemePref, string, string, string][] = [
  ['system', 'System', 'linear-gradient(135deg,#fff 50%,#09090b 50%)', '#3b82f6'],
  ['light', 'Light', '#ffffff', '#2563eb'],
  ['dark', 'Dark', '#09090b', '#3b82f6'],
  ...THEMES.map((t): [ThemePref, string, string, string] => [t.id, t.label, t.editor.bg, t.accent[2]!]),
];

const field = 'rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900';
const heading = 'text-xs font-semibold uppercase tracking-wide text-zinc-500';

function Choice<K extends keyof Settings>(props: {
  label: string;
  k: K;
  options: [Settings[K], string][];
  settings: Settings;
  onSettings: Props['onSettings'];
}) {
  const { label, k, options, settings, onSettings } = props;
  const index = options.findIndex(([v]) => v === settings[k]);
  return (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      <select className={field} value={index} onChange={(e) => onSettings({ [k]: options[Number(e.target.value)]![0] } as Partial<Settings>)}>
        {options.map(([, text], i) => (
          <option key={text} value={i}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SettingsView({ settings, onSettings, templates, editorTheme }: Props) {
  const [family, setFamily] = useState<LangFamily>(settings.preferredFamily);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');

  const [savedN, setSavedN] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => void savedCount().then(setSavedN), []);

  const clearSaved = async () => {
    if (!confirmClear) return setConfirmClear(true);
    setConfirmClear(false);
    flash(`Deleted saved code for ${await clearSavedCode()} problems`);
    setSavedN(0);
  };

  const current = templates[family] ?? DEFAULT_TEMPLATES[family] ?? '';
  useEffect(() => setDraft(current), [current, family]);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 1500);
  };

  const saveTemplate = async () => {
    await templatesItem.setValue({ ...templates, [family]: draft });
    flash('Template saved');
  };

  const resetTemplate = async () => {
    const { [family]: _, ...rest } = templates;
    await templatesItem.setValue(rest);
    setDraft(DEFAULT_TEMPLATES[family] ?? '');
    flash('Template reset to default');
  };

  const c = { settings, onSettings };
  const onOff: [boolean, string][] = [
    [true, 'On'],
    [false, 'Off'],
  ];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <section className="grid grid-cols-2 gap-2">
        <h2 className={`col-span-2 ${heading}`}>General</h2>
        <Choice label="Preferred language" k="preferredFamily" options={FAMILIES.map((f) => [f.id, f.label])} {...c} />
        <div className="col-span-2 flex flex-col gap-1 text-xs">
          Theme
          <div className="grid grid-cols-4 gap-1.5">
            {THEME_SWATCHES.map(([id, label, bg, accent]) => (
              <button
                key={id}
                onClick={() => onSettings({ theme: id })}
                className={`flex flex-col items-center gap-1 rounded border p-1 ${
                  settings.theme === id ? 'border-blue-500 ring-1 ring-blue-500' : 'border-zinc-300 dark:border-zinc-700'
                }`}
              >
                <span className="relative h-6 w-full rounded-sm border border-black/10" style={{ background: bg }}>
                  <span className="absolute right-1 bottom-1 h-2 w-2 rounded-full" style={{ background: accent }} />
                </span>
                <span className="truncate text-[10px]">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <h2 className={`col-span-2 ${heading}`}>Editor</h2>
        <Choice label="Key bindings" k="keyBinding" options={[['standard', 'Standard'], ['vim', 'Vim']]} {...c} />
        <Choice label="Font size" k="fontSize" options={[12, 13, 14, 16, 18, 20].map((n) => [n, `${n}px`])} {...c} />
        <Choice label="Tab size" k="tabSize" options={[2, 4, 8].map((n) => [n, `${n} spaces`])} {...c} />
        <Choice label="Line numbers" k="lineNumbers" options={[['on', 'On'], ['relative', 'Relative'], ['off', 'Off']]} {...c} />
        <Choice
          label="Cursor style"
          k="cursorStyle"
          options={(['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'] as const).map((s) => [s, s])}
          {...c}
        />
        <Choice label="Smooth caret" k="smoothCaret" options={[['off', 'Off'], ['explicit', 'Explicit'], ['on', 'On']]} {...c} />
        <Choice label="Auto suggestions" k="autoSuggest" options={onOff} {...c} />
        <Choice label="Minimap" k="minimap" options={onOff} {...c} />
        <Choice label="Word wrap" k="wordWrap" options={onOff} {...c} />
      </section>

      <section className="flex items-center gap-2 text-xs">
        <h2 className={heading}>Saved code</h2>
        <span className="flex-1 text-zinc-500">{savedN} problem{savedN === 1 ? '' : 's'} (keeps the latest 500)</span>
        <button
          className={`rounded border px-2 py-0.5 ${confirmClear ? 'border-red-500 text-red-600 dark:text-red-400' : 'border-zinc-300 dark:border-zinc-700'}`}
          disabled={!savedN}
          onClick={() => void clearSaved()}
        >
          {confirmClear ? 'Confirm delete?' : 'Delete all'}
        </button>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className={heading}>Shortcuts</h2>
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="flex justify-between text-xs">
            <span>{s.label}</span>
            <kbd className="rounded bg-zinc-100 px-1.5 font-mono dark:bg-zinc-800">{s.keys}</kbd>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className={heading}>Templates</h2>
          <span className="ml-auto text-[11px] text-emerald-600 dark:text-emerald-400">{status}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {FAMILIES.filter((f) => f.id !== 'other').map((f) => (
            <button
              key={f.id}
              className={`rounded px-2 py-0.5 text-xs ${
                f.id === family ? 'bg-blue-600 text-white' : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800'
              }`}
              onClick={() => setFamily(f.id)}
            >
              {f.label}
              {templates[f.id] != null && ' •'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500">
          Loaded for new problems and when you switch to this language. Put{' '}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">$0</code> where the cursor should start.
        </p>
        <div className="h-72 overflow-hidden rounded border border-zinc-200 dark:border-zinc-800">
          <CodeEditor value={draft} onChange={setDraft} language={monacoLanguage(family)} theme={editorTheme} prefs={settings} />
        </div>
        <div className="flex gap-2">
          <button
            className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
            disabled={draft === current}
            onClick={() => void saveTemplate()}
          >
            Save template
          </button>
          <button className="rounded border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700" onClick={() => void resetTemplate()}>
            Reset to default
          </button>
        </div>
      </section>
    </div>
  );
}
