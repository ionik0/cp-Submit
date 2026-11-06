import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHtml } from './html';
import { atcoder } from './platforms/atcoder';
import { codeforces } from './platforms/codeforces';
import type { PageRequest, PageResponse, Problem, SubmitContext } from './types';

// What a busy contest looks like from the extension: a fake browser whose tabs and site replies each test controls.
type FakeTab = { id: number; url: string; status: string; discarded?: boolean };
const fake = vi.hoisted(() => ({
  tabs: new Map<number, FakeTab>(),
  nextId: 100,
  created: 0,
  updated: [] as string[],
  listeners: new Set<(id: number, info: { status?: string }) => void>(),
  site: (() => {
    throw new Error('no site reply set');
  }) as (r: PageRequest) => PageResponse | Promise<PageResponse>,
  page: {} as Record<string, unknown>,
  requests: [] as PageRequest[],
  html: '',
  fill: 'no-form' as string,
  fills: 0,
  afterFill: () => {},
}));

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      get: async (id: number) => {
        const t = fake.tabs.get(id);
        if (!t) throw new Error('no tab');
        return t;
      },
      query: async () => [...fake.tabs.values()],
      create: async ({ url }: { url: string }) => {
        fake.created++;
        const t = { id: fake.nextId++, url, status: 'loading' };
        fake.tabs.set(t.id, t);
        setTimeout(() => {
          t.status = 'complete';
          fake.listeners.forEach((l) => l(t.id, { status: 'complete' }));
        }, 100);
        return t;
      },
      update: async (id: number, { url }: { url: string }) => {
        fake.updated.push(url);
        const t = fake.tabs.get(id)!;
        t.url = url;
        return t;
      },
      remove: async (id: number) => void fake.tabs.delete(id),
      onUpdated: {
        addListener: (l: (id: number, info: { status?: string }) => void) => fake.listeners.add(l),
        removeListener: (l: (id: number, info: { status?: string }) => void) => fake.listeners.delete(l),
      },
      onRemoved: { addListener: () => {}, removeListener: () => {} },
    },
    scripting: {
      executeScript: async ({ func, args }: { func: { name: string }; args?: unknown[] }) => {
        if (func.name === 'pageFetch') {
          fake.requests.push(args![0] as PageRequest);
          return [{ result: await fake.site(args![0] as PageRequest) }];
        }
        if (func.name === 'readCsrf') return [{ result: 'fresh-csrf' }];
        if (func.name === 'readHtml') return [{ result: fake.html }];
        if (func.name === 'harvestForm') return [{ result: null }];
        if (func.name === 'fillAndSubmit') {
          fake.fills++;
          const result = fake.fill;
          queueMicrotask(() => fake.afterFill());
          return [{ result }];
        }
        return [{ result: {} }];
      },
    },
  },
}));

const { runOne, submitSolution, trackVerdict, helperTabs } = await import('./session');

const CF_URL = 'https://codeforces.com/contest/4/problem/A';
const AC_URL = 'https://atcoder.jp/contests/abc086/tasks/abc086_a';
const CF_PROBLEM = codeforces.parseProblem(parseHtml('<div class="problem-statement"><div class="header"><div class="title">A</div></div></div>'), CF_URL)!;
const AC_PROBLEM: Problem = { ...CF_PROBLEM, platform: 'atcoder', url: AC_URL, index: 'abc086_a', base: 'contests/abc086' };

const json = (body: unknown, status = 200): PageResponse => ({ ok: true, status, url: '', text: JSON.stringify(body) });
const page = (text: string, status = 200): PageResponse => ({ ok: true, status, url: '', text });
const CHALLENGE = '<title>Just a moment...</title>';
const isUpload = (r: PageRequest) => r.form?.some(([k, v]) => k === 'action' && v === 'submitSourceCode') || r.url.endsWith('/custom_test/submit/json');

