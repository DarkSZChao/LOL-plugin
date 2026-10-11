import { config } from '../core/config';
import type { FeatureContext } from '../core/context';
import { Scope } from '../core/events';
import { report } from '../core/lcu';

export function autoOpenStats(
  { flow, injector, scope }: FeatureContext,
  waitForHonor: () => Promise<void>,
): void {
  let nativeApi: { displayMatchDetails(options: {
    sections: string[]; defaultSection: string; dataSource: string; hideHeader: boolean;
    gameMode?: string; closeModalCallback: () => void;
  }): void | Promise<void> } | undefined;
  let nativeEpoch = -1;
  // Pengu exposes initialized Riot modules, including on a client page reload.
  const rcp = (window as Window & { rcp?: { whenReady?: (name: string) => Promise<unknown> } }).rcp;
  if (rcp?.whenReady) {
    try {
      void rcp.whenReady('rcp-fe-lol-match-history').then(api => {
        if (!scope.active) return;
        if (api && typeof (api as typeof nativeApi)?.displayMatchDetails === 'function') {
          nativeApi = api as typeof nativeApi;
          injector.schedule();
        }
      }).catch(error => report('读取原生统计模块（改用按钮）', error));
    } catch (error) { report('读取原生统计模块（改用按钮）', error); }
  }
  let statsEpoch = -1;
  let clickEpoch = -1;
  let clicked = new WeakSet<HTMLElement>();
  const visible = (element: HTMLElement | null): element is HTMLElement => {
    if (!element?.isConnected) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const actionable = (element: HTMLElement | null): element is HTMLElement =>
    visible(element) && !element.hasAttribute('disabled') &&
    element.getAttribute('aria-disabled') !== 'true' && !element.classList.contains('disabled');
  const findVisible = (root: ParentNode, selector: string): HTMLElement | undefined =>
    [...root.querySelectorAll<HTMLElement>(selector)].find(visible);
  const findAction = (root: ParentNode, selector: string): HTMLElement | undefined =>
    [...root.querySelectorAll<HTMLElement>(selector)].find(actionable);
  function openStats(job: Scope, epoch: number, current: () => boolean): Promise<boolean> {
    if (statsEpoch === epoch) return Promise.resolve(true);
    if (clickEpoch !== epoch) { clickEpoch = epoch; clicked = new WeakSet(); }
    return new Promise(resolve => {
      let done = false;
      let awaitingDetails = false;
      let remove = () => {};
      let cancel = () => {};
      const finish = (opened: boolean) => {
        if (done) return;
        done = true; remove(); cancel(); resolve(opened);
      };
      const click = (element: HTMLElement | null) => {
        if (!actionable(element) || clicked.has(element)) return false;
        clicked.add(element);
        element.click();
        return true;
      };
      job.own(() => finish(false));
      // Selectors verified against the installed rcp-fe-lol-postgame/match-history resources.
      const step = () => {
        if (!current()) { finish(false); return; }
        const details = findVisible(document, '.match-details-root.match-details-no-header');
        if (details) {
          const graph = findVisible(details, '.match-graph-container:not(.match-details-loading-hide) .match-graph-display');
          if (graph) { statsEpoch = epoch; finish(true); return; }
          const graphTab = findAction(details, '.rcp-fe-lol-match-details-overlay-sub-nav [data-name="graph"]') ||
            [...details.querySelectorAll('.jade-match-details-tabs-nav')].map(nav =>
              nav.querySelectorAll<HTMLElement>('.jade-match-details-tab')[1]).find(tab => actionable(tab ?? null));
          click(graphTab || null);
          return;
        }
        if (nativeApi && nativeEpoch !== epoch && !awaitingDetails) {
          nativeEpoch = epoch;
          awaitingDetails = true;
          // Same API and eogStats source used by the native advanced-record button.
          // Request Graph directly so the asynchronously created modal selects it itself.
          try {
            const gameMode = flow.game?.gameData?.queue?.gameMode || flow.game?.map?.gameMode;
            const result = nativeApi.displayMatchDetails({
              sections: gameMode === 'JADE' || gameMode === 'CRAB' ? ['stats', 'graph'] : ['stats', 'graph', 'runes'],
              defaultSection: 'graph', dataSource: 'eogStats', hideHeader: true, gameMode,
              closeModalCallback: () => {
                if (!current()) return;
                statsEpoch = epoch;
                finish(false);
              },
            });
            void Promise.resolve(result).catch(error => {
              if (done || !current()) return;
              awaitingDetails = false;
              report('打开原生统计（改用按钮）', error);
              injector.schedule();
            });
            console.info('[ARAM Lite] 已请求原生进阶记录图表');
            job.later(() => {
              if (done || !current()) return;
              awaitingDetails = false;
              injector.schedule();
            }, 2000);
          } catch (error) {
            awaitingDetails = false;
            report('打开原生统计（改用按钮）', error);
          }
          if (awaitingDetails) return;
        }
        if (awaitingDetails) return;
        // Open the native advanced record before attempting its Graph tab.
        const advanced = findAction(document, '.postgame-match-history-button') ||
          [...document.querySelectorAll<HTMLElement>('lol-uikit-flat-button, button')].find(element =>
            actionable(element) && ['观看进阶记录', '觀看進階紀錄', 'View Advanced Details'].includes(
              element.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
        if (advanced) {
          awaitingDetails = click(advanced);
          if (awaitingDetails) job.later(() => {
            if (done || !current()) return;
            awaitingDetails = false;
            injector.schedule();
          }, 1000);
          return;
        }
        const scoreboard = [...document.querySelectorAll(
          '.postgame-sub-navigation-container, .jade-postgame-tabs-container',
        )].map(nav => nav.querySelectorAll<HTMLElement>('lol-uikit-navigation-item, .jade-postgame-tab')[1])
          .find(tab => actionable(tab ?? null));
        click(scoreboard || null);
      };
      remove = injector.register(step);
      step();
      if (!done) cancel = job.later(() => {
        report('自动打开伤害统计', new Error('等待原生统计界面超时，本次跳过自动打开'), true);
        finish(false);
      }, 15000);
    });
  }
  let pending: { epoch: number; scope: Scope } | undefined;
  scope.own(() => pending?.scope.dispose());
  scope.own(flow.onChange(() => {
    if (!config.autoOpenStats || flow.phase !== 'EndOfGame') {
      pending?.scope.dispose(); pending = undefined;
      return;
    }
    const epoch = flow.phaseEpoch;
    if (statsEpoch === epoch || pending?.epoch === epoch) return;
    pending?.scope.dispose();
    const job = new Scope();
    pending = { epoch, scope: job };
    const current = () => scope.active && job.active && config.autoOpenStats &&
      flow.phase === 'EndOfGame' && flow.phaseEpoch === epoch;
    void (async () => {
      await waitForHonor();
      if (current()) await openStats(job, epoch, current);
    })().catch(error => report('自动打开统计', error));
  }));
}