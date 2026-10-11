import { config, marks } from '../core/config';
import type { FeatureContext } from '../core/context';
import { LcuError, report, uri } from '../core/lcu';
import type { HonorBallot } from '../core/types';

export function autoHonor({ flow, lcu, scope }: FeatureContext): () => Promise<void> {
  let generation = 0;
  let inEnd = false;
  let job = Promise.resolve();
  const isEnd = () => flow.phase === 'PreEndOfGame' || flow.phase === 'EndOfGame';
  const current = (token: number) => scope.active && config.autoHonor && token === generation && isEnd();

  async function honor(token: number): Promise<void> {
    for (let attempt = 0; attempt < 8 && current(token); attempt++) {
      let ballot: HonorBallot | undefined;
      try { ballot = await lcu.get<HonorBallot>(uri.ballot); }
      catch (error) {
        if (!(error instanceof LcuError && error.status === 404)) { report('读取点赞名单', error); return; }
      }
      if (!current(token)) return;
      const expectedGame = flow.game?.gameData?.gameId;
      if (ballot?.gameId && (!expectedGame || expectedGame === ballot.gameId)) {
        const gameId = String(ballot.gameId);
        if (marks.get('honor-game') === gameId) return;
        if ((ballot.honoredPlayers?.length ?? 0) > 0 || (ballot.votePool?.votes ?? 1) <= 0) {
          marks.set('honor-game', gameId);
          return;
        }
        const allies = (ballot.eligibleAllies ?? []).filter(player => !player.botPlayer && player.puuid);
        if (allies.length) {
          const premades = allies.filter(player => flow.partyMembers.some(member =>
            (member.puuid && member.puuid === player.puuid) ||
            (member.summonerId && member.summonerId === player.summonerId)));
          const candidates = premades.length ? premades : allies;
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          // Claim before POST. Never spend a second vote on replay or an ambiguous timeout.
          marks.set('honor-game', gameId);
          const categories = ['HEART', 'COOL', 'SHOTCALLER'];
          await lcu.post('/lol-honor-v2/v1/honor-player', {
            puuid: target.puuid,
            summonerId: target.summonerId,
            gameId: ballot.gameId,
            honorCategory: config.honorCategory === 'RANDOM' ? categories[Math.floor(Math.random() * categories.length)] : config.honorCategory,
          }).catch(error => report('自动点赞（本局不重复提交）', error));
          return;
        }
      }
      if (!await scope.delay(500)) return;
    }
  }
  scope.own(flow.onChange(() => {
    if (!config.autoHonor || !isEnd()) {
      if (inEnd) { inEnd = false; generation++; job = Promise.resolve(); }
      return;
    }
    if (inEnd) return;
    inEnd = true;
    job = honor(++generation);
  }));
  return () => job;
}
