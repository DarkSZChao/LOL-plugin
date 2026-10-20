import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { Lcu, LcuError, uri } from '../../src/core/lcu';
import { Events, Scope } from '../../src/core/events';
import { Gameflow } from '../../src/core/gameflow';
import { Injector } from '../../src/core/injector';
import { BenchLog } from '../../src/core/bench-log';
import { championSpells, config, loadConfig, normalizeConfig, onConfigChange, resetConfig, updateConfig } from '../../src/core/config';
import { controlPanel } from '../../src/features/control-panel';
import type { FeatureContext } from '../../src/core/context';
import type { LcuEvent, PenguContext } from '../../src/core/types';
import { autoAccept } from '../../src/features/auto-accept';
import { aramDefaultSpells } from '../../src/features/aram-default-spells';
import { aramBenchNoCooldown } from '../../src/features/aram-bench-no-cooldown';
import { champSelectQuit } from '../../src/features/champselect-quit';
import { quickLobby } from '../../src/features/quick-lobby';
import { autoHonor } from '../../src/features/auto-honor';
import { autoOpenStats } from '../../src/features/auto-open-stats';
import { autoReturnLobby } from '../../src/features/auto-return-lobby';
import { friendEnhancement, formatDuration, compactModeName } from '../../src/features/friend-enhancement';

const sleep = (ms = 45) => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1500;
  while (!predicate() && Date.now() < deadline) await sleep(10);
  assert.equal(predicate(), true, 'timed out waiting for expected asynchronous state');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Request = { endpoint: string; method: string; body: unknown };
type Route = (request: Request) => Response | Promise<Response> | undefined;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let nextGame = 1000;

function fixture(route?: Route, initialPhase = 'None') {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true, url: 'https://riot:riot@127.0.0.1/',
  });
  let observers = 0;
  class CountingObserver extends dom.window.MutationObserver {
    constructor(callback: MutationCallback) { super(callback); observers++; }
  }
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    MutationObserver: CountingObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  });
  const storage = new Map<string, unknown>();
  Object.assign(globalThis, { DataStore: {
    get: (key: string) => storage.get(key),
    set: (key: string, value: unknown) => { storage.set(key, value); return true; },
  } });
  loadConfig();
  const gameId = ++nextGame;
  const requests: Request[] = [];
  globalThis.fetch = (async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const request = {
      endpoint: String(input), method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    const response = route?.(request);
    if (response) return await response;
    if (request.method !== 'GET') return new Response(null, { status: 204 });
    if (request.endpoint === uri.phase) return json(initialPhase);
    if (request.endpoint === uri.game) return json({ gameData: { gameId, queue: { id: 450, gameMode: 'ARAM' } } });
    if (request.endpoint === uri.ready) return json({ playerResponse: 'None' });
    if (request.endpoint === uri.champ) return json(session());
    if (request.endpoint === uri.friends || request.endpoint === uri.queues) return json([]);
    return json({}, 404);
  }) as typeof fetch;
  const subscriptions = new Map<string, Array<(event: LcuEvent) => void>>();
  const pengu: PenguContext = { socket: {
    observe(endpoint, callback) {
      const list = subscriptions.get(endpoint) ?? [];
      list.push(callback); subscriptions.set(endpoint, list);
    },
  } };
  const lcu = new Lcu();
  const events = new Events();
  events.bind(pengu);
  const flow = new Gameflow(lcu, events);
  const injector = new Injector();
  const scope = new Scope();
  const context: FeatureContext = { lcu, events, flow, injector, scope };
  scope.own(flow.onChange(injector.schedule));
  scope.own(onConfigChange(() => { flow.refresh(); injector.schedule(); }));
  function emit(endpoint: string, data: unknown, eventType: LcuEvent['eventType'] = 'Update') {
    for (const callback of subscriptions.get(endpoint) ?? []) callback({ uri: endpoint, data, eventType });
  }
  function phase(value: string) { emit(uri.phase, value); }
  function session(queueId = 450) {
    return { gameId, queueId, benchEnabled: true, benchChampions: [{ championId: 1 }, { championId: 2 }],
      localPlayerCellId: 0, myTeam: [{ championId: 1, cellId: 0, spell1Id: 7, spell2Id: 14 }] };
  }
  return {
    ...context, pengu, gameId, requests, subscriptions, emit, phase, session, dom, storage,
    get observers() { return observers; },
    start() { injector.start(); flow.start(scope); },
    close() { scope.dispose(); injector.stop(); dom.window.close(); },
    writes(endpoint?: string) {
      return requests.filter(request => request.method !== 'GET' && (!endpoint || request.endpoint === endpoint));
    },
  };
}

test('LCU handles empty 204 and exposes HTTP status', async () => {
  const f = fixture(request => request.endpoint === '/missing' ? json({}, 404) : undefined);
  try {
    assert.equal(await f.lcu.post('/empty'), undefined);
    await assert.rejects(f.lcu.get('/missing'), error => error instanceof LcuError && error.status === 404);
  } finally { f.close(); }
});

test('shared socket subscribes once per URI and isolates listener failures', () => {
  const f = fixture();
  try {
    let received = 0;
    const unsubscribe = f.events.on('/test', () => received++);
    f.events.on('/test', () => received++);
    f.events.bind(f.pengu);
    assert.equal(f.subscriptions.get('/test')?.length, 1);
    f.emit('/test', {});
    assert.equal(received, 2);
    unsubscribe();
    f.emit('/test', {});
    assert.equal(received, 3);
  } finally { f.close(); }
});

test('an old startup HTTP snapshot cannot replace a live gameflow event', async () => {
  const pending = deferred<Response>();
  const f = fixture(request => request.endpoint === uri.phase ? pending.promise : undefined);
  try {
    f.start();
    assert.equal(f.flow.phase, null);
    f.phase('ReadyCheck');
    pending.resolve(json('None'));
    await sleep();
    assert.equal(f.flow.phase, 'ReadyCheck');
  } finally { f.close(); }
});

test('ARAM spells write once per selection despite manual edits and event replay', async () => {
  const f = fixture();
  try {
    aramDefaultSpells(f);
    f.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    assert.deepEqual(f.writes(uri.champ + '/my-selection')[0]?.body, { spell1Id: 4, spell2Id: 32 });
    const manual = f.session();
    manual.myTeam[0].spell1Id = 6;
    for (let i = 0; i < 5; i++) f.emit(uri.champ, manual);
    f.phase('ChampSelect');
    await sleep();
    assert.equal(f.writes(uri.champ + '/my-selection').length, 1);
    f.phase('Lobby'); f.phase('ChampSelect'); await sleep();
    // The same game ID is still deduplicated.
    assert.equal(f.writes(uri.champ + '/my-selection').length, 1);
    f.emit(uri.champ, { ...f.session(), gameId: f.gameId + 100 });
    // A stale snapshot from the previous match must not consume the new selection's attempt.
    assert.equal(f.writes(uri.champ + '/my-selection').length, 2);
  } finally { f.close(); }
});

test('mid-selection startup and non-ARAM selection do not overwrite spells', async () => {
  for (const initial of ['ChampSelect', 'None']) {
    const f = fixture(undefined, initial);
    try {
      aramDefaultSpells(f); f.start(); await sleep();
      if (initial === 'None') {
        f.emit(uri.champ, f.session(420));
        f.phase('ChampSelect');
        f.emit(uri.champ, f.session(420));
      }
      await sleep();
      assert.equal(f.writes().length, 0);
    } finally { f.close(); }
  }
});

test('failed spell PATCH is not retried over subsequent manual changes', async () => {
  const f = fixture(request => request.method === 'PATCH' ? json({}, 500) : undefined);
  try {
    aramDefaultSpells(f); f.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    f.emit(uri.champ, f.session()); f.emit(uri.champ, f.session());
    await sleep();
    assert.equal(f.writes().length, 1);
  } finally { f.close(); }
});

test('auto accept runs once and respects manual decline until returning to lobby', async () => {
  const f = fixture();
  try {
    autoAccept(f); f.start(); await sleep();
    f.phase('ReadyCheck'); await sleep();
    f.emit(uri.ready, { playerResponse: 'Declined' });
    await sleep(280);
    assert.equal(f.writes().length, 0);
    f.phase('Matchmaking'); f.phase('ReadyCheck'); await sleep(300);
    assert.equal(f.writes().length, 0);
    f.phase('Lobby'); f.phase('ReadyCheck'); await sleep(300);
    for (let i = 0; i < 3; i++) f.phase('ReadyCheck');
    await sleep(300);
    assert.equal(f.writes(uri.ready + '/accept').length, 1);
  } finally { f.close(); }
});

