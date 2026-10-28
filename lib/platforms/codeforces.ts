import { hasHumanCheck, hiddenInputs, isChallenge, isSubmitPage, mergeFields, parseHtml, preText, textOf } from '../html';
import { toLanguages } from '../languages';
import type { PageIO, Problem, RunResult, SubmitContext, SubmitOutcome, Verdict } from '../types';
import { type Platform, parseJson, pollDelay, sleep } from './platform';

const ORIGIN = 'https://codeforces.com';
// Static browser-fingerprint value the CF web client sends; used only if the page didn't expose its own.
const DEFAULT_BFAA = 'f1b3f18c715565b589b7823cda7448ce';

interface CfRef {
  kind: Problem['kind'];
  base: string;
  contestId: string;
  index: string;
}

export function parseCfUrl(url: string): CfRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== 'codeforces.com') return null;
  let m = u.pathname.match(/^\/((?:group\/[\w-]+\/)?(contest|gym)\/(\d+))\/problem\/(\w+)\/?$/);
  if (m) return { kind: m[2] as 'contest' | 'gym', base: m[1]!, contestId: m[3]!, index: m[4]!.toUpperCase() };
  m = u.pathname.match(/^\/problemset\/problem\/(\d+)\/(\w+)\/?$/);
  if (m) return { kind: 'problemset', base: 'problemset', contestId: m[1]!, index: m[2]!.toUpperCase() };
  return null;
}

function propertyValue(el: Element | null): string | undefined {
  if (!el) return undefined;
  const c = el.cloneNode(true) as Element;
  c.querySelector('.property-title')?.remove();
  return textOf(c) || undefined;
}

function myUrl(p: Problem): string {
  return p.kind === 'problemset' ? `${ORIGIN}/problemset/status?my=on` : `${ORIGIN}/${p.base}/my`;
}

function csrfFrom(doc: Document): string {
  return (
    doc.querySelector('meta[name="X-Csrf-Token"]')?.getAttribute('content') ??
    doc.querySelector('.csrf-token')?.getAttribute('data-csrf') ??
    doc.querySelector<HTMLInputElement>('input[name="csrf_token"]')?.value ??
    ''
  );
}

function randomFtaa(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => chars[b % chars.length]).join('');
}

export function parseCfVerdictRow(row: Element): Verdict {
  const cell = row.querySelector('td.status-verdict-cell') ?? row.querySelector('.submissionVerdictWrapper')?.closest('td');
  const label = textOf(cell) || 'In queue';
  const waiting = cell?.getAttribute('waiting') === 'true';
  const final = !waiting && !/in queue|running|testing|judging|pending/i.test(label);
  const ok = !!cell?.querySelector('.verdict-accepted') || /^(accepted|pretests passed|happy new year)/i.test(label);
  return {
    id: row.getAttribute('data-submission-id') ?? '',
    label,
    final,
    ok: final && ok,
    time: textOf(row.querySelector('.time-consumed-cell')) || undefined,
    memory: textOf(row.querySelector('.memory-consumed-cell')) || undefined,
  };
}

function rowMatchesProblem(row: Element, p: Problem): boolean {
  return Array.from(row.querySelectorAll('a[href*="/problem/"]')).some((a) => {
    const href = a.getAttribute('href') ?? '';
    return (
      new RegExp(`/${p.contestId}/problem/${p.index}$`, 'i').test(href) ||
      new RegExp(`/problem/${p.contestId}/${p.index}$`, 'i').test(href)
    );
  });
}

