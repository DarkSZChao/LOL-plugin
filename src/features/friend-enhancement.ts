import { config, onConfigChange } from '../core/config';
import type { FeatureContext } from '../core/context';
import { report, uri } from '../core/lcu';
import type { Friend, Queue } from '../core/types';

const original = 'data-aram-lite-original';
const rendered = 'data-aram-lite-rendered';
const groupAttr = 'data-aram-lite-group';

export function friendIndex(friends: Friend[]): Map<string, Friend[]> {
  const index = new Map<string, Friend[]>();
  for (const friend of friends) {
    const name = friend.gameName?.trim() || friend.name?.trim();
    const keys = new Set([name, friend.name?.trim(), friend.puuid]);
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
};
function statusText(friend: Friend, queueNames: Map<number, string>, queueTypes: Map<string, string>): string | null {
  const lol = friend.lol;
  if (!lol || friend.availability === 'offline') return null;
  const state = lol.gameStatus ?? '';
  const hosting = state.startsWith('hosting');
  const stage = hosting ? '大厅中' : stages[state];
  if (!stage) return null;
  const queueType = hosting && state.startsWith('hosting_') ? state.slice(8) : lol.gameQueueType;
  const mode = (hosting && queueType && (queueTypes.get(queueType) || modeNames[queueType])) ||
    queueNames.get(Number(lol.queueId)) || (queueType && queueTypes.get(queueType)) ||
    (queueType && modeNames[queueType]) || (lol.gameMode && modeNames[lol.gameMode]) || queueType || lol.gameMode;
  const duration = state === 'inGame' || state === 'spectating' ? formatDuration(lol.timeStamp) : null;
  return [mode, stage, duration].filter(Boolean).join(' · ');
}
function restore(element: HTMLElement): void {
  const previous = element.getAttribute(rendered);
  if (previous !== null && element.textContent === previous) {
    element.textContent = element.getAttribute(original) ?? '';
  }
  element.removeAttribute(original);
  element.removeAttribute(rendered);
}
export function friendEnhancement({ events, injector, lcu, scope }: FeatureContext): void {
  let index = new Map<string, Friend[]>();
  let groups = new Map<string, number>();
  let queueNames = new Map<number, string>();
  let queueTypes = new Map<string, string>();
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
      queueNames = new Map(queues.map(queue => [queue.id, queue.name || queue.description || '']));
      queueTypes = new Map(queues.filter(queue => queue.type).map(queue =>
        [queue.type!, queue.name || queue.description || '']));
      injector.schedule();
    }).catch(error => report('模式名称', error)).finally(() => { queuesLoading = false; });
  }
  let wasEnabled = enabled();
  scope.own(onConfigChange(() => {
    if (enabled() && !wasEnabled) { failures = 0; void refresh(); }
    wasEnabled = enabled();
    loadQueues();
    injector.schedule();
  }));
  scope.own(events.on(uri.friends, () => { failures = 0; schedule(); }));
  void refresh();
  loadQueues();

  scope.own(injector.register(() => {
    const members = document.querySelectorAll<HTMLElement>(
      '.lol-social-lower-pane-container [class*="lol-social-roster-member"]',
    );
    for (const member of members) {
      const status = member.querySelector<HTMLElement>('span.status-message');
      if (!status) continue;
      const name = member.querySelector('.member-name')?.textContent?.trim();
      const key = member.getAttribute('data-puuid') || name;
      const matches = key ? index.get(key) : undefined;
      // A name without tag is ambiguous when two Riot IDs share that name.
      const friend = matches?.length === 1 ? matches[0] : undefined;
      if (!enabled() || !friend || member.classList.contains('offline') || friend.availability === 'offline') {
        restore(status);
        member.removeAttribute(groupAttr);
        continue;
      }
      const lol = friend.lol;
      const detail = config.friendStatus ? statusText(friend, queueNames, queueTypes) : null;


      const group = config.friendGroups && lol?.gameStatus === 'inGame' ? groups.get(lol.gameId || '') : undefined;
      if (!detail && !group) {
        restore(status);
        member.removeAttribute(groupAttr);
        continue;
      }
      const previous = status.getAttribute(rendered);
      if (previous === null || status.textContent !== previous) {
        status.setAttribute(original, status.textContent ?? '');
      }
      const base = detail ?? status.getAttribute(original) ?? '';
      const text = base + (group ? ' · 同局' + group : '');
      if (status.getAttribute(rendered) !== text) status.setAttribute(rendered, text);
      if (status.textContent !== text) status.textContent = text;
      if (group) {
        if (member.getAttribute(groupAttr) !== lol!.gameId) member.setAttribute(groupAttr, lol!.gameId!);
      } else member.removeAttribute(groupAttr);
    }
  }));
  scope.own(() => {
    document.querySelectorAll<HTMLElement>('[' + rendered + ']').forEach(restore);
    document.querySelectorAll('[' + groupAttr + ']').forEach(member => member.removeAttribute(groupAttr));
  });
}
