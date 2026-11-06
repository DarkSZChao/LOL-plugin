import { config, onConfigChange } from '../core/config';
import type { FeatureContext } from '../core/context';
import { report, uri } from '../core/lcu';
import type { Friend, Queue } from '../core/types';

const original = 'data-aram-lite-original';
const rendered = 'data-aram-lite-rendered';
const groupAttr = 'data-aram-lite-group';
const stateAttr = 'data-aram-lite-state';
const groupLabel = 'data-aram-lite-group-label';
const savedTitle = 'data-aram-lite-original-title';

export function friendIndex(friends: Friend[]): Map<string, Friend[]> {
  const index = new Map<string, Friend[]>();
  for (const friend of friends) {
    const name = friend.gameName?.trim() || friend.name?.trim();
    const keys = new Set([name, friend.name?.trim(), friend.puuid, friend.id]);
    if (name && friend.gameTag?.trim()) keys.add(name + '#' + friend.gameTag.trim());
    for (const key of keys) {
      if (!key) continue;
      const matches = index.get(key) ?? [];
      matches.push(friend);
      index.set(key, matches);
    }
  }
  return index;
}
export function formatDuration(raw: string | undefined, now = Date.now()): string | null {
  let started = Number(raw);
  if (!Number.isFinite(started) || started <= 0) return null;
  if (started < 1e12) started *= 1000;
  if (started > now + 60000) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}
