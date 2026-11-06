import { config } from '../core/config';
import type { FeatureContext } from '../core/context';
import { Scope } from '../core/events';
import { report } from '../core/lcu';
import { autoDismissRewards } from './auto-dismiss-rewards';

export function autoOpenStats(
  context: FeatureContext,
  waitForHonor: () => Promise<void>,
): void {
  const { flow, injector, scope } = context;
  autoDismissRewards(context);
  let nativeApi: { displayMatchDetails(options: {
    sections: string[]; defaultSection: string; dataSource: string; hideHeader: boolean;
    gameMode?: string; closeModalCallback: () => void;
  }): void | Promise<void> } | undefined;
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
  let clicked = new WeakMap<HTMLElement, { attempts: number; at: number }>();
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
    if (clickEpoch !== epoch) { clickEpoch = epoch; clicked = new WeakMap(); }
    return new Promise(resolve => {
      let done = false;
      let awaitingDetails = false;
      let nativeAttempts = 0;
      let detailsSeen = false;
      let lastStage = '等待进阶记录入口';
      let remove = () => {};
      let cancel = () => {};
      const finish = (opened: boolean) => {
        if (done) return;
        done = true; remove(); cancel(); resolve(opened);
      };
      const click = (element: HTMLElement | null) => {
        if (!actionable(element)) return false;
        const previous = clicked.get(element);
        if (previous && (previous.attempts >= 3 || Date.now() - previous.at < 1000)) return false;
        clicked.set(element, { attempts: (previous?.attempts ?? 0) + 1, at: Date.now() });
        // Riot flat buttons override .click with a mouse-event handler expecting event.button.
        // Invoke the DOM method from this element's realm to dispatch a real click event.
        try { element.ownerDocument.defaultView!.HTMLElement.prototype.click.call(element); }
        catch (error) { report('点击统计入口（稍后重试）', error); }
        return true;
      };
      job.own(() => finish(false));
      // Selectors verified against the installed rcp-fe-lol-postgame/match-history resources.
      const step = () => {
        if (!current()) { finish(false); return; }
        const details = findVisible(document, '.match-details-root.match-details-no-header');
        if (details) {
          detailsSeen = true;
          lastStage = '等待己方身份及图表';
          const graph = findVisible(details, '.match-graph-container:not(.match-details-loading-hide) .match-graph-display');
          if (graph) { statsEpoch = epoch; finish(true); return; }
          // The native data view marks our avatar only after the local player is resolved.
          // Graph snapshots this identity on creation; opening it earlier can swap team colors.
          const standardTabs = findVisible(details, '.rcp-fe-lol-match-details-overlay-sub-nav');
          if (standardTabs && !findVisible(details, '.team-avatar-wrapper.current')) return;
          const graphTab = findAction(details, '.rcp-fe-lol-match-details-overlay-sub-nav [data-name="graph"]') ||
            [...details.querySelectorAll('.jade-match-details-tabs-nav')].map(nav =>
              nav.querySelectorAll<HTMLElement>('.jade-match-details-tab')[1]).find(tab => actionable(tab ?? null));
          click(graphTab || null);
          return;
        }
        // A visible details view disappearing is a user close, not a failed open.
        if (detailsSeen) { statsEpoch = epoch; finish(false); return; }
        if (awaitingDetails) return;
        // Prefer the real button: it also initializes postgame state and emits native events.
        const advanced = findAction(document, '.postgame-match-history-button') ||
          [...document.querySelectorAll<HTMLElement>('lol-uikit-flat-button, button')].find(element =>
            actionable(element) && ['观看进阶记录', '觀看進階紀錄', 'View Advanced Details'].includes(
              element.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
        if (advanced && (!nativeApi || nativeAttempts > 0 || !clicked.has(advanced)) && click(advanced)) {
          lastStage = '已点击进阶记录，等待页面';
          awaitingDetails = true;
          job.later(() => {
            if (done || !current()) return;
            awaitingDetails = false;
            injector.schedule();
          }, 1000);
          return;
        }
        if (nativeApi && nativeAttempts < 3) {
          nativeAttempts++;
          lastStage = '已调用进阶记录模块，等待页面';
          awaitingDetails = true;
          // Same API and eogStats source used by the native advanced-record button.
          // Initialize the native data view before selecting Graph, matching manual navigation.
          try {
            const gameMode = flow.game?.gameData?.queue?.gameMode || flow.game?.map?.gameMode;
            const result = nativeApi.displayMatchDetails({
              sections: gameMode === 'JADE' || gameMode === 'CRAB' ? ['stats', 'graph'] : ['stats', 'graph', 'runes'],
              defaultSection: 'stats', dataSource: 'eogStats', hideHeader: true, gameMode,
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
            console.info('[ARAM Lite] 已请求原生进阶记录，等待己方身份后打开图表');
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
        const scoreboard = [...document.querySelectorAll(
          '.postgame-sub-navigation-container, .jade-postgame-tabs-container',
        )].map(nav => nav.querySelectorAll<HTMLElement>('lol-uikit-navigation-item, .jade-postgame-tab')[1])
          .find(tab => actionable(tab ?? null));
        click(scoreboard || null);
      };
      const safeStep = () => {
        if (done) return;
        try { step(); }
        catch (error) { report('统计界面尚未就绪（稍后重试）', error); }
      };
      remove = injector.register(safeStep);
      safeStep();
      if (!done) cancel = job.later(() => {
        report('自动打开伤害统计', new Error('等待超时：' + lastStage), true);
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
      if (!current() || !await job.delay(config.openStatsDelayMs)) return;
      if (current()) await openStats(job, epoch, current);
    })().catch(error => report('自动打开统计', error));
  }));
}
