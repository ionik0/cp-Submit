import { browser } from 'wxt/browser';
import type { FormSpec, PageIO, PageRequest, PageResponse } from './types';

/** Runs inside the platform tab (MAIN world): a same-origin fetch with the user's real cookies and fingerprint. */
function pageFetch(req: PageRequest): Promise<PageResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 20000);
  let body: FormData | URLSearchParams | undefined;
  if (req.form) {
    if (req.multipart) {
      const fd = new FormData();
      for (const [k, v] of req.form) fd.append(k, v);
      body = fd;
    } else {
      body = new URLSearchParams(req.form);
    }
  }
  return fetch(req.url, {
    method: req.method ?? 'GET',
    body,
    headers: req.headers,
    credentials: 'include',
    signal: ctrl.signal,
  })
    .then(async (res) => ({ ok: true, status: res.status, url: res.url, text: await res.text() }))
    .catch((e: unknown) => ({
      ok: false,
      status: 0,
      url: req.url,
      text: '',
      error: e instanceof DOMException && e.name === 'AbortError' ? 'request timed out' : String(e),
    }))
    .finally(() => clearTimeout(timer));
}

function readGlobals(names: string[]): Record<string, string | null> {
  const w = window as unknown as Record<string, unknown>;
  const out: Record<string, string | null> = {};
  for (const n of names) out[n] = typeof w[n] === 'string' ? (w[n] as string) : null;
  return out;
}

/** Runs in the platform tab (MAIN world): the page's current CSRF token, however this site exposes it. */
export function readCsrf(): string | null {
  const w = window as unknown as { csrfToken?: unknown };
  return (
    document.querySelector('meta[name="X-Csrf-Token"]')?.getAttribute('content') ||
    document.querySelector('.csrf-token')?.getAttribute('data-csrf') ||
    document.querySelector<HTMLInputElement>('input[name="csrf_token"]')?.value ||
    (typeof w.csrfToken === 'string' ? w.csrfToken : null)
  );
}

function readHtml(): string {
  return document.documentElement.outerHTML;
}

export interface Harvest {
  fields: [string, string][];
  /** A human-check token the page already earned (Turnstile/reCAPTCHA), if any. */
  token: boolean;
}

/**
 * Runs in the problem tab (MAIN world): reads the page's own submit form — Codeforces' sidebar form,
 * AtCoder's task-page form — including any human-check token, so a direct POST needs no extra round trip.
 */
export function harvestForm(): Harvest | null {
  const form = document.querySelector('select[name="programTypeId"], select[name="data.LanguageId"]')?.closest('form');
  if (!form) return null;
  const fields: [string, string][] = [];
  new FormData(form).forEach((v, k) => typeof v === 'string' && fields.push([k, v]));
  const tokenEl = document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"], [name="g-recaptcha-response"]');
  if (tokenEl?.value && !fields.some(([k]) => k === tokenEl.name)) fields.push([tokenEl.name, tokenEl.value]);
  return { fields, token: !!tokenEl?.value };
}

export type FillResult = 'submitted' | 'needs-user' | 'no-form';

/**
 * Runs in the submit page (MAIN world): fills the real form, waits for the site's human check
 * (Turnstile normally passes by itself in a real browser), then clicks the page's own Submit button.
 */
export async function fillAndSubmit(spec: FormSpec & { code: string }, autoSubmit: boolean): Promise<FillResult> {
  const w = window as unknown as {
    jQuery?: (el: Element) => { trigger(e: string): void };
    ace?: { edit(id: string): { setValue(v: string, cursor: number): void } };
  };
  const ta = document.querySelector<HTMLTextAreaElement>(spec.codeSelector);
  const file = !ta && spec.fileSelector ? document.querySelector<HTMLInputElement>(spec.fileSelector) : null;
  const form = (ta ?? file)?.closest('form');
  if (!form) return 'no-form';
  for (const [sel, v] of spec.values) {
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(sel).forEach((el) => {
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      w.jQuery?.(el).trigger('change');
    });
  }
  if (ta) {
    ta.value = spec.code;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    try {
      if (w.ace && document.getElementById('editor')) w.ace.edit('editor').setValue(spec.code, -1);
    } catch {
      /* page uses a plain textarea */
    }
  } else if (file) {
    const dt = new DataTransfer();
    dt.items.add(new File([spec.code], 'solution.txt', { type: 'text/plain' }));
    file.files = dt.files;
    file.dispatchEvent(new Event('change', { bubbles: true }));
  }
  form.scrollIntoView({ block: 'center' });
  if (!autoSubmit) return 'needs-user';

  // Give an auto-running check up to 8 s to produce its token; sites that run the check on submit get the click anyway.
  const token = () => document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"], [name="g-recaptcha-response"]')?.value;
  if (document.querySelector('[data-sitekey], .cf-turnstile')) {
    for (let i = 0; i < 40 && !token(); i++) await new Promise((r) => setTimeout(r, 200));
  }
  const button = (file && spec.submitSelector && document.querySelector<HTMLElement>(spec.submitSelector)) || form.querySelector<HTMLElement>('[type="submit"]');
  // Click after returning: navigating away first would lose this result, and a lost result could look like "nothing was submitted".
  setTimeout(() => (button ? button.click() : form.requestSubmit()), 50);
  return 'submitted';
}