const stages: Record<string, string> = {
  inQueue: '排队中',
  championSelect: '选人中',
  inGame: '游戏中',
  spectating: '观战中',
  watchingReplay: '观看回放',
  inTeamBuilder: '组队中',
  teamSelect: '队伍选择中',
  tutorial: '新手教程中',
};
const modeNames: Record<string, string> = {
  ARAM: '大乱斗', ARAM_UNRANKED_5x5: '大乱斗', KIWI: '海克斯大乱斗',
  CHERRY: '竞技场', CLASSIC: '召唤师峡谷', TFT: '云顶之弈',
  RANKED_SOLO_5x5: '单双排', RANKED_FLEX_SR: '灵活排位',
  NORMAL: '匹配', NORMAL_TFT: '云顶匹配', RANKED_TFT: '云顶排位',
  RANKED_TFT_DOUBLE_UP: '云顶双人', RANKED_TFT_TURBO: '云顶狂暴',
};
const shortModeNames: Record<string, string> = {
  '随机单中：大混战锦标赛': '海克斯锦标赛',
  '竞技场（PBE公测服务器 2v2）': '竞技场PBE',
  '召唤峡谷盲选模式自定义': '峡谷盲选自定义',
  '召唤峡谷征召自定义': '峡谷征召自定义',
  '召唤峡谷全随机': '峡谷全随机',
  '召唤峡谷电竞选角': '峡谷赛事选人',
  '多人练习工具自定义': '多人练习',
  '随机单中 5v5 电脑': '大乱斗人机',
  '积分对战 五排': '五排排位',
  '阿福快打 Clash': '阿福冠军杯',
  '末日机器人 - 维迦的诅咒！': '末日诅咒',
  '末日机器人 - 维迦的邪恶！': '末日邪恶',
  '末日机器人 - 维迦的末日！': '末日终局',
  '末日机器人 - 困难': '末日困难',
  '《联盟战棋》（巴豆龙的经典宝藏）': '云顶宝藏',
  '《联盟战棋》（灵魂争斗）': '云顶灵魂争斗',
  '《联盟战棋》（双人搭档）': '云顶双人',
  '联盟战棋：超级抽抽乐自订': '云顶狂暴自定义',
  '联盟战棋（教学模式）': '云顶教学',
  '巴豆龙的KO竞技场': '云顶KO竞技场',
  '第17赛季（普通匹配）': 'S17返场',
  '测试：阿福快打 1v1': '阿福1v1测试',
};
export function compactModeName(name: string): string {
  const short = shortModeNames[name] ?? name.trim();
  const characters = [...short];
  return characters.length <= 9 ? short : characters.slice(0, 8).join('') + '…';
}
interface PartySize { queueId: number; occupancy: string }
interface RememberedParty extends PartySize { state: string; gameId?: string; updatedAt: number }
function friendParty(friend: Friend): PartySize | null {
  const lol = friend.lol;
  if (!lol?.pty || !(lol.gameStatus?.startsWith('hosting') ||
    ['inQueue', 'championSelect', 'inGame'].includes(lol.gameStatus ?? '') ||
    (lol.gameStatus === 'outOfGame' && ['open', 'closed'].includes(lol.ptyType ?? '')))) return null;
  try {
    const party = JSON.parse(lol.pty);
    if (!party || typeof party.partyId !== 'string' || !party.partyId) return null;
    const members = Array.isArray(party.summonerPuuids) && party.summonerPuuids.length ?
      party.summonerPuuids : party.summoners;
    const maximum = Number(party.maxPlayers);
    if (!Array.isArray(members) || !members.length || !Number.isInteger(maximum) || maximum < members.length) return null;
    const queueId = Number(party.queueId);
    return Number.isInteger(queueId) && queueId > 0 ? { queueId, occupancy: members.length + '/' + maximum } : null;
  } catch { return null; }
}
function friendLobby(friend: Friend): PartySize | null {
  return friend.lol?.gameStatus?.startsWith('hosting') || friend.lol?.gameStatus === 'outOfGame' ? friendParty(friend) : null;
}
function statusText(friend: Friend, queueNames: Map<number, string>, queueTypes: Map<string, string>, remembered?: PartySize): string | null {
  const lol = friend.lol;
  if (!lol || friend.availability === 'offline') return null;
  const state = lol.gameStatus ?? '';
  const lobby = friendLobby(friend);
  const lobbyQueue = lobby?.queueId ?? null;
  const hosting = state.startsWith('hosting') || lobbyQueue !== null;
  const stage = hosting ? '大厅中' : stages[state];
  if (!stage) return null;
  const queueType = hosting && state.startsWith('hosting_') ? state.slice(8) : lol.gameQueueType;
  const queueId = lobbyQueue ?? (Number(lol.queueId) || remembered?.queueId);
  const mode = (queueId && queueNames.get(queueId)) ||
    (hosting && queueType && (modeNames[queueType] || queueTypes.get(queueType))) || (queueType && queueTypes.get(queueType)) ||
    (queueType && modeNames[queueType]) || (lol.gameMode && modeNames[lol.gameMode]) || queueType || lol.gameMode;
  const duration = state === 'inGame' || state === 'spectating' ? formatDuration(lol.timeStamp) : null;
  const people = (friendParty(friend) ?? remembered)?.occupancy;
  const activity = hosting && people ? '大厅 · ' + people :
    state === 'inQueue' && people ? '排队 · ' + people :
    state === 'championSelect' && people ? '选人 · ' + people :
    state === 'inGame' ? [duration, people].filter(Boolean).join(' · ') : stage;
  return [mode ? compactModeName(mode) : (state === 'inGame' ? '未知模式' : null), activity,
    state === 'inGame' ? null : duration].filter(Boolean).join(' · ');
}
function restore(element: HTMLElement): void {
  const previous = element.getAttribute(rendered);
  if (previous !== null && element.textContent === previous) {
    element.textContent = element.getAttribute(original) ?? '';
  }
  element.removeAttribute(stateAttr);
  element.removeAttribute(original);
  element.removeAttribute(rendered);
  if (element.hasAttribute(savedTitle)) {
    const title = element.getAttribute(savedTitle)!;
    if (title) element.setAttribute('title', title);
    else element.removeAttribute('title');
    element.removeAttribute(savedTitle);
  }
}
export function friendEnhancement({ events, injector, lcu, scope }: FeatureContext): void {
  const style = document.createElement('style');
  style.id = 'aram-lite-friend-status-colors';
  const colors: Record<string, string> = {
    lobby: '#36d987', inGame: '#0acbe6', inQueue: '#c8aa6e', championSelect: '#ffad55',
    spectating: '#b29bff', watchingReplay: '#8dafff', inTeamBuilder: '#63c28c',
    teamSelect: '#63c28c', tutorial: '#e8c85a',
  };
  style.textContent = Object.entries(colors).map(([state, color]) =>
    '[' + stateAttr + '="' + state + '"]{color:' + color + '!important}').join('') +
    '[' + groupLabel + ']{position:relative;box-sizing:border-box;padding-right:42px}' +
    '[' + groupLabel + ']::after{content:attr(' + groupLabel + ');position:absolute;right:0;top:0;' +
    'font-size:12px;color:#0acbe6;letter-spacing:0;pointer-events:none}';
  scope.own(() => style.remove());
  let index = new Map<string, Friend[]>();
  let groups = new Map<string, number>();
  let queueNames = new Map<number, string>();
  let queueTypes = new Map<string, string>();
  // This is the last observed premade size, not the full game roster.
  // sessionStorage survives a client-page reload but ends with the client session.
  const partySizes = new Map<string, RememberedParty>();
  const partyStorageKey = 'aram-lite:friend-party-sizes';
  const maxPartyAge = 6 * 60 * 60 * 1000;
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(partyStorageKey) ?? '[]');
    if (Array.isArray(saved)) for (const entry of saved) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[0]) continue;
      const value = entry[1] as RememberedParty | null;
      if (!value || !Number.isInteger(value.queueId) || value.queueId <= 0 ||
        typeof value.occupancy !== 'string' || !/^[1-9][0-9]*\/[1-9][0-9]*$/.test(value.occupancy) ||
        typeof value.state !== 'string' || (value.gameId !== undefined && typeof value.gameId !== 'string') ||
        !Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt > maxPartyAge ||
        value.updatedAt > Date.now() + 60000) continue;
      const [count, maximum] = value.occupancy.split('/').map(Number);
      if (count <= maximum) partySizes.set(entry[0], value);
    }
  } catch { /* Keep working in memory if session storage is unavailable. */ }
  function saveParties(): void {
    try {
      if (partySizes.size) window.sessionStorage.setItem(partyStorageKey, JSON.stringify([...partySizes]));
      else window.sessionStorage.removeItem(partyStorageKey);
    } catch { /* A storage failure must not stop friend status updates. */ }
  }
  const friendKey = (friend: Friend) => friend.puuid || friend.id;
  function rememberParties(friends: Friend[]): void {
    const seen = new Set<string>();
    for (const friend of friends) {
      const key = friendKey(friend);
      if (!key) continue;
      seen.add(key);
      const state = friend.lol?.gameStatus ?? '';
      const live = friendParty(friend);
      const previous = partySizes.get(key);
      if (friend.availability === 'offline') { partySizes.delete(key); continue; }
      if (live) {
        partySizes.set(key, { ...live, state, gameId: state === 'inGame' ? friend.lol?.gameId : undefined, updatedAt: Date.now() });
        continue;
      }
      if (!previous) continue;
      const queueId = Number(friend.lol?.queueId);
      const gameId = Number(friend.lol?.gameId) > 0 ? friend.lol?.gameId : undefined;
      if (Date.now() - previous.updatedAt > maxPartyAge ||
        !['inQueue', 'championSelect', 'inGame'].includes(state) ||
        (queueId > 0 && queueId !== previous.queueId) ||
        (previous.state === 'inGame' && state !== 'inGame') ||
        (state === 'inGame' && previous.gameId && gameId && previous.gameId !== gameId)) {
        partySizes.delete(key);
      } else {
        partySizes.set(key, { ...previous, state, gameId: state === 'inGame' ? gameId || previous.gameId : undefined });
      }
    }
    for (const key of partySizes.keys()) if (!seen.has(key)) partySizes.delete(key);
    saveParties();
  }
  scope.own(() => partySizes.clear());
  let loading = false;
  let dirty = false;
  let scheduled = false;
  let failures = 0;
  const enabled = () => config.friendGroups || config.friendStatus;

  function schedule(): void {
    if (scheduled || !scope.active || !enabled()) return;
    scheduled = true;
    scope.later(() => { scheduled = false; void refresh(); }, 250);
  }
  async function refresh(): Promise<void> {
    if (!scope.active || !enabled()) return;
    if (loading) { dirty = true; return; }
    loading = true;
    try {
      const friends = await lcu.get<Friend[]>(uri.friends);
      if (!scope.active) return;
      index = friendIndex(friends);
      rememberParties(friends);
      const counts = new Map<string, number>();
      for (const friend of friends) {
        const gameId = friend.lol?.gameId;
        if (friend.lol?.gameStatus === 'inGame' && gameId && Number(gameId) > 0) {
          counts.set(gameId, (counts.get(gameId) ?? 0) + 1);
        }
      }
      groups = new Map([...counts].filter(([, count]) => count >= 2).map(([id], number) => [id, number + 1]));
      failures = 0;
      injector.schedule();
    } catch (error) {
      report('好友状态', error);
      if (++failures < 3) scope.later(schedule, 1000);
    } finally {
      loading = false;
      if (dirty) { dirty = false; schedule(); }
    }
  }
  let queuesLoaded = false;
  let queuesLoading = false;
  function loadQueues(): void {
    if (!config.friendStatus || queuesLoaded || queuesLoading) return;
    queuesLoading = true;
    void lcu.get<Queue[]>(uri.queues).then(queues => {
      if (!scope.active) return;
      queuesLoaded = true;
      const queueName = (queue: Queue): string => queue.id === 2400 || queue.type === 'KIWI' ? '海克斯大乱斗' :
        queue.id === 450 || queue.type === 'ARAM_UNRANKED_5x5' ? '大乱斗' :
        queue.id === 400 || queue.id === 430 ? '匹配' :
        (queue.type && queue.type !== 'CHERRY' && queue.type !== 'NORMAL' && modeNames[queue.type]) ||
        queue.name || queue.description || '';
      queueNames = new Map(queues.map(queue => [queue.id, queueName(queue)]));
      queueTypes = new Map(queues.filter(queue => queue.type).map(queue =>
        [queue.type!, queueName(queue)]));
      injector.schedule();
    }).catch(error => report('模式名称', error)).finally(() => { queuesLoading = false; });
  }
  let wasEnabled = enabled();
  scope.own(onConfigChange(() => {
    if (enabled() && !wasEnabled) { failures = 0; void refresh(); }
    if (!enabled()) { partySizes.clear(); saveParties(); }
    wasEnabled = enabled();
    loadQueues();
    injector.schedule();
  }));
  scope.own(events.on(uri.friends, () => { failures = 0; schedule(); }));
  void refresh();
  loadQueues();

  scope.own(injector.register(() => {
    if (enabled()) {
      if (!style.isConnected) document.head?.append(style);
    } else style.remove();
    const members = document.querySelectorAll<HTMLElement>(
      '.lol-social-lower-pane-container [class*="lol-social-roster-member"], ' +
      '.lol-social-lower-pane-container lol-social-roster-member',
    );
    for (const member of members) {
      const status = member.querySelector<HTMLElement>('span.status-message');
      if (!status) continue;
      const nameElement = member.querySelector<HTMLElement>('.member-name');
      const name = nameElement?.textContent?.trim();
      const key = member.getAttribute('data-puuid') || member.querySelector('.member[data-id]')?.getAttribute('data-id') || name;
      const matches = key ? index.get(key) : undefined;
      // A name without tag is ambiguous when two Riot IDs share that name.
      const friend = matches?.length === 1 ? matches[0] : undefined;
      if (!enabled() || !friend || member.classList.contains('offline') || friend.availability === 'offline') {
        restore(status);
        member.removeAttribute(groupAttr);
        nameElement?.removeAttribute(groupLabel);
        continue;
      }
      const lol = friend.lol;
      const remembered = partySizes.get(friendKey(friend) ?? '');
      const detail = config.friendStatus ? statusText(friend, queueNames, queueTypes, remembered) : null;
      const group = config.friendGroups && lol?.gameStatus === 'inGame' ? groups.get(lol.gameId || '') : undefined;
      const label = group ? '同局' + group : null;
      if (label && nameElement) {
        if (nameElement.getAttribute(groupLabel) !== label) nameElement.setAttribute(groupLabel, label);
      } else nameElement?.removeAttribute(groupLabel);
      if (!detail && !group) {
        restore(status);
        member.removeAttribute(groupAttr);
        continue;
      }
      if (detail) {
        const state = (lol?.gameStatus?.startsWith('hosting') || friendLobby(friend) !== null) ? 'lobby' : lol?.gameStatus;
        if (state && status.getAttribute(stateAttr) !== state) status.setAttribute(stateAttr, state);
      } else status.removeAttribute(stateAttr);
      const previous = status.getAttribute(rendered);
      if (previous === null || status.textContent !== previous) {
        status.setAttribute(original, status.textContent ?? '');
      }
      const base = detail ?? status.getAttribute(original) ?? '';
      const text = base;
      if (status.getAttribute(rendered) !== text) status.setAttribute(rendered, text);
      if (status.textContent !== text) status.textContent = text;
      if (!status.hasAttribute(savedTitle)) status.setAttribute(savedTitle, status.getAttribute('title') ?? '');
      if (status.getAttribute('title') !== text) status.setAttribute('title', text);
      if (group) {
        if (member.getAttribute(groupAttr) !== lol!.gameId) member.setAttribute(groupAttr, lol!.gameId!);
      } else member.removeAttribute(groupAttr);
    }
  }));
  scope.own(() => {
    document.querySelectorAll<HTMLElement>('[' + rendered + ']').forEach(restore);
    document.querySelectorAll('[' + groupAttr + ']').forEach(member => member.removeAttribute(groupAttr));
    document.querySelectorAll('[' + groupLabel + ']').forEach(name => name.removeAttribute(groupLabel));
  });
}