test('Play only intercepts None, suppresses double click, and survives DOM replacement', async () => {
  const f = fixture();
  try {
    quickLobby(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="play-button-container"><span>Play</span></div>';
    let native = 0;
    document.body.addEventListener('click', () => native++);
    const click = () => document.querySelector<HTMLElement>('.play-button-container span')!.click();
    click(); click(); await sleep();
    assert.equal(f.writes(uri.lobby).length, 1);
    assert.deepEqual(f.writes(uri.lobby)[0].body, { queueId: 2400 });
    for (const phase of ['Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect', 'InProgress', 'Reconnect', 'EndOfGame']) {
      f.phase(phase); click();
    }
    assert.equal(native, 7);
    assert.equal(f.writes(uri.lobby).length, 1);
    f.phase('None');
    document.querySelector('.play-button-container')!.outerHTML =
      '<div class="play-button-container"><span>Play</span></div>';
    click(); await sleep();
    assert.equal(f.writes(uri.lobby).length, 2);
  } finally { f.close(); }
});

test('Bench delegates recycled nodes, restores cooldown DOM, and preserves native locked slots', async () => {
  const f = fixture();
  try {
    aramBenchNoCooldown(f); f.start(); f.injector.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    document.body.innerHTML = '<div class="bench-container"><div class="champion-bench-item on-cooldown">'
      + '<div class="bench-champion-background" style="background-image:url(/lol-game-data/assets/v1/champion-icons/1.png)">'
      + '</div><div class="cooldown-mask"></div></div></div>';
    await sleep();
    const item = document.querySelector<HTMLElement>('.champion-bench-item')!;
    assert.equal(item.classList.contains('on-cooldown'), false);
    item.click(); await sleep();
    const icon = item.querySelector<HTMLElement>('.bench-champion-background')!;
    icon.style.backgroundImage = 'url(/lol-game-data/assets/v1/champion-icons/2.png)';
    item.classList.add('on-cooldown');
    await sleep(); item.click(); await sleep();
    item.classList.add('locked-out'); item.click(); await sleep();
    assert.deepEqual(f.writes().map(request => request.endpoint), [uri.champ + '/bench/swap/1', uri.champ + '/bench/swap/2']);
    assert.equal(f.observers, 1);
    f.phase('Lobby'); await sleep();
    assert.equal(document.querySelector('[data-aram-lite-bench]'), null);
    assert.equal(item.classList.contains('on-cooldown'), true);
  } finally { f.close(); }
});

test('quit button self-heals without duplicates and only invokes the verified DELETE after confirmation', async () => {
  const f = fixture();
  try {
    champSelectQuit(f); f.start(); await sleep();
    f.scope.own(f.flow.onChange(f.injector.schedule));
    f.phase('ChampSelect'); await sleep();
    document.body.innerHTML = '<div class="bottom-right-buttons"></div>';
    await sleep();
    for (let i = 0; i < 3; i++) {
      assert.equal(document.querySelectorAll('#aram-lite-quit').length, 1);
      document.querySelector('#aram-lite-quit')!.remove();
      await sleep();
    }
    document.querySelector('.bottom-right-buttons')!.outerHTML = '<div class="bottom-right-buttons"></div>';
    await sleep();

    document.querySelector<HTMLElement>('#aram-lite-quit')!.click();
    assert.equal(f.writes().length, 0);
    document.querySelector('#aram-lite-quit-confirm')!.shadowRoot!.querySelector<HTMLButtonElement>('[data-aram-lite-quit-action="cancel"]')!.click();
    assert.equal(document.querySelector('#aram-lite-quit-confirm'), null);
    document.querySelector<HTMLElement>('#aram-lite-quit')!.click();
    document.querySelector('#aram-lite-quit-confirm')!.shadowRoot!.querySelector<HTMLButtonElement>('[data-aram-lite-quit-action="confirm"]')!.click();
    await sleep();
    assert.equal(f.writes(uri.lobby)[0].method, 'DELETE');
    f.phase('Lobby'); await sleep();
    assert.equal(document.querySelector('#aram-lite-quit'), null);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('honor spends exactly one vote on a human ally, with replay and already-honored protection', async () => {
  let gameId = 0;
  const f = fixture(request => request.endpoint === uri.ballot ? json({
    gameId, eligibleAllies: [
      { puuid: 'bot', summonerId: 1, botPlayer: true },
      { puuid: 'ally', summonerId: 2, botPlayer: false },
    ],
    eligibleOpponents: [{ puuid: 'enemy', summonerId: 3 }],
    votePool: { votes: 4 }, honoredPlayers: [],
  }) : undefined);
  gameId = f.gameId;
  try {
    autoHonor(f); f.start(); await sleep();
    f.phase('PreEndOfGame'); f.phase('PreEndOfGame'); await sleep();
    f.phase('EndOfGame'); await sleep();
    assert.equal(f.writes().length, 1);
    assert.equal((f.writes()[0].body as { puuid: string }).puuid, 'ally');
    f.phase('Lobby'); f.phase('EndOfGame'); await sleep();
    assert.equal(f.writes().length, 1);
  } finally { f.close(); }
});

test('honor never uses opponents, zero votes, or a ballot already handled manually', async () => {
  for (const scenario of ['opponents-only', 'no-votes', 'manual']) {
    let gameId = 0;
    const f = fixture(request => request.endpoint === uri.ballot ? json({
      gameId, eligibleAllies: scenario === 'opponents-only' ? [] : [{ puuid: 'ally', summonerId: 2 }],
      eligibleOpponents: [{ puuid: 'enemy', summonerId: 3 }],
      votePool: { votes: scenario === 'no-votes' ? 0 : 3 },
      honoredPlayers: scenario === 'manual' ? ['other-ally'] : [],
    }) : undefined);
    gameId = f.gameId;
    try {
      autoHonor(f); f.start(); await sleep();
      f.phase('PreEndOfGame'); await sleep();
      assert.equal(f.writes().length, 0);
    } finally { f.close(); }
  }
});

test('auto return runs at its deadline and cancels when the player leaves EndOfGame', async () => {
  const hold = deferred<void>();
  const f = fixture();
  const originalDelay = config.returnLobbyDelayMs;
  (config as { returnLobbyDelayMs: number }).returnLobbyDelayMs = 20;
  try {
    document.body.innerHTML = '<div class="match-details-root match-details-no-header"><div class="match-graph-container"><div class="match-graph-display"></div></div></div>';
    autoReturnLobby(f);
    f.start(); await sleep();
    f.phase('EndOfGame'); await sleep(100);
    hold.resolve();
    await waitUntil(() => f.writes('/lol-lobby/v2/play-again').length === 1);
    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 1);
    f.phase('Lobby'); f.phase('EndOfGame'); f.phase('ChampSelect'); await sleep();
    await waitUntil(() => f.writes('/lol-lobby/v2/play-again').length === 1);
    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 1);
  } finally {
    (config as { returnLobbyDelayMs: number }).returnLobbyDelayMs = originalDelay;
    f.close();
  }
});

test('friend modes, elapsed time and same-game labels self-heal and restore native status', async () => {
  let friends = [
    { gameName: 'Alice', gameTag: 'A', puuid: 'a', lol: { gameStatus: 'inGame', gameId: '123', queueId: '450', timeStamp: String(Date.now() - 65000) } },
    { gameName: 'Bob', gameTag: 'B', puuid: 'b', lol: { gameStatus: 'inGame', gameId: '123', queueId: '450', timeStamp: String(Date.now() - 65000) } },
  ];
  const f = fixture(request => {
    if (request.endpoint === uri.friends) return json(friends);
    if (request.endpoint === uri.queues) return json([{ id: 450, description: '极地大乱斗' }]);
  });
  const markup = '<div class="lol-social-lower-pane-container">'
    + '<div class="lol-social-roster-member"><span class="member-name">Alice</span>'
    + '<span class="status-message game-status dnd">游戏中</span></div>'
    + '<div class="lol-social-roster-member"><span class="member-name">Bob</span>'
    + '<span class="status-message game-status dnd">游戏中</span></div></div>';
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = markup; await sleep();
    assert.match(document.querySelector('.status-message')!.textContent!, /大乱斗 · 01:\d{2} · 同局1/);
    assert.equal(document.querySelectorAll('[data-aram-lite-group]').length, 2);
    document.body.innerHTML = markup; await sleep();
    assert.equal(document.querySelectorAll('[data-aram-lite-rendered]').length, 2);
    const first = document.querySelector<HTMLElement>('.status-message')!;
    first.textContent = '正在大厅';
    friends = [];
    f.emit(uri.friends, {}); await sleep(350);
    assert.equal(first.textContent, '正在大厅');
    assert.equal(document.querySelectorAll('[data-aram-lite-group]').length, 0);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('ambiguous friend names are left intact and invalid timestamps never display huge durations', async () => {
  const f = fixture(request => request.endpoint === uri.friends ? json([
    { gameName: 'Same', gameTag: '1', lol: { gameStatus: 'inGame', gameId: '1', gameMode: 'ARAM' } },
    { gameName: ' Same ', gameTag: '2', lol: { gameStatus: 'inGame', gameId: '2', gameMode: 'TFT' } },
  ]) : undefined);
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container"><div class="lol-social-roster-member">'
      + '<span class="member-name">Same</span><span class="status-message">游戏中</span></div></div>';
    await sleep();
    assert.equal(document.querySelector('.status-message')!.textContent, '游戏中');
    assert.equal(formatDuration(undefined), null);
    assert.equal(formatDuration('0'), null);
    assert.equal(formatDuration('bad'), null);
    assert.equal(formatDuration('1700000000', 1700000065000), '01:05');
  } finally { f.close(); }
});

test('dispose cancels pending accept and removes DOM enhancements', async () => {
  const f = fixture();
  try {
    autoAccept(f); champSelectQuit(f); f.start(); await sleep();
    f.phase('ReadyCheck'); await sleep();
    f.scope.dispose(); f.injector.stop();
    await sleep(300);
    assert.equal(f.writes().length, 0);
    assert.equal(document.querySelector('#aram-lite-quit'), null);
  } finally { f.close(); }
});

test('new selection discards the previous match cache before initializing spells', async () => {
  const pending = deferred<Response>();
  let hold = false;
  const f = fixture(request => hold && request.endpoint === uri.champ ? pending.promise : undefined);
  try {
    aramDefaultSpells(f); f.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    assert.equal(f.writes().length, 1);
    f.phase('Lobby');
    f.emit(uri.champ, f.session()); // Late old-match event, before the next phase.
    hold = true;
    f.phase('ChampSelect');
    assert.equal(f.flow.champ, null);
    f.emit(uri.champ, { ...f.session(), gameId: f.gameId + 500 });
    await sleep();
    assert.equal(f.writes().length, 2);
    pending.resolve(json(f.session()));
    await sleep();
    assert.equal((f.flow.champ as { gameId?: number } | null)?.gameId, f.gameId + 500);
    assert.equal(f.writes().length, 2);
  } finally { pending.resolve(json({})); f.close(); }
});

test('a late honor ballot after phase exit never causes a vote', async () => {
  const pending = deferred<Response>();
  const f = fixture(request => request.endpoint === uri.ballot ? pending.promise : undefined);
  try {
    autoHonor(f); f.start(); await sleep();
    f.phase('PreEndOfGame');
    f.phase('Lobby');
    pending.resolve(json({
      gameId: f.gameId, eligibleAllies: [{ puuid: 'ally', summonerId: 1 }],
      votePool: { votes: 1 }, honoredPlayers: [],
    }));
    await sleep();
    assert.equal(f.writes().length, 0);
  } finally { pending.resolve(json({})); f.close(); }
});

test('real Pengu entry repeated init/load and stop/start retain one observer and one subscription per URI', async () => {
  const f = fixture();
  const plugin = await import('../../src/index');
  try {
    plugin.init(f.pengu); plugin.init(f.pengu);
    plugin.load(); plugin.load(); await sleep();
    assert.equal(f.observers, 1);
    for (const callbacks of f.subscriptions.values()) assert.equal(callbacks.length, 1);
    plugin.unload(); plugin.load(); await sleep();
    assert.equal(f.observers, 2); // One stopped observer plus exactly one new active observer.
    for (const callbacks of f.subscriptions.values()) assert.equal(callbacks.length, 1);
    document.body.innerHTML = '<div class="play-button-container"></div>';
    document.querySelector<HTMLElement>('.play-button-container')!.click();
    await sleep();
    assert.equal(f.writes(uri.lobby).length, 1);
  } finally { plugin.unload(); f.close(); }
});

test('missing champ queue ID waits for this phase gameflow and ignores stale ARAM mode', async () => {
  const hold = deferred<Response>();
  let holdGame = false;
  const f = fixture(request => holdGame && request.endpoint === uri.game ? hold.promise.then(response => response.clone()) : undefined);
  try {
    aramDefaultSpells(f); f.start(); await sleep();
    holdGame = true;
    f.phase('ChampSelect');
    const session = { ...f.session(), queueId: undefined, gameId: f.gameId + 1 };
    f.emit(uri.champ, session);
    await sleep();
    assert.equal(f.writes().length, 0);
    f.emit(uri.game, { gameData: { gameId: f.gameId + 1, queue: { id: 420, gameMode: 'CLASSIC' } } });
    assert.equal(f.writes().length, 0);
    f.phase('Lobby'); f.phase('ChampSelect');
    f.emit(uri.champ, { ...session, gameId: f.gameId + 2 });
    f.emit(uri.game, { gameData: { gameId: f.gameId + 2, queue: { id: 450, gameMode: 'ARAM' } } });
    await sleep();
    assert.equal(f.writes().length, 1);
  } finally { hold.resolve(json({})); f.close(); }
});

test('saved configuration validates booleans, delay bounds, skill pairs and fixed ARAM queue', () => {
  const result = normalizeConfig({
    autoAccept: 'false', benchNoCooldown: false, autoAcceptDelayMs: -10,
    returnLobbyDelayMs: 999999, aramQueueId: 420, spells: { spell1Id: 4, spell2Id: 6 },
    honorCategory: 'unknown',
  });
  assert.equal(result.autoAccept, true);
  assert.equal(result.benchNoCooldown, false);
  assert.equal(result.autoAcceptDelayMs, 0);
  assert.equal(result.returnLobbyDelayMs, 30000);
  assert.equal(result.aramQueueId, 2400);
  assert.equal(normalizeConfig({ aramQueueId: 450 }).aramQueueId, 2400);
  assert.deepEqual(result.spells, { spell1Id: 4, spell2Id: 32 });
  assert.deepEqual(normalizeConfig({ spells: { spell1Id: 32, spell2Id: 4 } }).spells, { spell1Id: 4, spell2Id: 32 });
  assert.equal(result.honorCategory, 'RANDOM');
});

test('panel edits and persists settings, validates input, and restores defaults', async () => {
  const f = fixture();
  try {
    controlPanel(f); f.start(); await sleep();
    const shadow = document.getElementById('aram-lite-controls')!.shadowRoot!;
    const change = (name: string, value: string | boolean) => {
      const field = shadow.querySelector<HTMLInputElement | HTMLSelectElement>('[name="' + name + '"]')!;
      if (typeof value === 'boolean') (field as HTMLInputElement).checked = value;
      else field.value = value;
      field.dispatchEvent(new f.dom.window.Event('change', { bubbles: true }));
    };
    assert.equal(shadow.querySelectorAll('input[type="checkbox"]').length, 10);
    document.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'F8', bubbles: true }));
    assert.equal(shadow.querySelector<HTMLElement>('section')!.hidden, false);
    change('autoAccept', false);
    change('autoAcceptDelayMs', '1250');
    assert.equal(shadow.querySelector('[name="spellOrder"]'), null);
    change('honorCategory', 'COOL');
    assert.equal(config.autoAccept, false);
    assert.equal(config.autoAcceptDelayMs, 1250);
    assert.deepEqual(config.spells, { spell1Id: 4, spell2Id: 32 });
    assert.equal(config.honorCategory, 'COOL');
    assert.equal((f.storage.get('aram-lite:config') as { autoAccept: boolean }).autoAccept, false);
    change('autoAcceptDelayMs', '99999');
    assert.equal(config.autoAcceptDelayMs, 1250);
    assert.match(shadow.querySelector('.status')!.textContent!, /范围内/);
    change('autoAcceptDelayMs', '');
    assert.equal(config.autoAcceptDelayMs, 1250);
    config.autoAccept = true;
    loadConfig();
    assert.equal(config.autoAccept, false);
    assert.deepEqual(config.spells, { spell1Id: 4, spell2Id: 32 });
    shadow.querySelector<HTMLButtonElement>('[data-action="reset"]')!.click();
    assert.equal(config.autoAccept, true);
    assert.equal(config.autoAcceptDelayMs, 250);
    assert.deepEqual(config.spells, { spell1Id: 4, spell2Id: 32 });
    document.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(shadow.querySelector<HTMLElement>('section')!.hidden, true);
  } finally { f.close(); }
});

test('panel self-heals using the shared observer and keeps its open state and unfinished input', async () => {
  const f = fixture();
  try {
    controlPanel(f); f.start(); await sleep();
    const host = document.getElementById('aram-lite-controls')!;
    const shadow = host.shadowRoot!;
    shadow.querySelector<HTMLButtonElement>('[data-action="toggle"]')!.click();
    shadow.querySelector<HTMLInputElement>('[name="autoAcceptDelayMs"]')!.value = '123';
    document.body.innerHTML = '<div>Client redraw</div>';
    await sleep();
    assert.equal(document.getElementById('aram-lite-controls'), host);
    assert.equal(shadow.querySelector<HTMLElement>('section')!.hidden, false);
    assert.equal(shadow.querySelector<HTMLInputElement>('[name="autoAcceptDelayMs"]')!.value, '123');
    assert.equal(document.querySelectorAll('#aram-lite-controls').length, 1);
    assert.equal(f.observers, 1);
    f.scope.dispose();
    assert.equal(document.getElementById('aram-lite-controls'), null);
  } finally { f.close(); }
});

