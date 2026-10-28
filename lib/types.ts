export type PlatformId = 'codeforces' | 'atcoder';

export interface Sample {
  input: string;
  output: string;
}

export interface Problem {
  platform: PlatformId;
  /** Stable id used for in-session drafts, e.g. `cf:4A`, `ac:abc086_a`. */
  key: string;
  url: string;
  name: string;
  contestId: string;
  /** CF problem index (`A`, `B1`) or AtCoder task screen name (`abc086_a`). */
  index: string;
  /** Path prefix for contest-scoped endpoints: `contest/4`, `gym/1001`, `problemset`, `contests/abc086`. */
  base: string;
  kind: 'contest' | 'gym' | 'problemset';
  timeLimit?: string;
  memoryLimit?: string;
  samples: Sample[];
  interactive: boolean;
}

export type LangFamily =
  | 'cpp'
  | 'c'
  | 'python'
  | 'java'
  | 'kotlin'
  | 'rust'
  | 'go'
  | 'csharp'
  | 'javascript'
  | 'other';

export interface Language {
  id: string;
  name: string;
  family: LangFamily;
}

export interface SubmitContext {
  languages: Language[];
  csrf: string;
  user: string | null;
  /** The submit form carries a human-verification widget (e.g. Turnstile) — a direct POST cannot pass it. */
  humanCheck: boolean;
  /** Hidden inputs of the platform's own submit form, replayed so new server-side fields are not missed. */
  hidden: [string, string][];
  action: string;
}

export interface PageRequest {
  url: string;
  method?: 'GET' | 'POST';
  form?: [string, string][];
  multipart?: boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface PageResponse {
  ok: boolean;
  status: number;
  url: string;
  text: string;
  error?: string;
}

/** Network access through a logged-in platform tab (same-origin, real cookies, real browser fingerprint). */
export interface PageIO {
  request(req: PageRequest): Promise<PageResponse>;
  globals(names: string[]): Promise<Record<string, string | null>>;
}

export type SubmitOutcome =
  | { kind: 'submitted'; submissionId: string | null }
  | { kind: 'challenge' }
  | { kind: 'logged-out' }
  | { kind: 'error'; message: string };

export interface Verdict {
  id: string;
  label: string;
  final: boolean;
  ok: boolean;
  time?: string;
  memory?: string;
}

/** How to fill a platform's real submit form: [selector, value] pairs plus the source textarea. */
export interface FormSpec {
  values: [string, string][];
  codeSelector: string;
}

export type RunStatus = 'AC' | 'WA' | 'RE' | 'TLE' | 'CE' | 'OK' | 'ERR';

export interface RunResult {
  status: RunStatus;
  stdout: string;
  stderr?: string;
  info?: string;
}
