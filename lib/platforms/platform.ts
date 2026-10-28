import type { FormSpec, PageIO, PageResponse, PlatformId, Problem, RunResult, SubmitContext, SubmitOutcome, Verdict } from '../types';

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
  runTest(io: PageIO, p: Problem, ctx: SubmitContext, langId: string, code: string, input: string, signal: AbortSignal): Promise<RunResult>;
  /** Describes the real submit form, for the in-page fallback when a direct POST is not possible. */
  formSpec(p: Problem, langId: string): FormSpec;
}

/** Poll delay for judge results: quick first check, then steady. */
export const pollDelay = (attempt: number) => (attempt === 0 ? 300 : 400);

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
