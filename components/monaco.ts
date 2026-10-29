import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { THEMES } from '@/lib/themes';

// Bundle Monaco locally: extension CSP forbids @monaco-editor/react's default CDN loader.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

// JS/TS IntelliSense would need Monaco's 6.7 MB TypeScript worker (too large for Firefox's validator);
// switching the language service off keeps JS syntax highlighting without ever requesting that worker.
monaco.typescript.javascriptDefaults.setModeConfiguration({});
monaco.typescript.typescriptDefaults.setModeConfiguration({});

const hex = (c: string) => c.slice(1);
for (const t of THEMES) {
  const e = t.editor;
  monaco.editor.defineTheme(`cp-${t.id}`, {
    base: t.dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: hex(e.comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: hex(e.keyword) },
      { token: 'string', foreground: hex(e.string) },
      { token: 'number', foreground: hex(e.number) },
      { token: 'type', foreground: hex(e.type) },
    ],
    colors: {
      'editor.background': e.bg,
      'editor.foreground': e.fg,
      'editorLineNumber.foreground': e.comment,
      'editorLineNumber.activeForeground': e.fg,
      'editor.lineHighlightBackground': t.neutral[t.dark ? 9 : 1]!,
      'editor.selectionBackground': `${t.accent[t.dark ? 4 : 0]}99`,
      'editorCursor.foreground': t.accent[2]!,
      'editorWidget.background': t.neutral[t.dark ? 9 : 0]!,
    },
  });
}