test('panel reports storage failure while still applying the setting', async () => {
  const f = fixture();
  try {
    controlPanel(f); f.start(); await sleep();
    Object.assign(globalThis, { DataStore: { get: () => undefined, set: () => false } });
    const shadow = document.getElementById('aram-lite-controls')!.shadowRoot!;
    const checkbox = shadow.querySelector<HTMLInputElement>('[name="quickLobby"]')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new f.dom.window.Event('change', { bubbles: true }));
    assert.equal(config.quickLobby, false);
    assert.match(shadow.querySelector('.status')!.textContent!, /保存失败/);
  } finally { f.close(); }
});

test('live auto-accept toggle cancels a pending timer and never reaccepts a handled ready check', async () => {
  const f = fixture();
  try {
    autoAccept(f); updateConfig({ autoAcceptDelayMs: 50 }); f.start(); await sleep();
    f.phase('ReadyCheck'); await sleep(10);
    updateConfig({ autoAccept: false });
    await sleep(70);
    assert.equal(f.writes().length, 0);
    updateConfig({ autoAccept: true, autoAcceptDelayMs: 0 });
    await sleep();
    assert.equal(f.writes(uri.ready + '/accept').length, 1);
    updateConfig({ autoAccept: false }); updateConfig({ autoAccept: true });
    await sleep();
    assert.equal(f.writes(uri.ready + '/accept').length, 1);
  } finally { f.close(); }
});

test('live return toggle cancels pending work and parameter changes reschedule it once', async () => {
  const f = fixture();
  try {
    document.body.innerHTML = '<div class="match-details-root match-details-no-header"><div class="match-graph-container"><div class="match-graph-display"></div></div></div>';
    autoReturnLobby(f);
    updateConfig({ returnLobbyDelayMs: 50 }); f.start(); await sleep();
    f.phase('EndOfGame'); await sleep(10);
    updateConfig({ autoReturnLobby: false });
    await sleep(70);
    assert.equal(f.writes().length, 0);
    updateConfig({ autoReturnLobby: true, returnLobbyDelayMs: 1000 });
    updateConfig({ returnLobbyDelayMs: 0 });
    await sleep(100);
    await waitUntil(() => f.writes('/lol-lobby/v2/play-again').length === 1);
    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 1);
    updateConfig({ returnLobbyDelayMs: 10 });
    await sleep();
    await waitUntil(() => f.writes('/lol-lobby/v2/play-again').length === 1);
    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 1);
  } finally { f.close(); }
});

