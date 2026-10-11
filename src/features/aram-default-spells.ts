import { championSpells, config, marks, validSpells } from '../core/config';
import type { SpellPair } from '../core/config';
import type { FeatureContext } from '../core/context';
import { report, uri } from '../core/lcu';

const same = (a: SpellPair, b: SpellPair) => a.spell1Id === b.spell1Id && a.spell2Id === b.spell2Id;
type Selection = {
  championId: number; gameId?: number; gameKey: string;
  initial: SpellPair; observed: SpellPair; desired: SpellPair;
  attempted: boolean; confirmed: boolean;
};
export function aramDefaultSpells({ flow, lcu, scope }: FeatureContext): void {
  let epoch = -1;
  let remember = false;
  let blockedGame: string | undefined;
  let selection: Selection | undefined;
  let busy = false;

  function apply(): void {
    const current = selection;
    if (!current || current.attempted || busy || !scope.active || !flow.isAram) return;
    const player = flow.champ?.myTeam?.find(item => item.cellId === flow.champ?.localPlayerCellId);
    if (remember && player?.championId !== current.championId) return;
    current.attempted = true;
    // Claim before PATCH: even a failed/ambiguous write must not overwrite a later manual change.
    if (current.gameId) marks.set('spells-game', String(current.gameId));
    if (same(current.observed, current.desired)) {
      current.confirmed = true;
      return;
    }
    busy = true;
    void lcu.patch(uri.champ + '/my-selection', current.desired)
      .catch(error => report('召唤师技能（本次不重试）', error))
      .finally(() => { busy = false; apply(); });
  }

  scope.own(flow.onChange(() => {
    if (flow.phase !== 'ChampSelect') { selection = undefined; return; }
    if (epoch !== flow.selectionEpoch) {
      epoch = flow.selectionEpoch;
      remember = config.rememberSpells;
      blockedGame = marks.get('spells-game');
      selection = undefined;
    }
    if (!flow.isAram || !flow.freshSelection) return;
    const session = flow.champ!;
    const player = session.myTeam?.find(item => item.cellId === session.localPlayerCellId);
    if (!player || !validSpells(player)) return;
    const championId = player.championId || 0;
    if (remember && championId <= 0) return;
    const gameId = session.gameId || flow.game?.gameData?.gameId;
    if (gameId && blockedGame === String(gameId)) return;
    const gameKey = gameId ? String(gameId) : 'epoch:' + epoch;
    const observed = { spell1Id: player.spell1Id, spell2Id: player.spell2Id };
    if (!selection || selection.gameKey !== gameKey || (remember && selection.championId !== championId)) {
      selection = {
        championId, gameId, gameKey, initial: observed, observed,
        desired: (remember && championSpells.get(championId)) || { ...config.spells },
        attempted: false, confirmed: false,
      };
    } else if (!same(selection.observed, observed)) {
      selection.observed = observed;
      if (selection.attempted) {
        const matched = same(observed, selection.desired);
        if (matched || selection.confirmed || !same(observed, selection.initial)) {
          selection.confirmed = true;
          if (remember && config.rememberSpells) championSpells.set(championId, observed);
        }
      }
    }
    apply();
  }));
}