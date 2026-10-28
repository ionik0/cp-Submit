import { describe, expect, it } from 'vitest';
import { parseHtml } from '../html';
import { atcoder, parseAcUrl, parseAcVerdictRow, readAcCustomResult } from './atcoder';

const TASK_HTML = `
<span class="h2">A - Product <a class="btn btn-default btn-sm">Editorial</a></span>
<p>Time Limit: 2 sec / Memory Limit: 256 MiB</p>
<div id="task-statement"><span class="lang">
<span class="lang-ja"><div class="part"><section><h3>入力例 1</h3><pre>9 9</pre></section></div></span>
<span class="lang-en">
  <div class="part"><section><h3>Sample Input 1<span class="btn-copy">Copy</span></h3><pre>3 4
</pre></section></div>
  <div class="part"><section><h3>Sample Output 1<span class="btn-copy">Copy</span></h3><pre>Even
</pre></section></div>
  <div class="part"><section><h3>Sample Input 2<span class="btn-copy">Copy</span></h3><pre>1 21
</pre></section></div>
  <div class="part"><section><h3>Sample Output 2<span class="btn-copy">Copy</span></h3><pre>Odd
</pre></section></div>
</span></span></div>`;

const URL_ = 'https://atcoder.jp/contests/abc086/tasks/abc086_a';

describe('atcoder', () => {
  it('parses urls', () => {
    expect(parseAcUrl(URL_)).toEqual({ contestId: 'abc086', task: 'abc086_a' });
    expect(parseAcUrl('https://atcoder.jp/contests/abc086/submissions/me')).toBeNull();
  });

  it('parses the task page (English samples only)', () => {
    const p = atcoder.parseProblem(parseHtml(TASK_HTML), URL_)!;
    expect(p.name).toBe('A - Product');
    expect(p.timeLimit).toBe('2 sec');
    expect(p.memoryLimit).toBe('256 MiB');
    expect(p.samples).toEqual([
      { input: '3 4\n', output: 'Even\n' },
      { input: '1 21\n', output: 'Odd\n' },
    ]);
    expect(atcoder.submitPageUrl(p)).toBe('https://atcoder.jp/contests/abc086/submit?taskScreenName=abc086_a');
  });

  it('parses submit context and detects logged-out pages', () => {
    const p = atcoder.parseProblem(parseHtml(TASK_HTML), URL_)!;
    const html = `<script>var csrfToken = "abc"; var userScreenName = "chokudai";</script>
      <form action="/contests/abc086/submit" method="POST">
        <select name="data.TaskScreenName"><option value="abc086_a">A</option></select>
        <div id="select-lang-abc086_a"><select name="data.LanguageId"><option></option><option value="6017">C++ 20 (gcc 12.2)</option><option value="5055">Python (CPython 3.11.4)</option></select></div>
        <textarea name="sourceCode"></textarea>
        <input type="hidden" name="csrf_token" value="abc">
      </form>`;
    const ctx = atcoder.parseSubmitPage(parseHtml(html), html, p);
    expect(ctx).toMatchObject({ user: 'chokudai', csrf: 'abc', humanCheck: false, action: '/contests/abc086/submit' });
    expect(ctx.languages.map((l) => l.family)).toEqual(['cpp', 'python']);
    const anon = html.replace('chokudai', '');
    expect(atcoder.parseSubmitPage(parseHtml(anon), anon, p).user).toBeNull();
  });

  it('detects AtCoder’s Turnstile widget and treats a bare "Error." as a human-check rejection', async () => {
    const p = atcoder.parseProblem(parseHtml(TASK_HTML), URL_)!;
    const widget = '<div class="cf-challenge" data-sitekey="0x4AAA" data-theme="light"></div>';
    const html = `<script>var userScreenName = "me";</script><form><textarea name="sourceCode"></textarea></form>${widget}`;
    expect(atcoder.parseSubmitPage(parseHtml(html), html, p).humanCheck).toBe(true);

    const ctx = { languages: [], csrf: 'x', user: 'me', humanCheck: false, hidden: [], action: '' };
    const reply = (text: string) => ({
      request: async () => ({ ok: true, status: 200, url: 'https://atcoder.jp/contests/abc086/submit', text }),
      globals: async () => ({}),
    });
    const generic = '<div class="alert alert-danger">× Error.</div>';
    expect(await atcoder.submit(reply(generic), p, ctx, '1', 'x')).toEqual({ kind: 'challenge' });
    const specific = '<div class="alert alert-danger">× Source code is too long.</div>';
    expect(await atcoder.submit(reply(specific), p, ctx, '1', 'x')).toEqual({ kind: 'error', message: 'Source code is too long.' });
  });

  it('parses submission rows', () => {
    const tr = (status: string, cls = '') =>
      parseHtml(
        `<table><tbody><tr><td>2026-10-29</td><td>A</td><td>me</td><td>C++</td><td>0</td><td>200 Byte</td><td class="text-center ${cls}">${status}</td><td>1 ms</td><td>3628 KiB</td><td><a href="/contests/abc086/submissions/123">Detail</a></td></tr></tbody></table>`,
      ).querySelector('tr')!;
    expect(parseAcVerdictRow(tr('<span class="label" title="Waiting for Judging">WJ</span>', 'waiting-judge'))).toMatchObject({ id: '123', final: false });
    expect(parseAcVerdictRow(tr('<span class="label">3/12</span>'))).toMatchObject({ final: false });
    expect(parseAcVerdictRow(tr('<span class="label label-success" title="Accepted">AC</span>'))).toMatchObject({
      final: true,
      ok: true,
      label: 'Accepted (AC)',
      time: '1 ms',
      memory: '3628 KiB',
    });
  });

  it('reads custom test results in plain and base64 form, ignoring stale runs', () => {
    const code = 'print(input())';
    const b64 = (s: string) => btoa(s);
    const plain = { Result: { SourceCode: code, Input: '5\n', Output: '5\n', Error: '', ExitCode: 0, Status: 3, TimeConsumption: 12 } };
    expect(readAcCustomResult(plain, code, '5\n')).toMatchObject({ status: 'OK', stdout: '5\n' });
    const enc = { Result: { SourceCode: b64(code), Input: b64('5\n'), Output: b64('5\n'), Error: '', ExitCode: 0, Status: 3 } };
    expect(readAcCustomResult(enc, code, '5\n')).toMatchObject({ status: 'OK', stdout: '5\n' });
    expect(readAcCustomResult({ ...plain, Result: { ...plain.Result, Status: 1 } }, code, '5\n')).toBeNull();
    expect(readAcCustomResult(plain, 'other code', '5\n')).toBeNull();
    const re = { Result: { ...plain.Result, ExitCode: 1, Output: '', Error: 'Traceback' } };
    expect(readAcCustomResult(re, code, '5\n')?.status).toBe('RE');
  });
});
