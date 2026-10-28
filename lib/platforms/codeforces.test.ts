import { describe, expect, it } from 'vitest';
import { isChallenge, parseHtml } from '../html';
import type { PageIO, PageRequest, PageResponse, Problem } from '../types';
import { classifyCfRun, codeforces, parseCfUrl, parseCfVerdictRow } from './codeforces';

const PROBLEM_HTML = `
<div class="problem-statement">
  <div class="header">
    <div class="title">A. Watermelon</div>
    <div class="time-limit"><div class="property-title">time limit per test</div>1 second</div>
    <div class="memory-limit"><div class="property-title">memory limit per test</div>64 megabytes</div>
  </div>
  <div class="sample-tests"><div class="sample-test">
    <div class="input"><div class="title">Input</div><pre><div class="test-example-line">3</div><div class="test-example-line">1 2 3</div></pre></div>
    <div class="output"><div class="title">Output</div><pre>YES<br>NO</pre></div>
  </div></div>
</div>`;

const SUBMIT_HTML = `
<html><head><meta name="X-Csrf-Token" content="tok123"></head><body>
<div class="lang-chooser"><a href="/profile/tourist">tourist</a></div>
<script>var handle = "tourist";</script>
<form class="submit-form" method="post" action="/contest/4/submit?csrf_token=tok123" enctype="multipart/form-data">
  <input type="hidden" name="csrf_token" value="tok123">
  <input type="hidden" name="ftaa" value="">
  <input type="hidden" name="bfaa" value="">
  <input type="hidden" name="action" value="submitSolutionFormSubmitted">
  <input type="hidden" name="newFieldFromServer" value="42">
  <select name="submittedProblemIndex"><option value="A">A</option></select>
  <select name="programTypeId">
    <option value="89">GNU G++20 13.2 (64 bit, winlibs)</option>
    <option value="31">Python 3.13.2</option>
    <option value="70">PyPy 3.10 (7.3.15, 64bit)</option>
  </select>
  <textarea name="source"></textarea>
</form></body></html>`;

class FakeIO implements PageIO {
  requests: PageRequest[] = [];
  constructor(private reply: (r: PageRequest) => PageResponse) {}
  async request(r: PageRequest) {
    this.requests.push(r);
    return this.reply(r);
  }
  async globals() {
    return { _ftaa: 'pageftaa', _bfaa: 'pagebfaa' };
  }
}

function problem(): Problem {
  const url = 'https://codeforces.com/contest/4/problem/A';
  return codeforces.parseProblem(parseHtml(PROBLEM_HTML), url)!;
}

describe('codeforces urls', () => {
  it.each([
    ['https://codeforces.com/contest/4/problem/A', { kind: 'contest', base: 'contest/4', contestId: '4', index: 'A' }],
    ['https://codeforces.com/problemset/problem/1950/b1', { kind: 'problemset', base: 'problemset', contestId: '1950', index: 'B1' }],
    ['https://codeforces.com/gym/104114/problem/C', { kind: 'gym', base: 'gym/104114', contestId: '104114', index: 'C' }],
    ['https://codeforces.com/group/AbC/contest/123/problem/D', { kind: 'contest', base: 'group/AbC/contest/123', contestId: '123', index: 'D' }],
  ])('%s', (url, ref) => expect(parseCfUrl(url)).toEqual(ref));

  it('rejects non-problem pages', () => {
    expect(parseCfUrl('https://codeforces.com/contest/4/standings')).toBeNull();
    expect(parseCfUrl('https://evil.com/contest/4/problem/A')).toBeNull();
  });
});

describe('codeforces parsing', () => {
  it('parses statement header and samples', () => {
    const p = problem();
    expect(p.name).toBe('A. Watermelon');
    expect(p.timeLimit).toBe('1 second');
    expect(p.memoryLimit).toBe('64 megabytes');
    expect(p.key).toBe('cf:4A');
    expect(p.samples).toEqual([{ input: '3\n1 2 3\n', output: 'YES\nNO\n' }]);
  });

  it('parses submit page context', () => {
    const doc = parseHtml(SUBMIT_HTML);
    const ctx = codeforces.parseSubmitPage(doc, SUBMIT_HTML, problem());
    expect(ctx.user).toBe('tourist');
    expect(ctx.csrf).toBe('tok123');
    expect(ctx.humanCheck).toBe(false);
    expect(ctx.languages.map((l) => [l.id, l.family])).toEqual([
      ['89', 'cpp'],
      ['31', 'python'],
      ['70', 'python'],
    ]);
  });

  it('flags a turnstile widget inside the submit form', () => {
    const html = SUBMIT_HTML.replace('<textarea', '<div class="cf-turnstile" data-sitekey="x"></div><textarea');
    expect(codeforces.parseSubmitPage(parseHtml(html), html, problem()).humanCheck).toBe(true);
  });
});

