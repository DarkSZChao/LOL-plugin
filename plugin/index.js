/* ARAM Lite — based on WJZ-P/sona (7a88a31). */

// src/core/config.ts
var switches = [
  ["autoAccept", "\u81EA\u52A8\u63A5\u53D7\u5BF9\u5C40"],
  ["benchNoCooldown", "Bench \u65E0 CD"],
  ["rememberSpells", "\u8BB0\u4F4F\u53EC\u5524\u5E08\u6280\u80FD"],
  ["champSelectQuit", "\u9009\u4EBA\u5FEB\u6377\u9000\u51FA"],
  ["autoOpenStats", "\u81EA\u52A8\u6253\u5F00\u7EDF\u8BA1"],
  ["autoReturnLobby", "\u81EA\u52A8\u56DE\u623F\u95F4"],
  ["autoHonor", "\u81EA\u52A8\u70B9\u8D5E\u961F\u53CB"],
  ["friendGroups", "\u597D\u53CB\u540C\u5C40\u5206\u7EC4"],
  ["friendStatus", "\u597D\u53CB\u6A21\u5F0F\u4E0E\u65F6\u95F4"],
  ["quickLobby", "\u5FEB\u901F\u6D77\u514B\u65AF\u5927\u5385"]
];
var defaults = {
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
  returnLobbyDelayMs: 2e3,
  aramQueueId: 2400,
  // 左侧技能 / 右侧技能：固定闪现 / 雪球。
  spells: { spell1Id: 4, spell2Id: 32 },
  honorCategory: "RANDOM"
};
var config = { ...defaults, spells: { ...defaults.spells } };
var listeners = /* @__PURE__ */ new Set();
var storageKey = "aram-lite:config";
function normalizeConfig(value, base = defaults) {
  const raw = value && typeof value === "object" ? value : {};
  const result = { ...base, aramQueueId: 2400, spells: { ...defaults.spells } };
  for (const [key] of switches) {
    if (typeof raw[key] === "boolean") result[key] = raw[key];
  }
  for (const [key, max] of [["autoAcceptDelayMs", 15e3], ["openStatsDelayMs", 15e3], ["returnLobbyDelayMs", 3e4]]) {
    const number = raw[key];
    if (typeof number === "number" && Number.isFinite(number)) {
      result[key] = Math.min(max, Math.max(0, Math.round(number)));
    }
  }
  if (typeof raw.honorCategory === "string" && ["RANDOM", "HEART", "COOL", "SHOTCALLER"].includes(raw.honorCategory)) {
    result.honorCategory = raw.honorCategory;
  }
  return result;
}
function loadConfig() {
  let saved;
  try {
    if (typeof DataStore !== "undefined") saved = DataStore.get(storageKey);
  } catch (error) {
    console.warn("[ARAM Lite] \u8BFB\u53D6\u914D\u7F6E\u5931\u8D25\uFF0C\u4F7F\u7528\u9ED8\u8BA4\u503C", error);
  }
  Object.assign(config, normalizeConfig(saved));
}
function onConfigChange(callback) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
function updateConfig(patch) {
  Object.assign(config, normalizeConfig(patch, config));
  let saved = false;
  try {
    if (typeof DataStore !== "undefined") {
      saved = DataStore.set(storageKey, { ...config, spells: { ...config.spells } });
    }
  } catch (error) {
    console.warn("[ARAM Lite] \u4FDD\u5B58\u914D\u7F6E\u5931\u8D25", error);
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn("[ARAM Lite] \u914D\u7F6E\u66F4\u65B0\u5931\u8D25", error);
    }
  }
  return saved;
}
function resetConfig() {
  return updateConfig(defaults);
}
var memoryMarks = /* @__PURE__ */ new Map();
var marks = {
  get(key) {
    try {
      return typeof DataStore === "undefined" ? memoryMarks.get(key) : DataStore.get("aram-lite:" + key) ?? memoryMarks.get(key);
    } catch {
      return memoryMarks.get(key);
    }
  },
  set(key, value) {
    memoryMarks.set(key, value);
    try {
      if (typeof DataStore !== "undefined") DataStore.set("aram-lite:" + key, value);
    } catch (error) {
      console.warn("[ARAM Lite] \u4FDD\u5B58\u53BB\u91CD\u6807\u8BB0\u5931\u8D25", error);
    }
  }
};
function validSpells(value) {
  const pair = value;
  return !!pair && Number.isInteger(pair.spell1Id) && Number.isInteger(pair.spell2Id) && pair.spell1Id > 0 && pair.spell2Id > 0 && pair.spell1Id !== pair.spell2Id;
}
var memorySpells = /* @__PURE__ */ new Map();
var championSpells = {
  get(championId) {
    try {
      const value = typeof DataStore === "undefined" ? memorySpells.get(championId) : DataStore.get("aram-lite:champion-spells:" + championId);
      return validSpells(value) ? { ...value } : void 0;
    } catch (error) {
      console.warn("[ARAM Lite] \u8BFB\u53D6\u82F1\u96C4\u6280\u80FD\u5931\u8D25", error);
      return void 0;
    }
  },
  set(championId, spells) {
    if (championId <= 0 || !validSpells(spells)) return;
    try {
      if (typeof DataStore === "undefined") memorySpells.set(championId, { ...spells });
      else if (!DataStore.set("aram-lite:champion-spells:" + championId, { ...spells })) {
        console.warn("[ARAM Lite] \u4FDD\u5B58\u82F1\u96C4\u6280\u80FD\u5931\u8D25");
      }
    } catch (error) {
      console.warn("[ARAM Lite] \u4FDD\u5B58\u82F1\u96C4\u6280\u80FD\u5931\u8D25", error);
    }
  }
};

// src/core/lcu.ts
var uri = {
  phase: "/lol-gameflow/v1/gameflow-phase",
  game: "/lol-gameflow/v1/session",
  champ: "/lol-champ-select/v1/session",
  ready: "/lol-matchmaking/v1/ready-check",
  lobby: "/lol-lobby/v2/lobby",
  friends: "/lol-chat/v1/friends",
  queues: "/lol-game-queues/v1/queues",
  ballot: "/lol-honor-v2/v1/ballot"
};
var LcuError = class extends Error {
  constructor(status, method, endpoint) {
    super(method + " " + endpoint + " \u2192 " + status);
    this.status = status;
  }
};
var Lcu = class {
  async request(method, endpoint, body, onResponse) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8e3);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: body === void 0 ? void 0 : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      try {
        onResponse?.(response.status, text);
      } catch {
      }
      if (!response.ok) throw new LcuError(response.status, method, endpoint);
      return text ? JSON.parse(text) : void 0;
    } finally {
      clearTimeout(timer);
    }
  }
  get(endpoint) {
    return this.request("GET", endpoint);
  }
  post(endpoint, body) {
    return this.request("POST", endpoint, body);
  }
  patch(endpoint, body) {
    return this.request("PATCH", endpoint, body);
  }
  delete(endpoint) {
    return this.request("DELETE", endpoint);
  }
};
function report(feature, error, notify = false) {
  const message = "[ARAM Lite] " + feature + ": " + String(error);
  console.warn(message);
  const toast = globalThis.Toast;
  if (notify) toast?.error(message);
}

// src/core/events.ts
var Events = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Map();
    // Keep subscriptions across stop/start; Pengu has no per-URI unobserve.
    this.observed = /* @__PURE__ */ new Set();
    this.subscriptions = /* @__PURE__ */ new WeakMap();
  }
  bind(context) {
    if (this.socket === context.socket) return;
    this.socket = context.socket;
    this.observed = this.subscriptions.get(context.socket) ?? /* @__PURE__ */ new Set();
    this.subscriptions.set(context.socket, this.observed);
    for (const endpoint of this.listeners.keys()) this.observe(endpoint);
  }
  on(endpoint, callback) {
    let listeners2 = this.listeners.get(endpoint);
    if (!listeners2) this.listeners.set(endpoint, listeners2 = /* @__PURE__ */ new Set());
    listeners2.add(callback);
    this.observe(endpoint);
    return () => {
      listeners2.delete(callback);
    };
  }
  observe(endpoint) {
    const socket = this.socket;
    if (!socket || this.observed.has(endpoint)) return;
    this.observed.add(endpoint);
    socket.observe(endpoint, (event) => {
      if (this.socket !== socket) return;
      for (const listener of this.listeners.get(endpoint) ?? []) {
        try {
          listener(event);
        } catch (error) {
          report("\u4E8B\u4EF6\u5904\u7406", error);
        }
      }
    });
  }
};
var Scope = class {
  constructor() {
    this.controller = new AbortController();
    this.cleanups = [];
    this.timers = /* @__PURE__ */ new Set();
  }
  get active() {
    return !this.controller.signal.aborted;
  }
  own(cleanup) {
    this.cleanups.push(cleanup);
  }
  later(callback, ms) {
    if (!this.active) return () => {
    };
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.active) callback();
    }, ms);
    this.timers.add(timer);
    return () => {
      clearTimeout(timer);
      this.timers.delete(timer);
    };
  }
  delay(ms) {
    if (!this.active) return Promise.resolve(false);
    return new Promise((resolve) => {
      const finish = (ok) => {
        cancel();
        this.controller.signal.removeEventListener("abort", aborted);
        resolve(ok);
      };
      const aborted = () => finish(false);
      const cancel = this.later(() => finish(true), ms);
      this.controller.signal.addEventListener("abort", aborted, { once: true });
    });
  }
  dispose() {
    this.controller.abort();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
};

