// Endpoints and payloads verified against WJZ-P/sona; see SOURCE_MAP.md.
export const uri = {
  phase: '/lol-gameflow/v1/gameflow-phase',
  game: '/lol-gameflow/v1/session',
  champ: '/lol-champ-select/v1/session',
  ready: '/lol-matchmaking/v1/ready-check',
  lobby: '/lol-lobby/v2/lobby',
  friends: '/lol-chat/v1/friends',
  queues: '/lol-game-queues/v1/queues',
  ballot: '/lol-honor-v2/v1/ballot',
} as const;

export class LcuError extends Error {
  constructor(readonly status: number, method: string, endpoint: string) {
    super(method + ' ' + endpoint + ' → ' + status);
  }
}
export class Lcu {
  async request<T = void>(method: string, endpoint: string, body?: unknown,
    onResponse?: (status: number, text: string) => void): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      try { onResponse?.(response.status, text); } catch { /* Observers cannot change request outcomes. */ }
      if (!response.ok) throw new LcuError(response.status, method, endpoint);
      return (text ? JSON.parse(text) : undefined) as T;
    } finally { clearTimeout(timer); }
  }
  get<T>(endpoint: string): Promise<T> { return this.request<T>('GET', endpoint); }
  post<T = void>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', endpoint, body);
  }
  patch(endpoint: string, body: unknown): Promise<void> {
    return this.request('PATCH', endpoint, body);
  }
  delete(endpoint: string): Promise<void> { return this.request('DELETE', endpoint); }
}

export function report(feature: string, error: unknown, notify = false): void {
  const message = '[ARAM Lite] ' + feature + ': ' + String(error);
  console.warn(message);
  const toast = (globalThis as typeof globalThis & { Toast?: { error(message: string): void } }).Toast;
  if (notify) toast?.error(message);
}
