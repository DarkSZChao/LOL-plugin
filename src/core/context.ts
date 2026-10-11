import type { Events, Scope } from './events';
import type { Gameflow } from './gameflow';
import type { Injector } from './injector';
import type { Lcu } from './lcu';

export interface FeatureContext {
  lcu: Lcu;
  events: Events;
  flow: Gameflow;
  injector: Injector;
  scope: Scope;
}
