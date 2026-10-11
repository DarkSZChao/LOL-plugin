import type { Cleanup } from './types';
import { report } from './lcu';

type Task = () => void;
type ClickHandler = (event: MouseEvent, element: HTMLElement) => void;
export class Injector {
  private tasks = new Set<Task>();
  private clicks = new Map<string, ClickHandler>();
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
  private handleClick = (event: MouseEvent): void => {
    const target = event.composedPath().find(node => node instanceof Element) as Element | undefined;
    if (!target) return;
    for (const [selector, handler] of this.clicks) {
      const element = target.closest<HTMLElement>(selector);
      if (element) {
        try { handler(event, element); } catch (error) { report('点击处理', error); }
        if (event.cancelBubble) break;
      }
    }
  };
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
    this.tasks.clear();
    this.clicks.clear();
  }
}
export function stopClick(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}
