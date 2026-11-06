import { isChallenge } from '../html';
import type { FormSpec, PageIO, PageRequest, PageResponse, PlatformId, Problem, RunResult, SubmitContext, SubmitOutcome, Verdict } from '../types';

export interface Platform {
  id: PlatformId;
  label: string;
  origin: string;
  /** Lightweight URL check — is this a problem page we can handle? */
  isProblemUrl(url: string): boolean;
  parseProblem(doc: Document, url: string): Problem | null;
  submitPageUrl(p: Problem): string;
  isLoginRedirect(url: string): boolean;
  parseSubmitPage(doc: Document, html: string, p: Problem): SubmitContext;
  submit(io: PageIO, p: Problem, ctx: SubmitContext, langId: string, code: string): Promise<SubmitOutcome>;
  /** Latest state of a submission; with `id === null`, the newest submission for this problem. */
  fetchVerdict(io: PageIO, p: Problem, id: string | null): Promise<Verdict | null>;
  /** Is this the page the site lands on after accepting a submission? */
  isResultsPage(url: string): boolean;
  /** Newest submission id on the page the site lands on after accepting a submission. */
  submissionIdFrom(doc: Document): string | null;
  /** Messages shown when the site re-renders its form instead of accepting the submission. */
  submitErrors(doc: Document): string[];
  runTest(io: PageIO, p: Problem, csrf: string, langId: string, code: string, input: string, signal: AbortSignal): Promise<RunResult>;
  /** Describes the real submit form, for the in-page fallback when a direct POST is not possible. */
  formSpec(p: Problem, langId: string): FormSpec;
  /** The judge keeps each custom test separately, so samples can run at the same time. */
  parallelRuns?: boolean;
}

/** Poll delay for judge results: quick first checks, backing off to 2 s so a busy contest judge isn't hammered. */
export const pollDelay = (attempt: number) => Math.min(300 + attempt * 150, 2000);

const RUN_DEADLINE_MS = 180_000;
const MAX_POLL_FAILURES = 5;
const RATE_LIMIT_PAUSE_MS = 5000;

/**
 * Polls a judge for a custom-test result. `read` returns the result, null while the judge is still
 * working, or undefined when the reply can't be understood. Blips are tolerated, but a challenge or a
 * persistent failure is reported with its reason instead of spinning silently until the deadline.
 */
export async function pollRun(
  io: PageIO,
  label: string,
  request: PageRequest,
  read: (res: PageResponse) => RunResult | null | undefined,
  signal: AbortSignal,
): Promise<RunResult> {
  const deadline = Date.now() + RUN_DEADLINE_MS;
  let failures = 0;
  for (let i = 0; Date.now() < deadline; i++) {
    await sleep(pollDelay(i), signal);
    const res = await io.request(request);
    if (isChallenge(res)) return { status: 'ERR', stdout: '', info: `Cloudflare check pending — pass it in a ${label} tab, then retry.` };
    const result = res.ok ? read(res) : undefined;
    if (result) return result;
    if (result === null) {
      failures = 0;
      continue;
    }
    if (++failures >= MAX_POLL_FAILURES) {
      const why = !res.ok ? `network error: ${res.error}` : res.status === 429 ? 'rate limited' : `unexpected reply, HTTP ${res.status}`;
      return { status: 'ERR', stdout: '', info: `${label} stopped answering the result check (${why}).` };
    }
    if (res.status === 429) await sleep(RATE_LIMIT_PAUSE_MS, signal);
  }
  return { status: 'ERR', stdout: '', info: `${label} did not return a result within 3 minutes (judge queue is busy).` };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function parseJson<T>(res: PageResponse): T | null {
  try {
    return JSON.parse(res.text) as T;
  } catch {
    return null;
  }
}