// Time allowed beyond a request's own timeout, and for quick in-page reads.
const SCRIPT_GRACE_MS = 5000;

export class TabIO implements PageIO {
  constructor(readonly tabId: number) {}

  /** Runs a function in the tab. A closed, navigating or frozen tab gives undefined rather than a rejection or an endless wait. */
  private async inject<A extends unknown[], R>(func: (...args: A) => R, args: A, world: 'MAIN' | 'ISOLATED', ms: number): Promise<Awaited<R> | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), ms)));
    const run = browser.scripting
      .executeScript({ target: { tabId: this.tabId }, world, func, args } as never)
      .then((r) => (r as unknown as { result?: Awaited<R> }[])[0]?.result)
      .catch(() => undefined);
    return Promise.race([run, timedOut]).finally(() => clearTimeout(timer));
  }

  async request(req: PageRequest): Promise<PageResponse> {
    const res = await this.inject(pageFetch, [req], 'MAIN', (req.timeoutMs ?? 20000) + SCRIPT_GRACE_MS);
    return res ?? { ok: false, status: 0, url: req.url, text: '', error: 'tab did not respond' };
  }

  async globals(names: string[]): Promise<Record<string, string | null>> {
    return (await this.inject(readGlobals, [names], 'MAIN', SCRIPT_GRACE_MS)) ?? {};
  }

  async harvest(): Promise<Harvest | null> {
    return (await this.inject(harvestForm, [], 'MAIN', SCRIPT_GRACE_MS)) ?? null;
  }

  async csrf(): Promise<string | null> {
    return (await this.inject(readCsrf, [], 'MAIN', SCRIPT_GRACE_MS)) ?? null;
  }

  async html(): Promise<string> {
    return (await this.inject(readHtml, [], 'ISOLATED', 2 * SCRIPT_GRACE_MS)) ?? '';
  }
}

export function waitForTabComplete(tabId: number, timeoutMs = 30_000): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      browser.tabs.onRemoved.removeListener(onRemoved);
      resolve(v);
    };
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') done(true);
    };
    const onRemoved = (id: number) => {
      if (id === tabId) done(false);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    browser.tabs.onUpdated.addListener(listener);
    browser.tabs.onRemoved.addListener(onRemoved);
  });
}

async function isUsable(tabId: number, origin: string): Promise<boolean> {
  try {
    const t = await browser.tabs.get(tabId);
    return !!t.url?.startsWith(origin + '/') && t.status === 'complete' && !t.discarded;
  } catch {
    return false;
  }
}

interface HelperTab {
  opening: Promise<number>;
  refs: number;
  closer?: ReturnType<typeof setTimeout>;
}

// Kept open briefly after the last user, so verdict polling doesn't open and close a tab for every check.
const HELPER_LINGER_MS = 30_000;
const helpers = new Map<string, HelperTab>();

/** One background tab per site, however many samples or polls need it at the same moment. */
async function acquireHelper(origin: string): Promise<{ io: TabIO; release: () => void }> {
  let h = helpers.get(origin);
  if (!h) {
    const opening = browser.tabs.create({ url: `${origin}/`, active: false }).then(async (t) => {
      await waitForTabComplete(t.id!);
      return t.id!;
    });
    h = { opening, refs: 0 };
    helpers.set(origin, h);
  }
  const entry = h;
  entry.refs++;
  clearTimeout(entry.closer);
  const id = await entry.opening;
  if (!(await browser.tabs.get(id).catch(() => null))) {
    // The user closed it: start over with a new one.
    if (helpers.get(origin) === entry) helpers.delete(origin);
    return acquireHelper(origin);
  }
  return {
    io: new TabIO(id),
    release: () => {
      if (--entry.refs > 0) return;
      entry.closer = setTimeout(() => {
        if (helpers.get(origin) === entry) helpers.delete(origin);
        void browser.tabs.remove(id).catch(() => {});
      }, HELPER_LINGER_MS);
    },
  };
}

/**
 * A loaded tab on the platform's origin to run requests from: the preferred (problem) tab,
 * any other open tab of that site, or a shared background tab that is closed again after release().
 */
export async function acquireTab(origin: string, preferredTabId?: number): Promise<{ io: TabIO; release: () => void }> {
  const noop = () => {};
  if (preferredTabId != null) {
    // The problem tab may be mid-reload (e.g. returning after a submit): worth a moment rather than opening another tab.
    const t = await browser.tabs.get(preferredTabId).catch(() => null);
    if (t?.url?.startsWith(origin + '/') && t.status !== 'complete') await waitForTabComplete(preferredTabId, 5000);
    if (await isUsable(preferredTabId, origin)) return { io: new TabIO(preferredTabId), release: noop };
  }
  if (helpers.has(origin)) return acquireHelper(origin);
  const tabs = await browser.tabs.query({ url: `${origin}/*` });
  const open = tabs.find((t) => t.id != null && t.status === 'complete' && !t.discarded);
  if (open?.id != null) return { io: new TabIO(open.id), release: noop };
  return acquireHelper(origin);
}
