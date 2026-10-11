import { config } from '../core/config';
import type { FeatureContext } from '../core/context';
import { report, uri } from '../core/lcu';
import { stopClick } from '../core/injector';

export function quickLobby({ flow, injector, lcu, scope }: FeatureContext): void {
  let busy = false;
  scope.own(injector.onClick('.play-button-container', (event, button) => {
    // This check must be synchronous: every other phase keeps the native click.
    if (!config.quickLobby || flow.phase !== 'None') return;
    if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return;
    stopClick(event);
    if (busy) return;
    busy = true;
    void lcu.post(uri.lobby, { queueId: config.aramQueueId }).then(() => {
      scope.later(() => { busy = false; }, 1500);
    }).catch(error => {
      busy = false;
      report('创建海克斯大乱斗大厅', error, true);
    });
  }));
  scope.own(flow.onChange(() => { if (flow.phase !== 'None') busy = false; }));
}
