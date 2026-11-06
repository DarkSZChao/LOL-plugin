import { config } from '../core/config';
import type { FeatureContext } from '../core/context';
import { report } from '../core/lcu';

const confirmations = new Set([
  '确定', '確定', '确认', '確認', '继续', '繼續', '完成', '知道了', '好的', '领取', '領取', '收下',
  'ok', 'okay', 'continue', 'done', 'got it', 'claim', 'collect',
]);

export function autoDismissRewards({ flow, injector, scope }: FeatureContext): void {
  let endedAt: number | null = null;
  let nextClickAt = 0;
  let seen = new WeakMap<HTMLElement, { signature: string; attempts: number; at: number }>();
  let wasEnding = false;
  const ending = () => flow.phase === 'PreEndOfGame' || flow.phase === 'EndOfGame';
  scope.own(flow.onChange(() => {
    const isEnding = ending();
    if (isEnding && !wasEnding) { seen = new WeakMap(); nextClickAt = 0; }
    if (isEnding) endedAt = Date.now();
    wasEnding = isEnding;
  }));
  const visible = (element: HTMLElement): boolean => {
    if (!element.isConnected) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  };
  scope.own(injector.register(() => {
    const now = Date.now();
    if (!config.autoOpenStats || now < nextClickAt) return;
    if (!ending() && !(endedAt !== null && now - endedAt < 30000 &&
      (flow.phase === 'Lobby' || flow.phase === 'None'))) return;
    // Native UIKit templates verified in the installed client. Never match generic dialogs.
    for (const root of document.querySelectorAll<HTMLElement>(
      '.lol-uikit-vignette-celebration-layer, .dialog-celebration-container',
    )) {
      if (!visible(root)) continue;
      for (const button of root.querySelectorAll<HTMLElement>('.footer-button, .dialog-celebration-ok-button')) {
        if (!visible(button) || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true' ||
          button.classList.contains('disabled') || getComputedStyle(button).pointerEvents === 'none') continue;
        const label = button.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
        if (!confirmations.has(label)) continue;
        // Vignette reuses the same button for consecutive rewards, so include reward content.
        const signature = label + '|' + root.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500);
        let previous = seen.get(button);
        if (!previous || previous.signature !== signature) {
          previous = { signature, attempts: 0, at: now };
          seen.set(button, previous);
          scope.later(injector.schedule, 400);
          continue;
        }
        if (previous.attempts >= 5 || now - previous.at < (previous.attempts ? 1000 : 400)) continue;
        previous.attempts++;
        previous.at = now;
        nextClickAt = now + 400;
        try {
          button.ownerDocument.defaultView!.HTMLElement.prototype.click.call(button);
        } catch (error) { report('自动跳过奖励', error); }
        return;
      }
    }
  }));
}
