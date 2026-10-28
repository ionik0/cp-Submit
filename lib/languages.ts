import type { LangFamily, Language } from './types';

export const FAMILIES: { id: LangFamily; label: string; monaco: string }[] = [
  { id: 'cpp', label: 'C++', monaco: 'cpp' },
  { id: 'c', label: 'C', monaco: 'c' },
  { id: 'python', label: 'Python', monaco: 'python' },
  { id: 'java', label: 'Java', monaco: 'java' },
  { id: 'kotlin', label: 'Kotlin', monaco: 'kotlin' },
  { id: 'rust', label: 'Rust', monaco: 'rust' },
  { id: 'go', label: 'Go', monaco: 'go' },
  { id: 'csharp', label: 'C#', monaco: 'csharp' },
  { id: 'javascript', label: 'JavaScript', monaco: 'javascript' },
  { id: 'other', label: 'Other', monaco: 'plaintext' },
];

export function familyOf(name: string): LangFamily {
  const n = name.toLowerCase();
  if (/c\+\+|g\+\+|clang\+\+|\bcpp\b/.test(n)) return 'cpp';
  if (/c#|csharp|\.net|\bmono\b/.test(n)) return 'csharp';
  if (/python|pypy|cython/.test(n)) return 'python';
  if (/kotlin/.test(n)) return 'kotlin';
  if (/java(?!script)/.test(n)) return 'java';
  if (/\brust\b/.test(n)) return 'rust';
  if (/\bgo\b|golang/.test(n)) return 'go';
  if (/javascript|typescript|node\.?js|\bdeno\b|\bbun\b/.test(n)) return 'javascript';
  if (/\bc\b|\bc\d\d\b/.test(n)) return 'c';
  return 'other';
}

export function monacoLanguage(family: LangFamily): string {
  return FAMILIES.find((f) => f.id === family)?.monaco ?? 'plaintext';
}

export function toLanguages(options: { value: string; text: string }[]): Language[] {
  const seen = new Set<string>();
  const out: Language[] = [];
  for (const o of options) {
    const id = o.value.trim();
    const name = o.text.replace(/\s+/g, ' ').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, family: familyOf(name) });
  }
  return out;
}

export interface LanguageGroup {
  family: LangFamily;
  label: string;
  languages: Language[];
}

const byNewestName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Groups by language family (preferred family first), newest compiler versions first inside each group. */
export function groupLanguages(langs: Language[], preferred: LangFamily): LanguageGroup[] {
  const order = [preferred, ...FAMILIES.map((f) => f.id).filter((f) => f !== preferred)];
  return order
    .map((family) => ({
      family,
      label: FAMILIES.find((f) => f.id === family)?.label ?? family,
      languages: langs.filter((l) => l.family === family).sort((a, b) => byNewestName.compare(b.name, a.name)),
    }))
    .filter((g) => g.languages.length > 0);
}

export const DEFAULT_TEMPLATES: Partial<Record<LangFamily, string>> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    $0
    return 0;
}
`,
  c: `#include <stdio.h>

int main(void) {
    $0
    return 0;
}
`,
  python: `def main():
    $0


main()
`,
  java: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        $0
    }
}
`,
  kotlin: `fun main() {
    $0
}
`,
  rust: `use std::io::*;

fn main() {
    let mut s = String::new();
    stdin().read_to_string(&mut s).unwrap();
    let mut it = s.split_whitespace();
    $0
}
`,
  go: `package main

import "fmt"

func main() {
	$0
}
`,
};

/** Expands a template: strips the `$0` cursor marker and reports where it was. */
export function expandTemplate(template: string): { code: string; cursor: number } {
  const i = template.indexOf('$0');
  if (i < 0) return { code: template, cursor: template.length };
  return { code: template.slice(0, i) + template.slice(i + 2), cursor: i };
}
