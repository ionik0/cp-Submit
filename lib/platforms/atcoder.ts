import { decodeBase64Utf8, hasHumanCheck, hiddenInputs, isChallenge, isSubmitPage, mergeFields, parseHtml, preText, textOf } from '../html';
import { toLanguages } from '../languages';
import type { Problem, RunResult, SubmitOutcome, Verdict } from '../types';
import { type Platform, parseJson, pollDelay, sleep } from './platform';

const ORIGIN = 'https://atcoder.jp';

export function parseAcUrl(url: string): { contestId: string; task: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== 'atcoder.jp') return null;
  const m = u.pathname.match(/^\/contests\/([\w-]+)\/tasks\/([\w-]+)\/?$/);
  return m ? { contestId: m[1]!, task: m[2]! } : null;
}

const SAMPLE_RE = /^\s*(Sample Input|Sample Output|入力例|出力例)\s*(\d+)/;

function parseSamples(doc: Document) {
  const statement = doc.querySelector('#task-statement');
  const scope = statement?.querySelector('.lang-en') ?? statement;
  const inputs = new Map<number, string>();
  const outputs = new Map<number, string>();
  for (const h3 of Array.from(scope?.querySelectorAll('h3') ?? [])) {
    const m = (h3.textContent ?? '').match(SAMPLE_RE);
    const pre = m && h3.parentElement?.querySelector('pre');
    if (!m || !pre) continue;
    const isInput = /Input|入力/.test(m[1]!);
    (isInput ? inputs : outputs).set(Number(m[2]), preText(pre));
  }
  return [...inputs.keys()]
    .sort((a, b) => a - b)
    .map((n) => ({ input: inputs.get(n)!, output: outputs.get(n) ?? '' }));
}

export function parseAcVerdictRow(row: Element): Verdict | null {
  const link = Array.from(row.querySelectorAll('a[href*="/submissions/"]'))
    .map((a) => a.getAttribute('href')?.match(/\/submissions\/(\d+)$/)?.[1])
    .find(Boolean);
  const label = row.querySelector('td span.label');
  if (!link || !label) return null;
  const td = label.closest('td');
  const short = textOf(label);
  const final = !td?.classList.contains('waiting-judge') && !/^(WJ|WR)\b|Judging|\d+\s*\/\s*\d+/i.test(short);
  const title = label.getAttribute('title') ?? label.getAttribute('data-original-title');
  const after = td ? Array.from(row.children).slice(Array.from(row.children).indexOf(td) + 1).map((c) => textOf(c)) : [];
  return {
    id: link,
    label: final && title ? `${title} (${short})` : short,
    final,
    ok: final && short === 'AC',
    time: after.find((t) => /\bms$/.test(t)),
    memory: after.find((t) => /(KiB|KB|MiB)$/.test(t)),
  };
}

/** Parses the status `<td>` cells returned by AtCoder's status JSON, reusing the row parser. */
export function parseAcStatusCells(html: string, id: string): Verdict | null {
  const doc = parseHtml(`<table><tbody><tr>${html}<td><a href="/submissions/${id}"></a></td></tr></tbody></table>`);
  return parseAcVerdictRow(doc.querySelector('tr')!);
}