const run = (platform = codeforces, problem = CF_PROBLEM, signal = new AbortController().signal, tabId: number | undefined = 1) =>
  runOne(platform, problem, tabId, 'stale-csrf', '89', 'code', '1 2\n', '3\n', signal);

/** Lets a promise finish by moving fake time forward, as long as it takes. */
async function finish<T>(p: Promise<T>, ms = 400_000): Promise<T> {
  let out: { v: T } | { e: unknown } | undefined;
  p.then((v) => (out = { v })).catch((e) => (out = { e }));
  for (let t = 0; t < ms && !out; t += 250) await vi.advanceTimersByTimeAsync(250);
  if (!out) throw new Error('never finished');
  if ('e' in out) throw out.e;
  return out.v;
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.tabs.clear();
  fake.listeners.clear();
  fake.requests = [];
  fake.updated = [];
  fake.created = 0;
  fake.html = '';
  fake.fill = 'no-form';
  fake.fills = 0;
  fake.afterFill = () => {};
  helperTabs.clear();
  fake.tabs.set(1, { id: 1, url: CF_URL, status: 'complete' });
});

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(60_000); // lets any helper tab close before the next test
  vi.useRealTimers();
});

describe('Codeforces Run during a contest', () => {
  it('waits out a long judge queue and returns the real result', async () => {
    const start = Date.now();
    fake.site = (r) => (isUpload(r) ? json({ customTestSubmitId: 7 }) : Date.now() - start < 120_000 ? json({ output: null }) : json({ output: '3\n', stat: 'exit code is 0' }));
    const r = await finish(run());
    expect(r.status).toBe('AC');
    // Backs off: two minutes of waiting is far fewer checks than the old 400 ms pace (300).
    expect(r.timing.polls).toBeLessThan(70);
  });

  it('uses the page’s current token, not the one from when the problem opened', async () => {
    fake.site = (r) => (isUpload(r) ? json({ customTestSubmitId: 7 }) : json({ output: '3\n' }));
    await finish(run());
    expect(fake.requests[0]!.form).toContainEqual(['csrf_token', 'fresh-csrf']);
    expect(fake.requests[0]!.headers).toEqual({ 'X-Csrf-Token': 'fresh-csrf' });
  });

  it('survives a few failed checks', async () => {
    let polls = 0;
    fake.site = (r) => {
      if (isUpload(r)) return json({ customTestSubmitId: 7 });
      return ++polls <= 3 ? page('<html>Server busy</html>', 503) : json({ output: '3\n' });
    };
    expect((await finish(run())).status).toBe('AC');
  });

  it('reports rate limiting instead of spinning, and slows down first', async () => {
    fake.site = (r) => (isUpload(r) ? json({ customTestSubmitId: 7 }) : page('Too many requests', 429));
    const start = Date.now();
    const r = await finish(run());
    expect(r.status).toBe('ERR');
    expect(r.info).toContain('rate limited');
    expect(Date.now() - start).toBeLessThan(40_000);
    expect(Date.now() - start).toBeGreaterThan(20_000);
  });

  it('stops at once on a Cloudflare check and says so', async () => {
    fake.site = (r) => (isUpload(r) ? json({ customTestSubmitId: 7 }) : page(CHALLENGE, 403));
    const r = await finish(run());
    expect(r.status).toBe('ERR');
    expect(r.info).toContain('Cloudflare');
    expect(r.timing.polls).toBe(1);
  });

  it('gives up with an explanation when the queue never moves', async () => {
    fake.site = (r) => (isUpload(r) ? json({ customTestSubmitId: 7 }) : json({ output: null }));
    const r = await finish(run());
    expect(r.status).toBe('ERR');
    expect(r.info).toContain('3 minutes');
  });

  it('marks a refused upload so it can be retried, but not a queued run that failed later', async () => {
    fake.site = () => json({ error: 'Too many custom invocations' });
    const refused = await finish(run());
    expect(refused.rejected).toBe(true);
    expect(refused.info).toContain('Too many custom invocations');

    fake.site = (r) => (isUpload(r) ? json({ customTestSubmitId: 7 }) : page('busy', 503));
    expect((await finish(run())).rejected).toBeUndefined();
  });

  it('reports a frozen tab instead of waiting forever', async () => {
    fake.site = () => new Promise<PageResponse>(() => {});
    const r = await finish(run());
    expect(r.status).toBe('ERR');
    expect(r.info).toContain('tab did not respond');
  });

  it('Stop takes effect even while a request is stuck', async () => {
    fake.site = () => new Promise<PageResponse>(() => {});
    const ac = new AbortController();
    const p = run(codeforces, CF_PROBLEM, ac.signal);
    const seen = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1000);
    ac.abort();
    await seen;
  });

  it('samples running together with no open tab share one background tab', async () => {
    fake.tabs.clear();
    fake.site = (r) => (isUpload(r) ? json({ customTestSubmitId: 7 }) : json({ output: '3\n' }));
    const rs = await finish(Promise.all([run(codeforces, CF_PROBLEM, undefined, undefined), run(codeforces, CF_PROBLEM, undefined, undefined), run(codeforces, CF_PROBLEM, undefined, undefined)]));
    expect(rs.map((r) => r.status)).toEqual(['AC', 'AC', 'AC']);
    expect(fake.created).toBe(1);
  });
});

