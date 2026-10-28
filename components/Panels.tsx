import { useEffect, useState } from 'react';
import type { Platform } from '@/lib/platforms';
import type { ContextResult, RunTiming } from '@/lib/session';
import type { RunResult, Verdict } from '@/lib/types';

export type TimedResult = RunResult & { timing?: RunTiming };
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export interface TestCase {
  id: number;
  label: string;
  input: string;
  expected: string;
  custom: boolean;
  open: boolean;
  result?: TimedResult | 'running';
}

export interface Submission {
  key: string;
  title: string;
  url: string;
  state: 'submitting' | 'manual' | 'tracking' | 'done' | 'error';
  message?: string;
  verdict?: Verdict;
  /** Reopens the real submit page with the code filled in. */
  reopen?: () => void;
}

const timerStarts = new Map<string, number>();

export function Timer({ id }: { id: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!timerStarts.has(id)) timerStarts.set(id, Date.now());
  const s = Math.floor((Date.now() - timerStarts.get(id)!) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  return (
    <button
      className="mt-0.5 shrink-0 font-mono text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      title="Time on this problem — click to restart"
      onClick={() => (timerStarts.set(id, Date.now()), tick((n) => n + 1))}
    >
      {text}
    </button>
  );
}

export function ContextBanner({ ctx, platform, onRetry }: { ctx: ContextResult | { kind: 'loading' }; platform: Platform; onRetry: () => void }) {
  if (ctx.kind === 'ok' || ctx.kind === 'loading') return null;
  const text =
    ctx.kind === 'logged-out' ? (
      <>
        Not logged in to {platform.label}.{' '}
        <a className="underline" href={platform.id === 'codeforces' ? `${platform.origin}/enter` : `${platform.origin}/login`} target="_blank" rel="noreferrer">
          Log in
        </a>
        , then retry.
      </>
    ) : ctx.kind === 'challenge' ? (
      <>{platform.label} is showing a Cloudflare check. Open the site tab, pass it once, then retry.</>
    ) : (
      <>{ctx.message}</>
    );
  return (
    <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <div className="flex-1">{text}</div>
      <button className="rounded border border-current px-2 py-0.5" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`border-b-2 px-2 py-1.5 ${active ? 'border-blue-500 font-semibold' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const STATUS_STYLE: Record<string, string> = {
  AC: 'bg-emerald-600',
  WA: 'bg-red-600',
  RE: 'bg-orange-600',
  TLE: 'bg-orange-600',
  CE: 'bg-amber-600',
  OK: 'bg-blue-600',
  ERR: 'bg-zinc-500',
};

export function TestCard({
  test,
  disabled,
  onChange,
  onRun,
  onDelete,
}: {
  test: TestCase;
  disabled: boolean;
  onChange: (p: Partial<TestCase>) => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const r = test.result;
  return (
    <div className="rounded border border-zinc-200 dark:border-zinc-800">
      <div className="flex cursor-pointer items-center gap-2 px-2 py-1" onClick={() => onChange({ open: !test.open })}>
        <span className="text-zinc-400">{test.open ? '▾' : '▸'}</span>
        <span className="flex-1 font-medium">{test.label}</span>
        {r === 'running' && <span className="animate-pulse text-[11px] text-zinc-500">running…</span>}
        {r && r !== 'running' && <span className={`rounded px-1.5 text-[10px] font-bold text-white ${STATUS_STYLE[r.status]}`}>{r.status}</span>}
        <button className="text-[11px] text-blue-600 disabled:opacity-40 dark:text-blue-400" disabled={disabled} onClick={(e) => (e.stopPropagation(), onRun())}>
          run
        </button>
        {test.custom && (
          <button className="text-[11px] text-zinc-400 hover:text-red-500" onClick={(e) => (e.stopPropagation(), onDelete())}>
            ✕
          </button>
        )}
      </div>
      {test.open && (
        <div className="space-y-1 border-t border-zinc-200 p-2 dark:border-zinc-800">
          <IOBlock label="Input" value={test.input} editable={test.custom} onChange={(v) => onChange({ input: v })} />
          <IOBlock label="Expected" value={test.expected} editable={test.custom} onChange={(v) => onChange({ expected: v })} />
          {r && r !== 'running' && (
            <>
              <IOBlock label="Output" value={r.stdout} highlight={r.status === 'WA'} />
              {r.stderr && <IOBlock label="Stderr" value={r.stderr} />}
              {r.info && <div className="text-[11px] text-zinc-500">{r.info}</div>}
              {r.timing && (
                <div className="text-[11px] text-zinc-500" title="send = upload to judge · wait = judge queue + compile + run + polling">
                  ⏱ {secs(r.timing.sendMs + r.timing.waitMs)} total · send {secs(r.timing.sendMs)} · wait {secs(r.timing.waitMs)} ·{' '}
                  {r.timing.polls} polls
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function IOBlock({ label, value, editable, highlight, onChange }: { label: string; value: string; editable?: boolean; highlight?: boolean; onChange?: (v: string) => void }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      {editable ? (
        <textarea
          className="mono w-full resize-y rounded border border-zinc-300 bg-transparent p-1 text-xs dark:border-zinc-700"
          rows={Math.min(8, Math.max(2, value.split('\n').length))}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
        />
      ) : (
        <pre
          className={`max-h-40 overflow-auto rounded p-1 text-xs whitespace-pre ${
            highlight ? 'bg-red-50 dark:bg-red-950/50' : 'bg-zinc-50 dark:bg-zinc-900'
          }`}
        >
          {value || <span className="text-zinc-400">(empty)</span>}
        </pre>
      )}
    </div>
  );
}

export function SubmissionRow({ sub }: { sub: Submission }) {
  const v = sub.verdict;
  const color =
    sub.state === 'error'
      ? 'text-red-600 dark:text-red-400'
      : v?.final
        ? v.ok
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400'
        : 'text-zinc-500';
  const label =
    v?.label ?? (sub.state === 'submitting' ? 'Submitting…' : sub.state === 'manual' ? 'Waiting for you to submit…' : sub.state === 'tracking' ? 'In queue…' : '');
  return (
    <div className="rounded border border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <a href={sub.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
          {sub.title}
        </a>
        {v?.id && <span className="text-[10px] text-zinc-400">#{v.id}</span>}
      </div>
      <div className={`text-xs font-semibold ${color} ${v && !v.final ? 'animate-pulse' : ''}`}>{sub.state === 'error' ? 'Failed' : label}</div>
      {(v?.time || v?.memory) && <div className="text-[11px] text-zinc-500">{[v.time, v.memory].filter(Boolean).join(' · ')}</div>}
      {sub.message && <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">{sub.message}</div>}
      {sub.reopen && !v?.final && (
        <button className="mt-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400" onClick={sub.reopen}>
          Open submit page (code filled in) ↗
        </button>
      )}
    </div>
  );
}