function normalizeNl(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

interface AcCustomResult {
  Result?: {
    SourceCode?: string;
    Input?: string;
    Output?: string;
    Error?: string;
    ExitCode?: number;
    Status?: number;
    TimeConsumption?: number;
    MemoryConsumption?: number;
  };
  Stdout?: string;
  Stderr?: string;
}

/** AtCoder returns some fields base64-encoded; decide by checking which form reproduces our own source. */
export function readAcCustomResult(j: AcCustomResult, code: string, input: string): RunResult | null {
  const r = j.Result;
  if (!r || r.Status !== 3) return null;
  const want = normalizeNl(code).trim();
  const raw = normalizeNl(r.SourceCode ?? '').trim();
  let b64: boolean;
  if (raw === want) b64 = false;
  else if (normalizeNl(decodeBase64Utf8(r.SourceCode ?? '') ?? '').trim() === want) b64 = true;
  else return null; // result belongs to an older run
  const dec = (s: string | undefined) => (s == null ? '' : b64 ? (decodeBase64Utf8(s) ?? s) : s);
  if (r.Input != null && normalizeNl(dec(r.Input)).trim() !== normalizeNl(input).trim()) return null;
  const stdout = r.Output != null ? dec(r.Output) : (j.Stdout ?? '');
  const stderr = r.Error != null ? dec(r.Error) : (j.Stderr ?? '');
  const exit = r.ExitCode ?? 0;
  const parts = [`exit ${exit}`];
  if (r.TimeConsumption != null && r.TimeConsumption >= 0) parts.push(`${r.TimeConsumption} ms`);
  if (r.MemoryConsumption != null && r.MemoryConsumption >= 0) parts.push(`${r.MemoryConsumption} KiB`);
  let status: RunResult['status'] = 'OK';
  if (exit !== 0) status = /compil|error:|syntaxerror/i.test(stderr) && !stdout ? 'CE' : 'RE';
  if (exit === 9 || (r.TimeConsumption ?? 0) > 10_000) status = 'TLE';
  return { status, stdout, stderr: stderr || undefined, info: parts.join(' · ') };
}

export const atcoder: Platform = {
  id: 'atcoder',
  label: 'AtCoder',
  origin: ORIGIN,

  isProblemUrl: (url) => parseAcUrl(url) !== null,

  parseProblem(doc, url) {
    const ref = parseAcUrl(url);
    if (!ref || !doc.querySelector('#task-statement')) return null;
    const titleEl = doc.querySelector('span.h2')?.cloneNode(true) as Element | undefined;
    titleEl?.querySelectorAll('a, .btn').forEach((e) => e.remove());
    const limits = Array.from(doc.querySelectorAll('p'), (p) => textOf(p)).find((t) => /Time Limit|実行時間制限/.test(t)) ?? '';
    const lm = limits.match(/(?:Time Limit|実行時間制限)\s*:\s*([^/]+?)\s*\/\s*(?:Memory Limit|メモリ制限)\s*:\s*(.+)$/);
    const headings = Array.from(doc.querySelectorAll('#task-statement h3'), (h) => textOf(h));
    return {
      platform: 'atcoder',
      key: `ac:${ref.task}`,
      url,
      name: textOf(titleEl) || ref.task,
      contestId: ref.contestId,
      index: ref.task,
      base: `contests/${ref.contestId}`,
      kind: 'contest',
      timeLimit: lm?.[1],
      memoryLimit: lm?.[2],
      samples: parseSamples(doc),
      interactive: headings.some((h) => /^(Input and Output|入出力)$/.test(h)),
    };
  },

  submitPageUrl: (p) => `${ORIGIN}/${p.base}/submit?taskScreenName=${encodeURIComponent(p.index)}`,

  isLoginRedirect: (url) => /atcoder\.jp\/login/.test(url),

  parseSubmitPage(doc, html, p) {
    const form = doc.querySelector('textarea[name="sourceCode"]')?.closest('form') ?? null;
    const select =
      doc.querySelector(`#select-lang-${CSS.escape(p.index)} select`) ?? doc.querySelector('select[name="data.LanguageId"]');
    const options = Array.from(select?.querySelectorAll('option') ?? [], (o) => ({ value: o.value, text: o.textContent ?? '' }));
    const user = html.match(/userScreenName\s*=\s*"([^"]*)"/)?.[1] || null;
    const csrf =
      doc.querySelector<HTMLInputElement>('input[name="csrf_token"]')?.value ?? html.match(/csrfToken\s*=\s*"([^"]+)"/)?.[1] ?? '';
    return {
      languages: toLanguages(options),
      csrf,
      user,
      humanCheck: hasHumanCheck(doc),
      hidden: hiddenInputs(form),
      action: form?.getAttribute('action') ?? '',
    };
  },

  async submit(io, p, ctx, langId, code): Promise<SubmitOutcome> {
    const fields = mergeFields(ctx.hidden, [
      ['data.TaskScreenName', p.index],
      ['data.LanguageId', langId],
      ['sourceCode', code],
      ['csrf_token', ctx.csrf],
    ]);
    const url = new URL(ctx.action || `/${p.base}/submit`, ORIGIN).href;
    const res = await io.request({ url, method: 'POST', form: fields });
    if (!res.ok) return { kind: 'error', message: `Network error: ${res.error}` };
    if (isChallenge(res)) return { kind: 'challenge' };
    if (atcoder.isLoginRedirect(res.url)) return { kind: 'logged-out' };
    const doc = parseHtml(res.text);
    if (!isSubmitPage(res.url)) {
      const row = Array.from(doc.querySelectorAll('table tbody tr')).map(parseAcVerdictRow).find(Boolean);
      return { kind: 'submitted', submissionId: row?.id ?? null };
    }
    const msg = Array.from(doc.querySelectorAll('.alert-danger, .alert-warning'), (e) => textOf(e).replace(/^×\s*/, ''))
      .filter((m) => m && !/^error\.?$/i.test(m));
    // A bare "Error." is AtCoder's answer to a missing Turnstile token: submit through the real page instead.
    if (hasHumanCheck(doc) || !msg.length) return { kind: 'challenge' };
    return { kind: 'error', message: msg.join(' · ') };
  },

  async fetchVerdict(io, p, id) {
    if (id) {
      // The small JSON endpoint AtCoder's own submissions page polls; fall back to the full page if it changes.
      const res = await io.request({ url: `${ORIGIN}/${p.base}/submissions/me/status/json?sids[]=${id}` });
      const cells = parseJson<{ Result?: Record<string, { Html?: string }> }>(res)?.Result?.[id]?.Html;
      const v = cells && parseAcStatusCells(cells, id);
      if (v) return v;
    }
    const url = `${ORIGIN}/${p.base}/submissions/me?f.Task=${encodeURIComponent(p.index)}`;
    const res = await io.request({ url });
    if (!res.ok || isChallenge(res)) return null;
    const rows = Array.from(parseHtml(res.text).querySelectorAll('table tbody tr'))
      .map(parseAcVerdictRow)
      .filter((v): v is Verdict => v !== null);
    return (id ? rows.find((v) => v.id === id) : rows[0]) ?? null;
  },

  async runTest(io, p, ctx, langId, code, input, signal): Promise<RunResult> {
    const res = await io.request({
      url: `${ORIGIN}/${p.base}/custom_test/submit/json`,
      method: 'POST',
      form: [
        ['data.LanguageId', langId],
        ['sourceCode', code],
        ['input', input],
        ['csrf_token', ctx.csrf],
      ],
    });
    if (!res.ok) return { status: 'ERR', stdout: '', info: `Network error: ${res.error}` };
    if (isChallenge(res)) return { status: 'ERR', stdout: '', info: 'Cloudflare check pending — pass it in an AtCoder tab, then retry.' };
    if (res.status >= 400) {
      const err = parseJson<{ error?: string }>(res)?.error;
      return { status: 'ERR', stdout: '', info: err ?? `Custom test rejected (HTTP ${res.status}).` };
    }
    const deadline = Date.now() + 60_000;
    for (let i = 0; Date.now() < deadline; i++) {
      await sleep(pollDelay(i), signal);
      const poll = await io.request({ url: `${ORIGIN}/${p.base}/custom_test/json?reload=true` });
      const j = parseJson<AcCustomResult>(poll);
      const r = j && readAcCustomResult(j, code, input);
      if (r) return r;
    }
    return { status: 'ERR', stdout: '', info: 'Timed out waiting for AtCoder custom test.' };
  },

  formSpec: (p, langId) => ({
    values: [
      ['select[name="data.TaskScreenName"]', p.index],
      ['select[name="data.LanguageId"]', langId],
    ],
    codeSelector: 'textarea[name="sourceCode"]',
  }),
};
