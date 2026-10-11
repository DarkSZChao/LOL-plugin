import { config, marks } from '../core/config';
import type { FeatureContext } from '../core/context';
import { Scope } from '../core/events';
import { LcuError, report } from '../core/lcu';
import { stopClick } from '../core/injector';

export function autoReturnLobby(
  { flow, lcu, injector, scope }: FeatureContext,
  waitForHonor: () => Promise<void>,
): void {
  let endedAt: number | null = null;
  let endEpoch = 0;
  let handledEpoch = -1;
  let cancelledEpoch = -1;
  let pending: { epoch: number; delay: number; scope: Scope } | undefined;
  const notice = document.createElement('div');
  notice.id = 'aram-lite-return-countdown';
  notice.setAttribute('role', 'region');
  notice.setAttribute('aria-label', '自动回房倒计时');
  notice.style.cssText = 'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);z-index:10001;display:flex;align-items:center;gap:16px;padding:10px 16px;border:1px solid #785a28;border-radius:5px;background:#09121bf2;color:#f0e6d2;font:14px/1.5 Arial,"Microsoft YaHei",sans-serif;box-shadow:0 4px 16px #0008';
  const label = document.createElement('span');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '取消回房';
  button.style.cssText = 'font:inherit;color:#f0e6d2;background:#142332;border:1px solid #785a28;border-radius:3px;padding:4px 10px;cursor:pointer';
  notice.append(label, button);
  function render(): void {
    const isEnd = flow.phase === 'PreEndOfGame' || flow.phase === 'EndOfGame';
    if (!scope.active || !config.autoReturnLobby || !isEnd || endedAt === null ||
      cancelledEpoch === endEpoch || handledEpoch === endEpoch) {
      notice.remove();
      return;
    }
    const seconds = Math.ceil(Math.max(0, endedAt + config.returnLobbyDelayMs - Date.now()) / 1000);
    const text = seconds > 0 ? seconds + ' 秒后自动回房' :
      flow.phase === 'PreEndOfGame' ? '等待结算后回房' : '等待点赞完成后回房';
    if (label.textContent !== text) label.textContent = text;
    for (const duplicate of document.querySelectorAll('#aram-lite-return-countdown')) {
      if (duplicate !== notice) duplicate.remove();
    }
    if (!notice.isConnected) document.body?.append(notice);
  }
  scope.own(injector.register(render));
  scope.own(() => notice.remove());
  scope.own(injector.onClick('#aram-lite-return-countdown button', event => {
    stopClick(event);
    cancelledEpoch = endEpoch;
    cancel();
    render();
  }));
  function cancel(): void { pending?.scope.dispose(); pending = undefined; }
  scope.own(cancel);
  scope.own(flow.onChange(() => {
    const isEnd = flow.phase === 'PreEndOfGame' || flow.phase === 'EndOfGame';
    if (!isEnd) { endedAt = null; cancel(); return; }
    if (endedAt === null) { endedAt = Date.now(); endEpoch++; }
    if (!config.autoReturnLobby || flow.phase !== 'EndOfGame') { cancel(); return; }
    const epoch = endEpoch;
    if (handledEpoch === epoch || cancelledEpoch === epoch) return;
    if (pending?.epoch === epoch && pending.delay === config.returnLobbyDelayMs) return;
    cancel();
    const job = new Scope();
    pending = { epoch, delay: config.returnLobbyDelayMs, scope: job };
    const current = () => scope.active && job.active && config.autoReturnLobby &&
      flow.phase === 'EndOfGame' && endEpoch === epoch && cancelledEpoch !== epoch;
    const remaining = Math.max(0, endedAt + config.returnLobbyDelayMs - Date.now());
    void (async () => {
      if (!await job.delay(remaining)) return;
      await waitForHonor();
      if (!current()) return;
      const gameId = flow.game?.gameData?.gameId;
      if (gameId && marks.get('return-game') === String(gameId)) {
        handledEpoch = epoch;
        render();
        return;
      }
      for (let attempt = 0; attempt < 3 && current(); attempt++) {
        handledEpoch = epoch;
        render();
        try {
          await lcu.post('/lol-lobby/v2/play-again');
          if (gameId) marks.set('return-game', String(gameId));
          return;
        } catch (error) {
          // Only retry explicit transient HTTP failures, never an ambiguous timeout.
          if (!(error instanceof LcuError && [400, 404, 409, 500, 503].includes(error.status)) || attempt === 2) {
            report('自动回房间', error);
            return;
          }
          if (!await job.delay(1000)) return;
        }
      }
    })().catch(error => report('自动回房间', error));
  }));
}