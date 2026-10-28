import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

type FirefoxExtras = {
  sidebarAction?: { toggle(): Promise<void> };
  browserAction?: typeof browser.action;
};

export default defineBackground(() => {
  if (browser.sidePanel?.setPanelBehavior) {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    return;
  }
  const b = browser as unknown as FirefoxExtras;
  const action = browser.action ?? b.browserAction;
  action?.onClicked.addListener(() => {
    void b.sidebarAction?.toggle();
  });
});
