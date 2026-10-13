export interface PenguContext {
  socket: { observe(uri: string, callback: (event: LcuEvent) => void): void };
}
export interface LcuEvent {
  uri: string;
  eventType: 'Create' | 'Update' | 'Delete';
  data: unknown;
}
export interface GameSession {
  gameData?: { gameId?: number; queue?: { id?: number; gameMode?: string } };
  map?: { gameMode?: string };
}
export interface ChampSession {
  gameId?: number;
  queueId?: number;
  benchEnabled?: boolean;
  benchChampions?: Array<{ championId: number }>;
  localPlayerCellId: number;
  myTeam: Array<{ championId?: number; cellId: number; spell1Id: number; spell2Id: number }>;
}
export interface LobbyMember { puuid?: string; summonerId?: number }
export interface LobbySession { members?: LobbyMember[] }
export interface ReadyCheck { playerResponse?: string }
export interface Friend {
  id?: string;
  puuid?: string;
  name?: string;
  gameName?: string;
  gameTag?: string;
  availability?: string;
  lol?: {
    gameId?: string;
    gameStatus?: string;
    pty?: string;
    ptyType?: string;
    gameMode?: string;
    gameQueueType?: string;
    queueId?: string;
    timeStamp?: string;
  };
}
export interface Queue { id: number; type?: string; name?: string; description?: string }
export interface HonorBallot {
  gameId: number;
  eligibleAllies?: Array<{ botPlayer?: boolean; puuid: string; summonerId: number }>;
  honoredPlayers?: unknown[];
  votePool?: { votes?: number };
}
export type Cleanup = () => void;