describe('codeforces submit', () => {
  const ctx = () => codeforces.parseSubmitPage(parseHtml(SUBMIT_HTML), SUBMIT_HTML, problem());

  it('posts the form with page fingerprints and server hidden fields, then reads the submission id', async () => {
    const io = new FakeIO(() => ({
      ok: true,
      status: 200,
      url: 'https://codeforces.com/contest/4/my',
      text: '<table><tr data-submission-id="999"><td class="status-verdict-cell" waiting="true">In queue</td></tr></table>',
    }));
    const out = await codeforces.submit(io, problem(), ctx(), '89', 'int main(){}');
    expect(out).toEqual({ kind: 'submitted', submissionId: '999' });
    const req = io.requests[0]!;
    expect(req.url).toBe('https://codeforces.com/contest/4/submit?csrf_token=tok123');
    expect(req.multipart).toBe(true);
    const f = Object.fromEntries(req.form!);
    expect(f).toMatchObject({
      csrf_token: 'tok123',
      ftaa: 'pageftaa',
      bfaa: 'pagebfaa',
      submittedProblemIndex: 'A',
      programTypeId: '89',
      source: 'int main(){}',
      newFieldFromServer: '42',
    });
  });

  it('reports duplicate-code errors from the re-rendered form', async () => {
    const io = new FakeIO(() => ({
      ok: true,
      status: 200,
      url: 'https://codeforces.com/contest/4/submit?csrf_token=tok123',
      text: '<form class="submit-form"><span class="error for__source">You have submitted exactly the same code before</span></form>',
    }));
    const out = await codeforces.submit(io, problem(), ctx(), '89', 'x');
    expect(out).toEqual({ kind: 'error', message: 'You have submitted exactly the same code before' });
  });

  it('detects a Cloudflare challenge response', async () => {
    const text = '<html><head><title>Just a moment...</title></head><script src="/cdn-cgi/challenge-platform/x"></script></html>';
    expect(isChallenge({ ok: true, status: 403, url: '', text })).toBe(true);
    const io = new FakeIO(() => ({ ok: true, status: 403, url: 'https://codeforces.com/contest/4/submit', text }));
    expect(await codeforces.submit(io, problem(), ctx(), '89', 'x')).toEqual({ kind: 'challenge' });
  });

  it('detects login redirects', async () => {
    const io = new FakeIO(() => ({ ok: true, status: 200, url: 'https://codeforces.com/enter?back=x', text: '' }));
    expect(await codeforces.submit(io, problem(), ctx(), '89', 'x')).toEqual({ kind: 'logged-out' });
  });
});

describe('codeforces verdicts', () => {
  const row = (cell: string) => parseHtml(`<table><tr data-submission-id="5">${cell}<td class="time-consumed-cell">15 ms</td><td class="memory-consumed-cell">0 KB</td></tr></table>`).querySelector('tr')!;

  it('treats running verdicts as not final', () => {
    const v = parseCfVerdictRow(row('<td class="status-verdict-cell" waiting="true">Running on test 3</td>'));
    expect(v).toMatchObject({ id: '5', final: false, ok: false });
  });
  it('reads accepted verdicts', () => {
    const v = parseCfVerdictRow(row('<td class="status-verdict-cell" waiting="false"><span class="verdict-accepted">Accepted</span></td>'));
    expect(v).toMatchObject({ final: true, ok: true, label: 'Accepted', time: '15 ms' });
  });
  it('reads rejections', () => {
    const v = parseCfVerdictRow(row('<td class="status-verdict-cell" waiting="false">Wrong answer on test 2</td>'));
    expect(v).toMatchObject({ final: true, ok: false, label: 'Wrong answer on test 2' });
  });
});

describe('codeforces custom invocation results', () => {
  it('classifies runs', () => {
    expect(classifyCfRun('4\n', '=====\nUsed: 15 ms, 4 KB', undefined).status).toBe('OK');
    expect(classifyCfRun('', 'Compilation error', undefined).status).toBe('CE');
    expect(classifyCfRun('', '=====\nUsed: 15 ms, 4 KB\nExit code is 3', undefined).status).toBe('RE');
    expect(classifyCfRun('', 'Time limit exceeded', undefined).status).toBe('TLE');
  });
});
