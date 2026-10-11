import type { ChampSession, Cleanup, GameSession, LobbyMember, LobbySession, ReadyCheck } from './types';
import { Events, Scope } from './events';
import { Lcu, LcuError, report, uri } from './lcu';

export class Gameflow {
  phase: string | null = null;
  game: GameSession | null = null;
  champ: ChampSession | null = null;
  ready: ReadyCheck | null = null;
  partyMembers: LobbyMember[] = [];
  phaseEpoch = 0;
  selectionEpoch = 0;
  freshSelection = false;
  private listeners = new Set<() => void>();
  private gamePhaseEpoch = -1;
  private revisions = new Map<string, number>();
  private requests = new Map<string, number>();

  constructor(private lcu: Lcu, private events: Events) {}
  get isAram(): boolean {
    if (this.phase !== 'ChampSelect' || !this.champ) return false;
    if (this.champ.queueId) return this.champ.queueId === 450 || this.champ.queueId === 2400;
    // A gameflow snapshot from the previous match cannot classify a new selection.
    if (this.gamePhaseEpoch !== this.phaseEpoch) return false;
    const gameId = this.game?.gameData?.gameId;
    if (gameId && this.champ.gameId && gameId !== this.champ.gameId) return false;
    const queueId = this.game?.gameData?.queue?.id;
    if (queueId) return queueId === 450 || queueId === 2400;
    return (this.game?.gameData?.queue?.gameMode || this.game?.map?.gameMode) === 'ARAM';
  }
  onChange(callback: () => void): Cleanup {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }
  refresh(): void { this.notify(); }
  private notify(): void {
    for (const callback of this.listeners) {
      try { callback(); } catch (error) { report('状态处理', error); }
    }
  }
  private revision(endpoint: string): number { return this.revisions.get(endpoint) ?? 0; }
  private apply(endpoint: string, value: unknown): void {
    this.revisions.set(endpoint, this.revision(endpoint) + 1);
    switch (endpoint) {
      case uri.phase: {
        const next = typeof value === 'string' ? value : null;
        if (this.phase !== next) {
          const previous = this.phase;
          this.phase = next;
          this.phaseEpoch++;
          if (next === 'None' || next === 'Lobby') this.partyMembers = [];
          if (next === 'ChampSelect') {
            this.champ = null;
            this.revisions.set(uri.champ, this.revision(uri.champ) + 1);
            this.selectionEpoch++;
            // Starting the plugin mid-selection must not overwrite manual spells.
            this.freshSelection = previous !== null;
          } else {
            this.champ = null;
            this.freshSelection = false;
            this.revisions.set(uri.champ, this.revision(uri.champ) + 1);
          }
          if (next !== 'ReadyCheck') {
            this.ready = null;
            this.revisions.set(uri.ready, this.revision(uri.ready) + 1);
          }
        }
        break;
      }
      case uri.lobby:
        // Freeze the premade roster through champion select, game and postgame.
        if (this.phase === null || ['None', 'Lobby', 'Matchmaking', 'ReadyCheck'].includes(this.phase)) {
          if (value) this.partyMembers = (value as LobbySession).members ?? [];
          else if (this.phase === null || this.phase === 'None' || this.phase === 'Lobby') this.partyMembers = [];
        }
        break;
      case uri.game: this.game = value as GameSession | null; this.gamePhaseEpoch = this.phaseEpoch; break;
      case uri.champ: this.champ = value as ChampSession | null; break;
      case uri.ready: this.ready = value as ReadyCheck | null; break;
    }
    this.notify();
  }
  private async hydrate(endpoint: string, scope: Scope): Promise<void> {
    const request = (this.requests.get(endpoint) ?? 0) + 1;
    this.requests.set(endpoint, request);
    const revision = this.revision(endpoint);
    const epoch = this.phaseEpoch;
    try {
      const value = await this.lcu.get<unknown>(endpoint);
      if (!scope.active || this.requests.get(endpoint) !== request || this.revision(endpoint) !== revision) return;
      if ((endpoint === uri.champ || endpoint === uri.ready || endpoint === uri.lobby) && this.phaseEpoch !== epoch) return;
      this.apply(endpoint, value);
    } catch (error) {
      if (!(error instanceof LcuError && error.status === 404)) report('读取状态', error);
    }
  }
  start(scope: Scope): void {
    for (const endpoint of [uri.phase, uri.game, uri.champ, uri.ready, uri.lobby]) {
      scope.own(this.events.on(endpoint, event => {
        this.apply(endpoint, event.eventType === 'Delete' ? null : event.data);
      }));
    }
    let previousEpoch = this.phaseEpoch;
    scope.own(this.onChange(() => {
      if (previousEpoch === this.phaseEpoch) return;
      previousEpoch = this.phaseEpoch;
      if (this.phase === 'ChampSelect') void this.hydrate(uri.champ, scope);
      if (this.phase === 'ReadyCheck') void this.hydrate(uri.ready, scope);
      if (this.phase && ['None', 'Lobby', 'Matchmaking', 'ReadyCheck'].includes(this.phase)) void this.hydrate(uri.lobby, scope);
      if (this.phase === 'ChampSelect') void this.hydrate(uri.game, scope);
    }));
    // Subscribe before snapshot reads so a late HTTP response cannot replace a newer event.
    void this.hydrate(uri.game, scope);
    void this.hydrate(uri.phase, scope);
    void this.hydrate(uri.lobby, scope);
    for (const delay of [1000, 3000]) scope.later(() => {
      if (this.phase === null) void this.hydrate(uri.phase, scope);
      if (this.game === null) void this.hydrate(uri.game, scope);
      if (this.phase === 'ChampSelect' && !this.champ) void this.hydrate(uri.champ, scope);
      if (this.phase === 'ReadyCheck' && !this.ready) void this.hydrate(uri.ready, scope);
    }, delay);
    scope.own(() => {
      this.phase = null; this.game = null; this.champ = null; this.ready = null; this.partyMembers = [];
      this.revisions.clear(); this.requests.clear(); this.gamePhaseEpoch = -1;
    });
  }
}
