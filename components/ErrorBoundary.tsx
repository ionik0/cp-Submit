import { Component, type ReactNode } from 'react';

/** Keeps an unexpected render error from blanking the panel: shows it with a one-click reload. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="font-semibold">CP Submit hit an unexpected error</div>
        <pre className="max-w-full overflow-auto rounded bg-zinc-100 p-2 text-left text-[11px] dark:bg-zinc-900">{error.message}</pre>
        <p className="text-xs text-zinc-500">Your code is saved per problem, so reloading loses nothing.</p>
        <button className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white" onClick={() => location.reload()}>
          Reload panel
        </button>
        <a className="text-xs text-blue-600 hover:underline dark:text-blue-400" href="https://github.com/ionik0/cp-Submit/issues" target="_blank" rel="noreferrer">
          Report this on GitHub
        </a>
      </div>
    );
  }
}
