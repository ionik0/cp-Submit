import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseHtml } from './html';
import { atcoder } from './platforms/atcoder';

const dir = process.env.LIVE_DIR;
const run = dir ? it : it.skip;

run('atcoder saved task pages', () => {
  for (const [file, url] of [
    ['ac_task', 'https://atcoder.jp/contests/abc086/tasks/abc086_a'],
    ['ac_task2', 'https://atcoder.jp/contests/abc400/tasks/abc400_c'],
  ] as const) {
    const p = atcoder.parseProblem(parseHtml(readFileSync(`${dir}/${file}.html`, 'utf8')), url);
    console.log(JSON.stringify(p, null, 1));
    expect(p?.samples.length).toBeGreaterThan(0);
  }
});

run('atcoder login page is detected as logged out', () => {
  const html = readFileSync(`${dir}/ac_submit.html`, 'utf8');
  const p = atcoder.parseProblem(parseHtml(readFileSync(`${dir}/ac_task.html`, 'utf8')), 'https://atcoder.jp/contests/abc086/tasks/abc086_a')!;
  const ctx = atcoder.parseSubmitPage(parseHtml(html), html, p);
  console.log('user', ctx.user, 'csrf', !!ctx.csrf, 'langs', ctx.languages.length);
  expect(ctx.user).toBeNull();
});
