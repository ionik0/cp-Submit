# Store listing — CP Submit

Copy-paste material for the Chrome Web Store, Firefox Add-ons (AMO) and Edge Add-ons.
Upload files are produced by `npm run zip:all` in `.output/`.

| Store | Upload | Extra |
|---|---|---|
| Chrome Web Store | `cp-extension-<ver>-chrome.zip` | promo tile `store/promo-small-440x280.png`, optional marquee `store/promo-marquee-1400x560.png` |
| Firefox Add-ons | `cp-extension-<ver>-firefox.zip` | source code: `cp-extension-<ver>-sources.zip` |
| Edge Add-ons | `cp-extension-<ver>-edge.zip` | same images as Chrome |

---

## Name
CP Submit - Codeforces & AtCoder

## Short description (≤132 chars)
Write, test and submit Codeforces & AtCoder solutions from a side panel, through your own logged-in browser session.

## Category
- Chrome: **Developer Tools**
- Firefox: **Web Development** (secondary: **Other**)
- Edge: **Developer tools**

## Description

CP Submit is a code editor for competitive programmers that lives in your browser's side panel. It works on both Codeforces and AtCoder.

Open any problem and you get a full Monaco editor (the editor from VS Code). The sample tests are loaded automatically, and Run and Submit buttons talk directly to the judge.

WHY IT DOESN'T GET STUCK
Other tools fail over and over when Codeforces asks you to verify you're human. CP Submit sends every request from inside your own logged-in Codeforces or AtCoder tab. If a human check is still required, it opens the site's real submit page with your code already filled in. You never retype or re-paste anything, and it never hangs.

FEATURES
• Submit to Codeforces and AtCoder with live verdicts (In queue → Running → Accepted)
• Run samples on the real judge (Codeforces Custom Invocation / AtCoder Custom Test), with the exact compiler you'll be judged with and no local setup
• Custom tests, output comparison and a timing breakdown for every run
• Code saved per problem and per language, kept across tabs and browser restarts
• Templates for each language, with a $0 cursor marker
• Vim key bindings, plus line numbers, cursor style, minimap, word wrap and more
• Shortcuts: Ctrl+' to run, Ctrl+Enter to submit, Shift+Alt+R to reset
• Themes: Light, Dark, Volcano, Cherry Blossom, Midnight, Deep Sea, Sunset
• Problem timer with start, stop and restart

PRIVACY
CP Submit collects no data. It has no servers, no analytics and no accounts. Your code and settings stay in your browser, and the extension only talks to codeforces.com and atcoder.jp, as you.

Open source (MIT): https://github.com/ionik0/cp-extension

## Links
- Homepage / support: https://github.com/ionik0/cp-extension
- Issues: https://github.com/ionik0/cp-extension/issues
- Privacy policy: https://github.com/ionik0/cp-extension#privacy--permissions

---

## Chrome Web Store — Privacy practices tab

**Single purpose**
Lets competitive programmers write, test and submit solutions to Codeforces and AtCoder problems from a browser side panel.

**Permission justifications**
- `sidePanel`: The extension's entire user interface (code editor, tests, submissions) is shown in the browser side panel.
- `scripting`: Problem pages are read, and submissions, test runs and verdict checks are sent, from inside the user's own Codeforces/AtCoder tab, so they use the user's existing logged-in session.
- `storage`: Saves the user's settings, code templates and per-problem code locally.
- `unlimitedStorage`: Per-problem saved code (up to the latest 500 problems) can exceed the default local storage quota.
- `clipboardWrite`: Copies the user's code to the clipboard when the site's own submit page is opened as a fallback, so it can be pasted if needed.
- Host permissions (`https://codeforces.com/*`, `https://atcoder.jp/*`): The extension only works on these two judges. It reads problem statements and samples, submits code, runs custom tests and reads verdicts there.

**Remote code:** No, I am not using remote code. All code is bundled in the package.

**Data usage:** No user data is collected or transmitted. Tick nothing in the data-type list, then certify all three statements: no selling of data, no unrelated use, no creditworthiness use.

---

## Firefox Add-ons — source code note (paste into "Notes for reviewers")

This add-on is built from TypeScript/React with WXT (Vite). The uploaded sources zip is the complete project.

Build steps (Node.js 20+, npm 10+):

    npm ci
    npm run build:firefox

The output is `.output/firefox-mv2/`, identical to the submitted package. Third-party bundled libraries: React 19, Monaco Editor 0.57, monaco-vim. The `innerHTML` warnings in the validator come from these libraries, not from add-on code.

The add-on only accesses codeforces.com and atcoder.jp, on behalf of the logged-in user, when the user clicks Run or Submit. No data is collected (`data_collection_permissions: none`).

---

## Screenshots (you capture these)

Chrome needs at least one, Edge recommends some, and Firefox's are optional. Use **1280×800** (or 640×400) PNG/JPEG.

Suggested shots:
1. A Codeforces problem with the panel open: code in the editor, Tests tab showing green AC badges
2. The Submissions tab with an "Accepted" verdict
3. Settings tab showing the themes, ideally in Volcano or Midnight
4. An AtCoder task with the panel open in the Cherry Blossom theme
