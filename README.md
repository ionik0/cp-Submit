# CP Submit — Codeforces & AtCoder

A side panel that lets you write, test and submit solutions on Codeforces and AtCoder. It submits through your own logged-in browser session.

## How it avoids anti-bot blocks

The extension sends every request (load submit form, submit, custom test, verdict poll) **from inside a Codeforces/AtCoder tab**. It does this with `scripting.executeScript({ world: 'MAIN' })`. Each request is therefore a same-origin `fetch` that carries your real cookies (`cf_clearance` included), your browser's TLS fingerprint and the page's own `_ftaa`/`_bfaa` values. To the site, it looks the same as clicking Submit.

If the site still demands a human check (Turnstile or a Cloudflare challenge), the extension opens the real submit page with your language and code **pre-filled**. It also copies the code to your clipboard. You click Submit once, and the panel picks up the verdict automatically. Every request has a timeout, so the panel never spins forever.

## Features

- **Run tests** on the platform's own judge: Codeforces *Custom Invocation* and AtCoder *Custom Test*. These are the exact compilers your submission is judged with. No Judge0, and no local compiler needed.
- **Submit** and get live verdicts.
- **Templates** for each language, where `$0` marks the cursor position. Edit them in the panel's **Settings** tab. Each language keeps its own code, and **Reset** restores the template.
- **Light, dark or system theme.**
- The editor is live only on problem pages. Other pages show a read-only notice.
- **Code memory:** code is saved per problem (and per language) in local storage, so it survives tab switches, navigation and browser restarts. The latest 500 problems are kept. Problems and samples are always read fresh from the page.
- **Never stuck on verification:** if a site demands a human check, its real submit page opens with your code filled in. Every pending or failed submission also has an "Open submit page" link.

## Develop

```sh
npm install
npm run dev            # Chrome with auto-reload
npm run dev:firefox
npm run build          # .output/chrome-mv3 → chrome://extensions → Load unpacked
npm run build:firefox  # .output/firefox-mv2 (Firefox 128+)
npm test
```

## Layout

- `lib/platforms/`: one file per judge (`codeforces.ts`, `atcoder.ts`), implementing the `Platform` interface in `platform.ts`. To add a judge, add one file here.
- `lib/page.ts`: runs fetches inside the platform tab.
- `lib/session.ts`: orchestration for submitting, the pre-filled fallback, verdict tracking and test runs.
- `entrypoints/sidepanel`, `components/`: the React UI, including the Settings tab (Monaco is bundled locally).

The `rough/` folder holds personal design sketches and is not part of the build.
