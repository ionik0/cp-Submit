import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { CodeEditor, type CursorRequest } from '@/components/CodeEditor';
import {
  ContextBanner,
  secs,
  type Submission,
  SubmissionRow,
  TabButton,
  type TestCase,
  TestCard,
  type TimedResult,
  Timer,
} from '@/components/Panels';
import { SettingsView } from '@/components/SettingsView';
import { useTheme } from '@/components/theme';
import { DEFAULT_TEMPLATES, expandTemplate, groupLanguages, monacoLanguage } from '@/lib/languages';
import type { Platform } from '@/lib/platforms';
import {
  type ContextResult,
  helperTabs,
  loadContext,
  openFilledSubmitPage,
  readProblem,
  runOne,
  submitSolution,
  trackVerdict,
} from '@/lib/session';
import {
  DEFAULT_SETTINGS,
  loadCode,
  saveCode,
  type Settings,
  settingsItem,
  templatesItem,
  withDefaults,
} from '@/lib/settings';
import { SHORTCUTS, type ShortcutAction } from '@/lib/shortcuts';
import type { LangFamily, Language, Problem } from '@/lib/types';

interface Loaded {
  platform: Platform;
  problem: Problem;
  tabId: number;
}

type Templates = Partial<Record<LangFamily, string>>;
type Codes = Partial<Record<LangFamily, string>>;

let nextTestId = 1;
function testsFromSamples(p: Problem): TestCase[] {
  return p.samples.map((s, i) => ({
    id: nextTestId++,
    label: `Sample ${i + 1}`,
    input: s.input,
    expected: s.output,
    custom: false,
    open: i === 0,
  }));
}

function templateFor(templates: Templates, family: LangFamily) {
  return expandTemplate(templates[family] ?? DEFAULT_TEMPLATES[family] ?? '');
}

const btn = 'rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-40';
// Pause between submissions: avoids CF/AtCoder rate limits and duplicate submits.
const SUBMIT_COOLDOWN_S = 5;

