import type { RunResult } from './types';

const EPS = 1e-6;

function closeNumbers(a: string, b: string): boolean {
  if (!a.includes('.') && !b.includes('.')) return false;
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const d = Math.abs(x - y);
  return d <= EPS || d <= EPS * Math.max(Math.abs(x), Math.abs(y));
}

/** Token-wise comparison (whitespace-insensitive, like most judges' default checkers); floats with a '.' allow 1e-6 error. */
export function outputsMatch(actual: string, expected: string): boolean {
  const a = actual.split(/\s+/).filter(Boolean);
  const e = expected.split(/\s+/).filter(Boolean);
  if (a.length !== e.length) return false;
  return a.every((t, i) => t === e[i] || closeNumbers(t, e[i]!));
}

/** Turns a cleanly finished run into AC/WA when an expected answer exists. */
export function judge(r: RunResult, expected: string | undefined): RunResult {
  if (r.status !== 'OK' || !expected?.trim()) return r;
  return { ...r, status: outputsMatch(r.stdout, expected) ? 'AC' : 'WA' };
}
