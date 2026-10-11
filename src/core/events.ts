import type { Cleanup, LcuEvent, PenguContext } from './types';
import { report } from './lcu';

type Listener = (event: LcuEvent) => void;
export class Events {
  private listeners = new Map<string, Set<Listener>>();
  private socket?: PenguContext['socket'];
  // Keep subscriptions across stop/start; Pengu has no per-URI unobserve.
  private observed = new Set<string>();
  private subscriptions = new WeakMap<PenguContext['socket'], Set<string>>();
  bind(context: PenguContext): void {
    if (this.socket === context.socket) return;
    this.socket = context.socket;
    this.observed = this.subscriptions.get(context.socket) ?? new Set();
    this.subscriptions.set(context.socket, this.observed);
    for (const endpoint of this.listeners.keys()) this.observe(endpoint);
  }
  on(endpoint: string, callback: Listener): Cleanup {
    let listeners = this.listeners.get(endpoint);
    if (!listeners) this.listeners.set(endpoint, listeners = new Set());
    listeners.add(callback);
    this.observe(endpoint);
    return () => { listeners.delete(callback); };
  }
  private observe(endpoint: string): void {
    const socket = this.socket;
    if (!socket || this.observed.has(endpoint)) return;
    this.observed.add(endpoint);
    socket.observe(endpoint, event => {
      if (this.socket !== socket) return;
      for (const listener of this.listeners.get(endpoint) ?? []) {
        try { listener(event); } catch (error) { report('事件处理', error); }
      }
    });
  }
}

export class Scope {
  private controller = new AbortController();
  private cleanups: Cleanup[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  get active(): boolean { return !this.controller.signal.aborted; }
  own(cleanup: Cleanup): void { this.cleanups.push(cleanup); }
  later(callback: () => void, ms: number): Cleanup {
    if (!this.active) return () => {};
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.active) callback();
    }, ms);
    this.timers.add(timer);
    return () => { clearTimeout(timer); this.timers.delete(timer); };
  }
  delay(ms: number): Promise<boolean> {
    if (!this.active) return Promise.resolve(false);
    return new Promise(resolve => {
      const finish = (ok: boolean) => {
        cancel();
        this.controller.signal.removeEventListener('abort', aborted);
        resolve(ok);
      };
      const aborted = () => finish(false);
      const cancel = this.later(() => finish(true), ms);
      this.controller.signal.addEventListener('abort', aborted, { once: true });
    });
  }
  dispose(): void {
    this.controller.abort();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
}