const OFF_PROBLEM_NOTICE = `/*
  Code Editor Access:

  • The code editor is available only while you are
    on a Codeforces or AtCoder problem page. Running
    tests and submitting are disabled on other pages.

  • To get full functionality, open a problem on:
      https://codeforces.com/problemset
      https://atcoder.jp/contests

  Your code is saved per problem — open the problem
  again and it will be right where you left it.

  • Found a bug or have an idea? Raise an issue or
    contribute on GitHub:
      https://github.com/ionik0/cp-extension
*/
`;

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [templates, setTemplates] = useState<Templates>({});
  const [view, setView] = useState<'code' | 'settings'>('code');
  const [activeUrl, setActiveUrl] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [ctx, setCtx] = useState<ContextResult | { kind: 'loading' }>({ kind: 'loading' });
  const [langId, setLangId] = useState('');
  const [code, setCode] = useState('');
  const [cursor, setCursor] = useState<CursorRequest>();
  const [confirmReset, setConfirmReset] = useState(false);
  const [tests, setTests] = useState<TestCase[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [tab, setTab] = useState<'tests' | 'submissions'>('tests');
  const [bottomHeight, setBottomHeight] = useState(260);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const submitLock = useRef(false);

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const { dark, editorTheme } = useTheme(settings.theme);
  const runAbort = useRef<AbortController | null>(null);
  const loadedKey = useRef<string | null>(null);
  const codesRef = useRef<Codes>({});
  const templatesRef = useRef(templates);
  templatesRef.current = templates;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    void settingsItem.getValue().then((v) => setSettings(withDefaults(v)));
    void templatesItem.getValue().then(setTemplates);
    const u1 = settingsItem.watch((v) => setSettings(withDefaults(v)));
    const u2 = templatesItem.watch((v) => setTemplates(v ?? {}));
    return () => {
      u1();
      u2();
    };
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);
    void settingsItem.setValue(next);
  }, []);

  const languages: Language[] = ctx.kind === 'ok' ? ctx.ctx.languages : [];
  const groups = useMemo(() => groupLanguages(languages, settings.preferredFamily), [languages, settings.preferredFamily]);
  const language = languages.find((l) => l.id === langId);
  const family: LangFamily = language?.family ?? settings.preferredFamily;

  const applyTemplate = (fam: LangFamily) => {
    const t = templateFor(templatesRef.current, fam);
    setCode(t.code);
    setCursor({ offset: t.cursor, nonce: Date.now() });
  };

  const openProblem = useCallback(async (tabId: number, url: string) => {
    let found: Awaited<ReturnType<typeof readProblem>>;
    try {
      found = await readProblem(tabId, url);
    } catch {
      return;
    }
    if (!found) return;
    const { platform, problem } = found;
    if (loadedKey.current === problem.key) {
      setLoaded((l) => (l ? { ...l, tabId } : l));
      return;
    }
    loadedKey.current = problem.key;
    runAbort.current?.abort();
    setLoading(true);
    setLoaded({ platform, problem, tabId });
    setTests(testsFromSamples(problem));
    setCtx({ kind: 'loading' });

    const [draft, c] = await Promise.all([
      loadCode(problem.key),
      loadContext(platform, problem, tabId).catch((e): ContextResult => ({ kind: 'error', message: String(e) })),
    ]);
    if (loadedKey.current !== problem.key) return;
    setCtx(c);
    const langs = c.kind === 'ok' ? c.ctx.languages : [];
    const s = settingsRef.current;
    const pick =
      langs.find((l) => l.id === draft?.langId) ??
      langs.find((l) => l.id === s.lastLanguage[platform.id]) ??
      groupLanguages(langs, s.preferredFamily)[0]?.languages[0];
    const fam = pick?.family ?? s.preferredFamily;
    codesRef.current = draft?.codes ?? {};
    setLangId(pick?.id ?? draft?.langId ?? '');
    const saved = codesRef.current[fam];
    if (saved != null) setCode(saved);
    else {
      const t = templateFor(templatesRef.current, fam);
      setCode(t.code);
      setCursor({ offset: t.cursor, nonce: Date.now() });
    }
    setLoading(false);
  }, []);

  // Follow the active tab; keep the last problem when the user wanders to a non-problem tab.
  useEffect(() => {
    const refresh = async () => {
      // Last focused *normal* window: correct both inside a side panel and from the companion window (Safari/Opera).
      const win = await browser.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
      const [t] = win?.id != null ? await browser.tabs.query({ active: true, windowId: win.id }) : [];
      if (t?.id == null || helperTabs.has(t.id)) return;
      setActiveUrl(t.url ?? '');
      if (t.url && t.status === 'complete') void openProblem(t.id, t.url);
    };
    void refresh();
    const onActivated = () => void refresh();
    const onUpdated = (_id: number, info: { status?: string }, t: { active?: boolean }) => {
      if (t.active && info.status === 'complete') void refresh();
    };
    const onFocus = () => void refresh();
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.windows?.onFocusChanged.addListener(onFocus);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.windows?.onFocusChanged.removeListener(onFocus);
    };
  }, [openProblem]);

  // Session-only draft (cleared when the browser closes).
  useEffect(() => {
    if (!loaded || loading) return;
    const key = loaded.problem.key;
    const t = setTimeout(() => void saveCode(key, { langId, family, codes: { ...codesRef.current, [family]: code } }), 400);
    return () => clearTimeout(t);
  }, [code, langId, family, loaded, loading]);

  const changeLanguage = (id: string) => {
    const next = languages.find((l) => l.id === id);
    if (!next || !loaded) return;
    if (next.family !== family) {
      codesRef.current = { ...codesRef.current, [family]: code };
      const saved = codesRef.current[next.family];
      if (saved != null) setCode(saved);
      else applyTemplate(next.family);
    }
    setLangId(id);
    updateSettings({ lastLanguage: { ...settingsRef.current.lastLanguage, [loaded.platform.id]: id } });
  };

  const resetCode = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    setConfirmReset(false);
    applyTemplate(family);
  };

  const retryContext = async () => {
    if (!loaded) return;
    setCtx({ kind: 'loading' });
    const c = await loadContext(loaded.platform, loaded.problem, loaded.tabId).catch(
      (e): ContextResult => ({ kind: 'error', message: String(e) }),
    );
    setCtx(c);
    if (c.kind === 'ok' && !c.ctx.languages.some((l) => l.id === langId)) {
      const s = settingsRef.current;
      const l =
        c.ctx.languages.find((x) => x.id === s.lastLanguage[loaded.platform.id]) ??
        c.ctx.languages.find((x) => x.family === family) ??
        groupLanguages(c.ctx.languages, s.preferredFamily)[0]?.languages[0];
      setLangId(l?.id ?? '');
    }
  };

  // Editor is live only while the active tab is a problem page (like Codeforces Lite); elsewhere a notice is shown.
  // Code stays saved per problem and returns when the user is back on it.
  const onProblem = !!loaded && !!activeUrl && loaded.platform.isProblemUrl(activeUrl);
  const canAct = !!loaded && ctx.kind === 'ok' && !!langId && !loading;
  const running = tests.some((t) => t.result === 'running');

  const runTests = async (only?: number) => {
    if (!loaded || ctx.kind !== 'ok' || !langId) return;
    runAbort.current?.abort();
    const ac = new AbortController();
    runAbort.current = ac;
    const targets = tests.filter((t) => only == null || t.id === only);
    setTab('tests');
    setTests((ts) => ts.map((t) => (targets.some((x) => x.id === t.id) ? { ...t, result: 'running' } : t)));
    for (const t of targets) {
      const r = await runOne(loaded.platform, loaded.problem, loaded.tabId, ctx.ctx, langId, code, t.input, t.expected, ac.signal).catch(
        (e: unknown): TimedResult => ({ status: 'ERR', stdout: '', info: e instanceof DOMException && e.name === 'AbortError' ? 'Cancelled' : String(e) }),
      );
      if (ac.signal.aborted) {
        setTests((ts) => ts.map((x) => (x.result === 'running' ? { ...x, result: undefined } : x)));
        return;
      }
      setTests((ts) => ts.map((x) => (x.id === t.id ? { ...x, result: r, open: x.open || r.status !== 'AC' } : x)));
    }
  };

  const updateSub = (key: string, patch: Partial<Submission>) =>
    setSubs((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const submit = async () => {
    // Ref guard: a second click/shortcut before React re-renders must not start another submission.
    if (!loaded || !canAct || submitLock.current || cooldown) return;
    submitLock.current = true;
    setSubmitBusy(true);
    const { platform, problem, tabId } = loaded;
    const key = crypto.randomUUID();
    setTab('submissions');
    setSubs((ss) => [{ key, title: `${platform.label} · ${problem.name}`, url: problem.url, state: 'submitting' }, ...ss]);
    const startedAt = performance.now();
    const cachedCtx = ctx.kind === 'ok' ? ctx.ctx : null;
    const r = await submitSolution(platform, problem, tabId, cachedCtx, langId, code, (message) => updateSub(key, { message }))
      .catch((e: unknown) => ({ kind: 'error' as const, message: String(e) }))
      .finally(() => {
        submitLock.current = false;
        setSubmitBusy(false);
        setCooldown(SUBMIT_COOLDOWN_S);
      });
    // Always-available way out: reopen the real submit page with this exact code filled in.
    const submittedCode = code;
    const reopen = () => void openFilledSubmitPage(platform, problem, langId, submittedCode);
    if (r.kind === 'logged-out' || r.kind === 'error') {
      updateSub(key, { state: 'error', reopen, message: r.kind === 'error' ? r.message : `You are not logged in to ${platform.label}.` });
      return;
    }
    if (r.kind === 'manual') {
      updateSub(key, {
        state: 'manual',
        reopen,
        message: `${platform.label} wants a human check. Its submit page is open with your code filled in (also copied) — finish there.`,
      });
    } else {
      updateSub(key, { state: 'tracking', message: r.via === 'page' ? 'Submitted via the site’s own form (human check passed).' : undefined });
    }
    const sentMs = performance.now() - startedAt;
    const id = r.kind === 'submitted' ? r.submissionId : null;
    const v = await trackVerdict(platform, problem, tabId, id, r.baselineId ?? null, (v) =>
      updateSub(key, {
        verdict: v,
        state: v.final ? 'done' : 'tracking',
        timing: `sent in ${secs(sentMs)}${v.final ? ` · verdict after ${secs(performance.now() - startedAt - sentMs)}` : ''}`,
      }),
    );
    if (!v) updateSub(key, { state: 'error', message: 'Stopped tracking — check your submissions page.' });
  };

  // Global shortcuts (capture phase, so Monaco doesn't swallow them).
  const actions = useRef<Record<ShortcutAction, () => void>>(null!);
  actions.current = {
    run: () => canAct && onProblem && !running && void runTests(),
    submit: () => onProblem && void submit(),
    reset: () => onProblem && resetCode(),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = SHORTCUTS.find((x) => x.match(e));
      if (!s) return;
      e.preventDefault();
      e.stopPropagation();
      actions.current[s.action]();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const addCustomTest = () => {
    setTab('tests');
    setTests((ts) => [...ts, { id: nextTestId++, label: `Custom ${ts.filter((t) => t.custom).length + 1}`, input: '', expected: '', custom: true, open: true }]);
  };

  const startResize = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const start = bottomHeight;
    const move = (ev: PointerEvent) => setBottomHeight(Math.min(window.innerHeight - 160, Math.max(90, start + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const results = tests.flatMap((t) => (typeof t.result === 'object' ? [t.result] : []));
  const passed = results.filter((r) => r.status === 'AC').length;
  const runTotalMs = results.reduce((s, r) => s + (r.timing ? r.timing.sendMs + r.timing.waitMs : 0), 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {onProblem && loaded ? (
          <>
            <span
              className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white ${
                loaded.platform.id === 'codeforces' ? 'bg-blue-600' : 'bg-zinc-700 dark:bg-zinc-600'
              }`}
            >
              {loaded.platform.id === 'codeforces' ? 'CF' : 'AC'}
            </span>
            <div className="min-w-0 flex-1">
              <a href={loaded.problem.url} target="_blank" rel="noreferrer" className="block truncate font-semibold hover:underline" title={loaded.problem.name}>
                {loaded.problem.name}
              </a>
              <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {[loaded.problem.timeLimit, loaded.problem.memoryLimit].filter(Boolean).join(' · ')}
                {loaded.problem.interactive && ' · interactive'}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 py-0.5 font-semibold">CP Submit</div>
        )}
        {onProblem && loaded && <Timer id={loaded.problem.key} />}
        <div className="flex shrink-0 items-center gap-0.5 rounded bg-zinc-100 p-0.5 text-xs dark:bg-zinc-900">
          {(['code', 'settings'] as const).map((v) => (
            <button
              key={v}
              className={`rounded px-2 py-0.5 capitalize ${view === v ? 'bg-white font-semibold shadow-sm dark:bg-zinc-700' : 'text-zinc-500'}`}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          className="rounded px-1.5 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}
        >
          {dark ? '☀' : '☾'}
        </button>
      </header>

      {view === 'settings' ? (
        <div className="min-h-0 flex-1">
          <SettingsView settings={settings} onSettings={updateSettings} templates={templates} editorTheme={editorTheme} />
        </div>
      ) : !onProblem || !loaded ? (
        <div className="min-h-0 flex-1">
          <CodeEditor value={OFF_PROBLEM_NOTICE} onChange={() => {}} language="cpp" theme={editorTheme} readOnly prefs={settings} />
        </div>
      ) : (
        <>
          <ContextBanner ctx={ctx} platform={loaded.platform} onRetry={() => void retryContext()} />

          <div className="min-h-0 flex-1">
            <CodeEditor
              value={code}
              onChange={setCode}
              language={monacoLanguage(family)}
              theme={editorTheme}
              prefs={settings}
              cursor={cursor}
            />
          </div>

          <div className="flex items-center gap-1.5 border-t border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
            <select
              className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              value={langId}
              disabled={!languages.length}
              onChange={(e) => changeLanguage(e.target.value)}
            >
              {!languages.length && <option value="">{ctx.kind === 'loading' ? 'Loading languages…' : 'Languages unavailable'}</option>}
              {groups.map((g) => (
                <optgroup key={g.family} label={g.label}>
                  {g.languages.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              className={`rounded border px-2 py-1 text-xs ${
                confirmReset ? 'border-red-500 text-red-600 dark:text-red-400' : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
              }`}
              onClick={resetCode}
              title="Replace the code with this language's template"
            >
              {confirmReset ? 'Confirm?' : '↺ Reset'}
            </button>
            {running ? (
              <button className={`${btn} bg-zinc-500 hover:bg-zinc-400`} onClick={() => runAbort.current?.abort()}>
                Stop
              </button>
            ) : (
              <button
                className={`${btn} bg-zinc-700 hover:bg-zinc-600`}
                disabled={!canAct || !tests.length}
                onClick={() => void runTests()}
                title="Run all tests on the judge (Ctrl+')"
              >
                ▶ Run
              </button>
            )}
            <button
              className={`${btn} bg-emerald-600 font-semibold hover:bg-emerald-500`}
              disabled={!canAct || !code.trim() || submitBusy || cooldown > 0}
              onClick={() => void submit()}
              title={cooldown ? 'Cooling down to avoid the judge’s rate limits' : 'Submit (Ctrl+Enter)'}
            >
              {submitBusy ? 'Submitting…' : cooldown ? `Submit (${cooldown}s)` : 'Submit'}
            </button>
          </div>

          <div className="h-1.5 cursor-row-resize bg-zinc-100 hover:bg-blue-300 dark:bg-zinc-900 dark:hover:bg-blue-800" onPointerDown={startResize} />

          <section className="flex flex-col" style={{ height: bottomHeight }}>
            <nav className="flex items-center gap-1 border-b border-zinc-200 px-2 text-xs dark:border-zinc-800">
              <TabButton active={tab === 'tests'} onClick={() => setTab('tests')}>
                Tests{' '}
                {tests.length > 0 && (
                  <span className="text-zinc-500">
                    ({passed}/{tests.length}
                    {runTotalMs > 0 && !running && ` · ${secs(runTotalMs)}`})
                  </span>
                )}
              </TabButton>
              <TabButton active={tab === 'submissions'} onClick={() => setTab('submissions')}>
                Submissions {subs.length > 0 && <span className="text-zinc-500">({subs.length})</span>}
              </TabButton>
              <div className="flex-1" />
              {tab === 'tests' && (
                <button className="px-1 py-1 text-blue-600 hover:underline dark:text-blue-400" onClick={addCustomTest}>
                  + Custom test
                </button>
              )}
            </nav>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
              {tab === 'tests' ? (
                <>
                  {loaded.problem.interactive && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">Interactive problem — samples cannot be judged automatically.</p>
                  )}
                  {!tests.length && <p className="text-zinc-500">No samples found. Add a custom test.</p>}
                  {tests.map((t) => (
                    <TestCard
                      key={t.id}
                      test={t}
                      disabled={!canAct || running}
                      onChange={(patch) => setTests((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...patch } : x)))}
                      onRun={() => void runTests(t.id)}
                      onDelete={() => setTests((ts) => ts.filter((x) => x.id !== t.id))}
                    />
                  ))}
                </>
              ) : (
                <>
                  {!subs.length && <p className="text-zinc-500">Submissions from this panel appear here with live verdicts.</p>}
                  {subs.map((s) => (
                    <SubmissionRow key={s.key} sub={s} />
                  ))}
                </>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
