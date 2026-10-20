import type { PluginFS } from './types';

interface Entry { at: string; event: string; data: unknown }
export class BenchLog {
  private entries: Entry[] = [];
  private fs?: PluginFS;
  private pending = Promise.resolve();
  readonly file = 'bench-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(16).slice(2, 8) + '.json';
  private readonly key = 'aram-lite:bench-log';
  private get store() {
    return (globalThis as typeof globalThis & { DataStore?: {
      get(key: string): unknown; set(key: string, value: unknown): boolean;
    } }).DataStore;
  }
  bind(fs?: PluginFS): void {
    if (this.fs === fs && this.entries.length) return;
    this.fs = fs;
    if (!this.entries.length) {
      try {
        const saved = this.store?.get(this.key);
        if (Array.isArray(saved)) this.entries = saved.slice(-500);
      } catch { /* File logging still works when the backup is unavailable. */ }
    }
    this.record('logger-ready', { file: this.file, fileSystemAvailable: !!fs });
  }
  record(event: string, data: unknown): void {
    // Diagnostic failures must never interrupt a click or send an extra LCU request.
    try {
      this.entries.push({ at: new Date().toISOString(), event, data });
      if (this.entries.length > 500) this.entries.splice(0, this.entries.length - 500);
      try { this.store?.set(this.key, this.entries.slice()); } catch { /* Keep the independent file sink working. */ }
      if (this.fs) {
        const fs = this.fs;
        const content = JSON.stringify({ version: 1, entries: this.entries }, null, 2);
        this.pending = this.pending.then(async () => {
          if (!await fs.write(this.file, content)) throw new Error('PluginFS.write returned false');
        }).catch(error => { console.warn('[ARAM Lite] Bench log write failed:', String(error)); });
      }
    } catch (error) { console.warn('[ARAM Lite] Bench log failed:', String(error)); }
  }
  flush(): Promise<void> { return this.pending; }
}
export const benchLog = new BenchLog();
