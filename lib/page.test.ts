import { beforeEach, describe, expect, it } from 'vitest';
import { harvestForm } from './page';

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
