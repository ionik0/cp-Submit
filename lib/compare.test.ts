import { describe, expect, it } from 'vitest';
import { judge, outputsMatch } from './compare';
import { isSubmitPage } from './html';
import { expandTemplate, familyOf, groupLanguages } from './languages';

describe('outputsMatch', () => {
  it('ignores whitespace differences', () => {
    expect(outputsMatch('1 2\r\n3  \n\n', '1 2\n3\n')).toBe(true);
  });
  it('detects wrong tokens', () => {
    expect(outputsMatch('YES', 'NO')).toBe(false);
    expect(outputsMatch('1 2', '1 2 3')).toBe(false);
  });
  it('allows float error only for decimal tokens', () => {
    expect(outputsMatch('0.3333333', '0.333333333')).toBe(true);
    expect(outputsMatch('1000000', '1000001')).toBe(false);
  });
});

describe('judge', () => {
  it('only judges clean runs with an expected answer', () => {
    expect(judge({ status: 'OK', stdout: '4\n' }, '4').status).toBe('AC');
    expect(judge({ status: 'OK', stdout: '5\n' }, '4').status).toBe('WA');
    expect(judge({ status: 'RE', stdout: '' }, '4').status).toBe('RE');
    expect(judge({ status: 'OK', stdout: '5' }, '').status).toBe('OK');
  });
});

describe('isSubmitPage', () => {
  it('matches form pages only', () => {
    expect(isSubmitPage('https://atcoder.jp/contests/abc086/submit?taskScreenName=abc086_a')).toBe(true);
    expect(isSubmitPage('https://codeforces.com/contest/4/submit?csrf_token=x')).toBe(true);
    expect(isSubmitPage('https://atcoder.jp/contests/abc086/submissions/me')).toBe(false);
    expect(isSubmitPage('https://codeforces.com/problemset/status?my=on')).toBe(false);
  });
});

describe('languages', () => {
  it.each([
    ['GNU G++20 13.2 (64 bit, winlibs)', 'cpp'],
    ['C++ 23 (gcc 12.2)', 'cpp'],
    ['GNU GCC C11 5.1.0', 'c'],
    ['C (gcc 12.2.0)', 'c'],
    ['C# 10, .NET SDK 6.0', 'csharp'],
    ['PyPy 3-64', 'python'],
    ['Python (CPython 3.11.4)', 'python'],
    ['Java 21 64bit', 'java'],
    ['JavaScript (Node.js 18.16.1)', 'javascript'],
    ['Kotlin 1.9', 'kotlin'],
    ['Rust (rustc 1.70.0)', 'rust'],
    ['Go (go 1.20.6)', 'go'],
    ['Haskell (GHC 9.4.5)', 'other'],
  ])('%s → %s', (name, fam) => expect(familyOf(name)).toBe(fam));

  it('groups languages with the preferred family first and newest versions first', () => {
    const langs = [
      { id: '1', name: 'GNU G++17 7.3.0', family: 'cpp' as const },
      { id: '2', name: 'Python 3.13.2', family: 'python' as const },
      { id: '3', name: 'GNU G++23 14.2 (64 bit, msys2)', family: 'cpp' as const },
      { id: '4', name: 'GNU G++20 13.2 (64 bit, winlibs)', family: 'cpp' as const },
    ];
    const g = groupLanguages(langs, 'python');
    expect(g.map((x) => x.family)).toEqual(['python', 'cpp']);
    expect(g[1]!.languages.map((l) => l.id)).toEqual(['3', '4', '1']);
  });

  it('expands $0 into a cursor offset', () => {
    expect(expandTemplate('ab$0cd')).toEqual({ code: 'abcd', cursor: 2 });
    expect(expandTemplate('abc')).toEqual({ code: 'abc', cursor: 3 });
  });
});
