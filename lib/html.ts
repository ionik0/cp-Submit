import type { PageResponse } from './types';

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const CHALLENGE_RE = /challenge-platform|cf_chl_opt|cf-chl-|<title>\s*Just a moment|Attention Required! \| Cloudflare/i;

/** True when the response is a Cloudflare interstitial instead of the real page. */
export function isChallenge(res: PageResponse): boolean {
  return CHALLENGE_RE.test(res.text.slice(0, 20000));
}

// AtCoder mounts Turnstile as `<div class="cf-challenge" data-sitekey=…>`, so match by sitekey/script, not just class.
const HUMAN_CHECK =
  '[data-sitekey], .cf-turnstile, [name="cf-turnstile-response"], [name="turnstileToken"], .g-recaptcha, iframe[src*="challenges.cloudflare.com"], script[src*="challenges.cloudflare.com/turnstile"]';

export function hasHumanCheck(scope: ParentNode | null): boolean {
  return !!scope?.querySelector(HUMAN_CHECK);
}

/** True when the URL is a submit form page (`/submit`), not e.g. `/submissions/me`. */
export function isSubmitPage(url: string): boolean {
  return /\/submit\/?$/.test(new URL(url).pathname);
}

export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Text of a `<pre>` sample block, honouring <br> and Codeforces' per-line `.test-example-line` divs. */
export function preText(pre: Element): string {
  const lines = pre.querySelectorAll('.test-example-line');
  let text: string;
  if (lines.length) {
    text = Array.from(lines, (l) => l.textContent ?? '').join('\n');
  } else {
    const c = pre.cloneNode(true) as Element;
    c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    text = c.textContent ?? '';
  }
  text = text.replace(/\r\n?/g, '\n').replace(/^\n+/, '');
  return text.endsWith('\n') ? text : text + '\n';
}

export function hiddenInputs(form: Element | null): [string, string][] {
  if (!form) return [];
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]'), (i) => [
    i.name,
    i.value,
  ]);
}

/** Merges overrides into the form's own hidden fields, keeping field order. */
export function mergeFields(base: [string, string][], overrides: [string, string][]): [string, string][] {
  const m = new Map(base);
  for (const [k, v] of overrides) m.set(k, v);
  return [...m];
}

export function decodeBase64Utf8(s: string): string | null {
  try {
    const bin = atob(s);
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}