export const codeforces: Platform = {
  id: 'codeforces',
  label: 'Codeforces',
  origin: ORIGIN,

  isProblemUrl: (url) => parseCfUrl(url) !== null,

  parseProblem(doc, url) {
    const ref = parseCfUrl(url);
    const st = doc.querySelector('.problem-statement');
    if (!ref || !st) return null;
    const inputs = st.querySelectorAll('.sample-test .input pre');
    const outputs = st.querySelectorAll('.sample-test .output pre');
    const samples = Array.from(inputs, (pre, i) => ({
      input: preText(pre),
      output: outputs[i] ? preText(outputs[i]) : '',
    }));
    const sectionTitles = Array.from(st.querySelectorAll('.section-title'), (e) => textOf(e));
    return {
      platform: 'codeforces',
      key: `cf:${ref.contestId}${ref.index}`,
      url,
      name: textOf(st.querySelector('.header .title')) || `${ref.contestId}${ref.index}`,
      contestId: ref.contestId,
      index: ref.index,
      base: ref.base,
      kind: ref.kind,
      timeLimit: propertyValue(st.querySelector('.header .time-limit')),
      memoryLimit: propertyValue(st.querySelector('.header .memory-limit')),
      samples,
      interactive: sectionTitles.some((t) => /^interaction/i.test(t)),
    };
  },

  submitPageUrl: (p) => (p.kind === 'problemset' ? `${ORIGIN}/problemset/submit` : `${ORIGIN}/${p.base}/submit`),

  isLoginRedirect: (url) => /codeforces\.com\/enter/.test(url),

  parseSubmitPage(doc, html) {
    const form = doc.querySelector('form.submit-form') ?? doc.querySelector('select[name="programTypeId"]')?.closest('form') ?? null;
    const select = form?.querySelector('select[name="programTypeId"]');
    const options = Array.from(select?.querySelectorAll('option') ?? [], (o) => ({ value: o.value, text: o.textContent ?? '' }));
    const user =
      html.match(/var handle = "([^"]+)"/)?.[1] ??
      doc.querySelector('.lang-chooser a[href^="/profile/"]')?.getAttribute('href')?.slice('/profile/'.length) ??
      null;
    return {
      languages: toLanguages(options),
      csrf: csrfFrom(doc),
      user,
      humanCheck: hasHumanCheck(doc),
      hidden: hiddenInputs(form),
      action: form?.getAttribute('action') ?? '',
    };
  },

  async submit(io, p, ctx, langId, code): Promise<SubmitOutcome> {
    const g = await io.globals(['_ftaa', '_bfaa']);
    const submitPage = codeforces.submitPageUrl(p);
    const action = new URL(ctx.action || `?csrf_token=${ctx.csrf}`, submitPage).href;
    const fields = mergeFields(ctx.hidden, [
      ['csrf_token', ctx.csrf],
      ['ftaa', g._ftaa || randomFtaa()],
      ['bfaa', g._bfaa || DEFAULT_BFAA],
      ['action', 'submitSolutionFormSubmitted'],
      p.kind === 'problemset' ? ['submittedProblemCode', `${p.contestId}${p.index}`] : ['submittedProblemIndex', p.index],
      ['programTypeId', langId],
      ['source', code],
      ['tabSize', '4'],
      ['sourceCodeConfirmed', 'true'],
      ['_tta', '594'],
    ]);
    const res = await io.request({ url: action, method: 'POST', form: fields, multipart: true });
    if (!res.ok) return { kind: 'error', message: `Network error: ${res.error}` };
    if (isChallenge(res)) return { kind: 'challenge' };
    if (codeforces.isLoginRedirect(res.url)) return { kind: 'logged-out' };
    const doc = parseHtml(res.text);
    if (!isSubmitPage(res.url)) {
      const row = doc.querySelector('tr[data-submission-id]');
      return { kind: 'submitted', submissionId: row?.getAttribute('data-submission-id') ?? null };
    }
    if (res.status === 429) return { kind: 'error', message: 'Rate limited by Codeforces — wait a few seconds.' };
    const errors = Array.from(doc.querySelectorAll('span.error'), (e) => textOf(e)).filter(Boolean);
    // No field error to show means the form wanted something we can't send (e.g. a human check): use the real page.
    if (hasHumanCheck(doc) || !errors.length) return { kind: 'challenge' };
    return { kind: 'error', message: errors.join(' · ') };
  },

  async fetchVerdict(io, p, id) {
    const res = await io.request({ url: myUrl(p) });
    if (!res.ok || isChallenge(res)) return null;
    const rows = Array.from(parseHtml(res.text).querySelectorAll('tr[data-submission-id]'));
    const row = id ? rows.find((r) => r.getAttribute('data-submission-id') === id) : rows.find((r) => rowMatchesProblem(r, p));
    return row ? parseCfVerdictRow(row) : null;
  },

  async runTest(io, p, ctx, langId, code, input, signal): Promise<RunResult> {
    const url = `${ORIGIN}/data/customtest`;
    const headers = { 'X-Csrf-Token': ctx.csrf };
    const res = await io.request({
      url,
      method: 'POST',
      headers,
      form: [
        ['action', 'submitSourceCode'],
        ['csrf_token', ctx.csrf],
        ['source', code],
        ['sourceCode', code],
        ['tabSize', '4'],
        ['input', input],
        ['programTypeId', langId],
        ['communityCode', ''],
      ],
    });
    if (!res.ok) return { status: 'ERR', stdout: '', info: `Network error: ${res.error}` };
    if (isChallenge(res)) return { status: 'ERR', stdout: '', info: 'Cloudflare check pending — pass it in a Codeforces tab, then retry.' };
    const sub = parseJson<{ customTestSubmitId?: number | string; error?: string }>(res);
    const submitId = sub?.customTestSubmitId;
    if (!submitId) return { status: 'ERR', stdout: '', info: sub?.error ?? `Custom invocation rejected (HTTP ${res.status}).` };

    const deadline = Date.now() + 60_000;
    for (let i = 0; Date.now() < deadline; i++) {
      await sleep(pollDelay(i), signal);
      const poll = await io.request({
        url,
        method: 'POST',
        headers,
        form: [
          ['action', 'getVerdict'],
          ['customTestSubmitId', String(submitId)],
          ['csrf_token', ctx.csrf],
          ['communityCode', ''],
        ],
      });
      const r = parseJson<{ output?: string | null; stat?: string; verdict?: string }>(poll);
      if (!r || r.output == null) continue;
      return classifyCfRun(r.output, r.stat ?? '', r.verdict);
    }
    return { status: 'ERR', stdout: '', info: 'Timed out waiting for Codeforces custom invocation.' };
  },

  formSpec: (p, langId) => ({
    values: [
      ['select[name="programTypeId"]', langId],
      ['select[name="submittedProblemIndex"]', p.index],
      ['input[name="submittedProblemCode"]', p.contestId + p.index],
    ],
    codeSelector: 'textarea[name="source"]',
  }),
};

export function classifyCfRun(output: string, stat: string, verdict?: string): RunResult {
  const all = `${verdict ?? ''}\n${stat}\n${output}`;
  const exit = stat.match(/exit code is (-?\d+)/i)?.[1];
  let status: RunResult['status'] = 'OK';
  if (/compilation error|can't compile|compilation failed/i.test(all)) status = 'CE';
  else if (/time limit|idleness/i.test(all)) status = 'TLE';
  else if ((exit && exit !== '0') || /runtime error|memory limit/i.test(`${verdict ?? ''}\n${stat}`)) status = 'RE';
  return { status, stdout: output, info: stat.replace(/=+/g, '').trim() || undefined };
}
