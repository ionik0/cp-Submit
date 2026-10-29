import { browser } from 'wxt/browser';
import { judge } from './compare';
import { isChallenge, isSubmitPage, parseHtml } from './html';
import { acquireTab, type FillResult, fillAndSubmit, TabIO, waitForTabComplete } from './page';
import { platformForUrl, type Platform } from './platforms';
import { sleep } from './platforms/platform';
import type { PageIO, Problem, RunResult, SubmitContext, Verdict } from './types';

export type ContextResult =
  | { kind: 'ok'; ctx: SubmitContext }
  | { kind: 'logged-out' }
  | { kind: 'challenge' }
  | { kind: 'error'; message: string };

export type SubmitResult =
  /** `baselineId` set: the id is unknown, track the first submission newer than it. */
  | { kind: 'submitted'; submissionId: string | null; baselineId?: string | null; via: 'direct' | 'page' }
  | { kind: 'manual'; baselineId: string | null }
  | { kind: 'logged-out' }
  | { kind: 'error'; message: string };

export async function readProblem(tabId: number, url: string): Promise<{ platform: Platform; problem: Problem } | null> {
  const platform = platformForUrl(url);
  if (!platform) return null;
  const html = await new TabIO(tabId).html();
  const problem = platform.parseProblem(parseHtml(html), url);
  return problem ? { platform, problem } : null;
}

async function loadContextWith(io: PageIO, platform: Platform, problem: Problem): Promise<ContextResult> {
  const res = await io.request({ url: platform.submitPageUrl(problem) });
  if (!res.ok) return { kind: 'error', message: `Could not reach ${platform.label}: ${res.error}` };
  if (isChallenge(res)) return { kind: 'challenge' };
  if (platform.isLoginRedirect(res.url)) return { kind: 'logged-out' };
  const ctx = platform.parseSubmitPage(parseHtml(res.text), res.text, problem);
  if (!ctx.user) return { kind: 'logged-out' };
  if (!ctx.languages.length) return { kind: 'error', message: `Could not read the ${platform.label} submit form.` };
  return { kind: 'ok', ctx };
}

export async function loadContext(platform: Platform, problem: Problem, tabId?: number): Promise<ContextResult> {
  const t = await acquireTab(platform.origin, tabId);
  try {
    return await loadContextWith(t.io, platform, problem);
  } finally {
    t.release();
  }
}

/** Tabs we open to submit through the site's own form; the panel ignores them when following the active tab. */
export const helperTabs = new Set<number>();

/**
 * Fast path: one same-origin POST from the problem tab, using the form context loaded when the problem opened
 * plus the live form on the problem page (fresh hidden fields and any human-check token it already earned).
 * Only if that is impossible or challenged: submit through the site's real page, then return to the problem.
 */
export async function submitSolution(
  platform: Platform,
  problem: Problem,
  tabId: number | undefined,
  cached: SubmitContext | null,
  langId: string,
  code: string,
  onStatus: (msg: string) => void,
): Promise<SubmitResult> {
  const t = await acquireTab(platform.origin, tabId);
  try {
    let ctx = cached;
    if (!ctx) {
      const c = await loadContextWith(t.io, platform, problem);
      if (c.kind === 'logged-out' || c.kind === 'error') return c;
      ctx = c.kind === 'ok' ? c.ctx : null;
    }
    const live = t.io.tabId === tabId ? await t.io.harvest().catch(() => null) : null;
    if (ctx && (!ctx.humanCheck || live?.token)) {
      const csrf = live?.fields.find(([k]) => k === 'csrf_token')?.[1] || ctx.csrf;
      const use = live ? { ...ctx, hidden: live.fields, csrf } : ctx;
      const out = await platform.submit(t.io, problem, use, langId, code);
      if (out.kind !== 'challenge') return out.kind === 'submitted' ? { ...out, via: 'direct' } : out;
    }
    const baselineId = (await platform.fetchVerdict(t.io, problem, null).catch(() => null))?.id ?? null;
    onStatus(`${platform.label} requires a human check — submitting through its own page…`);
    const done = await submitViaPage(platform, problem, tabId, langId, code, onStatus);
    return done ? { kind: 'submitted', submissionId: null, baselineId, via: 'page' } : { kind: 'manual', baselineId };
  } finally {
    t.release();
  }
}

async function fillIn(tabId: number, platform: Platform, problem: Problem, langId: string, code: string, autoSubmit: boolean) {
  const [r] = await browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: fillAndSubmit,
    args: [{ ...platform.formSpec(problem, langId), code }, autoSubmit],
  });
  return (r?.result as FillResult | undefined) ?? 'no-form';
}

