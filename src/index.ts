import { loadConfig, onConfigChange } from './core/config';
import { Events, Scope } from './core/events';
import { Gameflow } from './core/gameflow';
import { Injector } from './core/injector';
import { Lcu } from './core/lcu';
import type { PenguContext } from './core/types';
import { autoAccept } from './features/auto-accept';
import { aramBenchNoCooldown } from './features/aram-bench-no-cooldown';
import { aramDefaultSpells } from './features/aram-default-spells';
import { champSelectQuit } from './features/champselect-quit';
import { autoOpenStats } from './features/auto-open-stats';
import { autoReturnLobby } from './features/auto-return-lobby';
import { autoHonor } from './features/auto-honor';
import { friendEnhancement } from './features/friend-enhancement';
import { quickLobby } from './features/quick-lobby';
import { controlPanel } from './features/control-panel';

class Plugin {
  readonly lcu = new Lcu();
  readonly events = new Events();
  readonly flow = new Gameflow(this.lcu, this.events);
  readonly injector = new Injector();
  private scope?: Scope;
  start(): void {
    if (this.scope?.active) return;
    loadConfig();
    const scope = this.scope = new Scope();
    const context = { lcu: this.lcu, events: this.events, flow: this.flow, injector: this.injector, scope };
    // Register features before bootstrapping cached state.
    autoAccept(context);
    aramBenchNoCooldown(context);
    aramDefaultSpells(context);
    champSelectQuit(context);
    const waitForHonor = autoHonor(context);
    autoOpenStats(context, waitForHonor);
    autoReturnLobby(context, waitForHonor);
    friendEnhancement(context);
    quickLobby(context);
    controlPanel(context);
    scope.own(onConfigChange(() => {
      this.flow.refresh();
      this.injector.schedule();
    }));
    scope.own(this.flow.onChange(this.injector.schedule));
    this.injector.start();
    this.flow.start(scope);
    console.info('[ARAM Lite] 已启动');
  }
  stop(): void {
    this.scope?.dispose();
    this.scope = undefined;
    this.injector.stop();
  }
}

declare global {
  interface Window { __PENGU_ARAM_LITE__?: Plugin }
}
function runtime(): Plugin {
  return window.__PENGU_ARAM_LITE__ ??= new Plugin();
}
export function init(context: PenguContext): void { runtime().events.bind(context); }
export function load(): void { runtime().start(); }
export function unload(): void { runtime().stop(); }
