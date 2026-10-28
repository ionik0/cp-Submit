import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  zip: { excludeSources: ['rough/**'] },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      // monaco-vim deep-imports `monaco-editor/esm/...`, which Monaco 0.57's exports map no longer exposes.
      alias: [
        { find: /^monaco-vim$/, replacement: resolve('node_modules/monaco-vim/dist/index.mjs') },
        { find: /^monaco-editor\/esm\/(.*)$/, replacement: resolve('node_modules/monaco-editor/esm/$1.js') },
      ],
    },
  }),
  manifest: ({ browser }) => ({
    name: 'CP Submit - Codeforces & AtCoder',
    description:
      'Write, test and submit Codeforces & AtCoder solutions from a side panel, through your own logged-in browser session.',
    permissions: [
      'storage',
      'unlimitedStorage',
      'tabs',
      'scripting',
      'clipboardWrite',
      ...(browser === 'firefox' ? [] : ['sidePanel']),
    ],
    host_permissions: ['https://codeforces.com/*', 'https://atcoder.jp/*'],
    action: { default_title: 'Open CP Submit' },
    ...(browser === 'firefox' && {
      browser_specific_settings: { gecko: { id: 'cp-submit@local', strict_min_version: '128.0' } },
    }),
  }),
});