/**
 * Submits through the site's real form in a visible tab (Turnstile does not run in background tabs).
 * Returns true once the page navigated away from the form; false if the user has to finish in that tab.
 */
async function submitViaPage(
  platform: Platform,
  problem: Problem,
  returnTo: number | undefined,
  langId: string,
  code: string,
  onStatus: (msg: string) => void,
): Promise<boolean> {
  await navigator.clipboard.writeText(code).catch(() => {});
  const tabId = (await browser.tabs.create({ url: platform.submitPageUrl(problem), active: true })).id!;
  helperTabs.add(tabId);
  await waitForTabComplete(tabId);
  const fill = () => fillIn(tabId, platform, problem, langId, code, true).catch((): FillResult => 'no-form');
  let result = await fill();
  if (result === 'no-form') {
    // A full-page challenge reloads into the form once passed.
    onStatus('Pass the verification in the opened tab — the form will be submitted for you.');
    if (await waitForTabComplete(tabId, 180_000)) result = await fill();
  }
  if (result === 'submitted') {
    onStatus('Waiting for the site to accept the submission (answer the check if one appears)…');
    const navigated = await waitForTabComplete(tabId, 60_000);
    const url = (await browser.tabs.get(tabId).catch(() => null))?.url;
    if (navigated && url && !isSubmitPage(url)) {
      void browser.tabs.remove(tabId).catch(() => {});
      if (returnTo != null) void browser.tabs.update(returnTo, { active: true }).catch(() => {});
      return true;
    }
  }
  return false;
}

/** Opens the real submit page with the code filled in (no auto-click) — the user's always-available way out. */
export async function openFilledSubmitPage(platform: Platform, problem: Problem, langId: string, code: string) {
  await navigator.clipboard.writeText(code).catch(() => {});
  const tabId = (await browser.tabs.create({ url: platform.submitPageUrl(problem), active: true })).id!;
  helperTabs.add(tabId);
  for (let i = 0; i < 3 && (await waitForTabComplete(tabId, i ? 180_000 : 30_000)); i++) {
    // Retries cover a verification interstitial that reloads into the form once passed.
    if ((await fillIn(tabId, platform, problem, langId, code, false).catch(() => 'no-form')) !== 'no-form') return;
  }
}

/** Polls until the submission reaches a final verdict. With `baselineId`, first waits for a newer submission to appear. */
export async function trackVerdict(
  platform: Platform,
  problem: Problem,
  tabId: number | undefined,
  id: string | null,
  baselineId: string | null,
  onUpdate: (v: Verdict) => void,
): Promise<Verdict | null> {
  const deadline = Date.now() + 15 * 60_000;
  let current = id;
  let last: Verdict | null = null;
  while (Date.now() < deadline) {
    // The judge needs a moment before there is anything new to see; then check every second.
    await sleep(last ? 1000 : 800);
    const t = await acquireTab(platform.origin, tabId);
    try {
      const v = await platform.fetchVerdict(t.io, problem, current);
      if (v && (current || !baselineId || Number(v.id) > Number(baselineId))) {
        current = v.id;
        last = v;
        onUpdate(v);
        if (v.final) return v;
      }
    } catch {
      /* transient — retry */
    } finally {
      t.release();
    }
  }
  return last;
}

export interface RunTiming {
  /** Sending the code to the judge (one HTTP round trip). */
  sendMs: number;
  /** From "sent" until the result was seen: judge queue + compile + run + our polling. */
  waitMs: number;
  polls: number;
}

export async function runOne(
  platform: Platform,
  problem: Problem,
  tabId: number | undefined,
  ctx: SubmitContext,
  langId: string,
  code: string,
  input: string,
  expected: string | undefined,
  signal: AbortSignal,
): Promise<RunResult & { timing: RunTiming }> {
  const t = await acquireTab(platform.origin, tabId);
  let requests = 0;
  let sentAt = 0;
  const start = performance.now();
  const io: PageIO = {
    request: async (r) => {
      const res = await t.io.request(r);
      if (requests++ === 0) sentAt = performance.now();
      return res;
    },
    globals: (n) => t.io.globals(n),
  };
  try {
    const r = judge(await platform.runTest(io, problem, ctx, langId, code, input, signal), expected);
    const end = performance.now();
    return { ...r, timing: { sendMs: sentAt - start, waitMs: end - sentAt, polls: Math.max(0, requests - 1) } };
  } finally {
    t.release();
  }
}
