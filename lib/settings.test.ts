import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearSavedCode, loadCode, saveCode, savedCount } from './settings';

describe('saved code', () => {
  beforeEach(() => fakeBrowser.reset());

  it('persists per problem and survives re-reading', async () => {
    await saveCode('cf:4A', { langId: '89', family: 'cpp', codes: { cpp: 'int main(){}' } });
    expect(await loadCode('cf:4A')).toEqual({ langId: '89', family: 'cpp', codes: { cpp: 'int main(){}' } });
    expect(await loadCode('cf:4B')).toBeNull();
  });

  it('keeps only the most recent 500 problems, evicting least-recently saved', async () => {
    for (let i = 0; i < 502; i++) await saveCode(`p${i}`, { langId: '1', codes: {} });
    await saveCode('p0', { langId: '1', codes: {} }); // p0 was evicted, saving re-adds it as newest
    expect(await savedCount()).toBe(500);
    expect(await loadCode('p1')).toBeNull();
    expect(await loadCode('p2')).toBeNull();
    expect(await loadCode('p3')).not.toBeNull();
    expect(await loadCode('p0')).not.toBeNull();
  });

  it('clears everything', async () => {
    await saveCode('a', { langId: '1', codes: {} });
    expect(await clearSavedCode()).toBe(1);
    expect(await loadCode('a')).toBeNull();
  });
});
