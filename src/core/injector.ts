import type { Cleanup } from './types';
import { report } from './lcu';

type Task = () => void;
type ClickHandler = (event: MouseEvent, element: HTMLElement) => void;
export class Injector {
  private tasks = new Set<Task>();
  private clicks = new Map<string, ClickHandler>();
  private pointerDowns = new Map<string, ClickHandler>();
  private observer?: MutationObserver;
  private frame: number | null = null;
  private tick?: ReturnType<typeof setInterval>;
  register(task: Task): Cleanup {
    this.tasks.add(task);
    this.schedule();
    return () => { this.tasks.delete(task); };
  }
  onClick(selector: string, handler: ClickHandler): Cleanup {
    this.clicks.set(selector, handler);
    return () => { this.clicks.delete(selector); };
  }
  onPointerDown(selector: string, handler: ClickHandler): Cleanup {
    this.pointerDowns.set(selector, handler);
    return () => { this.pointerDowns.delete(selector); };
  }
  private handleClick = (event: MouseEvent): void => {
    this.dispatch(event, this.clicks);
  };
  private handlePointerDown = (event: MouseEvent): void => { this.dispatch(event, this.pointerDowns); };
  private dispatch(event: MouseEvent, handlers: Map<string, ClickHandler>): void {
    const path = event.composedPath().filter((node): node is Element => node instanceof Element);
    for (const [selector, handler] of handlers) {
      const element = path.map(node => node.closest<HTMLElement>(selector)).find(Boolean);
      if (element) {
        try { handler(event, element); } catch (error) { report('点击处理', error); }
        if (event.cancelBubble) break;
      }
    }
  }
  schedule = (): void => {
    if (!this.observer || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      for (const task of this.tasks) {
        try { task(); } catch (error) { report('DOM 注入', error); }
      }
    });
  };
  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(this.schedule);
    this.observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'style', 'disabled', 'aria-disabled', 'data-puuid'],
    });
    // One delegated handler survives replaced/cloned client nodes.
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('pointerdown', this.handlePointerDown, true);
    this.tick = setInterval(this.schedule, 1000);
    this.schedule();
  }
  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    clearInterval(this.tick);
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('pointerdown', this.handlePointerDown, true);
    this.tasks.clear();
    this.clicks.clear();
    this.pointerDowns.clear();
  }
}
export function stopClick(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}