describe('AtCoder Run during a contest', () => {
  beforeEach(() => fake.tabs.set(1, { id: 1, url: AC_URL, status: 'complete' }));
  const done = { Result: { SourceCode: 'code', Input: '1 2\n', Output: '3\n', ExitCode: 0, Status: 3 } };

  it('waits through the queue, ignoring the previous run’s result', async () => {
    const start = Date.now();
    const stale = { Result: { ...done.Result, SourceCode: 'older code' } };
    fake.site = (r) => (isUpload(r) ? json({}) : Date.now() - start < 60_000 ? json(stale) : json(done));
    expect((await finish(run(atcoder, AC_PROBLEM))).status).toBe('AC');
  });

  it('reports a site that stops answering, a challenge and a refused run', async () => {
    fake.site = (r) => (isUpload(r) ? json({}) : page('error', 500));
    expect((await finish(run(atcoder, AC_PROBLEM))).info).toContain('stopped answering');

    fake.site = (r) => (isUpload(r) ? json({}) : page(CHALLENGE, 403));
    expect((await finish(run(atcoder, AC_PROBLEM))).info).toContain('Cloudflare');

    fake.site = () => json({ error: 'Please wait' }, 429);
    const refused = await finish(run(atcoder, AC_PROBLEM));
    expect(refused.info).toBe('Please wait');
    expect(refused.rejected).toBe(true);
  });
});

