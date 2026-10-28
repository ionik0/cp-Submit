import './monaco';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import type { EditorPrefs } from '@/lib/settings';

export interface CursorRequest {
  offset: number;
  nonce: number;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  language: string;
  /** Monaco theme name, e.g. `vs-dark` or `cp-volcano`. */
  theme: string;
  prefs: EditorPrefs;
  readOnly?: boolean;
  cursor?: CursorRequest;
}

export function CodeEditor({ value, onChange, language, theme, prefs, readOnly, cursor }: Props) {
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const vim = prefs.keyBinding === 'vim' && !readOnly;

  const onMount: OnMount = (ed) => setEditor(ed);

  useEffect(() => {
    const model = editor?.getModel();
    if (!editor || !model || !cursor) return;
    const pos = model.getPositionAt(cursor.offset);
    editor.setPosition(pos);
    editor.revealPositionInCenter(pos);
    editor.focus();
  }, [editor, cursor]);

  useEffect(() => {
    if (!editor || !vim || !statusRef.current) return;
    let mode: { dispose(): void } | undefined;
    let cancelled = false;
    void import('monaco-vim').then(({ initVimMode }) => {
      if (!cancelled) mode = initVimMode(editor, statusRef.current!);
    });
    return () => {
      cancelled = true;
      mode?.dispose();
    };
  }, [editor, vim]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <Editor
          value={value}
          onChange={(v) => onChange(v ?? '')}
          language={language}
          theme={theme}
          onMount={onMount}
          options={{
            fontSize: prefs.fontSize,
            tabSize: prefs.tabSize,
            minimap: { enabled: prefs.minimap },
            wordWrap: prefs.wordWrap ? 'on' : 'off',
            lineNumbers: prefs.lineNumbers,
            cursorStyle: prefs.cursorStyle,
            cursorSmoothCaretAnimation: prefs.smoothCaret,
            quickSuggestions: prefs.autoSuggest,
            suggestOnTriggerCharacters: prefs.autoSuggest,
            readOnly,
            domReadOnly: readOnly,
            renderLineHighlight: readOnly ? 'none' : 'line',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            lineNumbersMinChars: 3,
            padding: { top: 8 },
            fixedOverflowWidgets: true,
          }}
        />
      </div>
      {vim && <div ref={statusRef} className="border-t border-zinc-200 px-2 font-mono text-[11px] text-zinc-500 dark:border-zinc-800" />}
    </div>
  );
}