// src/core/gameflow.ts
var Gameflow = class {
  constructor(lcu, events) {
    this.lcu = lcu;
    this.events = events;
    this.phase = null;
    this.game = null;
    this.champ = null;
    this.ready = null;
    this.partyMembers = [];
    this.phaseEpoch = 0;
    this.selectionEpoch = 0;
    this.freshSelection = false;
    this.listeners = /* @__PURE__ */ new Set();
    this.gamePhaseEpoch = -1;
    this.revisions = /* @__PURE__ */ new Map();
    this.requests = /* @__PURE__ */ new Map();
  }
  get isAram() {
    if (this.phase !== "ChampSelect" || !this.champ) return false;
    if (this.champ.queueId) return this.champ.queueId === 450 || this.champ.queueId === 2400;
    if (this.gamePhaseEpoch !== this.phaseEpoch) return false;
    const gameId = this.game?.gameData?.gameId;
    if (gameId && this.champ.gameId && gameId !== this.champ.gameId) return false;
    const queueId = this.game?.gameData?.queue?.id;
    if (queueId) return queueId === 450 || queueId === 2400;
    return (this.game?.gameData?.queue?.gameMode || this.game?.map?.gameMode) === "ARAM";
  }
  onChange(callback) {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  refresh() {
    this.notify();
  }
  notify() {
    for (const callback of this.listeners) {
      try {
        callback();
      } catch (error) {
        report("\u72B6\u6001\u5904\u7406", error);
      }
    }
  }
  revision(endpoint) {
    return this.revisions.get(endpoint) ?? 0;
  }
  apply(endpoint, value) {
    this.revisions.set(endpoint, this.revision(endpoint) + 1);
    switch (endpoint) {
      case uri.phase: {
        const next = typeof value === "string" ? value : null;
        if (this.phase !== next) {
          const previous = this.phase;
          this.phase = next;
          this.phaseEpoch++;
          if (next === "None" || next === "Lobby") this.partyMembers = [];
          if (next === "ChampSelect") {
            this.champ = null;
            this.revisions.set(uri.champ, this.revision(uri.champ) + 1);
            this.selectionEpoch++;
            this.freshSelection = previous !== null;
          } else {
            this.champ = null;
            this.freshSelection = false;
            this.revisions.set(uri.champ, this.revision(uri.champ) + 1);
          }
          if (next !== "ReadyCheck") {
            this.ready = null;
            this.revisions.set(uri.ready, this.revision(uri.ready) + 1);
          }
        }
        break;
      }
      case uri.lobby:
        if (this.phase === null || ["None", "Lobby", "Matchmaking", "ReadyCheck"].includes(this.phase)) {
          if (value) this.partyMembers = value.members ?? [];
          else if (this.phase === null || this.phase === "None" || this.phase === "Lobby") this.partyMembers = [];
        }
        break;
      case uri.game:
        this.game = value;
        this.gamePhaseEpoch = this.phaseEpoch;
        break;
      case uri.champ:
        this.champ = value;
        break;
      case uri.ready:
        this.ready = value;
        break;
    }
    this.notify();
  }
  async hydrate(endpoint, scope) {
    const request = (this.requests.get(endpoint) ?? 0) + 1;
    this.requests.set(endpoint, request);
    const revision = this.revision(endpoint);
    const epoch = this.phaseEpoch;
    try {
      const value = await this.lcu.get(endpoint);
      if (!scope.active || this.requests.get(endpoint) !== request || this.revision(endpoint) !== revision) return;
      if ((endpoint === uri.champ || endpoint === uri.ready || endpoint === uri.lobby) && this.phaseEpoch !== epoch) return;
      this.apply(endpoint, value);
    } catch (error) {
      if (!(error instanceof LcuError && error.status === 404)) report("\u8BFB\u53D6\u72B6\u6001", error);
    }
  }
  start(scope) {
    for (const endpoint of [uri.phase, uri.game, uri.champ, uri.ready, uri.lobby]) {
      scope.own(this.events.on(endpoint, (event) => {
        this.apply(endpoint, event.eventType === "Delete" ? null : event.data);
      }));
    }
    let previousEpoch = this.phaseEpoch;
    scope.own(this.onChange(() => {
      if (previousEpoch === this.phaseEpoch) return;
      previousEpoch = this.phaseEpoch;
      if (this.phase === "ChampSelect") void this.hydrate(uri.champ, scope);
      if (this.phase === "ReadyCheck") void this.hydrate(uri.ready, scope);
      if (this.phase && ["None", "Lobby", "Matchmaking", "ReadyCheck"].includes(this.phase)) void this.hydrate(uri.lobby, scope);
      if (this.phase === "ChampSelect") void this.hydrate(uri.game, scope);
    }));
    void this.hydrate(uri.game, scope);
    void this.hydrate(uri.phase, scope);
    void this.hydrate(uri.lobby, scope);
    for (const delay of [1e3, 3e3]) scope.later(() => {
      if (this.phase === null) void this.hydrate(uri.phase, scope);
      if (this.game === null) void this.hydrate(uri.game, scope);
      if (this.phase === "ChampSelect" && !this.champ) void this.hydrate(uri.champ, scope);
      if (this.phase === "ReadyCheck" && !this.ready) void this.hydrate(uri.ready, scope);
    }, delay);
    scope.own(() => {
      this.phase = null;
      this.game = null;
      this.champ = null;
      this.ready = null;
      this.partyMembers = [];
      this.revisions.clear();
      this.requests.clear();
      this.gamePhaseEpoch = -1;
    });
  }
};

// src/core/injector.ts
var Injector = class {
  constructor() {
    this.tasks = /* @__PURE__ */ new Set();
    this.clicks = /* @__PURE__ */ new Map();
    this.pointerDowns = /* @__PURE__ */ new Map();
    this.frame = null;
    this.handleClick = (event) => {
      this.dispatch(event, this.clicks);
    };
    this.handlePointerDown = (event) => {
      this.dispatch(event, this.pointerDowns);
    };
    this.schedule = () => {
      if (!this.observer || this.frame !== null) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        for (const task of this.tasks) {
          try {
            task();
          } catch (error) {
            report("DOM \u6CE8\u5165", error);
          }
        }
      });
    };
  }
  register(task) {
    this.tasks.add(task);
    this.schedule();
    return () => {
      this.tasks.delete(task);
    };
  }
  onClick(selector, handler) {
    this.clicks.set(selector, handler);
    return () => {
      this.clicks.delete(selector);
    };
  }
  onPointerDown(selector, handler) {
    this.pointerDowns.set(selector, handler);
    return () => {
      this.pointerDowns.delete(selector);
    };
  }
  dispatch(event, handlers) {
    const path = event.composedPath().filter((node) => node instanceof Element);
    for (const [selector, handler] of handlers) {
      const element = path.map((node) => node.closest(selector)).find(Boolean);
      if (element) {
        try {
          handler(event, element);
        } catch (error) {
          report("\u70B9\u51FB\u5904\u7406", error);
        }
        if (event.cancelBubble) break;
      }
    }
  }
  start() {
    if (this.observer) return;
    this.observer = new MutationObserver(this.schedule);
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "disabled", "aria-disabled", "data-puuid"]
    });
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("pointerdown", this.handlePointerDown, true);
    this.tick = setInterval(this.schedule, 1e3);
    this.schedule();
  }
  stop() {
    this.observer?.disconnect();
    this.observer = void 0;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    clearInterval(this.tick);
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("pointerdown", this.handlePointerDown, true);
    this.tasks.clear();
    this.clicks.clear();
    this.pointerDowns.clear();
  }
};
function stopClick(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

// src/features/auto-accept.ts
function autoAccept({ flow, lcu, scope }) {
  let handledEpoch = -1;
  let declined = false;
  let pendingEpoch = -1;
  let pendingDelay = -1;
  let cancel = () => {
  };
  function cancelPending() {
    cancel();
    pendingEpoch = -1;
  }
  scope.own(flow.onChange(() => {
    if (flow.ready?.playerResponse === "Declined") declined = true;
    if (flow.phase !== "ReadyCheck") {
      cancelPending();
      if (flow.phase === "None" || flow.phase === "Lobby") declined = false;
      return;
    }
    if (flow.ready?.playerResponse === "Accepted") handledEpoch = flow.phaseEpoch;
    if (!config.autoAccept || declined || !flow.ready || handledEpoch === flow.phaseEpoch) {
      cancelPending();
      return;
    }
    if (pendingEpoch === flow.phaseEpoch && pendingDelay === config.autoAcceptDelayMs) return;
    cancelPending();
    const epoch = pendingEpoch = flow.phaseEpoch;
    pendingDelay = config.autoAcceptDelayMs;
    cancel = scope.later(() => {
      pendingEpoch = -1;
      if (!config.autoAccept || flow.phase !== "ReadyCheck" || flow.phaseEpoch !== epoch || declined) return;
      if (flow.ready?.playerResponse === "Accepted" || flow.ready?.playerResponse === "Declined") return;
      handledEpoch = epoch;
      void lcu.post(uri.ready + "/accept").catch((error) => report("\u81EA\u52A8\u63A5\u53D7", error));
    }, pendingDelay);
  }));
}

// src/core/bench-log.ts
var BenchLog = class {
  constructor() {
    this.entries = [];
    this.pending = Promise.resolve();
    this.file = "bench-log-" + (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(16).slice(2, 8) + ".json";
    this.key = "aram-lite:bench-log";
  }
  get store() {
    return globalThis.DataStore;
  }
  bind(fs) {
    if (this.fs === fs && this.entries.length) return;
    this.fs = fs;
    if (!this.entries.length) {
      try {
        const saved = this.store?.get(this.key);
        if (Array.isArray(saved)) this.entries = saved.slice(-500);
      } catch {
      }
    }
    this.record("logger-ready", { file: this.file, fileSystemAvailable: !!fs });
  }
  record(event, data) {
    try {
      this.entries.push({ at: (/* @__PURE__ */ new Date()).toISOString(), event, data });
      if (this.entries.length > 500) this.entries.splice(0, this.entries.length - 500);
      try {
        this.store?.set(this.key, this.entries.slice());
      } catch {
      }
      if (this.fs) {
        const fs = this.fs;
        const content = JSON.stringify({ version: 1, entries: this.entries }, null, 2);
        this.pending = this.pending.then(async () => {
          if (!await fs.write(this.file, content)) throw new Error("PluginFS.write returned false");
        }).catch((error) => {
          console.warn("[ARAM Lite] Bench log write failed:", String(error));
        });
      }
    } catch (error) {
      console.warn("[ARAM Lite] Bench log failed:", String(error));
    }
  }
  flush() {
    return this.pending;
  }
};
var benchLog = new BenchLog();

// src/features/aram-bench-no-cooldown.ts
var marker = "data-aram-lite-bench";
var styleId = "aram-lite-bench-style";
function aramBenchNoCooldown({ flow, injector, lcu, scope }) {
  let busy = false;
  let requestOwner = 0;
  let attempts = 0;
  const snapshot = (session = flow.champ) => ({
    phase: flow.phase,
    selectionEpoch: flow.selectionEpoch,
    isAram: flow.isAram,
    enabled: config.benchNoCooldown,
    busy,
    gameId: session?.gameId ?? flow.game?.gameData?.gameId,
    queueId: session?.queueId ?? flow.game?.gameData?.queue?.id,
    benchEnabled: session?.benchEnabled,
    timer: session?.timer && {
      phase: session.timer.phase,
      inBanPickPhase: session.timer.inBanPickPhase,
      inFinalizationPhase: session.timer.inFinalizationPhase
    },
    localChampion: session?.myTeam?.find((player) => player.cellId === session.localPlayerCellId)?.championId,
    bench: session?.benchChampions?.map((champion) => champion.championId),
    team: session?.myTeam?.map((player) => ({ cell: player.cellId, champion: player.championId })),
    actions: session?.actions?.flat().map((action) => ({
      id: action.id,
      type: action.type,
      cell: action.actorCellId,
      completed: action.completed,
      champion: action.championId
    }))
  });
  let previousState = "";
  scope.own(flow.onChange(() => {
    if (flow.phase !== "ChampSelect" && !previousState) return;
    const state = snapshot();
    const encoded = JSON.stringify(state);
    if (encoded !== previousState) benchLog.record("selection-state", state);
    previousState = flow.phase === "ChampSelect" ? encoded : "";
  }));
  const championId = (item) => {
    const icon = item.querySelector(".bench-champion-background");
    const background = icon && (icon.style.backgroundImage || getComputedStyle(icon).backgroundImage);
    const match = background?.match(/champion-icons\/(\d+)\.png/);
    return match ? Number(match[1]) : 0;
  };
  const isOnBench = (id3) => id3 > 0 && !!flow.champ?.benchChampions?.some((champion) => champion.championId === id3);
  scope.own(injector.onPointerDown(".bench-container", (event, container) => {
    const item = event.composedPath().filter((node) => node instanceof Element).map((node) => node.closest(".champion-bench-item")).find(Boolean);
    benchLog.record("pointerdown", {
      ...snapshot(),
      button: event.button,
      targetChampion: item ? championId(item) : null,
      itemClasses: item?.className,
      containerClasses: container.className
    });
  }));
  const removed = /* @__PURE__ */ new Map();
  const restore2 = () => {
    for (const [element, classes] of removed) {
      if (element.isConnected) element.classList.add(...classes);
    }
    removed.clear();
    document.querySelectorAll("[" + marker + "]").forEach((element) => element.removeAttribute(marker));
  };
  scope.own(injector.register(() => {
    if (!config.benchNoCooldown || !flow.isAram || !flow.champ?.benchEnabled) {
      restore2();
      return;
    }
    for (const element of removed.keys()) if (!element.isConnected) removed.delete(element);
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = "[" + marker + "] .cooldown-mask{display:none!important}";
      (document.head || document.documentElement).append(style);
    }
    document.querySelectorAll(".bench-container").forEach((container) => {
      if (!container.hasAttribute(marker)) container.setAttribute(marker, "");
      container.querySelectorAll('[class*="on-cooldown"]').forEach((element) => {
        const classes = [...element.classList].filter((name) => name.startsWith("on-cooldown"));
        if (!classes.length) return;
        let saved = removed.get(element);
        if (!saved) removed.set(element, saved = /* @__PURE__ */ new Set());
        for (const name of classes) {
          saved.add(name);
          element.classList.remove(name);
        }
      });
    });
  }));
  scope.own(injector.onClick(".bench-container .champion-bench-item", (event, item) => {
    const attempt = ++attempts;
    benchLog.record("click", { attempt, ...snapshot(), targetChampion: championId(item), itemClasses: item.className, trusted: event.isTrusted });
    if (!config.benchNoCooldown || !flow.isAram || !flow.champ?.benchEnabled) {
      benchLog.record("ignored", { attempt, reason: "feature-or-session-not-ready", ...snapshot() });
      return;
    }
    if (item.classList.contains("empty-bench-item")) {
      benchLog.record("ignored", { attempt, reason: "empty-slot" });
      return;
    }
    if (item.classList.contains("locked-out") || item.classList.contains("waiting-on-finalization")) {
      benchLog.record("ignored", { attempt, reason: "native-eligibility-or-phase-lock" });
      return;
    }
    const id3 = championId(item);
    if (!isOnBench(id3)) {
      benchLog.record("ignored", { attempt, reason: id3 ? "not-in-bench" : "champion-icon-unrecognized", targetChampion: id3 });
      return;
    }
    stopClick(event);
    if (busy) {
      benchLog.record("ignored", { attempt, reason: "request-in-progress" });
      return;
    }
    busy = true;
    requestOwner = attempt;
    const epoch = flow.selectionEpoch;
    const current = () => scope.active && flow.isAram && flow.selectionEpoch === epoch;
    console.info("[ARAM Lite] Bench POST id=" + id3);
    const endpoint = uri.champ + "/bench/swap/" + id3;
    benchLog.record("request", { attempt, method: "POST", endpoint, ...snapshot() });
    void lcu.request("POST", endpoint, void 0, (status, body) => {
      benchLog.record("response", { attempt, status, body: body.slice(0, 2048) });
    }).then(async () => {
      if (requestOwner === attempt) busy = false;
      if (!current()) {
        benchLog.record("verification-stopped", { attempt, reason: "selection-ended" });
        return;
      }
      for (let check = 0; check < 3 && current(); check++) {
        const session = await lcu.get(uri.champ);
        benchLog.record("verification", { attempt, check: check + 1, ...snapshot(session) });
        if (!current()) return;
        if (session?.myTeam?.find((player) => player.cellId === session.localPlayerCellId)?.championId === id3) {
          console.info("[ARAM Lite] Bench confirmed id=" + id3);
          benchLog.record("confirmed", { attempt, targetChampion: id3, ...snapshot(session) });
          return;
        }
        if (check < 2 && !await scope.delay(500)) return;
      }
      if (current()) {
        benchLog.record("unconfirmed", { attempt, targetChampion: id3, ...snapshot() });
      }
    }).catch((error) => {
      benchLog.record("error", { attempt, message: String(error) });
      report("Bench \u6362\u82F1\u96C4", error, true);
    }).finally(() => {
      if (requestOwner === attempt) busy = false;
    });
  }));
  scope.own(() => {
    restore2();
    document.getElementById(styleId)?.remove();
  });
}

// src/features/aram-default-spells.ts
var same = (a, b) => a.spell1Id === b.spell1Id && a.spell2Id === b.spell2Id;
function aramDefaultSpells({ flow, lcu, scope }) {
  let epoch = -1;
  let remember = false;
  let blockedGame;
  let selection;
  let busy = false;
  function apply() {
    const current = selection;
    if (!current || current.attempted || busy || !scope.active || !flow.isAram) return;
    const player = flow.champ?.myTeam?.find((item) => item.cellId === flow.champ?.localPlayerCellId);
    if (remember && player?.championId !== current.championId) return;
    current.attempted = true;
    if (current.gameId) marks.set("spells-game", String(current.gameId));
    if (same(current.observed, current.desired)) {
      current.confirmed = true;
      return;
    }
    busy = true;
    void lcu.patch(uri.champ + "/my-selection", current.desired).catch((error) => report("\u53EC\u5524\u5E08\u6280\u80FD\uFF08\u672C\u6B21\u4E0D\u91CD\u8BD5\uFF09", error)).finally(() => {
      busy = false;
      apply();
    });
  }
  scope.own(flow.onChange(() => {
    if (flow.phase !== "ChampSelect") {
      selection = void 0;
      return;
    }
    if (epoch !== flow.selectionEpoch) {
      epoch = flow.selectionEpoch;
      remember = config.rememberSpells;
      blockedGame = marks.get("spells-game");
      selection = void 0;
    }
    if (!flow.isAram || !flow.freshSelection) return;
    const session = flow.champ;
    const player = session.myTeam?.find((item) => item.cellId === session.localPlayerCellId);
    if (!player || !validSpells(player)) return;
    const championId = player.championId || 0;
    if (remember && championId <= 0) return;
    const gameId = session.gameId || flow.game?.gameData?.gameId;
    if (gameId && blockedGame === String(gameId)) return;
    const gameKey = gameId ? String(gameId) : "epoch:" + epoch;
    const observed = { spell1Id: player.spell1Id, spell2Id: player.spell2Id };
    if (!selection || selection.gameKey !== gameKey || remember && selection.championId !== championId) {
      selection = {
        championId,
        gameId,
        gameKey,
        initial: observed,
        observed,
        desired: remember && championSpells.get(championId) || { ...config.spells },
        attempted: false,
        confirmed: false
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

// src/features/champselect-quit.ts
var id = "aram-lite-quit";
function champSelectQuit({ flow, injector, lcu, scope }) {
  let busy = false;
  let confirmationEpoch = null;
  let previousFocus = null;
  const dialog = document.createElement("div");
  dialog.id = "aram-lite-quit-confirm";
  const shadow = dialog.attachShadow({ mode: "open" });
  shadow.innerHTML = '<style>:host{position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;background:#0009;font:14px/1.6 Arial,"Microsoft YaHei",sans-serif;color:#f0e6d2}section{width:340px;max-width:calc(100vw - 48px);padding:20px;background:#09121b;border:1px solid #785a28;border-radius:5px;box-shadow:0 6px 24px #0009}h2{margin:0 0 10px;font-size:17px}p{margin:0 0 20px}footer{display:flex;justify-content:flex-end;gap:12px}button{font:inherit;color:inherit;background:#142332;border:1px solid #785a28;border-radius:3px;padding:5px 14px;cursor:pointer}button:focus-visible{outline:2px solid #c8aa6e;outline-offset:2px}</style><section role="alertdialog" aria-modal="true" aria-labelledby="quit-title" aria-describedby="quit-message"><h2 id="quit-title">\u786E\u8BA4\u9000\u51FA\u9009\u4EBA\uFF1F</h2><p id="quit-message">\u9000\u51FA\u5C06\u6309\u5BA2\u6237\u7AEF\u89C4\u5219\u4EA7\u751F\u79D2\u9000\u60E9\u7F5A\u3002</p><footer><button type="button" data-aram-lite-quit-action="cancel">\u53D6\u6D88</button><button type="button" data-aram-lite-quit-action="confirm">\u786E\u8BA4\u9000\u51FA</button></footer></section>';
  const cancelButton = shadow.querySelector('[data-aram-lite-quit-action="cancel"]');
  function dismiss() {
    confirmationEpoch = null;
    dialog.remove();
    document.removeEventListener("keydown", handleKey, true);
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }
  function handleKey(event) {
    if (event.key === "Escape") {
      stopClick(event);
      dismiss();
    } else if (event.key === "Tab") {
      stopClick(event);
      const confirmButton = shadow.querySelector('[data-aram-lite-quit-action="confirm"]');
      (shadow.activeElement === cancelButton ? confirmButton : cancelButton).focus();
    }
  }
  scope.own(dismiss);
  scope.own(flow.onChange(() => {
    if (confirmationEpoch !== null && (!config.champSelectQuit || !flow.isAram || confirmationEpoch !== flow.selectionEpoch)) dismiss();
  }));
  scope.own(injector.register(() => {
    if (confirmationEpoch === null) return;
    if (!config.champSelectQuit || !flow.isAram || confirmationEpoch !== flow.selectionEpoch) {
      dismiss();
      return;
    }
    if (!dialog.isConnected) {
      document.body?.append(dialog);
      cancelButton.focus();
    }
  }));
  scope.own(injector.onClick("[data-aram-lite-quit-action]", (event, element) => {
    stopClick(event);
    const epoch = confirmationEpoch;
    const confirmed = element.getAttribute("data-aram-lite-quit-action") === "confirm";
    dismiss();
    if (!confirmed || epoch === null || epoch !== flow.selectionEpoch || !scope.active || !config.champSelectQuit || !flow.isAram || busy) return;
    busy = true;
    void lcu.delete(uri.lobby).catch((error) => {
      if (!(error instanceof LcuError && error.status === 404)) report("\u9000\u51FA\u9009\u4EBA", error, true);
    }).finally(() => {
      busy = false;
    });
  }));
  scope.own(injector.register(() => {
    const container = config.champSelectQuit && flow.isAram ? document.querySelector(".bottom-right-buttons") : null;
    const old = document.getElementById(id);
    if (!container || container.querySelector(".quit-button")) {
      old?.remove();
      return;
    }
    if (old?.parentElement === container) return;
    old?.remove();
    const button = document.createElement("lol-uikit-flat-button");
    button.id = id;
    button.textContent = "\u9000\u51FA\u9009\u4EBA";
    button.style.width = "125px";
    button.style.marginRight = "10px";
    container.prepend(button);
  }));
  scope.own(injector.onClick("#" + id, (event) => {
    stopClick(event);
    if (!scope.active || !config.champSelectQuit || !flow.isAram || busy || confirmationEpoch !== null) return;
    confirmationEpoch = flow.selectionEpoch;
    previousFocus = document.activeElement;
    document.body?.append(dialog);
    document.addEventListener("keydown", handleKey, true);
    cancelButton.focus();
  }));
  scope.own(() => document.getElementById(id)?.remove());
}

// src/features/auto-open-stats.ts
function autoOpenStats({ flow, injector, scope }, waitForHonor) {
  let nativeApi;
  const rcp = window.rcp;
  if (rcp?.whenReady) {
    try {
      void rcp.whenReady("rcp-fe-lol-match-history").then((api) => {
        if (!scope.active) return;
        if (api && typeof api?.displayMatchDetails === "function") {
          nativeApi = api;
          injector.schedule();
        }
      }).catch((error) => report("\u8BFB\u53D6\u539F\u751F\u7EDF\u8BA1\u6A21\u5757\uFF08\u6539\u7528\u6309\u94AE\uFF09", error));
    } catch (error) {
      report("\u8BFB\u53D6\u539F\u751F\u7EDF\u8BA1\u6A21\u5757\uFF08\u6539\u7528\u6309\u94AE\uFF09", error);
    }
  }
  let statsEpoch = -1;
  let clickEpoch = -1;
  let clicked = /* @__PURE__ */ new WeakMap();
  const visible = (element) => {
    if (!element?.isConnected) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  };
  const actionable = (element) => visible(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true" && !element.classList.contains("disabled");
  const findVisible = (root, selector) => [...root.querySelectorAll(selector)].find(visible);
  const findAction = (root, selector) => [...root.querySelectorAll(selector)].find(actionable);
  function openStats(job, epoch, current) {
    if (statsEpoch === epoch) return Promise.resolve(true);
    if (clickEpoch !== epoch) {
      clickEpoch = epoch;
      clicked = /* @__PURE__ */ new WeakMap();
    }
    return new Promise((resolve) => {
      let done = false;
      let awaitingDetails = false;
      let nativeAttempts = 0;
      let detailsSeen = false;
      let lastStage = "\u7B49\u5F85\u8FDB\u9636\u8BB0\u5F55\u5165\u53E3";
      let remove = () => {
      };
      let cancel = () => {
      };
      const finish = (opened) => {
        if (done) return;
        done = true;
        remove();
        cancel();
        resolve(opened);
      };
      const click = (element) => {
        if (!actionable(element)) return false;
        const previous = clicked.get(element);
        if (previous && (previous.attempts >= 3 || Date.now() - previous.at < 1e3)) return false;
        clicked.set(element, { attempts: (previous?.attempts ?? 0) + 1, at: Date.now() });
        try {
          element.ownerDocument.defaultView.HTMLElement.prototype.click.call(element);
        } catch (error) {
          report("\u70B9\u51FB\u7EDF\u8BA1\u5165\u53E3\uFF08\u7A0D\u540E\u91CD\u8BD5\uFF09", error);
        }
        return true;
      };
      job.own(() => finish(false));
      const step = () => {
        if (!current()) {
          finish(false);
          return;
        }
        const details = findVisible(document, ".match-details-root.match-details-no-header");
        if (details) {
          detailsSeen = true;
          lastStage = "\u7B49\u5F85\u5DF1\u65B9\u8EAB\u4EFD\u53CA\u56FE\u8868";
          const graph = findVisible(details, ".match-graph-container:not(.match-details-loading-hide) .match-graph-display");
          if (graph) {
            statsEpoch = epoch;
            finish(true);
            return;
          }
          const standardTabs = findVisible(details, ".rcp-fe-lol-match-details-overlay-sub-nav");
          if (standardTabs && !findVisible(details, ".team-avatar-wrapper.current")) return;
          const graphTab = findAction(details, '.rcp-fe-lol-match-details-overlay-sub-nav [data-name="graph"]') || [...details.querySelectorAll(".jade-match-details-tabs-nav")].map((nav) => nav.querySelectorAll(".jade-match-details-tab")[1]).find((tab) => actionable(tab ?? null));
          click(graphTab || null);
          return;
        }
        if (detailsSeen) {
          statsEpoch = epoch;
          finish(false);
          return;
        }
        if (awaitingDetails) return;
        const advanced = findAction(document, ".postgame-match-history-button") || [...document.querySelectorAll("lol-uikit-flat-button, button")].find((element) => actionable(element) && ["\u89C2\u770B\u8FDB\u9636\u8BB0\u5F55", "\u89C0\u770B\u9032\u968E\u7D00\u9304", "View Advanced Details"].includes(
          element.textContent?.replace(/\s+/g, " ").trim() ?? ""
        ));
        if (advanced && (!nativeApi || nativeAttempts > 0 || !clicked.has(advanced)) && click(advanced)) {
          lastStage = "\u5DF2\u70B9\u51FB\u8FDB\u9636\u8BB0\u5F55\uFF0C\u7B49\u5F85\u9875\u9762";
          awaitingDetails = true;
          job.later(() => {
            if (done || !current()) return;
            awaitingDetails = false;
            injector.schedule();
          }, 1e3);
          return;
        }
        if (nativeApi && nativeAttempts < 3) {
          nativeAttempts++;
          lastStage = "\u5DF2\u8C03\u7528\u8FDB\u9636\u8BB0\u5F55\u6A21\u5757\uFF0C\u7B49\u5F85\u9875\u9762";
          awaitingDetails = true;
          try {
            const gameMode = flow.game?.gameData?.queue?.gameMode || flow.game?.map?.gameMode;
            const result = nativeApi.displayMatchDetails({
              sections: gameMode === "JADE" || gameMode === "CRAB" ? ["stats", "graph"] : ["stats", "graph", "runes"],
              defaultSection: "stats",
              dataSource: "eogStats",
              hideHeader: true,
              gameMode,
              closeModalCallback: () => {
                if (!current()) return;
                statsEpoch = epoch;
                finish(false);
              }
            });
            void Promise.resolve(result).catch((error) => {
              if (done || !current()) return;
              awaitingDetails = false;
              report("\u6253\u5F00\u539F\u751F\u7EDF\u8BA1\uFF08\u6539\u7528\u6309\u94AE\uFF09", error);
              injector.schedule();
            });
            console.info("[ARAM Lite] \u5DF2\u8BF7\u6C42\u539F\u751F\u8FDB\u9636\u8BB0\u5F55\uFF0C\u7B49\u5F85\u5DF1\u65B9\u8EAB\u4EFD\u540E\u6253\u5F00\u56FE\u8868");
            job.later(() => {
              if (done || !current()) return;
              awaitingDetails = false;
              injector.schedule();
            }, 2e3);
          } catch (error) {
            awaitingDetails = false;
            report("\u6253\u5F00\u539F\u751F\u7EDF\u8BA1\uFF08\u6539\u7528\u6309\u94AE\uFF09", error);
          }
          if (awaitingDetails) return;
        }
        if (awaitingDetails) return;
        const scoreboard = [...document.querySelectorAll(
          ".postgame-sub-navigation-container, .jade-postgame-tabs-container"
        )].map((nav) => nav.querySelectorAll("lol-uikit-navigation-item, .jade-postgame-tab")[1]).find((tab) => actionable(tab ?? null));
        click(scoreboard || null);
      };
      const safeStep = () => {
        if (done) return;
        try {
          step();
        } catch (error) {
          report("\u7EDF\u8BA1\u754C\u9762\u5C1A\u672A\u5C31\u7EEA\uFF08\u7A0D\u540E\u91CD\u8BD5\uFF09", error);
        }
      };
      remove = injector.register(safeStep);
      safeStep();
      if (!done) cancel = job.later(() => {
        report("\u81EA\u52A8\u6253\u5F00\u4F24\u5BB3\u7EDF\u8BA1", new Error("\u7B49\u5F85\u8D85\u65F6\uFF1A" + lastStage), true);
        finish(false);
      }, 15e3);
    });
  }
  let pending;
  scope.own(() => pending?.scope.dispose());
  scope.own(flow.onChange(() => {
    if (!config.autoOpenStats || flow.phase !== "EndOfGame") {
      pending?.scope.dispose();
      pending = void 0;
      return;
    }
    const epoch = flow.phaseEpoch;
    if (statsEpoch === epoch || pending?.epoch === epoch) return;
    pending?.scope.dispose();
    const job = new Scope();
    pending = { epoch, scope: job };
    const current = () => scope.active && job.active && config.autoOpenStats && flow.phase === "EndOfGame" && flow.phaseEpoch === epoch;
    void (async () => {
      await waitForHonor();
      if (!current() || !await job.delay(config.openStatsDelayMs)) return;
      if (current()) await openStats(job, epoch, current);
    })().catch((error) => report("\u81EA\u52A8\u6253\u5F00\u7EDF\u8BA1", error));
  }));
}

// src/features/auto-return-lobby.ts
function autoReturnLobby({ flow, lcu, injector, scope }) {
  let endedAt = null;
  let endEpoch = 0;
  let handledEpoch = -1;
  let cancelledEpoch = -1;
  let pending;
  const notice = document.createElement("div");
  notice.id = "aram-lite-return-countdown";
  notice.setAttribute("role", "region");
  notice.setAttribute("aria-label", "\u81EA\u52A8\u56DE\u623F\u5012\u8BA1\u65F6");
  notice.style.cssText = 'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);z-index:10001;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 16px;border:1px solid #785a28;border-radius:5px;background:#09121bf2;color:#f0e6d2;font:14px/1.5 Arial,"Microsoft YaHei",sans-serif;box-shadow:0 4px 16px #0008';
  const label = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "\u53D6\u6D88";
  button.dataset.action = "cancel";
  button.style.cssText = "font:inherit;color:#f0e6d2;background:#142332;border:1px solid #785a28;border-radius:3px;padding:4px 10px;cursor:pointer";
  const immediateButton = document.createElement("button");
  immediateButton.type = "button";
  immediateButton.textContent = "\u7ACB\u5373\u56DE\u623F";
  immediateButton.dataset.action = "return";
  immediateButton.style.cssText = button.style.cssText;
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;justify-content:center;gap:12px";
  actions.append(immediateButton, button);
  notice.append(label, actions);
  function render() {
    const isEnd = flow.phase === "PreEndOfGame" || flow.phase === "EndOfGame";
    if (!scope.active || !config.autoReturnLobby || !isEnd || endedAt === null || cancelledEpoch === endEpoch || handledEpoch === endEpoch) {
      notice.remove();
      return;
    }
    const seconds = Math.ceil(Math.max(0, endedAt + config.returnLobbyDelayMs - Date.now()) / 1e3);
    const text = seconds > 0 ? seconds + " \u79D2\u540E\u81EA\u52A8\u56DE\u623F" : "\u6B63\u5728\u56DE\u623F";
    if (label.textContent !== text) label.textContent = text;
    for (const duplicate of document.querySelectorAll("#aram-lite-return-countdown")) {
      if (duplicate !== notice) duplicate.remove();
    }
    if (!notice.isConnected) document.body?.append(notice);
  }
  scope.own(injector.register(render));
  scope.own(() => notice.remove());
  scope.own(injector.onClick("#aram-lite-return-countdown button", (event, element) => {
    stopClick(event);
    if (element.dataset.action === "return") {
      startReturn(true);
      return;
    }
    cancelledEpoch = endEpoch;
    cancel();
    render();
  }));
  function cancel() {
    pending?.scope.dispose();
    pending = void 0;
  }
  scope.own(cancel);
  function startReturn(immediate = false) {
    const isEnd = flow.phase === "PreEndOfGame" || flow.phase === "EndOfGame";
    if (!isEnd) {
      endedAt = null;
      cancel();
      return;
    }
    if (endedAt === null) {
      endedAt = Date.now();
      endEpoch++;
    }
    if (!config.autoReturnLobby) {
      cancel();
      return;
    }
    const epoch = endEpoch;
    if (handledEpoch === epoch || cancelledEpoch === epoch) return;
    if (pending?.epoch === epoch && (pending.immediate || !immediate && pending.delay === config.returnLobbyDelayMs)) return;
    cancel();
    const job = new Scope();
    pending = { epoch, delay: config.returnLobbyDelayMs, immediate, scope: job };
    const current = () => scope.active && job.active && config.autoReturnLobby && (flow.phase === "PreEndOfGame" || flow.phase === "EndOfGame") && endEpoch === epoch && cancelledEpoch !== epoch;
    const remaining = immediate ? 0 : Math.max(0, endedAt + config.returnLobbyDelayMs - Date.now());
    void (async () => {
      if (!await job.delay(remaining)) return;
      if (!current()) return;
      const gameId = flow.game?.gameData?.gameId;
      if (gameId && marks.get("return-game") === String(gameId)) {
        handledEpoch = epoch;
        render();
        return;
      }
      for (let attempt = 0; attempt < 3 && current(); attempt++) {
        handledEpoch = epoch;
        render();
        try {
          await lcu.post("/lol-lobby/v2/play-again");
          if (gameId) marks.set("return-game", String(gameId));
          return;
        } catch (error) {
          if (!(error instanceof LcuError && [400, 404, 409, 500, 503].includes(error.status)) || attempt === 2) {
            report("\u81EA\u52A8\u56DE\u623F\u95F4", error);
            return;
          }
          if (!await job.delay(1e3)) return;
        }
      }
    })().catch((error) => report("\u81EA\u52A8\u56DE\u623F\u95F4", error));
  }
  scope.own(flow.onChange(() => startReturn()));
}

// src/features/auto-honor.ts
function autoHonor({ flow, lcu, scope }) {
  let generation = 0;
  let inEnd = false;
  let job = Promise.resolve();
  const isEnd = () => flow.phase === "PreEndOfGame" || flow.phase === "EndOfGame";
  const current = (token) => scope.active && config.autoHonor && token === generation && isEnd();
  async function honor(token) {
    for (let attempt = 0; attempt < 8 && current(token); attempt++) {
      let ballot;
      try {
        ballot = await lcu.get(uri.ballot);
      } catch (error) {
        if (!(error instanceof LcuError && error.status === 404)) {
          report("\u8BFB\u53D6\u70B9\u8D5E\u540D\u5355", error);
          return;
        }
      }
      if (!current(token)) return;
      const expectedGame = flow.game?.gameData?.gameId;
      if (ballot?.gameId && (!expectedGame || expectedGame === ballot.gameId)) {
        const gameId = String(ballot.gameId);
        if (marks.get("honor-game") === gameId) return;
        if ((ballot.honoredPlayers?.length ?? 0) > 0 || (ballot.votePool?.votes ?? 1) <= 0) {
          marks.set("honor-game", gameId);
          return;
        }
        const allies = (ballot.eligibleAllies ?? []).filter((player) => !player.botPlayer && player.puuid);
        if (allies.length) {
          const premades = allies.filter((player) => flow.partyMembers.some((member) => member.puuid && member.puuid === player.puuid || member.summonerId && member.summonerId === player.summonerId));
          const candidates = premades.length ? premades : allies;
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          marks.set("honor-game", gameId);
          const categories = ["HEART", "COOL", "SHOTCALLER"];
          await lcu.post("/lol-honor-v2/v1/honor-player", {
            puuid: target.puuid,
            summonerId: target.summonerId,
            gameId: ballot.gameId,
            honorCategory: config.honorCategory === "RANDOM" ? categories[Math.floor(Math.random() * categories.length)] : config.honorCategory
          }).catch((error) => report("\u81EA\u52A8\u70B9\u8D5E\uFF08\u672C\u5C40\u4E0D\u91CD\u590D\u63D0\u4EA4\uFF09", error));
          return;
        }
      }
      if (!await scope.delay(500)) return;
    }
  }
  scope.own(flow.onChange(() => {
    if (!config.autoHonor || !isEnd()) {
      if (inEnd) {
        inEnd = false;
        generation++;
        job = Promise.resolve();
      }
      return;
    }
    if (inEnd) return;
    inEnd = true;
    job = honor(++generation);
  }));
  return () => job;
}

// src/features/friend-enhancement.ts
var original = "data-aram-lite-original";
var rendered = "data-aram-lite-rendered";
var groupAttr = "data-aram-lite-group";
var stateAttr = "data-aram-lite-state";
function friendIndex(friends) {
  const index = /* @__PURE__ */ new Map();
  for (const friend of friends) {
    const name = friend.gameName?.trim() || friend.name?.trim();
    const keys = /* @__PURE__ */ new Set([name, friend.name?.trim(), friend.puuid, friend.id]);
    if (name && friend.gameTag?.trim()) keys.add(name + "#" + friend.gameTag.trim());
    for (const key of keys) {
      if (!key) continue;
      const matches = index.get(key) ?? [];
      matches.push(friend);
      index.set(key, matches);
    }
  }
  return index;
}
function formatDuration(raw, now = Date.now()) {
  let started = Number(raw);
  if (!Number.isFinite(started) || started <= 0) return null;
  if (started < 1e12) started *= 1e3;
  if (started > now + 6e4) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1e3));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}
var stages = {
  inQueue: "\u6392\u961F\u4E2D",
  championSelect: "\u9009\u4EBA\u4E2D",
  inGame: "\u6E38\u620F\u4E2D",
  spectating: "\u89C2\u6218\u4E2D",
  watchingReplay: "\u89C2\u770B\u56DE\u653E",
  inTeamBuilder: "\u7EC4\u961F\u4E2D",
  teamSelect: "\u961F\u4F0D\u9009\u62E9\u4E2D",
  tutorial: "\u65B0\u624B\u6559\u7A0B\u4E2D"
};
var modeNames = {
  ARAM: "\u5927\u4E71\u6597",
  ARAM_UNRANKED_5x5: "\u5927\u4E71\u6597",
  KIWI: "\u6D77\u514B\u65AF\u5927\u4E71\u6597",
  CHERRY: "\u7ADE\u6280\u573A",
  CLASSIC: "\u53EC\u5524\u5E08\u5CE1\u8C37",
  TFT: "\u4E91\u9876\u4E4B\u5F08",
  RANKED_SOLO_5x5: "\u5355\u53CC\u6392",
  RANKED_FLEX_SR: "\u7075\u6D3B\u6392\u4F4D",
  NORMAL: "\u5339\u914D",
  NORMAL_TFT: "\u4E91\u9876\u5339\u914D",
  RANKED_TFT: "\u4E91\u9876\u6392\u4F4D",
  RANKED_TFT_DOUBLE_UP: "\u4E91\u9876\u53CC\u4EBA",
  RANKED_TFT_TURBO: "\u4E91\u9876\u72C2\u66B4"
};
var shortModeNames = {
  "\u968F\u673A\u5355\u4E2D\uFF1A\u5927\u6DF7\u6218\u9526\u6807\u8D5B": "\u6D77\u514B\u65AF\u9526\u6807\u8D5B",
  "\u7ADE\u6280\u573A\uFF08PBE\u516C\u6D4B\u670D\u52A1\u5668 2v2\uFF09": "\u7ADE\u6280\u573APBE",
  "\u53EC\u5524\u5CE1\u8C37\u76F2\u9009\u6A21\u5F0F\u81EA\u5B9A\u4E49": "\u5CE1\u8C37\u76F2\u9009\u81EA\u5B9A\u4E49",
  "\u53EC\u5524\u5CE1\u8C37\u5F81\u53EC\u81EA\u5B9A\u4E49": "\u5CE1\u8C37\u5F81\u53EC\u81EA\u5B9A\u4E49",
  "\u53EC\u5524\u5CE1\u8C37\u5168\u968F\u673A": "\u5CE1\u8C37\u5168\u968F\u673A",
  "\u53EC\u5524\u5CE1\u8C37\u7535\u7ADE\u9009\u89D2": "\u5CE1\u8C37\u8D5B\u4E8B\u9009\u4EBA",
  "\u591A\u4EBA\u7EC3\u4E60\u5DE5\u5177\u81EA\u5B9A\u4E49": "\u591A\u4EBA\u7EC3\u4E60",
  "\u968F\u673A\u5355\u4E2D 5v5 \u7535\u8111": "\u5927\u4E71\u6597\u4EBA\u673A",
  "\u79EF\u5206\u5BF9\u6218 \u4E94\u6392": "\u4E94\u6392\u6392\u4F4D",
  "\u963F\u798F\u5FEB\u6253 Clash": "\u963F\u798F\u51A0\u519B\u676F",
  "\u672B\u65E5\u673A\u5668\u4EBA - \u7EF4\u8FE6\u7684\u8BC5\u5492\uFF01": "\u672B\u65E5\u8BC5\u5492",
  "\u672B\u65E5\u673A\u5668\u4EBA - \u7EF4\u8FE6\u7684\u90AA\u6076\uFF01": "\u672B\u65E5\u90AA\u6076",
  "\u672B\u65E5\u673A\u5668\u4EBA - \u7EF4\u8FE6\u7684\u672B\u65E5\uFF01": "\u672B\u65E5\u7EC8\u5C40",
  "\u672B\u65E5\u673A\u5668\u4EBA - \u56F0\u96BE": "\u672B\u65E5\u56F0\u96BE",
  "\u300A\u8054\u76DF\u6218\u68CB\u300B\uFF08\u5DF4\u8C46\u9F99\u7684\u7ECF\u5178\u5B9D\u85CF\uFF09": "\u4E91\u9876\u5B9D\u85CF",
  "\u300A\u8054\u76DF\u6218\u68CB\u300B\uFF08\u7075\u9B42\u4E89\u6597\uFF09": "\u4E91\u9876\u7075\u9B42\u4E89\u6597",
  "\u300A\u8054\u76DF\u6218\u68CB\u300B\uFF08\u53CC\u4EBA\u642D\u6863\uFF09": "\u4E91\u9876\u53CC\u4EBA",
  "\u8054\u76DF\u6218\u68CB\uFF1A\u8D85\u7EA7\u62BD\u62BD\u4E50\u81EA\u8BA2": "\u4E91\u9876\u72C2\u66B4\u81EA\u5B9A\u4E49",
  "\u8054\u76DF\u6218\u68CB\uFF08\u6559\u5B66\u6A21\u5F0F\uFF09": "\u4E91\u9876\u6559\u5B66",
  "\u5DF4\u8C46\u9F99\u7684KO\u7ADE\u6280\u573A": "\u4E91\u9876KO\u7ADE\u6280\u573A",
  "\u7B2C17\u8D5B\u5B63\uFF08\u666E\u901A\u5339\u914D\uFF09": "S17\u8FD4\u573A",
  "\u6D4B\u8BD5\uFF1A\u963F\u798F\u5FEB\u6253 1v1": "\u963F\u798F1v1\u6D4B\u8BD5"
};
function compactModeName(name) {
  const short = shortModeNames[name] ?? name.trim();
  const characters = [...short];
  return characters.length <= 9 ? short : characters.slice(0, 8).join("") + "\u2026";
}
function friendParty(friend) {
  const lol = friend.lol;
  if (!lol?.pty || !(lol.gameStatus?.startsWith("hosting") || ["inQueue", "championSelect", "inGame"].includes(lol.gameStatus ?? "") || lol.gameStatus === "outOfGame" && ["open", "closed"].includes(lol.ptyType ?? ""))) return null;
  try {
    const party = JSON.parse(lol.pty);
    if (!party || typeof party.partyId !== "string" || !party.partyId) return null;
    const members = Array.isArray(party.summonerPuuids) && party.summonerPuuids.length ? party.summonerPuuids : party.summoners;
    const maximum = Number(party.maxPlayers);
    if (!Array.isArray(members) || !members.length || !Number.isInteger(maximum) || maximum < members.length) return null;
    const queueId = Number(party.queueId);
    return Number.isInteger(queueId) && queueId > 0 ? { queueId, occupancy: members.length + "/" + maximum } : null;
  } catch {
    return null;
  }
}
function friendLobby(friend) {
  return friend.lol?.gameStatus?.startsWith("hosting") || friend.lol?.gameStatus === "outOfGame" ? friendParty(friend) : null;
}
function statusText(friend, queueNames, queueTypes, remembered) {
  const lol = friend.lol;
  if (!lol || friend.availability === "offline") return null;
  const state = lol.gameStatus ?? "";
  const lobby = friendLobby(friend);
  const lobbyQueue = lobby?.queueId ?? null;
  const hosting = state.startsWith("hosting") || lobbyQueue !== null;
  const stage = hosting ? "\u5927\u5385\u4E2D" : stages[state];
  if (!stage) return null;
  const queueType = hosting && state.startsWith("hosting_") ? state.slice(8) : lol.gameQueueType;
  const queueId = lobbyQueue ?? (Number(lol.queueId) || remembered?.queueId);
  const mode = queueId && queueNames.get(queueId) || hosting && queueType && (modeNames[queueType] || queueTypes.get(queueType)) || queueType && queueTypes.get(queueType) || queueType && modeNames[queueType] || lol.gameMode && modeNames[lol.gameMode] || queueType || lol.gameMode;
  const duration = state === "inGame" || state === "spectating" ? formatDuration(lol.timeStamp) : null;
  const people = (friendParty(friend) ?? remembered)?.occupancy;
  const activity = hosting && people ? "\u5927\u5385 \xB7 " + people : state === "inQueue" && people ? "\u6392\u961F \xB7 " + people : state === "championSelect" && people ? "\u9009\u4EBA \xB7 " + people : state === "inGame" ? [duration, people].filter(Boolean).join(" \xB7 ") : stage;
  return [
    mode ? compactModeName(mode) : state === "inGame" ? "\u672A\u77E5\u6A21\u5F0F" : null,
    activity,
    state === "inGame" ? null : duration
  ].filter(Boolean).join(" \xB7 ");
}
function restore(element) {
  const previous = element.getAttribute(rendered);
  if (previous !== null && element.textContent === previous) {
    element.textContent = element.getAttribute(original) ?? "";
  }
  element.removeAttribute(stateAttr);
  element.removeAttribute(original);
  element.removeAttribute(rendered);
}
function friendEnhancement({ events, injector, lcu, scope }) {
  const style = document.createElement("style");
  style.id = "aram-lite-friend-status-colors";
  const colors = {
    lobby: "#36d987",
    inGame: "#0acbe6",
    inQueue: "#c8aa6e",
    championSelect: "#ffad55",
    spectating: "#b29bff",
    watchingReplay: "#8dafff",
    inTeamBuilder: "#63c28c",
    teamSelect: "#63c28c",
    tutorial: "#e8c85a"
  };
  style.textContent = Object.entries(colors).map(([state, color]) => "[" + stateAttr + '="' + state + '"]{color:' + color + "!important}").join("");
  scope.own(() => style.remove());
  let index = /* @__PURE__ */ new Map();
  let groups = /* @__PURE__ */ new Map();
  let queueNames = /* @__PURE__ */ new Map();
  let queueTypes = /* @__PURE__ */ new Map();
  const partySizes = /* @__PURE__ */ new Map();
  const partyStorageKey = "aram-lite:friend-party-sizes";
  const maxPartyAge = 6 * 60 * 60 * 1e3;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(partyStorageKey) ?? "[]");
    if (Array.isArray(saved)) for (const entry of saved) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[0]) continue;
      const value = entry[1];
      if (!value || !Number.isInteger(value.queueId) || value.queueId <= 0 || typeof value.occupancy !== "string" || !/^[1-9][0-9]*\/[1-9][0-9]*$/.test(value.occupancy) || typeof value.state !== "string" || value.gameId !== void 0 && typeof value.gameId !== "string" || !Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt > maxPartyAge || value.updatedAt > Date.now() + 6e4) continue;
      const [count, maximum] = value.occupancy.split("/").map(Number);
      if (count <= maximum) partySizes.set(entry[0], value);
    }
  } catch {
  }
  function saveParties() {
    try {
      if (partySizes.size) window.sessionStorage.setItem(partyStorageKey, JSON.stringify([...partySizes]));
      else window.sessionStorage.removeItem(partyStorageKey);
    } catch {
    }
  }
  const friendKey = (friend) => friend.puuid || friend.id;
  function rememberParties(friends) {
    const seen = /* @__PURE__ */ new Set();
    for (const friend of friends) {
      const key = friendKey(friend);
      if (!key) continue;
      seen.add(key);
      const state = friend.lol?.gameStatus ?? "";
      const live = friendParty(friend);
      const previous = partySizes.get(key);
      if (friend.availability === "offline") {
        partySizes.delete(key);
        continue;
      }
      if (live) {
        partySizes.set(key, { ...live, state, gameId: state === "inGame" ? friend.lol?.gameId : void 0, updatedAt: Date.now() });
        continue;
      }
      if (!previous) continue;
      const queueId = Number(friend.lol?.queueId);
      const gameId = Number(friend.lol?.gameId) > 0 ? friend.lol?.gameId : void 0;
      if (Date.now() - previous.updatedAt > maxPartyAge || !["inQueue", "championSelect", "inGame"].includes(state) || queueId > 0 && queueId !== previous.queueId || previous.state === "inGame" && state !== "inGame" || state === "inGame" && previous.gameId && gameId && previous.gameId !== gameId) {
        partySizes.delete(key);
      } else {
        partySizes.set(key, { ...previous, state, gameId: state === "inGame" ? gameId || previous.gameId : void 0 });
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
  function schedule() {
    if (scheduled || !scope.active || !enabled()) return;
    scheduled = true;
    scope.later(() => {
      scheduled = false;
      void refresh();
    }, 250);
  }
  async function refresh() {
    if (!scope.active || !enabled()) return;
    if (loading) {
      dirty = true;
      return;
    }
    loading = true;
    try {
      const friends = await lcu.get(uri.friends);
      if (!scope.active) return;
      index = friendIndex(friends);
      rememberParties(friends);
      const counts = /* @__PURE__ */ new Map();
      for (const friend of friends) {
        const gameId = friend.lol?.gameId;
        if (friend.lol?.gameStatus === "inGame" && gameId && Number(gameId) > 0) {
          counts.set(gameId, (counts.get(gameId) ?? 0) + 1);
        }
      }
      groups = new Map([...counts].filter(([, count]) => count >= 2).map(([id3], number) => [id3, number + 1]));
      failures = 0;
      injector.schedule();
    } catch (error) {
      report("\u597D\u53CB\u72B6\u6001", error);
      if (++failures < 3) scope.later(schedule, 1e3);
    } finally {
      loading = false;
      if (dirty) {
        dirty = false;
        schedule();
      }
    }
  }
  let queuesLoaded = false;
  let queuesLoading = false;
  function loadQueues() {
    if (!config.friendStatus || queuesLoaded || queuesLoading) return;
    queuesLoading = true;
    void lcu.get(uri.queues).then((queues) => {
      if (!scope.active) return;
      queuesLoaded = true;
      const queueName = (queue) => queue.id === 2400 || queue.type === "KIWI" ? "\u6D77\u514B\u65AF\u5927\u4E71\u6597" : queue.id === 450 || queue.type === "ARAM_UNRANKED_5x5" ? "\u5927\u4E71\u6597" : queue.id === 400 || queue.id === 430 ? "\u5339\u914D" : queue.type && queue.type !== "CHERRY" && queue.type !== "NORMAL" && modeNames[queue.type] || queue.name || queue.description || "";
      queueNames = new Map(queues.map((queue) => [queue.id, queueName(queue)]));
      queueTypes = new Map(queues.filter((queue) => queue.type).map((queue) => [queue.type, queueName(queue)]));
      injector.schedule();
    }).catch((error) => report("\u6A21\u5F0F\u540D\u79F0", error)).finally(() => {
      queuesLoading = false;
    });
  }
  let wasEnabled = enabled();
  scope.own(onConfigChange(() => {
    if (enabled() && !wasEnabled) {
      failures = 0;
      void refresh();
    }
    if (!enabled()) {
      partySizes.clear();
      saveParties();
    }
    wasEnabled = enabled();
    loadQueues();
    injector.schedule();
  }));
  scope.own(events.on(uri.friends, () => {
    failures = 0;
    schedule();
  }));
  void refresh();
  loadQueues();
  scope.own(injector.register(() => {
    if (config.friendStatus) {
      if (!style.isConnected) document.head?.append(style);
    } else style.remove();
    const members = document.querySelectorAll(
      '.lol-social-lower-pane-container [class*="lol-social-roster-member"], .lol-social-lower-pane-container lol-social-roster-member'
    );
    for (const member of members) {
      const status = member.querySelector("span.status-message");
      if (!status) continue;
      const name = member.querySelector(".member-name")?.textContent?.trim();
      const key = member.getAttribute("data-puuid") || member.querySelector(".member[data-id]")?.getAttribute("data-id") || name;
      const matches = key ? index.get(key) : void 0;
      const friend = matches?.length === 1 ? matches[0] : void 0;
      if (!enabled() || !friend || member.classList.contains("offline") || friend.availability === "offline") {
        restore(status);
        member.removeAttribute(groupAttr);
        continue;
      }
      const lol = friend.lol;
      const remembered = partySizes.get(friendKey(friend) ?? "");
      const detail = config.friendStatus ? statusText(friend, queueNames, queueTypes, remembered) : null;
      const group = config.friendGroups && lol?.gameStatus === "inGame" ? groups.get(lol.gameId || "") : void 0;
      if (!detail && !group) {
        restore(status);
        member.removeAttribute(groupAttr);
        continue;
      }
      if (detail) {
        const state = lol?.gameStatus?.startsWith("hosting") || friendLobby(friend) !== null ? "lobby" : lol?.gameStatus;
        if (state && status.getAttribute(stateAttr) !== state) status.setAttribute(stateAttr, state);
      } else status.removeAttribute(stateAttr);
      const previous = status.getAttribute(rendered);
      if (previous === null || status.textContent !== previous) {
        status.setAttribute(original, status.textContent ?? "");
      }
      const base = detail ?? status.getAttribute(original) ?? "";
      const text = base + (group ? " \xB7 \u540C\u5C40" + group : "");
      if (status.getAttribute(rendered) !== text) status.setAttribute(rendered, text);
      if (status.textContent !== text) status.textContent = text;
      if (group) {
        if (member.getAttribute(groupAttr) !== lol.gameId) member.setAttribute(groupAttr, lol.gameId);
      } else member.removeAttribute(groupAttr);
    }
  }));
  scope.own(() => {
    document.querySelectorAll("[" + rendered + "]").forEach(restore);
    document.querySelectorAll("[" + groupAttr + "]").forEach((member) => member.removeAttribute(groupAttr));
  });
}

// src/features/quick-lobby.ts
function quickLobby({ flow, injector, lcu, scope }) {
  let busy = false;
  scope.own(injector.onClick(".play-button-container", (event, button) => {
    if (!config.quickLobby || flow.phase !== "None") return;
    if (button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true") return;
    stopClick(event);
    if (busy) return;
    busy = true;
    void lcu.post(uri.lobby, { queueId: config.aramQueueId }).then(() => {
      scope.later(() => {
        busy = false;
      }, 1500);
    }).catch((error) => {
      busy = false;
      report("\u521B\u5EFA\u6D77\u514B\u65AF\u5927\u4E71\u6597\u5927\u5385", error, true);
    });
  }));
  scope.own(flow.onChange(() => {
    if (flow.phase !== "None") busy = false;
  }));
}

// src/features/control-panel.ts
var id2 = "aram-lite-controls";
function controlPanel({ injector, scope }) {
  const host = document.createElement("div");
  host.id = id2;
  const shadow = host.attachShadow({ mode: "open" });
  function checkbox(key) {
    const label = switches.find(([name]) => name === key)[1];
    return '<label class="switch"><input type="checkbox" name="' + key + '">' + label + "</label>";
  }
  shadow.innerHTML = '<style>:host{all:initial;position:fixed;right:12px;bottom:calc(40px + 0.5cm);text-align:right;z-index:10000;font:13px/1.5 Arial,"Microsoft YaHei",sans-serif;color:#f0e6d2}*{box-sizing:border-box}[hidden]{display:none!important}button,input,select{font:inherit}button{cursor:pointer;color:inherit;background:#142332;border:1px solid #785a28;border-radius:3px;padding:5px 10px}button:hover{background:#20394b}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #c8aa6e;outline-offset:2px}section{width:350px;max-width:calc(100vw - 24px);max-height:calc(100vh - 100px - 0.5cm);text-align:left;overflow:auto;margin-bottom:8px;background:#09121b;border:1px solid #785a28;border-radius:5px;padding:14px;box-shadow:0 6px 20px #0008}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}h2{font-size:15px;margin:0}fieldset{min-width:0;margin:0 0 12px;padding:8px 0 0;border:0;border-top:1px solid #34414c}fieldset:last-child{margin-bottom:0}legend{padding:0 8px 0 0;color:#c8aa6e;font-weight:bold;font-size:12px}.row,.switches{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:8px 10px}.row+.row{margin-top:9px}.switch{display:flex;align-items:center;gap:6px;cursor:pointer}.switch input{margin:0;accent-color:#c8aa6e}.parameter{display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:12px}input[type=number],select{flex:1;min-width:0;width:0;padding:4px;color:#f0e6d2;background:#142332;border:1px solid #435261;border-radius:3px}p{font-size:12px;color:#b9b8b2;margin:8px 0 0}.status{min-height:18px;color:#c8aa6e}footer{display:flex;align-items:center;justify-content:space-between;margin-top:8px}footer span{font-size:12px;color:#b9b8b2}</style><section hidden role="dialog" aria-label="ARAM \u8BBE\u7F6E"><header><h2>ARAM \u8BBE\u7F6E</h2><button type="button" data-action="close" aria-label="\u5173\u95ED\u8BBE\u7F6E">\xD7</button></header><form><fieldset><legend>\u5BF9\u5C40\u5F00\u59CB</legend><div class="row">' + checkbox("quickLobby") + '</div><div class="row">' + checkbox("autoAccept") + '<label class="parameter">\u63A5\u53D7\u5EF6\u8FDF<input aria-label="\u63A5\u53D7\u5EF6\u8FDF\uFF08\u6BEB\u79D2\uFF09" title="\u5355\u4F4D\uFF1A\u6BEB\u79D2" name="autoAcceptDelayMs" type="number" min="0" max="15000" step="1" required></label></div></fieldset><fieldset><legend>\u5BF9\u5C40\u7ED3\u675F</legend><div class="row">' + checkbox("autoHonor") + '<label class="parameter">\u70B9\u8D5E\u7C7B\u578B<select name="honorCategory"><option value="RANDOM">\u968F\u673A</option><option value="HEART">\u53CB\u5584</option><option value="COOL">\u51B7\u9759</option><option value="SHOTCALLER">\u6307\u6325</option></select></label></div><div class="row">' + checkbox("autoOpenStats") + '<label class="parameter">\u7EDF\u8BA1\u5EF6\u8FDF<input aria-label="\u7EDF\u8BA1\u5EF6\u8FDF\uFF08\u6BEB\u79D2\uFF09" title="\u70B9\u8D5E\u5904\u7406\u7ED3\u675F\u540E\u7B49\u5F85\uFF0C\u5355\u4F4D\uFF1A\u6BEB\u79D2" name="openStatsDelayMs" type="number" min="0" max="15000" step="1" required></label></div><div class="row">' + checkbox("autoReturnLobby") + '<label class="parameter">\u56DE\u623F\u5EF6\u8FDF<input aria-label="\u7ED3\u7B97\u51FA\u73B0\u540E\u7684\u56DE\u623F\u5EF6\u8FDF\uFF08\u6BEB\u79D2\uFF09" title="\u4ECE\u7ED3\u7B97\u6216\u70B9\u8D5E\u754C\u9762\u51FA\u73B0\u65F6\u8BA1\u65F6\uFF0C15000 \u6BEB\u79D2 = 15 \u79D2" name="returnLobbyDelayMs" type="number" min="0" max="30000" step="1" required></label></div></fieldset><fieldset><legend>\u5927\u4E71\u6597\u9009\u4EBA</legend><div class="row">' + checkbox("benchNoCooldown") + checkbox("champSelectQuit") + '</div><div class="row">' + checkbox("rememberSpells") + '</div></fieldset><fieldset><legend>\u597D\u53CB\u5217\u8868</legend><div class="switches">' + checkbox("friendStatus") + checkbox("friendGroups") + '</div></fieldset></form><p class="status" role="status" aria-live="polite"></p><footer><span>\u66F4\u6539\u81EA\u52A8\u4FDD\u5B58</span><button type="button" data-action="reset">\u6062\u590D\u9ED8\u8BA4</button></footer></section><button type="button" data-action="toggle" aria-expanded="false">ARAM \u8BBE\u7F6E \xB7 F8</button>';
  const panel = shadow.querySelector("section");
  const toggle = shadow.querySelector('[data-action="toggle"]');
  const status = shadow.querySelector(".status");
  let previousFocus = null;
  function sync() {
    for (const [key] of switches) shadow.querySelector('[name="' + key + '"]').checked = config[key];
    for (const key of ["autoAcceptDelayMs", "openStatsDelayMs", "returnLobbyDelayMs"]) {
      shadow.querySelector('[name="' + key + '"]').value = String(config[key]);
    }
    shadow.querySelector('[name="honorCategory"]').value = config.honorCategory;
  }
  function show(open) {
    if (open && panel.hidden) previousFocus = document.activeElement;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) panel.querySelector("input")?.focus();
    else if (previousFocus === host) toggle.focus();
    else if (previousFocus?.isConnected) previousFocus.focus();
  }
  function saved(ok) {
    status.textContent = ok ? "\u5DF2\u4FDD\u5B58\u5E76\u751F\u6548" : "\u672C\u6B21\u5DF2\u751F\u6548\uFF0C\u4F46\u4FDD\u5B58\u5931\u8D25\uFF0C\u91CD\u542F\u540E\u53EF\u80FD\u4E22\u5931\u3002";
  }
  shadow.addEventListener("change", (event) => {
    const target = event.target;
    const flag = switches.find(([key]) => key === target.name);
    if (flag) {
      saved(updateConfig({ [flag[0]]: target.checked }));
    } else if (target.name === "autoAcceptDelayMs" || target.name === "openStatsDelayMs" || target.name === "returnLobbyDelayMs") {
      const input = target;
      const number = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(number) || !Number.isInteger(number) || !input.validity.valid) {
        status.textContent = "\u8BF7\u8F93\u5165\u8303\u56F4\u5185\u7684\u6574\u6570\uFF1A\u63A5\u53D7\u53CA\u7EDF\u8BA1 0\u201315000\uFF0C\u56DE\u623F 0\u201330000 \u6BEB\u79D2\u3002";
        sync();
        return;
      }
      saved(updateConfig({ [target.name]: number }));
    } else if (target.name === "honorCategory") {
      saved(updateConfig({ honorCategory: target.value }));
    }
  });
  shadow.querySelector("form").addEventListener("submit", (event) => event.preventDefault());
  shadow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    switch (button?.dataset.action) {
      case "toggle":
        show(panel.hidden);
        break;
      case "close":
        show(false);
        break;
      case "reset":
        saved(resetConfig());
        break;
    }
  });
  const keydown = (event) => {
    if (event.repeat) return;
    if (event.key === "F8" || event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      show(event.key === "F8" && panel.hidden);
    }
  };
  document.addEventListener("keydown", keydown, true);
  sync();
  scope.own(onConfigChange(sync));
  scope.own(injector.register(() => {
    const existing = document.getElementById(id2);
    if (existing && existing !== host) existing.remove();
    if (host.parentElement !== document.body) document.body?.append(host);
  }));
  scope.own(() => {
    document.removeEventListener("keydown", keydown, true);
    host.remove();
  });
}

// src/index.ts
var Plugin = class {
  constructor() {
    this.lcu = new Lcu();
    this.events = new Events();
    this.flow = new Gameflow(this.lcu, this.events);
    this.injector = new Injector();
  }
  start() {
    if (this.scope?.active) return;
    loadConfig();
    const scope = this.scope = new Scope();
    const context = { lcu: this.lcu, events: this.events, flow: this.flow, injector: this.injector, scope };
    autoAccept(context);
    aramBenchNoCooldown(context);
    aramDefaultSpells(context);
    champSelectQuit(context);
    const waitForHonor = autoHonor(context);
    autoOpenStats(context, waitForHonor);
    autoReturnLobby(context);
    friendEnhancement(context);
    quickLobby(context);
    controlPanel(context);
    scope.own(onConfigChange(() => {
      this.flow.refresh();
      this.injector.schedule();
    }));
    scope.own(this.flow.onChange(this.injector.schedule));
    this.injector.start();
    this.flow.start(scope);
    console.info("[ARAM Lite] \u5DF2\u542F\u52A8");
  }
  stop() {
    this.scope?.dispose();
    this.scope = void 0;
    this.injector.stop();
  }
};
function runtime() {
  return window.__PENGU_ARAM_LITE__ ??= new Plugin();
}
function init(context) {
  benchLog.bind(context.fs);
  runtime().events.bind(context);
}
function load() {
  runtime().start();
}
function unload() {
  runtime().stop();
}
export {
  init,
  load,
  unload
};
