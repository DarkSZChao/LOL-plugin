import { config } from '../core/config';
import type { FeatureContext } from '../core/context';
import { report, uri } from '../core/lcu';

export function autoAccept({ flow, lcu, scope }: FeatureContext): void {
  let handledEpoch = -1;
  let declined = false;
  let pendingEpoch = -1;
  let pendingDelay = -1;
  let cancel = () => {};
  function cancelPending(): void { cancel(); pendingEpoch = -1; }
  scope.own(flow.onChange(() => {
    if (flow.ready?.playerResponse === 'Declined') declined = true;
    if (flow.phase !== 'ReadyCheck') {
      cancelPending();
      if (flow.phase === 'None' || flow.phase === 'Lobby') declined = false;
      return;
    }
    if (flow.ready?.playerResponse === 'Accepted') handledEpoch = flow.phaseEpoch;
    if (!config.autoAccept || declined || !flow.ready || handledEpoch === flow.phaseEpoch) {
      cancelPending();
      return;
    }
    if (pendingEpoch === flow.phaseEpoch && pendingDelay === config.autoAcceptDelayMs) return;
    cancelPending();
    const epoch = pendingEpoch = flow.phaseEpoch;
    pendingDelay = config.autoAcceptDelayMs;
    cancel = scope.later(() => {
      pendingEpoch = -1;
      if (!config.autoAccept || flow.phase !== 'ReadyCheck' || flow.phaseEpoch !== epoch || declined) return;
      if (flow.ready?.playerResponse === 'Accepted' || flow.ready?.playerResponse === 'Declined') return;
      handledEpoch = epoch;
      void lcu.post(uri.ready + '/accept').catch(error => report('自动接受', error));
    }, pendingDelay);
  }));
}
