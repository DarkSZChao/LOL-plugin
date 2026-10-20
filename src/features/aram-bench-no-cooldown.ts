import { config } from '../core/config';
import type { FeatureContext } from '../core/context';
import { report, uri } from '../core/lcu';
import { stopClick } from '../core/injector';
import type { ChampSession } from '../core/types';
import { benchLog } from '../core/bench-log';

const marker = 'data-aram-lite-bench';
const styleId = 'aram-lite-bench-style';
export function aramBenchNoCooldown({ flow, injector, lcu, scope }: FeatureContext): void {
  let busy = false;
  let requestOwner = 0;
  let attempts = 0;
  const snapshot = (session: ChampSession | null = flow.champ) => ({
    phase: flow.phase, selectionEpoch: flow.selectionEpoch, isAram: flow.isAram,
    enabled: config.benchNoCooldown, busy,
    gameId: session?.gameId ?? flow.game?.gameData?.gameId,
    queueId: session?.queueId ?? flow.game?.gameData?.queue?.id,
    benchEnabled: session?.benchEnabled,
    timer: session?.timer && { phase: session.timer.phase, inBanPickPhase: session.timer.inBanPickPhase,
      inFinalizationPhase: session.timer.inFinalizationPhase },
    localChampion: session?.myTeam?.find(player => player.cellId === session.localPlayerCellId)?.championId,
    bench: session?.benchChampions?.map(champion => champion.championId),
    team: session?.myTeam?.map(player => ({ cell: player.cellId, champion: player.championId })),
    actions: session?.actions?.flat().map(action => ({ id: action.id, type: action.type,
      cell: action.actorCellId, completed: action.completed, champion: action.championId })),
  });
  let previousState = '';
  scope.own(flow.onChange(() => {
    if (flow.phase !== 'ChampSelect' && !previousState) return;
    const state = snapshot();
    const encoded = JSON.stringify(state);
    if (encoded !== previousState) benchLog.record('selection-state', state);
    previousState = flow.phase === 'ChampSelect' ? encoded : '';
  }));
  const championId = (item: Element): number => {
    const icon = item.querySelector<HTMLElement>('.bench-champion-background');
    const background = icon && (icon.style.backgroundImage || getComputedStyle(icon).backgroundImage);
    const match = background?.match(/champion-icons\/(\d+)\.png/);
    return match ? Number(match[1]) : 0;
  };
  const isOnBench = (id: number) => id > 0 && !!flow.champ?.benchChampions?.some(champion => champion.championId === id);
  scope.own(injector.onPointerDown('.bench-container', (event, container) => {
    const item = event.composedPath().filter((node): node is Element => node instanceof Element)
      .map(node => node.closest('.champion-bench-item')).find(Boolean);
    benchLog.record('pointerdown', { ...snapshot(), button: event.button,
      targetChampion: item ? championId(item) : null, itemClasses: item?.className, containerClasses: container.className });
  }));
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
    const attempt = ++attempts;
    benchLog.record('click', { attempt, ...snapshot(), targetChampion: championId(item), itemClasses: item.className, trusted: event.isTrusted });
    if (!config.benchNoCooldown || !flow.isAram || !flow.champ?.benchEnabled) {
      benchLog.record('ignored', { attempt, reason: 'feature-or-session-not-ready', ...snapshot() });
      return;
    }
    // Keep native eligibility and phase locks; only bypass the swap cooldown.
    if (item.classList.contains('empty-bench-item')) { benchLog.record('ignored', { attempt, reason: 'empty-slot' }); return; }
    if (item.classList.contains('locked-out') || item.classList.contains('waiting-on-finalization')) {
      benchLog.record('ignored', { attempt, reason: 'native-eligibility-or-phase-lock' });
      return;
    }
    const id = championId(item);
    if (!isOnBench(id)) {
      benchLog.record('ignored', { attempt, reason: id ? 'not-in-bench' : 'champion-icon-unrecognized', targetChampion: id });
      return;
    }
    stopClick(event);
    if (busy) { benchLog.record('ignored', { attempt, reason: 'request-in-progress' }); return; }
    busy = true;
    requestOwner = attempt;
    const epoch = flow.selectionEpoch;
    const current = () => scope.active && flow.isAram && flow.selectionEpoch === epoch;
    console.info('[ARAM Lite] Bench POST id=' + id);
    const endpoint = uri.champ + '/bench/swap/' + id;
    benchLog.record('request', { attempt, method: 'POST', endpoint, ...snapshot() });
    void lcu.request('POST', endpoint, undefined, (status, body) => {
      benchLog.record('response', { attempt, status, body: body.slice(0, 2048) });
    }).then(async () => {
      if (requestOwner === attempt) busy = false;
      if (!current()) { benchLog.record('verification-stopped', { attempt, reason: 'selection-ended' }); return; }
      // A successful HTTP response alone does not prove a swap took effect.
      for (let check = 0; check < 3 && current(); check++) {
        const session = await lcu.get<ChampSession>(uri.champ);
        benchLog.record('verification', { attempt, check: check + 1, ...snapshot(session) });
        if (!current()) return;
        if (session?.myTeam?.find(player => player.cellId === session.localPlayerCellId)?.championId === id) {
          console.info('[ARAM Lite] Bench confirmed id=' + id);
          benchLog.record('confirmed', { attempt, targetChampion: id, ...snapshot(session) });
          return;
        }
        if (check < 2 && !await scope.delay(500)) return;
      }
      if (current()) {
        benchLog.record('unconfirmed', { attempt, targetChampion: id, ...snapshot() });
      }
    })
      .catch(error => {
        benchLog.record('error', { attempt, message: String(error) });
        report('Bench 换英雄', error, true);
      })
      .finally(() => { if (requestOwner === attempt) busy = false; });
  }));
  scope.own(() => { restore(); document.getElementById(styleId)?.remove(); });
}