test('live DOM switches restore Bench cooldown, remove quit, and release native Play clicks', async () => {
  const f = fixture();
  try {
    aramBenchNoCooldown(f); champSelectQuit(f); quickLobby(f);
    updateConfig({ benchNoCooldown: false, champSelectQuit: false, quickLobby: false });
    f.start(); await sleep();
    document.body.innerHTML = '<div class="play-button-container">Play</div>'
      + '<div class="bottom-right-buttons"></div><div class="bench-container">'
      + '<div class="champion-bench-item on-cooldown"><div class="bench-champion-background" '
      + 'style="background-image:url(/lol-game-data/assets/v1/champion-icons/1.png)"></div><div class="cooldown-mask"></div></div></div>';
    let nativeClicks = 0;
    document.body.addEventListener('click', () => nativeClicks++);
    document.querySelector<HTMLElement>('.play-button-container')!.click();
    assert.equal(nativeClicks, 1);
    assert.equal(f.writes().length, 0);
    f.phase('ChampSelect'); await sleep();
    const bench = document.querySelector<HTMLElement>('.champion-bench-item')!;
    bench.click();
    assert.equal(nativeClicks, 2);
    assert.equal(document.getElementById('aram-lite-quit'), null);
    assert.equal(bench.classList.contains('on-cooldown'), true);
    updateConfig({ benchNoCooldown: true, champSelectQuit: true });
    await sleep();
    assert.equal(bench.classList.contains('on-cooldown'), false);
    assert.ok(document.getElementById('aram-lite-quit'));
    bench.click(); await sleep();
    assert.equal(f.writes(uri.champ + '/bench/swap/1').length, 1);
    updateConfig({ benchNoCooldown: false, champSelectQuit: false });
    await sleep();
    assert.equal(bench.classList.contains('on-cooldown'), true);
    assert.equal(document.getElementById('aram-lite-quit'), null);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('honor supports the configured category and remains one vote across live toggles', async () => {
  let gameId = 0;
  const f = fixture(request => request.endpoint === uri.ballot ? json({
    gameId, eligibleAllies: [{ puuid: 'ally', summonerId: 2 }],
    votePool: { votes: 4 }, honoredPlayers: [],
  }) : undefined);
  gameId = f.gameId;
  try {
    autoHonor(f);
    updateConfig({ autoHonor: false, honorCategory: 'SHOTCALLER' });
    f.start(); await sleep(); f.phase('PreEndOfGame'); await sleep();
    assert.equal(f.requests.filter(request => request.endpoint === uri.ballot).length, 0);
    updateConfig({ autoHonor: true }); await sleep();
    assert.equal(f.writes().length, 1);
    assert.equal((f.writes()[0].body as { honorCategory: string }).honorCategory, 'SHOTCALLER');
    updateConfig({ autoHonor: false }); updateConfig({ autoHonor: true }); await sleep();
    assert.equal(f.writes().length, 1);
  } finally { f.close(); }
});

test('disabling honor during an outstanding ballot prevents the vote', async () => {
  const pending = deferred<Response>();
  const f = fixture(request => request.endpoint === uri.ballot ? pending.promise : undefined);
  try {
    autoHonor(f); f.start(); await sleep(); f.phase('PreEndOfGame');
    updateConfig({ autoHonor: false });
    pending.resolve(json({
      gameId: f.gameId, eligibleAllies: [{ puuid: 'ally', summonerId: 2 }], votePool: { votes: 1 },
    }));
    await sleep();
    assert.equal(f.writes().length, 0);
  } finally { pending.resolve(json({})); f.close(); }
});

test('friend grouping and mode/time can be independently toggled and disabled queries stay quiet', async () => {
  const friends = ['Alice', 'Bob'].map(name => ({
    gameName: name, puuid: name, lol: {
      gameStatus: 'inGame', gameId: '123', queueId: '450', timeStamp: String(Date.now() - 65000),
    },
  }));
  const f = fixture(request => {
    if (request.endpoint === uri.friends) return json(friends);
    if (request.endpoint === uri.queues) return json([{ id: 450, description: '极地大乱斗' }]);
  });
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container">'
      + friends.map(friend => '<div class="lol-social-roster-member"><span class="member-name">'
        + friend.gameName + '</span><span class="status-message">游戏中</span></div>').join('') + '</div>';
    await sleep();
    const status = document.querySelector<HTMLElement>('.status-message')!;
    assert.match(status.textContent!, /大乱斗.*同局1/);
    updateConfig({ friendGroups: false }); await sleep();
    assert.match(status.textContent!, /大乱斗/);
    assert.doesNotMatch(status.textContent!, /同局/);
    updateConfig({ friendStatus: false }); await sleep();
    assert.equal(status.textContent, '游戏中');
    const before = f.requests.filter(request => request.endpoint === uri.friends).length;
    f.emit(uri.friends, {}); await sleep(300);
    assert.equal(f.requests.filter(request => request.endpoint === uri.friends).length, before);
    updateConfig({ friendGroups: true }); await sleep();
    assert.equal(status.textContent, '游戏中 · 同局1');
    updateConfig({ friendGroups: false, friendStatus: true }); await sleep();
    assert.match(status.textContent!, /大乱斗/);
    assert.doesNotMatch(status.textContent!, /同局/);
    assert.equal(f.observers, 1);
    assert.equal(f.subscriptions.get(uri.friends)!.length, 1);
  } finally { f.close(); }
});

test('Mayhem selection enables one-time spells, bench swapping and quit without affecting ranked', async () => {
  const f = fixture(request => request.endpoint === uri.champ ? json(f.session(2400)) : undefined);
  try {
    aramDefaultSpells(f); aramBenchNoCooldown(f); champSelectQuit(f);
    f.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    assert.equal(f.flow.isAram, true);
    assert.equal(f.writes(uri.champ + '/my-selection').length, 1);
    document.body.innerHTML = '<div class="bottom-right-buttons"></div>'
      + '<div class="bench-container"><div class="champion-bench-item on-cooldown">'
      + '<div class="bench-champion-background" style="background-image:url(/lol-game-data/assets/v1/champion-icons/1.png)"></div>'
      + '<div class="cooldown-mask"></div></div></div>';
    await sleep();
    assert.equal(document.querySelectorAll('#aram-lite-quit').length, 1);
    const item = document.querySelector<HTMLElement>('.champion-bench-item')!;
    assert.equal(item.classList.contains('on-cooldown'), false);
    item.click(); await sleep();
    assert.equal(f.writes(uri.champ + '/bench/swap/1').length, 1);
    f.emit(uri.champ, { ...f.session(2400), myTeam: [{ cellId: 0, spell1Id: 6, spell2Id: 7 }] });
    await sleep();
    assert.equal(f.writes(uri.champ + '/my-selection').length, 1);
    f.emit(uri.champ, f.session(420)); await sleep();
    assert.equal(f.flow.isAram, false);
    assert.equal(document.querySelector('#aram-lite-quit'), null);
    assert.equal(item.classList.contains('on-cooldown'), true);
    item.click(); await sleep();
    assert.equal(f.writes(uri.champ + '/bench/swap/1').length, 1);
  } finally { f.close(); }
});
test('remember switch is on by default and reset enables it without losing saved spells', () => {
  assert.equal(normalizeConfig({ defaultSpells: true }).rememberSpells, true);
  assert.equal(normalizeConfig({ defaultSpells: false }).rememberSpells, true);
  assert.equal(normalizeConfig({ rememberSpells: false }).rememberSpells, false);
  const f = fixture();
  try {
    championSpells.set(1, { spell1Id: 4, spell2Id: 6 });
    updateConfig({ rememberSpells: false });
    resetConfig();
    assert.equal(config.rememberSpells, true);
    assert.deepEqual(championSpells.get(1), { spell1Id: 4, spell2Id: 6 });
  } finally { f.close(); }
});

test('disabled memory always defaults once and never changes stored hero spells', async () => {
  const f = fixture();
  try {
    updateConfig({ rememberSpells: false });
    championSpells.set(1, { spell1Id: 32, spell2Id: 4 });
    aramDefaultSpells(f); f.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    assert.deepEqual(f.writes()[0].body, { spell1Id: 4, spell2Id: 32 });
    f.emit(uri.champ, { ...f.session(), myTeam: [{ championId: 1, cellId: 0, spell1Id: 6, spell2Id: 4 }] });
    f.emit(uri.champ, { ...f.session(), myTeam: [{ championId: 2, cellId: 0, spell1Id: 6, spell2Id: 4 }] });
    await sleep();
    assert.equal(f.writes().length, 1);
    assert.deepEqual(championSpells.get(1), { spell1Id: 32, spell2Id: 4 });
    assert.equal(championSpells.get(2), undefined);
  } finally { f.close(); }
});

test('memory restores each hero, records manual edits and survives later selections', async () => {
  const f = fixture();
  try {
    updateConfig({ rememberSpells: true });
    championSpells.set(1, { spell1Id: 32, spell2Id: 4 });
    championSpells.set(2, { spell1Id: 4, spell2Id: 6 });
    aramDefaultSpells(f); f.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    assert.deepEqual(f.writes()[0].body, { spell1Id: 32, spell2Id: 4 });
    const emitHero = (championId: number, spell1Id: number, spell2Id: number, gameId = f.gameId) =>
      f.emit(uri.champ, { ...f.session(), gameId, myTeam: [{ championId, cellId: 0, spell1Id, spell2Id }] });
    emitHero(1, 32, 4); // Echo of the plugin's own initialization.
    emitHero(1, 6, 4); await sleep();
    assert.equal(f.writes().length, 1);
    assert.deepEqual(championSpells.get(1), { spell1Id: 6, spell2Id: 4 });
    assert.deepEqual(f.storage.get('aram-lite:champion-spells:1'), { spell1Id: 6, spell2Id: 4 });
    emitHero(2, 6, 4); await sleep();
    assert.deepEqual(f.writes()[1].body, { spell1Id: 4, spell2Id: 6 });
    assert.deepEqual(championSpells.get(2), { spell1Id: 4, spell2Id: 6 });
    emitHero(1, 4, 6); await sleep();
    assert.deepEqual(f.writes()[2].body, { spell1Id: 6, spell2Id: 4 });
    f.phase('Lobby'); f.phase('ChampSelect');
    emitHero(1, 7, 14, f.gameId + 10000); await sleep();
    assert.deepEqual(f.writes()[3].body, { spell1Id: 6, spell2Id: 4 });
    emitHero(3, 6, 4, f.gameId + 10000); await sleep();
    assert.deepEqual(f.writes()[4].body, { spell1Id: 4, spell2Id: 32 });
    assert.equal(championSpells.get(3), undefined);
  } finally { f.close(); }
});

test('memory ignores invalid records and waits for an assigned champion', async () => {
  const f = fixture(request => request.endpoint === uri.champ ?
    json({ ...f.session(), myTeam: [{ championId: 0, cellId: 0, spell1Id: 7, spell2Id: 14 }] }) : undefined);
  try {
    updateConfig({ rememberSpells: true });
    f.storage.set('aram-lite:champion-spells:1', { spell1Id: 4, spell2Id: 4 });
    aramDefaultSpells(f); f.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    assert.equal(f.writes().length, 0);
    f.emit(uri.champ, f.session()); await sleep();
    assert.deepEqual(f.writes()[0].body, { spell1Id: 4, spell2Id: 32 });
  } finally { f.close(); }
});

test('memory toggle during selection takes effect next selection without overriding current skills', async () => {
  const f = fixture();
  try {
    updateConfig({ rememberSpells: false });
    championSpells.set(1, { spell1Id: 6, spell2Id: 4 });
    aramDefaultSpells(f); f.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    updateConfig({ rememberSpells: true });
    f.emit(uri.champ, { ...f.session(), myTeam: [{ championId: 1, cellId: 0, spell1Id: 7, spell2Id: 4 }] });
    await sleep();
    assert.equal(f.writes().length, 1);
    assert.deepEqual(championSpells.get(1), { spell1Id: 6, spell2Id: 4 });
    f.phase('Lobby'); f.phase('ChampSelect');
    f.emit(uri.champ, { ...f.session(), gameId: f.gameId + 10000 }); await sleep();
    assert.deepEqual(f.writes()[1].body, { spell1Id: 6, spell2Id: 4 });
  } finally { f.close(); }
});

test('queued hero initialization waits for the previous PATCH and does not store inherited spells', async () => {
  const pending = deferred<Response>();
  let patches = 0;
  const f = fixture(request => request.method === 'PATCH' && ++patches === 1 ? pending.promise : undefined);
  try {
    updateConfig({ rememberSpells: true });
    championSpells.set(2, { spell1Id: 4, spell2Id: 6 });
    aramDefaultSpells(f); f.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    f.emit(uri.champ, { ...f.session(), myTeam: [{ championId: 2, cellId: 0, spell1Id: 7, spell2Id: 14 }] });
    f.emit(uri.champ, { ...f.session(), myTeam: [{ championId: 2, cellId: 0, spell1Id: 4, spell2Id: 32 }] });
    assert.equal(f.writes().length, 1);
    pending.resolve(new Response(null, { status: 204 })); await sleep();
    assert.equal(f.writes().length, 2);
    assert.deepEqual(f.writes()[1].body, { spell1Id: 4, spell2Id: 6 });
    assert.deepEqual(championSpells.get(2), { spell1Id: 4, spell2Id: 6 });
  } finally { pending.resolve(new Response(null, { status: 204 })); f.close(); }
});
test('postgame opens native scoreboard, advanced details and damage graph with automatic return independently disabled', async () => {
  const f = fixture();
  let scoreboardClicks = 0, advancedClicks = 0, graphClicks = 0;
  try {
    updateConfig({ autoReturnLobby: false });
    updateConfig({ openStatsDelayMs: 0 }); autoOpenStats(f, () => Promise.resolve());
    updateConfig({ returnLobbyDelayMs: 150 });
    f.start(); await sleep();
    f.phase('EndOfGame');
    await sleep(170);
    assert.equal(f.writes().length, 0); // Statistics alone must never return to the lobby.
    document.body.innerHTML = '<div class="postgame-sub-navigation-container">'
      + '<lol-uikit-navigation-item active="true">Progression</lol-uikit-navigation-item>'
      + '<lol-uikit-navigation-item>Scoreboard</lol-uikit-navigation-item></div>';
    document.querySelectorAll('lol-uikit-navigation-item')[1].addEventListener('click', () => {
      scoreboardClicks++;
      const button = document.createElement('lol-uikit-flat-button');
      button.className = 'postgame-match-history-button';
      button.addEventListener('click', () => {
        advancedClicks++;
        const details = document.createElement('div');
        details.className = 'match-details-root match-details-no-header';
        details.innerHTML = '<span class="team-avatar-wrapper current"></span><div class="rcp-fe-lol-match-details-overlay-sub-nav">'
          + '<lol-uikit-navigation-item data-name="stats">Stats</lol-uikit-navigation-item>'
          + '<lol-uikit-navigation-item data-name="graph">Graph</lol-uikit-navigation-item></div>';
        details.querySelector('[data-name="graph"]')!.addEventListener('click', () => {
          graphClicks++;
          const graph = document.createElement('div');
          graph.className = 'match-graph-container';
          graph.innerHTML = '<div class="match-graph-display"></div>';
          details.append(graph);
        });
        document.body.append(details);
      });
      document.body.append(button);
    });
    await sleep(100);
    await waitUntil(() => graphClicks === 1);
    assert.deepEqual([scoreboardClicks, advancedClicks, graphClicks], [1, 1, 1]);
    assert.equal(f.writes().length, 0);
    await sleep(180);

    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 0);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('Mayhem native tabs are supported and closing stats does not repeatedly reopen the modal', async () => {
  const f = fixture();
  let scoreboardClicks = 0, advancedClicks = 0, graphClicks = 0;
  try {
    updateConfig({ autoReturnLobby: false });
    updateConfig({ openStatsDelayMs: 0 }); autoOpenStats(f, () => Promise.resolve());
    updateConfig({ returnLobbyDelayMs: 250 });
    f.start(); await sleep();
    document.body.innerHTML = '<div class="jade-postgame-tabs-container"><div class="jade-postgame-tab active">Progression</div>'
      + '<div class="jade-postgame-tab">Scoreboard</div></div>';
    document.querySelectorAll('.jade-postgame-tab')[1].addEventListener('click', () => {
      scoreboardClicks++;
      document.body.insertAdjacentHTML('beforeend', '<button class="postgame-match-history-button">Details</button>');
      document.querySelector('.postgame-match-history-button')!.addEventListener('click', () => {
        advancedClicks++;
        document.body.insertAdjacentHTML('beforeend', '<div class="match-details-root match-details-no-header">'
          + '<div class="jade-match-details-tabs-nav"><div class="jade-match-details-tab active">Stats</div>'
          + '<div class="jade-match-details-tab">Graph</div></div></div>');
        document.querySelectorAll('.jade-match-details-tab')[1].addEventListener('click', () => {
          graphClicks++;
          document.querySelector('.match-details-root')!.insertAdjacentHTML('beforeend',
            '<div class="match-graph-container"><div class="match-graph-display"></div></div>');
        });
      });
    });
    f.phase('EndOfGame'); await sleep(180);
    await waitUntil(() => graphClicks === 1);
    assert.deepEqual([scoreboardClicks, advancedClicks, graphClicks], [1, 1, 1]);
    document.querySelector('.match-details-root')!.remove();
    updateConfig({ returnLobbyDelayMs: 150 });
    await sleep(70);
    assert.equal(advancedClicks, 1);
    assert.equal(f.writes().length, 0);
    await sleep(150);

    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 0);
  } finally { f.close(); }
});

test('missing, disabled or hidden native stats controls are ignored and cancellation removes DOM tasks', async () => {
  const f = fixture();
  let clicks = 0;
  try {
    updateConfig({ autoReturnLobby: false });
    updateConfig({ openStatsDelayMs: 0 }); autoOpenStats(f, () => Promise.resolve());
    updateConfig({ returnLobbyDelayMs: 0 });
    f.start(); await sleep();
    document.body.innerHTML = '<button class="postgame-match-history-button" disabled>Details</button>';
    document.querySelector('button')!.addEventListener('click', () => clicks++);
    f.phase('EndOfGame'); await sleep(100);
    assert.equal(clicks, 0);
    assert.equal(f.writes().length, 0);
    updateConfig({ autoOpenStats: false });
    document.querySelector('button')!.removeAttribute('disabled'); await sleep();
    assert.equal(clicks, 0);
    assert.equal(f.writes().length, 0);
    f.phase('Lobby');
    updateConfig({ autoOpenStats: true });
    document.body.innerHTML = '<div class="match-details-root match-details-no-header" hidden>'
      + '<div class="match-graph-container"><div class="match-graph-display"></div></div></div>';
    f.phase('EndOfGame'); await sleep(100);
    assert.equal(f.writes().length, 0);
    f.phase('Lobby');
    document.querySelector<HTMLElement>('.match-details-root')!.hidden = false;
    await sleep();
    assert.equal(f.writes().length, 0);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});
test('friend names with trailing whitespace match the roster and display the live Arena queue and duration', async () => {
  const f = fixture(request => {
    if (request.endpoint === uri.friends) return json([{
      gameName: 'Airlines Wuhu ', gameTag: ' EUW ', name: '', puuid: 'arena-friend',
      lol: { gameStatus: 'inGame', gameId: '12345', queueId: '1750', gameMode: 'CHERRY',
        gameQueueType: 'CHERRY', timeStamp: String(Date.now() - 65000) },
    }]);
    if (request.endpoint === uri.queues) return json([{ id: 1750, name: '竞技场3x6', description: '竞技场3x6' }]);
  });
  const markup = '<div class="lol-social-lower-pane-container"><div class="lol-social-roster-member">'
    + '<span class="member-name">Airlines Wuhu</span><span class="status-message">游戏中</span></div></div>';
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = markup;
    await waitUntil(() => document.querySelector('.status-message')?.textContent?.includes('竞技场3x6') === true);
    assert.match(document.querySelector('.status-message')!.textContent!, /竞技场3x6 · 01:\d{2}/);
    document.body.innerHTML = markup;
    await waitUntil(() => document.querySelector('.status-message')?.textContent?.includes('竞技场3x6') === true);
    updateConfig({ friendStatus: false }); await sleep();
    assert.equal(document.querySelector('.status-message')!.textContent, '游戏中');
    updateConfig({ friendStatus: true }); await sleep();
    document.querySelector('.member-name')!.textContent = 'Airlines Wuhu#EUW';
    await waitUntil(() => document.querySelector('.status-message')?.textContent?.includes('竞技场3x6') === true);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});
test('return countdown starts at the first honor screen and does not restart when EndOfGame appears', async () => {
  const f = fixture();
  const realNow = Date.now;
  try {
    autoReturnLobby(f);
    updateConfig({ returnLobbyDelayMs: 200, autoOpenStats: false });
    f.start(); await sleep();
    let clock = realNow();
    Date.now = () => clock;
    f.phase('PreEndOfGame');
    await sleep(190); clock += 190;
    const started = performance.now();
    f.phase('EndOfGame');
    Date.now = realNow;
    await waitUntil(() => f.writes('/lol-lobby/v2/play-again').length === 1);
    assert.ok(performance.now() - started < 150, 'must wait only the remaining 10 ms, not a fresh 200 ms');
    assert.equal(document.querySelector('.match-details-root'), null);
  } finally { Date.now = realNow; f.close(); }
});

test('return runs in PreEndOfGame without waiting for settlement or honor', async () => {
  const f = fixture();
  const honor = deferred<void>();
  try {
    autoReturnLobby(f);
    updateConfig({ returnLobbyDelayMs: 100 });
    f.start(); await sleep();
    f.phase('PreEndOfGame'); await sleep(140);
    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 1);
    const released = performance.now();
    honor.resolve();
    await waitUntil(() => f.writes('/lol-lobby/v2/play-again').length === 1);
    assert.ok(performance.now() - released < 80, 'honor completion must not start another full delay');
  } finally { honor.resolve(); f.close(); }
});

test('all combinations of honor, statistics and return switches work independently', async () => {
  for (let flags = 0; flags < 8; flags++) {
    const order: string[] = [];
    let gameId = 0;
    const f = fixture(request => {
      if (request.endpoint === uri.ballot) return json({
        gameId, eligibleAllies: [{ puuid: 'ally', summonerId: 2 }], votePool: { votes: 1 }, honoredPlayers: [],
      });
      if (request.endpoint === '/lol-honor-v2/v1/honor-player') order.push('honor');
      if (request.endpoint === '/lol-lobby/v2/play-again') order.push('return');
    });
    gameId = f.gameId;
    try {
      const honorEnabled = !!(flags & 1), statsEnabled = !!(flags & 2), returnEnabled = !!(flags & 4);
      updateConfig({ autoHonor: honorEnabled, autoOpenStats: statsEnabled, autoReturnLobby: returnEnabled, returnLobbyDelayMs: 200 });
      const waitForHonor = autoHonor(f);
      updateConfig({ openStatsDelayMs: 0 }); autoOpenStats(f, waitForHonor); autoReturnLobby(f);
      f.start(); await sleep();
      document.body.innerHTML = '<button class="postgame-match-history-button">Details</button>';
      document.querySelector('button')!.addEventListener('click', () => {
        order.push('stats');
        document.body.insertAdjacentHTML('beforeend', '<div class="match-details-root match-details-no-header">'
          + '<span class="team-avatar-wrapper current"></span><div class="rcp-fe-lol-match-details-overlay-sub-nav"><button data-name="graph">Graph</button></div></div>');
        document.querySelector('[data-name="graph"]')!.addEventListener('click', () => {
          order.push('graph');
          document.querySelector('.match-details-root')!.insertAdjacentHTML('beforeend',
            '<div class="match-graph-container"><div class="match-graph-display"></div></div>');
        });
      });
      f.phase('PreEndOfGame'); await sleep();
      assert.equal(f.writes('/lol-lobby/v2/play-again').length, 0);
      f.phase('EndOfGame'); await sleep(250);
      assert.equal(order.filter(item => item === 'honor').length, honorEnabled ? 1 : 0, 'honor flags=' + flags);
      assert.equal(order.filter(item => item === 'stats').length, statsEnabled ? 1 : 0, 'stats flags=' + flags);
      assert.equal(order.filter(item => item === 'graph').length, statsEnabled ? 1 : 0, 'graph flags=' + flags);
      assert.equal(order.filter(item => item === 'return').length, returnEnabled ? 1 : 0, 'return flags=' + flags);
      if (honorEnabled && statsEnabled) assert.ok(order.indexOf('honor') < order.indexOf('stats'));
      assert.equal(f.observers, 1);
    } finally { f.close(); }
  }
});
test('return notice heals after redraw, cancels only this game and resumes next game', async () => {
  const f = fixture();
  try {
    updateConfig({ returnLobbyDelayMs: 300 });
    autoReturnLobby(f);
    f.start(); await sleep();
    f.phase('PreEndOfGame');
    await waitUntil(() => !!document.querySelector('#aram-lite-return-countdown'));
    assert.match(document.querySelector('#aram-lite-return-countdown')!.textContent!, /1 秒后自动回房/);
    const notice = document.querySelector('#aram-lite-return-countdown')!;
    notice.remove();
    await waitUntil(() => notice.isConnected);
    document.body.append(notice.cloneNode(true));
    await waitUntil(() => document.querySelectorAll('#aram-lite-return-countdown').length === 1);
    notice.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    assert.equal(document.querySelector('#aram-lite-return-countdown'), null);
    assert.equal(config.autoReturnLobby, true);
    updateConfig({ returnLobbyDelayMs: 0 });
    f.phase('EndOfGame'); await sleep();
    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 0);
    f.phase('Lobby'); f.phase('EndOfGame');
    await waitUntil(() => f.writes('/lol-lobby/v2/play-again').length === 1);
    assert.equal(document.querySelector('#aram-lite-return-countdown'), null);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('return can be cancelled before its deadline, and notice hides when disabled or leaving', async () => {
  const f = fixture();
  const honor = deferred<void>();
  try {
    updateConfig({ returnLobbyDelayMs: 300 });
    autoReturnLobby(f);
    f.start(); await sleep(); f.phase('EndOfGame');
    await waitUntil(() => !!document.querySelector('#aram-lite-return-countdown'));
    document.querySelector<HTMLButtonElement>('#aram-lite-return-countdown [data-action="cancel"]')!.click();
    honor.resolve(); await sleep();
    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 0);
    f.phase('Lobby');
    updateConfig({ returnLobbyDelayMs: 1000 });
    f.phase('EndOfGame');
    await waitUntil(() => !!document.querySelector('#aram-lite-return-countdown'));
    updateConfig({ autoReturnLobby: false });
    await waitUntil(() => !document.querySelector('#aram-lite-return-countdown'));
    updateConfig({ autoReturnLobby: true });
    await waitUntil(() => !!document.querySelector('#aram-lite-return-countdown'));
    f.phase('Lobby');
    await waitUntil(() => !document.querySelector('#aram-lite-return-countdown'));
    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 0);
  } finally { honor.resolve(); f.close(); }
});
test('honor prefers a premade by puuid or summoner ID and freezes lobby roster through the match', async () => {
  for (const member of [{ puuid: 'premade', summonerId: 2 }, { summonerId: 2 }]) {
    const f = fixture(request => {
      if (request.endpoint === uri.lobby) return json({ members: [member] });
      if (request.endpoint === uri.ballot) return json({
        gameId: f.gameId, eligibleAllies: [
          { puuid: 'stranger-first', summonerId: 1 },
          { puuid: 'premade', summonerId: 2 },
          { puuid: 'stranger-last', summonerId: 3 },
        ], votePool: { votes: 1 },
      });
    }, 'Lobby');
    try {
      autoHonor(f); f.start(); await sleep();
      assert.deepEqual(f.flow.partyMembers, [member]);
      f.phase('ReadyCheck'); await sleep();
      f.emit(uri.lobby, null, 'Delete');
      f.phase('ChampSelect'); await sleep();
      f.phase('InProgress');
      f.emit(uri.lobby, { members: [{ puuid: 'stranger-last', summonerId: 3 }] });
      f.phase('PreEndOfGame');
      await waitUntil(() => f.writes('/lol-honor-v2/v1/honor-player').length === 1);
      assert.equal((f.writes('/lol-honor-v2/v1/honor-player')[0].body as { puuid: string }).puuid, 'premade');
      f.phase('EndOfGame'); await sleep();
      assert.equal(f.writes('/lol-honor-v2/v1/honor-player').length, 1);
      assert.equal(f.subscriptions.get(uri.lobby)?.length, 1);
    } finally { f.close(); }
  }
});

test('honor falls back to eligible strangers if premades are absent, bots or opponents', async () => {
  const f = fixture(request => {
    if (request.endpoint === uri.lobby) return json({ members: [
      { puuid: 'bot', summonerId: 1 }, { puuid: 'opponent', summonerId: 2 },
      { puuid: 'not-eligible', summonerId: 3 },
    ] });
    if (request.endpoint === uri.ballot) return json({
      gameId: f.gameId, eligibleAllies: [
        { puuid: 'bot', summonerId: 1, botPlayer: true },
        { puuid: 'stranger', summonerId: 4 },
      ], eligibleOpponents: [{ puuid: 'opponent', summonerId: 2 }],
      votePool: { votes: 1 },
    });
  }, 'Lobby');
  try {
    autoHonor(f); f.start(); await sleep();
    f.phase('ChampSelect'); await sleep(); f.phase('PreEndOfGame');
    await waitUntil(() => f.writes('/lol-honor-v2/v1/honor-player').length === 1);
    assert.equal((f.writes('/lol-honor-v2/v1/honor-player')[0].body as { puuid: string }).puuid, 'stranger');
  } finally { f.close(); }
});

test('party cache tracks lobby changes, rejects stale reads and clears after the match', async () => {
  const snapshot = deferred<Response>();
  const f = fixture(request => request.endpoint === uri.lobby ? snapshot.promise.then(response => response.clone()) : undefined, 'Lobby');
  try {
    f.start(); await sleep();
    f.emit(uri.lobby, { members: [{ puuid: 'left-player', summonerId: 1 }] });
    f.emit(uri.lobby, { members: [{ puuid: 'current-player', summonerId: 2 }] });
    snapshot.resolve(json({ members: [{ puuid: 'stale-player', summonerId: 3 }] }));
    await sleep();
    assert.equal(f.flow.partyMembers[0].puuid, 'current-player');
    f.phase('ChampSelect'); await sleep(); f.phase('InProgress');
    f.emit(uri.lobby, null, 'Delete');
    assert.equal(f.flow.partyMembers[0].puuid, 'current-player');
    f.phase('EndOfGame'); f.phase('Lobby');
    assert.equal(f.flow.partyMembers.length, 0);
    f.emit(uri.lobby, { members: [] }); await sleep();
    assert.equal(f.flow.partyMembers.length, 0);
    f.emit(uri.lobby, { members: [{ puuid: 'new-player', summonerId: 4 }] });
    assert.equal(f.flow.partyMembers[0].puuid, 'new-player');
    f.emit(uri.lobby, null, 'Delete');
    assert.equal(f.flow.partyMembers.length, 0);
  } finally { snapshot.resolve(json({})); f.close(); }
});
test('friend details show verified stages and modes without using game timestamps for queue or selection', async () => {
  const states = ['hosting_KIWI', 'inQueue', 'championSelect', 'inGame', 'spectating',
    'watchingReplay', 'inTeamBuilder', 'teamSelect', 'tutorial', 'outOfGame', 'unknown'];
  const f = fixture(request => {
    if (request.endpoint === uri.friends) return json(states.map((state, i) => ({
      puuid: String(i), gameName: 'Friend' + i, availability: 'chat',
      lol: { gameStatus: state, gameQueueType: 'KIWI', timeStamp: String(Date.now() - 65000) },
    })));
    if (request.endpoint === uri.queues) return json([
      { id: 2400, type: 'KIWI', name: '随机单中：大混战' },
      { id: 2450, type: 'KIWI', name: '随机单中：大混战：经典风格' },
    ]);
  });
  const markup = '<div class="lol-social-lower-pane-container">' + states.map((state, i) =>
    '<div class="lol-social-roster-member" data-puuid="' + i + '"><span class="member-name">Friend' + i +
    '</span><span class="status-message">原始状态</span></div>').join('') + '</div>';
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = markup; await sleep();
    const values = [...document.querySelectorAll('.status-message')].map(e => e.textContent);
    assert.equal(values[0], '海克斯大乱斗 · 大厅中');
    assert.equal(values[1], '海克斯大乱斗 · 排队中');
    assert.equal(values[2], '海克斯大乱斗 · 选人中');
    assert.match(values[3]!, /海克斯大乱斗 · 01:[0-9]{2}/);
    assert.match(values[4]!, /海克斯大乱斗 · 观战中 · 01:[0-9]{2}/);
    assert.equal(values[5], '海克斯大乱斗 · 观看回放');
    assert.equal(values[6], '海克斯大乱斗 · 组队中');
    assert.equal(values[7], '海克斯大乱斗 · 队伍选择中');
    assert.equal(values[8], '海克斯大乱斗 · 新手教程中');
    assert.equal(values[9], '原始状态');
    assert.equal(values[10], '原始状态');
    document.body.innerHTML = markup; await sleep();
    assert.equal(document.querySelectorAll('[data-aram-lite-rendered]').length, 9);
    updateConfig({ friendStatus: false });
    await sleep();
    assert.equal(document.querySelectorAll('[data-aram-lite-rendered]').length, 0);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('friend status updates remove stale timers and groups, preserve offline and native idle messages', async () => {
  let state = 'inGame', availability = 'chat';
  const f = fixture(request => request.endpoint === uri.friends ? json([
    { puuid: 'a', gameName: 'Alice', availability, lol: {
      gameStatus: state, gameId: '123', gameQueueType: 'KIWI', timeStamp: String(Date.now() - 65000),
    } },
    { puuid: 'b', gameName: 'Bob', lol: { gameStatus: 'inGame', gameId: '123' } },
  ]) : undefined);
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container"><div class="lol-social-roster-member" data-puuid="a">' +
      '<span class="member-name">Alice</span><span class="status-message">在线</span></div></div>';
    await sleep();
    const status = document.querySelector('.status-message')!;
    assert.match(status.textContent!, /海克斯大乱斗.*同局1/);
    state = 'championSelect'; f.emit(uri.friends, {});
    await waitUntil(() => status.textContent === '海克斯大乱斗 · 选人中');
    assert.equal(document.querySelector('[data-aram-lite-group]'), null);
    availability = 'offline'; f.emit(uri.friends, {});
    await waitUntil(() => status.textContent === '在线');
    availability = 'chat'; state = 'outOfGame'; f.emit(uri.friends, {});
    await sleep(350);
    assert.equal(status.textContent, '在线');
    assert.equal(status.hasAttribute('data-aram-lite-rendered'), false);
  } finally { f.close(); }
});
test('stats clicks visible advanced record before graph despite hidden stale controls and asynchronous loading', async () => {
  for (const textFallback of [false, true]) {
    const f = fixture();
    const honor = deferred<void>();
    const order: string[] = [];
    try {
      updateConfig({ autoReturnLobby: false });
      updateConfig({ openStatsDelayMs: 0 }); autoOpenStats(f, () => honor.promise);
      f.start(); await sleep();
      document.body.innerHTML =
        '<div hidden><button class="postgame-match-history-button">旧记录</button>' +
        '<div class="match-details-root match-details-no-header"><div class="match-graph-container">' +
        '<div class="match-graph-display"></div></div></div></div>' +
        '<button class="postgame-match-history-button" disabled>尚未加载</button>' +
        '<div class="postgame-sub-navigation-container"><lol-uikit-navigation-item>进度</lol-uikit-navigation-item>' +
        '<lol-uikit-navigation-item>计分板</lol-uikit-navigation-item></div>';
      document.querySelectorAll('lol-uikit-navigation-item')[1].addEventListener('click', () => order.push('scoreboard'));
      const advanced = document.createElement('lol-uikit-flat-button');
      if (!textFallback) advanced.className = 'postgame-match-history-button';
      advanced.textContent = ' 观看进阶记录 ';
      document.body.append(advanced);
      advanced.addEventListener('click', () => {
        order.push('advanced');
        advanced.remove();
        f.scope.later(() => {
          const details = document.createElement('div');
          details.className = 'match-details-root match-details-no-header';
          details.innerHTML = '<span class="team-avatar-wrapper current"></span><div class="rcp-fe-lol-match-details-overlay-sub-nav">' +
            '<button data-name="graph" hidden>旧图表</button><button data-name="graph">图表</button></div>';
          details.querySelectorAll('button')[1].addEventListener('click', () => {
            order.push('graph');
            details.insertAdjacentHTML('beforeend',
              '<div class="match-graph-container"><div class="match-graph-display"></div></div>');
          });
          document.body.append(details);
        }, 80);
      });
      f.phase('EndOfGame'); await sleep();
      assert.equal(order.length, 0);
      honor.resolve();
      await waitUntil(() => order.includes('graph'));
      assert.deepEqual(order, ['advanced', 'graph']);
      assert.equal(f.writes().length, 0);
      assert.equal(f.observers, 1);
      await sleep();
      document.querySelectorAll('.match-details-root')[1].remove();
      updateConfig({ autoOpenStats: false });
      updateConfig({ autoOpenStats: true });
      await sleep();
      assert.deepEqual(order, ['advanced', 'graph']);
    } finally { honor.resolve(); f.close(); }
  }
});
test('quit confirmation cancels on Escape or phase exit, heals redraw and sends only one confirmed request', async () => {
  const pending = deferred<Response>();
  const f = fixture(request => request.method === 'DELETE' && request.endpoint === uri.lobby ? pending.promise : undefined);
  try {
    champSelectQuit(f); f.start(); await sleep();
    f.phase('ChampSelect'); await sleep();
    document.body.innerHTML = '<div class="bottom-right-buttons"></div>'; await sleep();
    const open = () => document.querySelector<HTMLElement>('#aram-lite-quit')!.click();
    open(); open();
    assert.equal(document.querySelectorAll('#aram-lite-quit-confirm').length, 1);
    assert.equal(f.writes(uri.lobby).length, 0);
    const dialog = document.querySelector('#aram-lite-quit-confirm')!;
    dialog.remove();
    await waitUntil(() => dialog.isConnected);
    document.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(document.querySelector('#aram-lite-quit-confirm'), null);
    open();
    const staleConfirm = dialog.shadowRoot!.querySelector<HTMLButtonElement>('[data-aram-lite-quit-action="confirm"]')!;
    f.phase('Lobby');
    assert.equal(document.querySelector('#aram-lite-quit-confirm'), null);
    staleConfirm.click();
    assert.equal(f.writes(uri.lobby).length, 0);
    f.phase('ChampSelect'); await sleep();
    open();
    updateConfig({ champSelectQuit: false });
    assert.equal(document.querySelector('#aram-lite-quit-confirm'), null);
    updateConfig({ champSelectQuit: true }); await sleep();
    open();
    const confirm = dialog.shadowRoot!.querySelector<HTMLButtonElement>('[data-aram-lite-quit-action="confirm"]')!;
    confirm.click(); confirm.click(); open();
    assert.equal(f.writes(uri.lobby).length, 1);
    assert.equal(f.observers, 1);
    pending.resolve(new Response(null, { status: 204 })); await sleep();
  } finally { pending.resolve(new Response(null, { status: 204 })); f.close(); }
});
test('native statistics API opens Graph after honor without requiring the advanced button DOM', async () => {
  const f = fixture();
  const honor = deferred<void>();
  const calls: Array<Record<string, unknown>> = [];
  let moduleName = '';
  Object.assign(f.dom.window, { rcp: { whenReady(name: string) {
    moduleName = name;
    return Promise.resolve({ displayMatchDetails(options: Record<string, unknown>) {
      calls.push(options);
      document.body.innerHTML = '<div class="match-details-root match-details-no-header">' +
        '<div class="match-graph-container"><div class="match-graph-display"></div></div></div>';
    } });
  } } });
  try {
    updateConfig({ autoReturnLobby: false });
    updateConfig({ openStatsDelayMs: 0 }); autoOpenStats(f, () => honor.promise);
    f.start(); await sleep();
    f.emit(uri.game, { gameData: { gameId: f.gameId, queue: { id: 2400, gameMode: 'KIWI' } } });
    f.phase('EndOfGame'); await sleep();
    assert.equal(calls.length, 0);
    honor.resolve();
    await waitUntil(() => calls.length === 1);
    assert.equal(moduleName, 'rcp-fe-lol-match-history');
    const options = calls[0];
    assert.equal(options.defaultSection, 'stats');
    assert.equal(options.dataSource, 'eogStats');
    assert.equal(options.hideHeader, true);
    assert.equal(options.gameMode, 'KIWI');
    assert.deepEqual(options.sections, ['stats', 'graph', 'runes']);
    (options.closeModalCallback as () => void)();
    document.body.innerHTML = '';
    updateConfig({ autoOpenStats: false }); updateConfig({ autoOpenStats: true }); await sleep();
    assert.equal(calls.length, 1);
    assert.equal(f.writes().length, 0);
    assert.equal(f.observers, 1);
  } finally { honor.resolve(); f.close(); }
});

test('native statistics prefer the advanced button and late modules never open after phase exit', async () => {
  const f = fixture();
  const api = deferred<unknown>();
  const order: string[] = [];
  Object.assign(f.dom.window, { rcp: { whenReady: () => api.promise } });
  try {
    updateConfig({ openStatsDelayMs: 0 }); autoOpenStats(f, async () => {});
    f.start(); await sleep(); f.phase('EndOfGame');
    f.phase('Lobby');
    api.resolve({ displayMatchDetails() { order.push('native'); throw new Error('unavailable'); } });
    await sleep();
    assert.equal(order.length, 0);
    document.body.innerHTML = '<button class="postgame-match-history-button">观看进阶记录</button>';
    document.querySelector('button')!.addEventListener('click', () => {
      order.push('button');
      document.body.insertAdjacentHTML('beforeend', '<div class="match-details-root match-details-no-header">' +
        '<div class="match-graph-container"><div class="match-graph-display"></div></div></div>');
    });
    f.phase('EndOfGame');
    await waitUntil(() => order.length === 1);
    assert.deepEqual(order, ['button']);
    await sleep();
    assert.equal(order.length, 1);
  } finally { api.resolve({}); f.close(); }
});
test('a no-op advanced button does not block the native API when its module becomes ready later', async () => {
  const f = fixture();
  const api = deferred<unknown>();
  let nativeCalls = 0;
  Object.assign(f.dom.window, { rcp: { whenReady: () => api.promise } });
  try {
    updateConfig({ openStatsDelayMs: 0 }); autoOpenStats(f, async () => {});
    f.start(); await sleep();
    document.body.innerHTML = '<button class="postgame-match-history-button">观看进阶记录</button>';
    f.phase('EndOfGame'); await sleep();
    api.resolve({ displayMatchDetails() {
      nativeCalls++;
      document.body.innerHTML = '<div class="match-details-root match-details-no-header">' +
        '<div class="match-graph-container"><div class="match-graph-display"></div></div></div>';
    } });
    await waitUntil(() => nativeCalls === 1);
    await sleep();
    assert.equal(nativeCalls, 1);
  } finally { api.resolve({}); f.close(); }
});
test('friend status uses colors without game text and restores native colors when disabled', async () => {
  const states = ['hosting_KIWI', 'inGame', 'inQueue', 'championSelect', 'spectating'];
  const f = fixture(request => request.endpoint === uri.friends ? json(states.map((state, i) => ({
    puuid: String(i), gameName: 'Friend' + i, lol: {
      gameStatus: state, gameQueueType: 'KIWI', timeStamp: String(Date.now() - 65000),
    },
  }))) : undefined);
  try {
    document.head.insertAdjacentHTML('beforeend', '<style>.status-message{color:red}</style>');
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container">' + states.map((state, i) =>
      '<div class="lol-social-roster-member" data-puuid="' + i + '">' +
      '<span class="status-message">原始状态</span></div>').join('') + '</div>';
    await sleep();
    const statuses = [...document.querySelectorAll<HTMLElement>('.status-message')];
    assert.equal(getComputedStyle(statuses[0]).color, 'rgb(54, 217, 135)');
    assert.equal(getComputedStyle(statuses[1]).color, 'rgb(10, 203, 230)');
    assert.match(statuses[1].textContent!, /海克斯大乱斗 · 01:[0-9]{2}/);
    assert.equal(statuses[1].textContent!.includes('游戏中'), false);
    assert.equal(new Set(statuses.map(status => getComputedStyle(status).color)).size, 5);
    document.getElementById('aram-lite-friend-status-colors')!.remove();
    await waitUntil(() => !!document.getElementById('aram-lite-friend-status-colors'));
    updateConfig({ friendStatus: false });
    await sleep();
    assert.equal(document.querySelector('[data-aram-lite-state]'), null);
    for (const status of statuses) {
      assert.equal(status.textContent, '原始状态');
      assert.equal(getComputedStyle(status).color, 'rgb(255, 0, 0)');
    }
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});
test('statistics default to 500 ms after honor and pending opens cancel on phase exit', async () => {
  const f = fixture();
  const honor = deferred<void>();
  const calls: number[] = [];
  Object.assign(f.dom.window, { rcp: { whenReady: () => Promise.resolve({
    displayMatchDetails() {
      calls.push(performance.now());
      document.body.innerHTML = '<div class="match-details-root match-details-no-header"><div class="match-graph-container"><div class="match-graph-display"></div></div></div>';
    },
  }) } });
  try {
    assert.equal(config.openStatsDelayMs, 500);
    controlPanel(f);
    autoOpenStats(f, () => honor.promise);
    f.start(); await sleep();
    const shadow = document.querySelector('#aram-lite-controls')!.shadowRoot!;
    assert.equal(shadow.querySelector<HTMLInputElement>('[name="openStatsDelayMs"]')!.value, '500');
    f.phase('EndOfGame'); await sleep(100);
    assert.equal(calls.length, 0);
    const released = performance.now();
    honor.resolve(); await sleep(150);
    assert.equal(calls.length, 0);
    await waitUntil(() => calls.length === 1);
    assert.ok(calls[0] - released >= 480);
    f.phase('Lobby'); document.body.innerHTML = '';
    f.phase('EndOfGame'); await sleep(80); f.phase('Lobby'); await sleep(550);
    assert.equal(calls.length, 1);
  } finally { honor.resolve(); f.close(); }
});

test('statistics initialize Data and wait for our avatar before constructing Graph', async () => {
  const f = fixture();
  let graphs = 0;
  Object.assign(f.dom.window, { rcp: { whenReady: () => Promise.resolve({
    displayMatchDetails(options: { defaultSection: string }) {
      assert.equal(options.defaultSection, 'stats');
      document.body.innerHTML = '<div class="match-details-root match-details-no-header">'
        + '<div class="rcp-fe-lol-match-details-overlay-sub-nav"><button data-name="graph">图表</button></div></div>';
      document.querySelector('[data-name="graph"]')!.addEventListener('click', () => {
        graphs++;
        document.querySelector('.match-details-root')!.insertAdjacentHTML('beforeend',
          '<div class="match-graph-container"><div class="match-graph-display"></div></div>');
      });
    },
  }) } });
  try {
    updateConfig({ openStatsDelayMs: 0, autoReturnLobby: false });
    autoOpenStats(f, async () => {});
    f.start(); await sleep(); f.phase('EndOfGame'); await sleep(100);
    assert.equal(graphs, 0, 'a visible tab is insufficient until the local identity is ready');
    document.querySelector('.match-details-root')!.insertAdjacentHTML('beforeend',
      '<div class="team-avatar-wrapper current"></div>');
    await waitUntil(() => graphs === 1);
    f.flow.refresh(); await sleep();
    assert.equal(graphs, 1);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('immediate return bypasses countdown once and keeps saved delay for the next game', async () => {
  const f = fixture();
  try {
    updateConfig({ returnLobbyDelayMs: 15000 });
    autoReturnLobby(f); f.start(); await sleep(); f.phase('PreEndOfGame');
    await waitUntil(() => !!document.querySelector('#aram-lite-return-countdown'));
    const notice = document.querySelector<HTMLElement>('#aram-lite-return-countdown')!;
    assert.equal(notice.style.flexDirection, 'column');
    assert.deepEqual([...notice.querySelectorAll('button')].map(button => button.textContent), ['立即回房', '取消']);
    const immediate = notice.querySelector<HTMLButtonElement>('[data-action="return"]')!;
    immediate.click(); immediate.click(); f.flow.refresh();
    await waitUntil(() => f.writes('/lol-lobby/v2/play-again').length === 1);
    assert.equal(config.returnLobbyDelayMs, 15000);
    assert.equal(document.querySelector('#aram-lite-return-countdown'), null);
    f.phase('EndOfGame'); await sleep();
    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 1);
    f.phase('Lobby'); f.phase('PreEndOfGame'); await sleep(100);
    assert.equal(f.writes('/lol-lobby/v2/play-again').length, 1);
    assert.match(document.querySelector('#aram-lite-return-countdown')!.textContent!, /15 秒后自动回房/);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('outOfGame friends with verified party presence display their lobby while idle and malformed parties stay native', async () => {
  const party = JSON.stringify({ partyId: 'room', queueId: 2400, maxPlayers: 5, summonerPuuids: ['a', 'b'] });
  const cases = [
    { ptyType: 'open', pty: party },
    { ptyType: 'closed', pty: party },
    { ptyType: 'open', pty: '{broken' },
    { ptyType: '', pty: party },
    { ptyType: 'open', pty: JSON.stringify({ partyId: 'room', queueId: 2400, maxPlayers: 5, summonerPuuids: [] }) },
    {},
  ];
  const f = fixture(request => {
    if (request.endpoint === uri.friends) return json(cases.map((fields, i) => ({
      puuid: String(i), gameName: 'Room' + i, availability: 'chat',
      lol: { gameStatus: 'outOfGame', gameMode: 'KIWI', queueId: '2400', ...fields },
    })));
    if (request.endpoint === uri.queues) return json([{ id: 2400, type: 'KIWI', name: '随机单中：大混战' }]);
  });
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container">' + cases.map((_, i) =>
      '<div class="lol-social-roster-member" data-puuid="' + i + '"><span class="member-name">Room' + i +
      '</span><span class="status-message">2/5</span></div>').join('') + '</div>';
    await sleep();
    const statuses = [...document.querySelectorAll('.status-message')];
    for (const status of statuses.slice(0, 2)) {
      assert.equal(status.textContent, '海克斯大乱斗 · 大厅 · 2/5');
      assert.equal(status.getAttribute('data-aram-lite-state'), 'lobby');
    }
    for (const status of statuses.slice(2)) {
      assert.equal(status.textContent, '2/5');
      assert.equal(status.hasAttribute('data-aram-lite-state'), false);
    }
    updateConfig({ friendStatus: false }); await sleep();
    assert.ok(statuses.every(status => status.textContent === '2/5'));
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('native custom-element roster rows enhance open party status and restore it after redraw', async () => {
  const f = fixture(request => {
    if (request.endpoint === uri.friends) return json([{
      id: 'chat-friend-id', gameName: 'CanChickenSwim', availability: 'chat',
      lol: { gameStatus: 'outOfGame', gameMode: 'KIWI', queueId: '2400', ptyType: 'open',
        pty: JSON.stringify({ partyId: 'room', queueId: 2400, maxPlayers: 5, summonerPuuids: ['a'] }) },
    }]);
    if (request.endpoint === uri.queues) return json([{ id: 2400, type: 'KIWI', name: '随机单中：大混战' }]);
  });
  const markup = '<div class="lol-social-lower-pane-container"><lol-social-roster-member>'
    + '<div class="member layout" data-id="chat-friend-id"><div class="member-name">别名</div>'
    + '<lol-social-status><span class="status-message open-party chat">3/5 随机单中：大混战</span></lol-social-status>'
    + '</div></lol-social-roster-member></div>';
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = markup; await sleep();
    assert.equal(document.querySelector('.status-message')!.textContent, '海克斯大乱斗 · 大厅 · 1/5');
    assert.equal(document.querySelector('.status-message')!.getAttribute('data-aram-lite-state'), 'lobby');
    document.body.innerHTML = markup; await sleep();
    assert.equal(document.querySelector('.status-message')!.textContent, '海克斯大乱斗 · 大厅 · 1/5');
    updateConfig({ friendStatus: false }); await sleep();
    assert.equal(document.querySelector('.status-message')!.textContent, '3/5 随机单中：大混战');
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('friend lobby occupancy follows party updates and carries the last party size into game', async () => {
  let count = 2, state = 'hosting_KIWI';
  const f = fixture(request => request.endpoint === uri.friends ? json([{
    puuid: 'room', gameName: 'Room', availability: 'chat',
    lol: { gameStatus: state, gameMode: 'KIWI', pty: JSON.stringify({
      partyId: 'room', queueId: 2400, maxPlayers: 5, summoners: Array.from({ length: count }, (_, i) => i + 1),
    }) },
  }]) : undefined);
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container"><div class="lol-social-roster-member" data-puuid="room">'
      + '<span class="member-name">Room</span><span class="status-message">原始状态</span></div></div>';
    await sleep();
    assert.equal(document.querySelector('.status-message')!.textContent, '海克斯大乱斗 · 大厅 · 2/5');
    count = 3; f.emit(uri.friends, {});
    await waitUntil(() => document.querySelector('.status-message')!.textContent === '海克斯大乱斗 · 大厅 · 3/5');
    state = 'inGame'; f.emit(uri.friends, {});
    await waitUntil(() => document.querySelector('.status-message')!.textContent === '海克斯大乱斗 · 3/5');
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('friend lobby modes and occupancy support ARAM, solo duo, flex, normals and TFT in open and closed rooms', async () => {
  const queues = [
    { id: 450, type: 'ARAM_UNRANKED_5x5', name: '随机单中', expected: '大乱斗', max: 5 },
    { id: 420, type: 'RANKED_SOLO_5x5', name: '单 / 双排积分', expected: '单双排', max: 2 },
    { id: 440, type: 'RANKED_FLEX_SR', name: '弹性积分', expected: '灵活排位', max: 5 },
    { id: 400, type: 'NORMAL', name: '一般对战', expected: '匹配', max: 5 },
    { id: 1100, type: 'RANKED_TFT', name: '联盟战棋（积分）', expected: '云顶排位', max: 3 },
    { id: 1160, type: 'RANKED_TFT_DOUBLE_UP', name: '联盟战棋（双人搭档）', expected: '云顶双人', max: 2 },
  ];
  const rooms = queues.flatMap(queue => ['hosting', 'open', 'closed'].map(kind => ({ queue, kind })));
  const f = fixture(request => {
    if (request.endpoint === uri.queues) return json(queues);
    if (request.endpoint === uri.friends) return json(rooms.map(({ queue, kind }, i) => ({
      puuid: String(i), gameName: 'Friend' + i, availability: 'chat',
      lol: { gameStatus: kind === 'hosting' ? 'hosting_' + queue.type : 'outOfGame',
        gameQueueType: '', gameMode: queue.type.startsWith('RANKED_TFT') ? 'TFT' : 'CLASSIC',
        ptyType: kind === 'hosting' ? 'closed' : kind,
        pty: JSON.stringify({ partyId: 'room' + i, queueId: queue.id, maxPlayers: queue.max, summoners: [1, 2] }) },
    })));
  });
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container">' + rooms.map((_, i) =>
      '<div class="lol-social-roster-member" data-puuid="' + i + '"><span class="member-name">Friend' + i +
      '</span><span class="status-message">原始状态</span></div>').join('') + '</div>';
    await sleep();
    const statuses = [...document.querySelectorAll('.status-message')];
    rooms.forEach(({ queue }, i) => {
      assert.equal(statuses[i].textContent, queue.expected + ' · 大厅 · 2/' + queue.max);
      assert.equal(statuses[i].getAttribute('data-aram-lite-state'), 'lobby');
    });
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('friend party size carries through queue, selection and game then clears for idle, offline and another match', async () => {
  let state = 'hosting_KIWI', availability = 'chat', queueId = '2400', gameId = '', count = 3;
  const f = fixture(request => {
    if (request.endpoint === uri.friends) return json([{
      puuid: 'friend', gameName: 'Friend', availability,
      lol: { gameStatus: state, queueId, gameId, gameMode: 'KIWI', timeStamp: String(Date.now() - 65000),
        pty: state.startsWith('hosting') ? JSON.stringify({ partyId: 'party', queueId: 2400,
          maxPlayers: 5, summonerPuuids: Array.from({ length: count }, (_, i) => String(i)) }) : '' },
    }]);
    if (request.endpoint === uri.queues) return json([{ id: 2400, type: 'KIWI', name: '随机单中：大混战' },
      { id: 420, type: 'RANKED_SOLO_5x5', name: '单 / 双排积分' }]);
  });
  const text = () => document.querySelector('.status-message')!.textContent!;
  async function change(next: string) { state = next; f.emit(uri.friends, {}); await sleep(330); }
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container"><div class="lol-social-roster-member" data-puuid="friend">'
      + '<span class="member-name">Friend</span><span class="status-message">原始状态</span></div></div>';
    await sleep();
    assert.equal(text(), '海克斯大乱斗 · 大厅 · 3/5');
    await change('inQueue'); assert.equal(text(), '海克斯大乱斗 · 排队 · 3/5');
    await change('championSelect'); assert.equal(text(), '海克斯大乱斗 · 选人 · 3/5');
    gameId = '111'; await change('inGame'); assert.match(text(), /海克斯大乱斗 · 01:[0-9]{2} · 3[/]5/);
    gameId = '112'; await change('inGame'); assert.ok(!text().includes('3/5'));
    await change('hosting_KIWI'); await change('outOfGame'); assert.equal(text(), '原始状态');
    await change('inQueue'); assert.ok(!text().includes('3/5'));
    await change('hosting_KIWI'); availability = 'offline'; await change('hosting_KIWI');
    availability = 'chat'; await change('championSelect'); assert.ok(!text().includes('3/5'));
    await change('hosting_KIWI'); queueId = '420'; await change('inQueue');
    assert.equal(text(), '单双排 · 排队中');
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('friend exact queue names stay distinct across common modes in queue, selection and game', async () => {
  const queues = [
    { id: 450, type: 'ARAM_UNRANKED_5x5', name: '随机单中', expected: '大乱斗' },
    { id: 2400, type: 'KIWI', name: '随机单中：大混战', expected: '海克斯大乱斗' },
    { id: 420, type: 'RANKED_SOLO_5x5', name: '单 / 双排积分', expected: '单双排' },
    { id: 440, type: 'RANKED_FLEX_SR', name: '弹性积分', expected: '灵活排位' },
    { id: 400, type: 'NORMAL', name: '一般对战', expected: '匹配' },
    { id: 490, type: 'NORMAL', name: '快速游戏', expected: '快速游戏' },
    { id: 1750, type: 'CHERRY', name: '竞技场3x6', expected: '竞技场3x6' },
    { id: 1700, type: 'CHERRY', name: '竞技场', expected: '竞技场' },
    { id: 1100, type: 'RANKED_TFT', name: '联盟战棋（积分）', expected: '云顶排位' },
    { id: 1160, type: 'RANKED_TFT_DOUBLE_UP', name: '联盟战棋（双人搭档）', expected: '云顶双人' },
    { id: 900, type: 'URF', name: '阿福快打', expected: '阿福快打' },
  ];
  let state = 'hosting';
  const f = fixture(request => {
    if (request.endpoint === uri.queues) return json(queues);
    if (request.endpoint === uri.friends) return json(queues.map((queue, i) => ({
      puuid: String(i), gameName: 'Friend' + i, availability: 'chat',
      lol: { gameStatus: state === 'hosting' ? 'hosting_' + queue.type : state, gameQueueType: queue.type,
        queueId: String(queue.id), timeStamp: String(Date.now() - 65000),
        pty: state === 'hosting' ? JSON.stringify({ partyId: 'party' + i, queueId: queue.id, maxPlayers: 5, summoners: [1, 2] }) : '' },
    })));
  });
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container">' + queues.map((_, i) =>
      '<div class="lol-social-roster-member" data-puuid="' + i + '"><span class="member-name">Friend' + i +
      '</span><span class="status-message">原始状态</span></div>').join('') + '</div>';
    await sleep();
    for (const next of ['hosting', 'inQueue', 'championSelect', 'inGame']) {
      state = next; f.emit(uri.friends, {}); await sleep(330);
      const statuses = [...document.querySelectorAll('.status-message')];
      queues.forEach((queue, i) => {
        const activity = next === 'hosting' ? '大厅 · 2/5' : next === 'inQueue' ? '排队 · 2/5' : next === 'championSelect' ? '选人 · 2/5' : '01:';
        assert.ok(statuses[i].textContent!.startsWith(queue.expected + ' · ' + activity), statuses[i].textContent!);
        if (next === 'inGame') assert.match(statuses[i].textContent!, / · 2[/]5$/);
      });
    }
  } finally { f.close(); }
});

test('friend current party size takes priority in queue, selection and game with cached fallback', async () => {
  let state = 'inQueue', count = 2, live = true;
  const f = fixture(request => request.endpoint === uri.friends ? json([{
    puuid: 'friend', gameName: 'Friend', availability: 'chat',
    lol: { gameStatus: state, queueId: '2400', gameMode: 'KIWI',
      pty: live ? JSON.stringify({ partyId: 'room', queueId: 2400, maxPlayers: 5,
        summoners: Array.from({ length: count }, (_, i) => i + 1) }) : '' },
  }]) : undefined);
  const text = () => document.querySelector('.status-message')!.textContent;
  async function change(next: string) { state = next; f.emit(uri.friends, {}); await sleep(330); }
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container"><div class="lol-social-roster-member" data-puuid="friend">'
      + '<span class="member-name">Friend</span><span class="status-message">原始状态</span></div></div>';
    await sleep();
    assert.equal(text(), '海克斯大乱斗 · 排队 · 2/5');
    count = 3; await change('championSelect'); assert.equal(text(), '海克斯大乱斗 · 选人 · 3/5');
    count = 4; await change('inGame'); assert.equal(text(), '海克斯大乱斗 · 4/5');
    live = false; await change('inGame'); assert.equal(text(), '海克斯大乱斗 · 4/5');
    count = 2; live = true; await change('inGame'); assert.equal(text(), '海克斯大乱斗 · 2/5');
    assert.equal(document.querySelector('.status-message')!.getAttribute('data-aram-lite-state'), 'inGame');
  } finally { f.close(); }
});

test('statistics bypass Riot click overrides and retry an unready advanced button', async () => {
  for (const throws of [false, true]) {
    const f = fixture();
    let attempts = 0;
    try {
      updateConfig({ openStatsDelayMs: 0, autoReturnLobby: false });
      autoOpenStats(f, async () => {}); f.start(); await sleep();
      document.body.innerHTML = '<button class="postgame-match-history-button">观看进阶记录</button>';
      const button = document.querySelector<HTMLButtonElement>('button')!;
      button.click = () => { if (throws) throw new TypeError('Riot click requires event.button'); };
      button.onclick = () => {
        attempts++;
        if (attempts === 1) return;
        document.body.insertAdjacentHTML('beforeend', '<div class="match-details-root match-details-no-header">'
          + '<div class="match-graph-container"><div class="match-graph-display"></div></div></div>');
      };
      f.phase('EndOfGame');
      await sleep(1250);
      await waitUntil(() => attempts === 2);
      await sleep();
      document.querySelector('.match-details-root')!.remove();
      f.injector.schedule(); await sleep(1100);
      assert.equal(attempts, 2, 'manual close must not cause another open');
      assert.equal(f.observers, 1);
    } finally { f.close(); }
  }
});

test('statistics retry a silent native open failure without assuming the request succeeded', async () => {
  const f = fixture();
  let calls = 0;
  Object.assign(f.dom.window, { rcp: { whenReady: () => Promise.resolve({ displayMatchDetails() {
    calls++;
    if (calls === 2) document.body.innerHTML = '<div class="match-details-root match-details-no-header">'
      + '<div class="match-graph-container"><div class="match-graph-display"></div></div></div>';
  } }) } });
  try {
    updateConfig({ openStatsDelayMs: 0, autoReturnLobby: false });
    autoOpenStats(f, async () => {}); f.start(); await sleep(); f.phase('EndOfGame');
    await sleep(2200); await waitUntil(() => calls === 2);
    await sleep(2100); assert.equal(calls, 2);
  } finally { f.close(); }
});

test('friend party cache survives page reload and rejects another game, changed mode and expired entries', async () => {
  let state = 'hosting_KIWI';
  const f = fixture(request => request.endpoint === uri.friends ? json([{
    puuid: 'friend', gameName: 'Friend', availability: 'chat',
    lol: { gameStatus: state, queueId: '2400', gameId: '111', gameMode: 'KIWI',
      pty: state.startsWith('hosting') ? JSON.stringify({ partyId: 'room', queueId: 2400, maxPlayers: 5, summoners: [1, 2] }) : '' },
  }]) : undefined);
  const key = 'aram-lite:friend-party-sizes';
  let saved = '';
  try {
    friendEnhancement(f); f.start(); await sleep();
    state = 'inGame'; f.emit(uri.friends, {}); await sleep(330);
    saved = f.dom.window.sessionStorage.getItem(key)!;
    assert.ok(saved.includes('2/5'));
  } finally { f.close(); }
  const markup = '<div class="lol-social-lower-pane-container"><div class="lol-social-roster-member" data-puuid="friend">'
    + '<span class="member-name">Friend</span><span class="status-message">原始状态</span></div></div>';
  for (const variant of ['same', 'another-game', 'another-mode', 'expired', 'malformed']) {
    const reload = fixture(request => request.endpoint === uri.friends ? json([{
      puuid: 'friend', gameName: 'Friend', availability: 'dnd',
      lol: { gameStatus: 'inGame', queueId: variant === 'another-mode' ? '420' : '2400',
        gameId: variant === 'another-game' ? '112' : '111', gameMode: 'KIWI', pty: '' },
    }]) : undefined);
    try {
      let stored = saved;
      if (variant === 'expired') {
        const entries = JSON.parse(saved); entries[0][1].updatedAt = Date.now() - 7 * 60 * 60 * 1000;
        stored = JSON.stringify(entries);
      }
      if (variant === 'malformed') stored = '[null,["friend",{"occupancy":"2/5"}]]';
      reload.dom.window.sessionStorage.setItem(key, stored);
      friendEnhancement(reload); reload.start(); await sleep();
      document.body.innerHTML = markup; await sleep();
      assert.equal(document.querySelector('.status-message')!.textContent!.includes('2/5'), variant === 'same', variant);
      assert.equal(reload.observers, 1);
    } finally { reload.close(); }
  }
});

test('single-person friend parties display 1/5 in every phase including cached game presence', async () => {
  let state = 'hosting_KIWI';
  const f = fixture(request => request.endpoint === uri.friends ? json([{
    puuid: 'solo', gameName: 'Solo', availability: 'chat', lol: { gameStatus: state, queueId: '2400', gameMode: 'KIWI',
      pty: state === 'hosting_KIWI' ? JSON.stringify({ partyId: 'room', queueId: 2400, maxPlayers: 5, summoners: [1] }) : '' },
  }]) : undefined);
  try {
    friendEnhancement(f); f.start(); await sleep();
    document.body.innerHTML = '<div class="lol-social-lower-pane-container"><div class="lol-social-roster-member" data-puuid="solo">'
      + '<span class="member-name">Solo</span><span class="status-message">原始状态</span></div></div>';
    await sleep();
    for (const next of ['hosting_KIWI', 'inQueue', 'championSelect', 'inGame']) {
      state = next; f.emit(uri.friends, {}); await sleep(330);
      assert.ok(document.querySelector('.status-message')!.textContent!.includes('1/5'), next);
    }
  } finally { f.close(); }
});

test('long friend mode names use concise aliases and unknown future names never exceed nine characters', () => {
  const cases = [
    ['海克斯大乱斗', '海克斯大乱斗'],
    ['随机单中：大混战锦标赛', '海克斯锦标赛'],
    ['竞技场（PBE公测服务器 2v2）', '竞技场PBE'],
    ['召唤峡谷盲选模式自定义', '峡谷盲选自定义'],
    ['末日机器人 - 维迦的诅咒！', '末日诅咒'],
    ['末日机器人 - 维迦的邪恶！', '末日邪恶'],
    ['《联盟战棋》（巴豆龙的经典宝藏）', '云顶宝藏'],
    ['联盟战棋：超级抽抽乐自订', '云顶狂暴自定义'],
    ['联盟战棋（教学模式）', '云顶教学'],
    ['测试：阿福快打 1v1', '阿福1v1测试'],
    ['未来未知的非常漫长模式名称', '未来未知的非常漫…'],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(compactModeName(raw), expected);
    assert.ok([...compactModeName(raw)].length <= 9);
  }
});

test('Bench preserves phase locks and only requests eligible nonempty bench champions without automatic retries', async () => {
  const f = fixture(request => request.endpoint.includes('/bench/swap/') ? json({}, 409) : undefined);
  try {
    aramBenchNoCooldown(f); f.start(); await sleep(); f.phase('ChampSelect'); await sleep();
    document.body.innerHTML = '<div class="bench-container"><div class="champion-bench-item locked-out waiting-on-finalization">'
      + '<div class="bench-champion-background" style="background-image:url(/lol-game-data/assets/v1/champion-icons/1.png)"></div></div></div>';
    await sleep();
    const item = document.querySelector<HTMLElement>('.champion-bench-item')!;
    item.click(); await sleep();
    assert.equal(f.writes().length, 0);
    item.classList.remove('locked-out'); item.click(); await sleep();
    assert.equal(f.writes().length, 0);
    item.classList.remove('waiting-on-finalization');
    item.click(); item.click(); await sleep();
    assert.equal(f.writes(uri.champ + '/bench/swap/1').length, 1);
    f.emit(uri.champ, f.session()); await sleep(100);
    assert.equal(f.writes(uri.champ + '/bench/swap/1').length, 1);
    item.classList.add('empty-bench-item'); item.click(); await sleep();
    item.classList.remove('empty-bench-item');
    item.querySelector<HTMLElement>('.bench-champion-background')!.style.backgroundImage = 'url(/lol-game-data/assets/v1/champion-icons/999.png)';
    item.click(); await sleep();
    assert.equal(f.writes().length, 1);
    item.querySelector<HTMLElement>('.bench-champion-background')!.style.backgroundImage = 'url(/lol-game-data/assets/v1/champion-icons/1.png)';
    updateConfig({ benchNoCooldown: false }); item.click(); await sleep();
    assert.equal(f.writes().length, 1);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('Bench retains native grayscale and waiting masks even when cooldown bypass is enabled', async () => {
  const f = fixture();
  try {
    const nativeStyle = document.createElement('style');
    nativeStyle.textContent = '.champion-bench-item.locked-out{filter:grayscale(1);cursor:not-allowed;pointer-events:none}';
    document.head.append(nativeStyle);
    aramBenchNoCooldown(f); f.start(); await sleep(); f.phase('ChampSelect'); await sleep();
    document.body.innerHTML = '<div class="bench-container">' + [1, 999].map(id =>
      '<div class="champion-bench-item locked-out waiting-on-finalization"><div class="bench-champion-background" '
      + 'style="background-image:url(/lol-game-data/assets/v1/champion-icons/' + id + '.png)"></div></div>').join('') + '</div>';
    await sleep();
    const items = [...document.querySelectorAll<HTMLElement>('.champion-bench-item')];
    assert.equal(items[0].hasAttribute('data-aram-lite-bench-swap'), false);
    assert.equal(items[1].hasAttribute('data-aram-lite-bench-swap'), false);
    assert.equal(getComputedStyle(items[0]).filter, 'grayscale(1)');
    assert.equal(getComputedStyle(items[0]).pointerEvents, 'none');
    assert.equal(getComputedStyle(items[1]).filter, 'grayscale(1)');
    items[0].click(); await sleep();
    assert.equal(f.writes(uri.champ + '/bench/swap/1').length, 0);
    updateConfig({ benchNoCooldown: false }); await sleep();
    assert.equal(items[0].hasAttribute('data-aram-lite-bench-swap'), false);
    assert.equal(getComputedStyle(items[0]).filter, 'grayscale(1)');
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('Bench success is checked against the local champion and unchanged responses remain in the log', async () => {
  for (const changes of [false, true]) {
    let sent = false, checks = 0;
    const notices: string[] = [];
    const previousToast = (globalThis as typeof globalThis & { Toast?: unknown }).Toast;
    const f = fixture(request => {
      if (request.endpoint.includes('/bench/swap/')) { sent = true; return new Response(null, { status: 204 }); }
      if (request.endpoint === uri.champ && sent) {
        checks++;
        return json({ ...f.session(), myTeam: [{ cellId: 0, championId: changes ? 1 : 2, spell1Id: 4, spell2Id: 32 }] });
      }
    });
    Object.assign(globalThis, { Toast: { error: (message: string) => notices.push(message) } });
    try {
      aramBenchNoCooldown(f); f.start(); await sleep(); f.phase('ChampSelect'); await sleep();
      document.body.innerHTML = '<div class="bench-container"><div class="champion-bench-item">'
        + '<div class="bench-champion-background" style="background-image:url(/lol-game-data/assets/v1/champion-icons/1.png)"></div></div></div>';
      await sleep(); document.querySelector<HTMLElement>('.champion-bench-item')!.click();
      if (changes) { await waitUntil(() => checks === 1); await sleep(); assert.equal(notices.length, 0); }
      else { await waitUntil(() => checks === 3); await sleep(); assert.equal(notices.length, 0);
        const entries = f.storage.get('aram-lite:bench-log') as Array<{ event: string; data: { gameId?: number } }>;
        assert.ok(entries.some(entry => entry.event === 'unconfirmed' && entry.data.gameId === f.gameId)); }
      assert.equal(f.writes().length, 1);
    } finally { f.close(); Object.assign(globalThis, { Toast: previousToast }); }
  }
});

test('Bench records pointerdown across shadow DOM and click rejection without another connection or observer', async () => {
  const f = fixture(request => request.endpoint.includes('/bench/swap/') ? json({ message: 'not allowed in this phase' }, 409) : undefined);
  try {
    aramBenchNoCooldown(f); f.start(); await sleep(); f.phase('ChampSelect'); await sleep();
    document.body.innerHTML = '<div class="bench-container"><div class="champion-bench-item">'
      + '<div class="bench-champion-background" style="background-image:url(/lol-game-data/assets/v1/champion-icons/1.png)"></div>'
      + '<test-bench-icon></test-bench-icon></div></div>';
    const icon = document.querySelector('test-bench-icon')!;
    const shadow = icon.attachShadow({ mode: 'open' }); shadow.innerHTML = '<span>Icon</span>';
    const target = shadow.querySelector('span')!;
    target.dispatchEvent(new f.dom.window.MouseEvent('pointerdown', { bubbles: true, composed: true }));
    target.dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true, composed: true }));
    await sleep();
    const entries = f.storage.get('aram-lite:bench-log') as Array<{ event: string; data: Record<string, unknown> }>;
    const recent = entries.filter(entry => entry.data.gameId === f.gameId);
    assert.ok(recent.some(entry => entry.event === 'pointerdown'));
    const click = recent.find(entry => entry.event === 'click')!;
    assert.ok(click);
    const requestEntry = [...entries].reverse().find(entry => entry.event === 'request' && entry.data.gameId === f.gameId)!;
    const requestIndex = entries.indexOf(requestEntry);
    const response = entries.slice(requestIndex).find(entry => entry.event === 'response')!;
    assert.equal(response.data.status, 409);
    assert.match(String(response.data.body), /not allowed/);
    assert.equal(f.writes().length, 1);
    assert.equal(f.observers, 1);
  } finally { f.close(); }
});

test('Bench file logging preserves write order, survives backup failure and remains bounded', async () => {
  const f = fixture();
  const writes: string[] = [];
  try {
    Object.assign(globalThis, { DataStore: { get: () => undefined, set: () => { throw new Error('backup unavailable'); } } });
    const log = new BenchLog();
    log.bind({ write: async (path, content) => { assert.match(path, /^bench-log-.*\.json$/); writes.push(content); return true; } });
    log.record('click', { targetChampion: 1 }); log.record('response', { status: 409 });
    await log.flush();
    assert.deepEqual(JSON.parse(writes.at(-1)!).entries.map((entry: { event: string }) => entry.event), ['logger-ready', 'click', 'response']);
    const bounded = new BenchLog();
    for (let i = 0; i < 510; i++) bounded.record('event', { i });
    let content = '';
    bounded.bind({ write: async (_path, text) => { content = text; return true; } });
    await bounded.flush();
    assert.equal(JSON.parse(content).entries.length, 500);
    assert.equal(f.writes().length, 0);
  } finally { f.close(); }
});
