import { config } from '../core/config';
import type { FeatureContext } from '../core/context';
import { report, uri } from '../core/lcu';
import { stopClick } from '../core/injector';

const marker = 'data-aram-lite-bench';
const styleId = 'aram-lite-bench-style';
export function aramBenchNoCooldown({ flow, injector, lcu, scope }: FeatureContext): void {
  let busy = false;
  const removed = new Map<Element, Set<string>>();
  const restore = () => {
    for (const [element, classes] of removed) {
      if (element.isConnected) element.classList.add(...classes);
    }
    removed.clear();
    document.querySelectorAll('[' + marker + ']').forEach(element => element.removeAttribute(marker));
  };
  scope.own(injector.register(() => {
    if (!config.benchNoCooldown || !flow.isAram || !flow.champ?.benchEnabled) { restore(); return; }
    for (const element of removed.keys()) if (!element.isConnected) removed.delete(element);
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = '[' + marker + '] .cooldown-mask{display:none!important}';
      (document.head || document.documentElement).append(style);
    }
    document.querySelectorAll('.bench-container').forEach(container => {
      if (!container.hasAttribute(marker)) container.setAttribute(marker, '');
      container.querySelectorAll('[class*="on-cooldown"]').forEach(element => {
        const classes = [...element.classList].filter(name => name.startsWith('on-cooldown'));
        if (!classes.length) return;
        let saved = removed.get(element);
        if (!saved) removed.set(element, saved = new Set());
        for (const name of classes) { saved.add(name); element.classList.remove(name); }
      });
    });
  }));
  scope.own(injector.onClick('.bench-container .champion-bench-item', (event, item) => {
    if (!config.benchNoCooldown || !flow.isAram || !flow.champ?.benchEnabled) return;
    if (item.classList.contains('empty-bench-item') || item.classList.contains('locked-out')) return;
    const icon = item.querySelector<HTMLElement>('.bench-champion-background');
    const background = icon && (icon.style.backgroundImage || getComputedStyle(icon).backgroundImage);
    const match = background?.match(/champion-icons\/(\d+)\.png/);
    const id = match ? Number(match[1]) : 0;
    if (!id || !flow.champ.benchChampions?.some(champion => champion.championId === id)) return;
    stopClick(event);
    if (busy) return;
    busy = true;
    void lcu.post(uri.champ + '/bench/swap/' + id)
      .catch(error => report('Bench 换英雄', error, true))
      .finally(() => { busy = false; });
  }));
  scope.own(() => { restore(); document.getElementById(styleId)?.remove(); });
}
