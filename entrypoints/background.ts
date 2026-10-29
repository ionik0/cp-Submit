import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

type Extras = {
  sidebarAction?: { toggle(): Promise<void> };
  browserAction?: typeof browser.action;
};

export default defineBackground(() => {
  // Chrome, Edge, Brave: native side panel.
  if (browser.sidePanel?.setPanelBehavior) {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    return;
  }
  // Firefox: sidebar. Safari, Opera and others without a side panel: a small companion window.
  const b = browser as unknown as Extras;
  let windowId: number | undefined;
  (browser.action ?? b.browserAction)?.onClicked.addListener(async () => {
    if (b.sidebarAction) return void b.sidebarAction.toggle();
    if (windowId != null && (await browser.windows.update(windowId, { focused: true }).catch(() => null))) return;
    const w = await browser.windows.create({ url: browser.runtime.getURL('/sidepanel.html'), type: 'popup', width: 460, height: 820 });
    windowId = w?.id;
  });
});
