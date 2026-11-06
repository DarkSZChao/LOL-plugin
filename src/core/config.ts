import type { Cleanup } from './types';

export type HonorCategory = 'RANDOM' | 'HEART' | 'COOL' | 'SHOTCALLER';
export interface Config {
  autoAccept: boolean;
  benchNoCooldown: boolean;
  rememberSpells: boolean;
  champSelectQuit: boolean;
  autoOpenStats: boolean;
  autoReturnLobby: boolean;
  autoHonor: boolean;
  friendGroups: boolean;
  friendStatus: boolean;
  quickLobby: boolean;
  autoAcceptDelayMs: number;
  openStatsDelayMs: number;
  returnLobbyDelayMs: number;
  aramQueueId: 2400;
  spells: { spell1Id: number; spell2Id: number };
  honorCategory: HonorCategory;
}
export const switches = [
  ['autoAccept', '自动接受对局'],
  ['benchNoCooldown', 'Bench 无 CD'],
  ['rememberSpells', '记住召唤师技能'],
  ['champSelectQuit', '选人快捷退出'],
  ['autoOpenStats', '自动打开统计'],
  ['autoReturnLobby', '自动回房间'],
  ['autoHonor', '自动点赞队友'],
  ['friendGroups', '好友同局分组'],
  ['friendStatus', '好友模式与时间'],
  ['quickLobby', '快速海克斯大厅'],
] as const;
const defaults: Config = {
  autoAccept: true,
  benchNoCooldown: true,
  rememberSpells: true,
  champSelectQuit: true,
  autoOpenStats: true,
  autoReturnLobby: true,
  autoHonor: true,
  friendGroups: true,
  friendStatus: true,
  quickLobby: true,
  autoAcceptDelayMs: 250,
  openStatsDelayMs: 500,
  returnLobbyDelayMs: 2000,
  aramQueueId: 2400,
  // 左侧技能 / 右侧技能：固定闪现 / 雪球。
  spells: { spell1Id: 4, spell2Id: 32 },
  honorCategory: 'RANDOM',
};
export const config: Config = { ...defaults, spells: { ...defaults.spells } };
const listeners = new Set<() => void>();
const storageKey = 'aram-lite:config';

declare const DataStore: {
  get<T>(key: string, fallback?: T): T | undefined;
  set(key: string, value: unknown): boolean;
};
export function normalizeConfig(value: unknown, base: Config = defaults): Config {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: Config = { ...base, aramQueueId: 2400, spells: { ...defaults.spells } };
  for (const [key] of switches) {
    if (typeof raw[key] === 'boolean') result[key] = raw[key] as boolean;
  }
  for (const [key, max] of [['autoAcceptDelayMs', 15000], ['openStatsDelayMs', 15000], ['returnLobbyDelayMs', 30000]] as const) {
    const number = raw[key];
    if (typeof number === 'number' && Number.isFinite(number)) {
      result[key] = Math.min(max, Math.max(0, Math.round(number)));
    }
  }
  if (typeof raw.honorCategory === 'string' && ['RANDOM', 'HEART', 'COOL', 'SHOTCALLER'].includes(raw.honorCategory)) {
    result.honorCategory = raw.honorCategory as HonorCategory;
  }
  return result;
}
export function loadConfig(): void {
  let saved: unknown;
  try { if (typeof DataStore !== 'undefined') saved = DataStore.get(storageKey); }
  catch (error) { console.warn('[ARAM Lite] 读取配置失败，使用默认值', error); }
  Object.assign(config, normalizeConfig(saved));
}
export function onConfigChange(callback: () => void): Cleanup {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}
export function updateConfig(patch: Partial<Config>): boolean {
  Object.assign(config, normalizeConfig(patch, config));
  let saved = false;
  try {
    if (typeof DataStore !== 'undefined') {
      saved = DataStore.set(storageKey, { ...config, spells: { ...config.spells } });
    }
  } catch (error) { console.warn('[ARAM Lite] 保存配置失败', error); }
  for (const listener of listeners) {
    try { listener(); } catch (error) { console.warn('[ARAM Lite] 配置更新失败', error); }
  }
  return saved;
}
export function resetConfig(): boolean { return updateConfig(defaults); }

const memoryMarks = new Map<string, string>();
export const marks = {
  get(key: string): string | undefined {
    try {
      return typeof DataStore === 'undefined' ? memoryMarks.get(key) : DataStore.get<string>('aram-lite:' + key) ?? memoryMarks.get(key);
    } catch { return memoryMarks.get(key); }
  },
  set(key: string, value: string): void {
    memoryMarks.set(key, value);
    try {
      if (typeof DataStore !== 'undefined') DataStore.set('aram-lite:' + key, value);
    } catch (error) { console.warn('[ARAM Lite] 保存去重标记失败', error); }
  },
};

export type SpellPair = Config['spells'];
export function validSpells(value: unknown): value is SpellPair {
  const pair = value as Partial<SpellPair> | null;
  return !!pair && Number.isInteger(pair.spell1Id) && Number.isInteger(pair.spell2Id) &&
    pair.spell1Id! > 0 && pair.spell2Id! > 0 && pair.spell1Id !== pair.spell2Id;
}
const memorySpells = new Map<number, SpellPair>();
export const championSpells = {
  get(championId: number): SpellPair | undefined {
    try {
      const value = typeof DataStore === 'undefined' ? memorySpells.get(championId) :
        DataStore.get('aram-lite:champion-spells:' + championId);
      return validSpells(value) ? { ...value } : undefined;
    } catch (error) { console.warn('[ARAM Lite] 读取英雄技能失败', error); return undefined; }
  },
  set(championId: number, spells: SpellPair): void {
    if (championId <= 0 || !validSpells(spells)) return;
    try {
      if (typeof DataStore === 'undefined') memorySpells.set(championId, { ...spells });
      else if (!DataStore.set('aram-lite:champion-spells:' + championId, { ...spells })) {
        console.warn('[ARAM Lite] 保存英雄技能失败');
      }
    } catch (error) { console.warn('[ARAM Lite] 保存英雄技能失败', error); }
  },
};