describe('Submit during a contest', () => {
  const ctx: SubmitContext = { languages: [], csrf: 'tok', user: 'me', humanCheck: false, hidden: [], action: '' };
  const submit = (cached: SubmitContext | null = ctx) => submitSolution(codeforces, CF_PROBLEM, 1, cached, '89', 'code', () => {});
  const land = (url: string, html: string) => {
    fake.afterFill = () =>
      setTimeout(() => {
        fake.tabs.get(1)!.url = url;
        fake.html = html;
        fake.listeners.forEach((l) => l(1, { status: 'complete' }));
      }, 1000);
  };

  it('uses the page’s own form, reads the new id and returns to the problem', async () => {
    fake.fill = 'submitted';
    land('https://codeforces.com/contest/4/my', '<table><tr data-submission-id="555"></tr><tr data-submission-id="111"></tr></table>');
    expect(await finish(submit())).toEqual({ kind: 'submitted', submissionId: '555', via: 'page' });
    expect(fake.fills).toBe(1);
    expect(fake.requests).toEqual([]);
    expect(fake.created).toBe(0);
    expect(fake.updated).toEqual([CF_URL]);
  });

  it('never submits a second time after the form was clicked and nothing came back', async () => {
    fake.fill = 'submitted';
    const r = await finish(submit(), 1_000_000);
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.message).toContain('Check your submissions page');
    expect(fake.fills).toBe(1);
    expect(fake.requests).toEqual([]);
    expect(fake.created).toBe(0);
  });

  it('points at the problem tab and keeps waiting through a slow verification, then still finds the submission', async () => {
    fake.fill = 'submitted';
    const notes: string[] = [];
    const p = submitSolution(codeforces, CF_PROBLEM, 1, ctx, '89', 'code', (m) => notes.push(m));
    await vi.advanceTimersByTimeAsync(11_000);
    expect(notes.at(-1)).toContain('pass it there');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    fake.tabs.get(1)!.url = 'https://codeforces.com/contest/4/my';
    fake.html = '<table><tr data-submission-id="555"></tr></table>';
    fake.listeners.forEach((l) => l(1, { status: 'complete' }));
    expect(await finish(p)).toEqual({ kind: 'submitted', submissionId: '555', via: 'page' });
    expect(fake.fills).toBe(1);
    expect(fake.updated).toEqual([CF_URL]);
  });

  it('keeps waiting through a Cloudflare page and a verification on the submit page', async () => {
    fake.fill = 'submitted';
    const p = submitSolution(codeforces, CF_PROBLEM, 1, ctx, '89', 'code', () => {});
    const arrive = async (url: string, html: string) => {
      await vi.advanceTimersByTimeAsync(60_000);
      fake.tabs.get(1)!.url = url;
      fake.html = html;
      fake.listeners.forEach((l) => l(1, { status: 'complete' }));
      await vi.advanceTimersByTimeAsync(0);
    };
    await arrive(CF_URL, CHALLENGE);
    await arrive('https://codeforces.com/contest/4/submit', '<div class="cf-turnstile" data-sitekey="k"></div>');
    await arrive('https://codeforces.com/contest/4/my', '<table><tr data-submission-id="555"></tr></table>');
    expect(await finish(p)).toEqual({ kind: 'submitted', submissionId: '555', via: 'page' });
  });

  it('ends the wait when the tab is reloaded, without claiming the submission went through', async () => {
    fake.fill = 'submitted';
    land(CF_URL, '<div class="problem-statement"></div>');
    const r = await finish(submit());
    expect(r.kind === 'error' && r.message).toContain('Check your submissions page');
    expect(fake.updated).toEqual([]);
    expect(helperTabs.has(1)).toBe(false);
  });

  it('leaves the tab alone when the user moves on to another problem while waiting', async () => {
    fake.fill = 'submitted';
    land('https://codeforces.com/contest/4/problem/B', '<div class="problem-statement"></div>');
    const r = await finish(submit());
    expect(r.kind).toBe('error');
    expect(fake.updated).toEqual([]);
    expect(helperTabs.has(1)).toBe(false);
  });

  it('shows the site’s own reason when it rejects the form', async () => {
    fake.fill = 'submitted';
    land(CF_URL, '<span class="error">You have submitted exactly the same code before</span>');
    expect(await finish(submit())).toEqual({ kind: 'error', message: 'You have submitted exactly the same code before' });
    expect(fake.updated).toEqual([]);
  });

  it('falls back to a direct POST only when the page has no form', async () => {
    fake.fill = 'no-form';
    fake.site = () => ({ ...page('<table><tr data-submission-id="9"></tr></table>'), url: 'https://codeforces.com/contest/4/my' });
    expect(await finish(submit())).toEqual({ kind: 'submitted', submissionId: '9', via: 'direct' });
    expect(fake.requests.length).toBe(1);
  });

  it('refuses to use the form of a different problem left open in that tab', async () => {
    fake.tabs.get(1)!.url = 'https://codeforces.com/contest/4/problem/B';
    fake.fill = 'submitted';
    fake.site = () => ({ ...page('<table><tr data-submission-id="9"></tr></table>'), url: 'https://codeforces.com/contest/4/my' });
    await finish(submit());
    expect(fake.fills).toBe(0);
  });

  it('keeps the panel on the problem until the tab is back, and then lets go', async () => {
    fake.fill = 'submitted';
    land('https://codeforces.com/contest/4/my', '<table><tr data-submission-id="555"></tr></table>');
    await finish(submit());
    expect(helperTabs.has(1)).toBe(true);
    fake.listeners.forEach((l) => l(1, { status: 'complete' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(helperTabs.has(1)).toBe(false);
  });
});

describe('Verdict tracking during a contest', () => {
  const row = (label: string) => `<table><tr data-submission-id="5"><td class="status-verdict-cell">${label}</td></tr></table>`;

  it('slows down while waiting and still finds the verdict', async () => {
    const start = Date.now();
    fake.site = () => page(row(Date.now() - start < 120_000 ? 'Running on test 3' : 'Accepted'));
    const v = await finish(trackVerdict(codeforces, CF_PROBLEM, 1, '5', null, () => {}, () => {}));
    expect(v?.final).toBe(true);
    // The old one-second pace would have fetched this heavy page about 120 times.
    expect(fake.requests.length).toBeLessThan(45);
  });

  it('says so when the site stops showing the verdict, and clears the note when it returns', async () => {
    const start = Date.now();
    const notes: (string | undefined)[] = [];
    fake.site = () => (Date.now() - start < 60_000 ? page(CHALLENGE, 403) : page(row('Accepted')));
    await finish(trackVerdict(codeforces, CF_PROBLEM, 1, '5', null, () => {}, (m) => notes.push(m)));
    expect(notes[0]).toContain('Still trying');
    expect(notes.at(-1)).toBeUndefined();
  });

  it('opens at most one background tab for all its checks', async () => {
    fake.tabs.clear();
    const start = Date.now();
    fake.site = () => page(row(Date.now() - start < 30_000 ? 'In queue' : 'Accepted'));
    await finish(trackVerdict(codeforces, CF_PROBLEM, undefined, '5', null, () => {}, () => {}));
    expect(fake.created).toBe(1);
  });
});

describe('Opening a problem without asking the site', () => {
  it('finds the languages and login on a Codeforces problem page', () => {
    const html = `<html><head><meta name="X-Csrf-Token" content="tok"></head><body>
      <div class="lang-chooser"><a href="/profile/me">me</a></div>
      <form action="/contest/4/problem/A?csrf_token=tok"><select name="programTypeId"><option value="89">GNU G++20 13.2 (64 bit, winlibs)</option></select>
      <input type="file" name="sourceFile"><input id="sidebarSubmitButton" type="submit"></form></body></html>`;
    const ctx = codeforces.parseSubmitPage(parseHtml(html), html, CF_PROBLEM);
    expect(ctx.user).toBe('me');
    expect(ctx.csrf).toBe('tok');
    expect(ctx.languages.map((l) => l.id)).toEqual(['89']);
  });

  it('finds the languages and login on an AtCoder task page', () => {
    const html = `<html><body><script>var csrfToken = "tok"; var userScreenName = "me";</script>
      <form action="/contests/abc086/submit"><input type="hidden" name="data.TaskScreenName" value="abc086_a">
      <div id="select-lang-abc086_a"><select name="data.LanguageId"><option value="6017">C++ 23 (gcc 12.2)</option></select></div>
      <textarea name="sourceCode"></textarea></form></body></html>`;
    const ctx = atcoder.parseSubmitPage(parseHtml(html), html, AC_PROBLEM);
    expect(ctx.user).toBe('me');
    expect(ctx.languages.map((l) => l.id)).toEqual(['6017']);
  });

  it('reports no login on a logged-out page, so the panel asks the site instead', () => {
    const html = '<html><body><form><select name="programTypeId"><option value="89">G++</option></select></form></body></html>';
    expect(codeforces.parseSubmitPage(parseHtml(html), html, CF_PROBLEM).user).toBeNull();
  });
});
