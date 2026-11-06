import { browser } from 'wxt/browser';
import { judge } from './compare';
import { hasHumanCheck, isChallenge, isSubmitPage, parseHtml } from './html';
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

/**
 * Everything comes from the page already open, with no request to the site. `pageCtx` is set when that page
 * carries its own submit form (language list and login included), which spares a `/submit` fetch on a busy contest site.
 */
export async function readProblem(tabId: number, url: string): Promise<{ platform: Platform; problem: Problem; pageCtx: SubmitContext | null } | null> {
  const platform = platformForUrl(url);
  if (!platform) return null;
  const html = await new TabIO(tabId).html();
  const doc = parseHtml(html);
  const problem = platform.parseProblem(doc, url);
  if (!problem) return null;
  const ctx = platform.parseSubmitPage(doc, html, problem);
  // The sidebar form posts to the problem URL; direct submits keep using the real submit endpoint.
  return { platform, problem, pageCtx: ctx.user && ctx.languages.length ? { ...ctx, action: '' } : null };
}

const samePage = (a: string, b: string) => {
  const [x, y] = [new URL(a), new URL(b)];
  return x.origin === y.origin && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '');
};

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
 * Preferred: the problem page's own form, so the site computes its own fields and human-check token.
 * If the page has no form: one same-origin POST from the problem tab, using the form context loaded when the
 * problem opened plus any live fields. Only if that is impossible or challenged: the real submit page in a new tab.
 * Nothing after a form click ever retries, since a second attempt could count as a second submission.
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
    if (t.io.tabId === tabId) {
      const viaForm = await submitViaProblemTab(platform, problem, tabId, langId, code, onStatus);
      if (viaForm) return viaForm;
    }
    // Languages restored from the cache come without a token.
    let ctx = cached?.csrf ? cached : null;
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

// How long a click can go unanswered before pointing at the problem tab, and before giving up on it.
const CHECK_PROMPT_MS = 10_000;
const SUBMIT_WAIT_MS = 15 * 60_000;

/**
 * Fills and clicks the form on the open problem page, then puts the tab back on the problem.
 * Returns null only when nothing was clicked (no form here), so the caller may safely try another way.
 */
async function submitViaProblemTab(
  platform: Platform,
  problem: Problem,
  tabId: number,
  langId: string,
  code: string,
  onStatus: (msg: string) => void,
): Promise<SubmitResult | null> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  // Another problem's sidebar form would submit this code to the wrong problem.
  if (!tab?.url || !samePage(tab.url, problem.url)) return null;
  // Keeps the panel on this problem while the tab visits the results page.
  helperTabs.add(tabId);
  let url = tab.url;
  const needsCheck = 'If the problem tab shows a verification, pass it there and press Submit if the page asks. Still waiting — reloading that tab cancels this.';
  const prompt = setTimeout(() => onStatus(needsCheck), CHECK_PROMPT_MS);
  try {
    const result = await fillIn(tabId, platform, problem, langId, code, true).catch((): FillResult => 'no-form');
    if (result !== 'submitted') return null;
    onStatus('Submitting through the page’s own form…');
    const notAccepted = `${platform.label} didn’t confirm this submission. Check your submissions page before trying again.`;
    // A verification can take minutes during a live round, and the submission can still go through after it.
    const deadline = Date.now() + SUBMIT_WAIT_MS;
    for (;;) {
      if (!(await waitForTabComplete(tabId, Math.max(0, deadline - Date.now())))) return { kind: 'error', message: notAccepted };
      url = (await browser.tabs.get(tabId).catch(() => null))?.url ?? url;
      const html = await new TabIO(tabId).html();
      if (isChallenge({ ok: true, status: 200, url, text: html })) {
        onStatus(needsCheck);
        continue;
      }
      if (platform.isLoginRedirect(url)) return { kind: 'logged-out' };
      const doc = parseHtml(html);
      if (platform.isResultsPage(url)) return { kind: 'submitted', submissionId: platform.submissionIdFrom(doc), via: 'page' };
      const errors = platform.submitErrors(doc);
      if (errors.length) return { kind: 'error', message: errors.join(' · ') };
      if (isSubmitPage(url) && hasHumanCheck(doc)) {
        onStatus(needsCheck);
        continue;
      }
      return { kind: 'error', message: notAccepted };
    }
  } finally {
    clearTimeout(prompt);
    // Anywhere else means the user moved on, so the tab stays where they took it.
    if (!platform.isResultsPage(url) && !isSubmitPage(url)) helperTabs.delete(tabId);
    else {
      void browser.tabs.update(tabId, { url: problem.url }).catch(() => {});
      void waitForTabComplete(tabId, 30_000).finally(() => helperTabs.delete(tabId));
    }
  }
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

// Checks needed before saying so, and the slowest pace: Codeforces' verdict source is a full page, heavy during a contest.
const VERDICT_SILENCE_NOTICE = 6;
const VERDICT_MAX_DELAY_MS = 4000;

/** Polls until the submission reaches a final verdict. With `baselineId`, first waits for a newer submission to appear. */
export async function trackVerdict(
  platform: Platform,
  problem: Problem,
  tabId: number | undefined,
  id: string | null,
  baselineId: string | null,
  onUpdate: (v: Verdict) => void,
  onSilence: (message: string | undefined) => void,
): Promise<Verdict | null> {
  const deadline = Date.now() + 15 * 60_000;
  let current = id;
  let last: Verdict | null = null;
  let silent = 0;
  for (let i = 0; Date.now() < deadline; i++) {
    // The judge needs a moment before there is anything new to see; then back off so a busy site isn't hammered.
    await sleep(Math.min(800 + i * 300, VERDICT_MAX_DELAY_MS));
    const t = await acquireTab(platform.origin, tabId);
    try {
      const v = await platform.fetchVerdict(t.io, problem, current);
      if (v && (current || !baselineId || Number(v.id) > Number(baselineId))) {
        current = v.id;
        last = v;
        silent = 0;
        onSilence(undefined);
        onUpdate(v);
        if (v.final) return v;
      } else if (++silent === VERDICT_SILENCE_NOTICE) {
        onSilence(`${platform.label} isn’t showing this verdict yet (busy, or asking for a check). Still trying — your submissions page has the live state.`);
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
  knownCsrf: string,
  langId: string,
  code: string,
  input: string,
  expected: string | undefined,
  signal: AbortSignal,
): Promise<RunResult & { timing: RunTiming }> {
  const work = async () => {
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
      // The token read when the problem opened may be stale after a long contest.
      const csrf = (await t.io.csrf()) || knownCsrf;
      const r = judge(await platform.runTest(io, problem, csrf, langId, code, input, signal), expected);
      const end = performance.now();
      return { ...r, timing: { sendMs: sentAt - start, waitMs: end - sentAt, polls: Math.max(0, requests - 1) } };
    } finally {
      t.release();
    }
  };
  // Stop takes effect at once, even while a request to the site is still out.
  const stopped = new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }),
  );
  return Promise.race([work(), stopped]);
}
