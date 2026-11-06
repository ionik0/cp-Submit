import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillAndSubmit, harvestForm, readCsrf } from './page';

describe('fillAndSubmit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => vi.useRealTimers());
  const spec = { values: [['select[name="programTypeId"]', '70']] as [string, string][], codeSelector: 'textarea[name="source"]', fileSelector: 'input[type="file"][name="sourceFile"]', submitSelector: '#sidebarSubmitButton' };

  it('uploads the code as a file and clicks the sidebar button on the Codeforces problem page', async () => {
    document.body.innerHTML = `<form><select name="programTypeId"><option value="89">G++</option><option value="70">PyPy</option></select>
      <input type="file" name="sourceFile"><input id="sidebarSubmitButton" type="submit"></form>`;
    const clicked = vi.fn((e: Event) => e.preventDefault());
    document.querySelector('#sidebarSubmitButton')!.addEventListener('click', clicked);
    (globalThis as { DataTransfer?: unknown }).DataTransfer ??= class {
      files: File[] = [];
      items = { add: (f: File) => this.files.push(f) };
    };
    const input = document.querySelector<HTMLInputElement>('input[name="sourceFile"]')!;
    let uploaded: File | undefined;
    Object.defineProperty(input, 'files', { set: (fs: File[]) => (uploaded = fs[0]), get: () => null });

    expect(await fillAndSubmit({ ...spec, code: 'print(1)' }, true)).toBe('submitted');
    // The click comes after the result is back, so a page navigation can't swallow the result.
    expect(clicked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLSelectElement>('select[name="programTypeId"]')!.value).toBe('70');
    expect(await uploaded!.text()).toBe('print(1)');
  });

  it('touches nothing when the page has no form', async () => {
    expect(await fillAndSubmit({ ...spec, code: 'x' }, true)).toBe('no-form');
  });

  it('only fills in when asked not to submit', async () => {
    document.body.innerHTML = `<form><textarea name="source"></textarea><input type="submit"></form>`;
    const clicked = vi.fn((e: Event) => e.preventDefault());
    document.querySelector('[type="submit"]')!.addEventListener('click', clicked);
    expect(await fillAndSubmit({ ...spec, code: 'x' }, false)).toBe('needs-user');
    vi.advanceTimersByTime(1000);
    expect(clicked).not.toHaveBeenCalled();
    expect(document.querySelector('textarea')!.value).toBe('x');
  });
});

describe('readCsrf', () => {
  beforeEach(() => (document.head.innerHTML = document.body.innerHTML = ''));

  it('reads the token from Codeforces’ meta tag and from AtCoder’s page variable', () => {
    document.head.innerHTML = '<meta name="X-Csrf-Token" content="cf">';
    expect(readCsrf()).toBe('cf');
    document.head.innerHTML = '';
    (window as unknown as { csrfToken?: string }).csrfToken = 'ac';
    expect(readCsrf()).toBe('ac');
    delete (window as unknown as { csrfToken?: string }).csrfToken;
    expect(readCsrf()).toBeNull();
  });
});

describe('harvestForm', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('returns null when the page has no submit form', () => {
    expect(harvestForm()).toBeNull();
  });

  it('collects the problem page form fields (Codeforces sidebar form)', () => {
    document.body.innerHTML = `<form><input type="hidden" name="csrf_token" value="abc"><input type="hidden" name="action" value="submitSolutionFormSubmitted">
      <select name="programTypeId"><option value="89" selected>G++20</option></select><input type="file" name="sourceFile"></form>`;
    expect(harvestForm()).toEqual({
      fields: [
        ['csrf_token', 'abc'],
        ['action', 'submitSolutionFormSubmitted'],
        ['programTypeId', '89'],
      ],
      token: false,
    });
  });

  it('picks up a human-check token even when the widget sits outside the form (AtCoder)', () => {
    document.body.innerHTML = `<form><input type="hidden" name="csrf_token" value="x">
      <select name="data.LanguageId"><option value="6017" selected>C++</option></select><textarea name="sourceCode"></textarea></form>
      <div class="cf-challenge" data-sitekey="k"><input type="hidden" name="cf-turnstile-response" value="TOKEN"></div>`;
    const h = harvestForm()!;
    expect(h.token).toBe(true);
    expect(h.fields).toContainEqual(['cf-turnstile-response', 'TOKEN']);
  });
});
