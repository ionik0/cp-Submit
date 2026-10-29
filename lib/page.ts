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
  const form = ta?.closest('form');
  if (!ta || !form) return 'no-form';
  for (const [sel, v] of spec.values) {
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(sel).forEach((el) => {
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      w.jQuery?.(el).trigger('change');
    });
  }
  ta.value = spec.code;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  try {
    if (w.ace && document.getElementById('editor')) w.ace.edit('editor').setValue(spec.code, -1);
  } catch {
    /* page uses a plain textarea */
  }
  form.scrollIntoView({ block: 'center' });
  if (!autoSubmit) return 'needs-user';

  // Give an auto-running check up to 8 s to produce its token; sites that run the check on submit get the click anyway.
  const token = () => document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"], [name="g-recaptcha-response"]')?.value;
  if (document.querySelector('[data-sitekey], .cf-turnstile')) {
    for (let i = 0; i < 40 && !token(); i++) await new Promise((r) => setTimeout(r, 200));
  }
  const button = form.querySelector<HTMLElement>('[type="submit"]');
  if (button) button.click();
  else form.requestSubmit();
  return 'submitted';
}

export class TabIO implements PageIO {
  constructor(readonly tabId: number) {}

  async request(req: PageRequest): Promise<PageResponse> {
    const [r] = await browser.scripting.executeScript({
      target: { tabId: this.tabId },
      world: 'MAIN',
      func: pageFetch,
      args: [req],
    });
    const res = r?.result as PageResponse | undefined;
    return res ?? { ok: false, status: 0, url: req.url, text: '', error: 'tab did not respond' };
  }

  async globals(names: string[]): Promise<Record<string, string | null>> {
    const [r] = await browser.scripting.executeScript({
      target: { tabId: this.tabId },
      world: 'MAIN',
      func: readGlobals,
      args: [names],
    });
    return (r?.result as Record<string, string | null>) ?? {};
  }

  async harvest(): Promise<Harvest | null> {
    const [r] = await browser.scripting.executeScript({ target: { tabId: this.tabId }, world: 'MAIN', func: harvestForm });
    return (r?.result as Harvest | null | undefined) ?? null;
  }

  async html(): Promise<string> {
    const [r] = await browser.scripting.executeScript({ target: { tabId: this.tabId }, func: readHtml });
    return (r?.result as string) ?? '';
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

/**
 * A loaded tab on the platform's origin to run requests from: the preferred (problem) tab,
 * any other open tab of that site, or a new background tab that is closed again on release().
 */
export async function acquireTab(origin: string, preferredTabId?: number): Promise<{ io: TabIO; release: () => void }> {
  const noop = () => {};
  if (preferredTabId != null && (await isUsable(preferredTabId, origin))) return { io: new TabIO(preferredTabId), release: noop };
  const tabs = await browser.tabs.query({ url: `${origin}/*` });
  const open = tabs.find((t) => t.id != null && t.status === 'complete' && !t.discarded);
  if (open?.id != null) return { io: new TabIO(open.id), release: noop };
  const created = await browser.tabs.create({ url: `${origin}/`, active: false });
  const id = created.id!;
  await waitForTabComplete(id);
  return { io: new TabIO(id), release: () => void browser.tabs.remove(id).catch(noop) };
}
