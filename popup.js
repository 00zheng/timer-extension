// popup.js

const tabTimer = document.getElementById("tabTimer");
const tabStopwatch = document.getElementById("tabStopwatch");
const timerSection = document.getElementById("timerSection");
const stopwatchSection = document.getElementById("stopwatchSection");

const timerListEl = document.getElementById("timerList");
const addTimerBtn = document.getElementById("addTimerBtn");
const addPomodoroBtn = document.getElementById("addPomodoroBtn");
const stopwatchListEl = document.getElementById("stopwatchList");
const addStopwatchBtn = document.getElementById("addStopwatchBtn");
const openInstructionsBtn = document.getElementById("openInstructionsBtn");

const songFileEl = document.getElementById("songFile");
const saveSongBtn = document.getElementById("saveSongBtn");
const testSongBtn = document.getElementById("testSongBtn");
const stopSongBtn = document.getElementById("stopSongBtn");
const songStatus = document.getElementById("songStatus");
const ringtoneVolumeEl = document.getElementById("ringtoneVolume");
const ringtoneVolumeNumberEl = document.getElementById("ringtoneVolumeNumber");
const ringtoneVolumeLabel = document.getElementById("ringtoneVolumeLabel");

let uiInterval = null;
const UI_TICK_MS = 50;
const POINTER_ACTION_WINDOW_MS = 400;
let lastPointerAction = { id: null, action: null, at: 0 };

const DB_NAME = "timerDB";
const DB_STORE = "audio";
const DB_KEY = "alarmSound";
const GITHUB_INSTRUCTIONS_URL = "https://00zheng.github.io/pomodoro-timer-extention/README.md";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play user-selected audio when timer ends"
  });
}

saveSongBtn.addEventListener("click", async () => {
  const file = songFileEl.files?.[0];
  if (!file) {
    songStatus.textContent = "Choose an audio file first.";
    return;
  }

  const arrayBuffer = await file.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: file.type || "audio/mpeg" });
  const alarmVolume = getCurrentAlarmVolume();

  await idbSet(DB_KEY, { blob, name: file.name, type: blob.type });
  await chrome.storage.local.set({
    alarmSoundName: file.name,
    alarmSoundType: blob.type,
    alarmVolume
  });

  try {
    await chrome.runtime.sendMessage({ type: "SET_VOLUME", volume: alarmVolume });
  } catch {
    // Offscreen is not always active; ignore message errors.
  }

  songStatus.textContent = `Saved: ${file.name}`;
});

testSongBtn.addEventListener("click", async () => {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: "PLAY_SOUND", volume: getCurrentAlarmVolume() });
  songStatus.textContent = "Previewing sound...";
});

stopSongBtn.addEventListener("click", async () => {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: "STOP_SOUND" });
  songStatus.textContent = "Sound stopped.";
});

function updateVolumeLabel(value) {
  if (ringtoneVolumeLabel) ringtoneVolumeLabel.textContent = `Volume: ${value}%`;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 80;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function getCurrentAlarmVolume() {
  const sliderValue = Number(ringtoneVolumeEl?.value);
  if (Number.isFinite(sliderValue)) return clampPercent(sliderValue) / 100;

  const inputValue = Number(ringtoneVolumeNumberEl?.value);
  return clampPercent(inputValue) / 100;
}

function syncVolumeInputs(clampedPercent) {
  if (ringtoneVolumeEl && ringtoneVolumeEl.value !== String(clampedPercent)) {
    ringtoneVolumeEl.value = String(clampedPercent);
  }
  if (ringtoneVolumeNumberEl && ringtoneVolumeNumberEl.value !== String(clampedPercent)) {
    ringtoneVolumeNumberEl.value = String(clampedPercent);
  }
}

async function saveAndBroadcastVolume(rawPercent) {
  const clampedPercent = clampPercent(rawPercent);
  const alarmVolume = clampedPercent / 100;

  syncVolumeInputs(clampedPercent);
  await chrome.storage.local.set({ alarmVolume });
  updateVolumeLabel(clampedPercent);

  try {
    await chrome.runtime.sendMessage({ type: "SET_VOLUME", volume: alarmVolume });
  } catch {
    // Offscreen is not always active; ignore message errors.
  }
}

ringtoneVolumeEl?.addEventListener("input", () => {
  void saveAndBroadcastVolume(Number(ringtoneVolumeEl.value));
});

ringtoneVolumeEl?.addEventListener("change", () => {
  void saveAndBroadcastVolume(Number(ringtoneVolumeEl.value));
});

ringtoneVolumeNumberEl?.addEventListener("input", () => {
  void saveAndBroadcastVolume(Number(ringtoneVolumeNumberEl.value));
});

ringtoneVolumeNumberEl?.addEventListener("change", () => {
  void saveAndBroadcastVolume(Number(ringtoneVolumeNumberEl.value));
});

// On popup open, show saved name
(async () => {
  const { alarmSoundName, alarmVolume } = await chrome.storage.local.get(["alarmSoundName", "alarmVolume"]);
  songStatus.textContent = alarmSoundName ? `Current sound: ${alarmSoundName}` : "No custom sound saved yet.";
  const vol = Number.isFinite(alarmVolume) ? clampPercent(alarmVolume * 100) : 80;
  syncVolumeInputs(vol);
  updateVolumeLabel(vol);
})();

function now() {
  return Date.now();
}

function fmt(msValue, { showMs = false } = {}) {
  const clampedMs = Math.max(0, Math.floor(msValue));
  const totalSeconds = Math.floor(clampedMs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (!showMs) {
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const ms = Math.floor((clampedMs % 1000) / 10); // hundredths
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

function makeId(prefix) {
  if (crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createTimer(label) {
  return {
    id: makeId("t"),
    label,
    inputHours: "",
    inputMinutes: "",
    inputSeconds: "",
    running: false,
    endAt: null,
    durationMs: 0
  };
}

function createPomodoro(label) {
  return {
    id: makeId("p"),
    label,
    running: false,
    phase: "work",
    endAt: null,
    remainingMs: 0,
    recurring: false,
    workMs: 25 * 60 * 1000,
    breakMs: 5 * 60 * 1000
  };
}

function createStopwatch(label) {
  return {
    id: makeId("s"),
    label,
    running: false,
    startAt: null,
    elapsedBeforeStart: 0,
    laps: []
  };
}

function getCountdownInputMsFromTimer(timer) {
  const hRaw = (timer.inputHours ?? "").trim();
  const mRaw = (timer.inputMinutes ?? "").trim();
  const sRaw = (timer.inputSeconds ?? "").trim();

  const hasInput = hRaw !== "" || mRaw !== "" || sRaw !== "";
  if (!hasInput) return { hasInput: false, durationMs: 0 };

  const h = hRaw === "" ? 0 : Number(hRaw);
  const m = mRaw === "" ? 0 : Number(mRaw);
  const s = sRaw === "" ? 0 : Number(sRaw);

  const valid = Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s) && h >= 0 && m >= 0 && s >= 0;
  if (!valid) return { hasInput: true, durationMs: null };

  const totalSeconds = Math.floor(h * 3600 + m * 60 + s);
  return { hasInput: true, durationMs: totalSeconds * 1000 };
}

async function getState() {
  const defaults = {
    activeTab: "timer",
    timers: [],
    pomodoros: [],
    stopwatches: [],
    timerOrder: []
  };
  const stored = await chrome.storage.local.get(Object.keys(defaults));
  const timers = Array.isArray(stored.timers) ? stored.timers : [];
  const pomodoros = Array.isArray(stored.pomodoros) ? stored.pomodoros : [];
  let stopwatches = [];
  if (Array.isArray(stored.stopwatches)) {
    stopwatches = stored.stopwatches;
  } else if (stored.stopwatch && typeof stored.stopwatch === "object") {
    stopwatches = [{ ...stored.stopwatch, id: makeId("s"), label: "Stopwatch 1" }];
  }

  const validKeys = new Set([
    ...timers.map((t) => `timer:${t.id}`),
    ...pomodoros.map((p) => `pomodoro:${p.id}`)
  ]);
  const baseOrder = Array.isArray(stored.timerOrder)
    ? stored.timerOrder.filter((key) => typeof key === "string" && validKeys.has(key))
    : [];
  const seen = new Set(baseOrder);
  const missing = [...validKeys].filter((key) => !seen.has(key));
  const timerOrder = [...baseOrder, ...missing];

  return {
    ...defaults,
    ...stored,
    timers,
    pomodoros,
    stopwatches: stopwatches.map((sw, index) => ({
      id: typeof sw.id === "string" && sw.id ? sw.id : makeId("s"),
      label: typeof sw.label === "string" ? sw.label : `Stopwatch ${index + 1}`,
      running: !!sw.running,
      startAt: Number.isFinite(sw.startAt) ? sw.startAt : null,
      elapsedBeforeStart: Number.isFinite(sw.elapsedBeforeStart) ? sw.elapsedBeforeStart : 0,
      laps: Array.isArray(sw.laps) ? sw.laps.filter((ms) => Number.isFinite(ms) && ms >= 0) : []
    })),
    timerOrder
  };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

async function migrateIfNeeded() {
  const legacyKeys = [
    "mode",
    "running",
    "startAt",
    "elapsedBeforeStart",
    "endAt",
    "durationMs",
    "pomodoroRunning",
    "pomodoroPhase",
    "pomodoroEndAt",
    "pomodoroRemainingMs",
    "pomodoroRecurring",
    "pomodoroWorkMs",
    "pomodoroBreakMs",
    "timers",
    "pomodoros",
    "migratedToMulti"
  ];
  const stored = await chrome.storage.local.get(legacyKeys);
  if (stored.migratedToMulti) return;

  let timers = Array.isArray(stored.timers) ? stored.timers : [];
  let pomodoros = Array.isArray(stored.pomodoros) ? stored.pomodoros : [];
  let stopwatches = [];

  const hasLegacyTimer =
    stored.mode || stored.running || stored.startAt || stored.endAt || stored.durationMs || stored.elapsedBeforeStart;
  if (timers.length === 0 && hasLegacyTimer) {
    if (stored.mode === "stopwatch") {
      stopwatches = [{
        id: makeId("s"),
        label: "Stopwatch 1",
        running: !!stored.running,
        startAt: Number.isFinite(stored.startAt) ? stored.startAt : null,
        elapsedBeforeStart: Number.isFinite(stored.elapsedBeforeStart) ? stored.elapsedBeforeStart : 0,
        laps: []
      }];
    } else {
      timers = [
        {
          id: makeId("t"),
          label: "Timer 1",
          inputHours: "",
          inputMinutes: "",
          inputSeconds: "",
          running: !!stored.running,
          endAt: stored.endAt ?? null,
          durationMs: stored.durationMs ?? 0,
          mode: "countdown"
        }
      ];
    }
  }

  const hasLegacyPomodoro =
    stored.pomodoroRunning || stored.pomodoroPhase || stored.pomodoroEndAt || stored.pomodoroRemainingMs;
  if (pomodoros.length === 0 && hasLegacyPomodoro) {
    pomodoros = [
      {
        id: makeId("p"),
        label: "Pomodoro 1",
        running: !!stored.pomodoroRunning,
        phase: stored.pomodoroPhase || "work",
        endAt: stored.pomodoroEndAt ?? null,
        remainingMs: stored.pomodoroRemainingMs ?? 0,
        recurring: !!stored.pomodoroRecurring,
        workMs: stored.pomodoroWorkMs || 25 * 60 * 1000,
        breakMs: stored.pomodoroBreakMs || 5 * 60 * 1000
      }
    ];
  }

  await chrome.storage.local.set({
    timers,
    pomodoros,
    stopwatches,
    timerOrder: [
      ...timers.map((t) => `timer:${t.id}`),
      ...pomodoros.map((p) => `pomodoro:${p.id}`)
    ],
    migratedToMulti: true
  });
}

function startUiTick() {
  if (uiInterval) return;
  uiInterval = setInterval(render, UI_TICK_MS);
}

function stopUiTick() {
  if (uiInterval) {
    clearInterval(uiInterval);
    uiInterval = null;
  }
}

function anyRunning(st) {
  return st.timers.some((t) => t.running) || st.pomodoros.some((p) => p.running) || st.stopwatches.some((s) => s.running);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getDefaultTimerLabel(index) {
  return `Timer ${index + 1}`;
}

function getTimerDisplayLabel(timer, index) {
  const custom = (timer.label ?? "").trim();
  return custom || getDefaultTimerLabel(index);
}

function getDefaultPomodoroLabel(index) {
  return `Pomodoro ${index + 1}`;
}

function getPomodoroDisplayLabel(pomo, index) {
  const custom = (pomo.label ?? "").trim();
  return custom || getDefaultPomodoroLabel(index);
}

function renderTimerItem(timer, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "item timer-item";
  wrapper.dataset.id = timer.id;
  wrapper.dataset.index = String(index);

  let displayMs = 0;
  if (timer.running && timer.endAt != null) {
    displayMs = timer.endAt - now();
  } else if (timer.endAt != null) {
    displayMs = timer.endAt - now();
  } else {
    displayMs = timer.durationMs;
  }
  if (displayMs < 0) displayMs = 0;

  wrapper.innerHTML = `
    <div class="row">
      <input class="timer-name-input" type="text" maxlength="40" value="${escapeHtml(getTimerDisplayLabel(timer, index))}" aria-label="Timer name" />
      <button data-action="move-up" class="move-btn" title="Move timer up">↑</button>
      <button data-action="move-down" class="move-btn" title="Move timer down">↓</button>
    </div>
    <div class="time" style="font-size: 24px; margin: 2px 0 6px;">
      ${fmt(displayMs)}
    </div>
    <div class="row">
      <input data-field="hours" class="timer-input" type="number" min="0" max="99" placeholder="H" value="${timer.inputHours ?? ""}" />
      <input data-field="minutes" class="timer-input" type="number" min="0" max="59" placeholder="M" value="${timer.inputMinutes ?? ""}" />
      <input data-field="seconds" class="timer-input" type="number" min="0" max="59" placeholder="S" value="${timer.inputSeconds ?? ""}" />
    </div>
    <div class="small" style="text-align:center; margin-top:2px;">Set H / M / S then press Start.</div>
    <div class="btn-row">
      <button data-action="start" class="primary">Start</button>
      <button data-action="pause">Pause</button>
      <button data-action="reset" class="danger">Reset</button>
      <button data-action="delete">Remove</button>
    </div>
  `;

  return wrapper;
}

function stopwatchElapsedMs(stopwatch) {
  if (stopwatch.running && stopwatch.startAt != null) {
    return stopwatch.elapsedBeforeStart + (now() - stopwatch.startAt);
  }
  return stopwatch.elapsedBeforeStart;
}

function getDefaultStopwatchLabel(index) {
  return `Stopwatch ${index + 1}`;
}

function getStopwatchDisplayLabel(stopwatch, index) {
  const custom = (stopwatch.label ?? "").trim();
  return custom || getDefaultStopwatchLabel(index);
}

function renderStopwatchItem(stopwatch, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "item stopwatch-item";
  wrapper.dataset.id = stopwatch.id;
  wrapper.dataset.index = String(index);

  const elapsed = Math.max(0, stopwatchElapsedMs(stopwatch));
  const laps = stopwatch.laps
    .map((lapMs, i) => `<div class="lap-row"><span>Lap ${i + 1}</span><span>${fmt(lapMs, { showMs: true })}</span></div>`)
    .join("");

  wrapper.innerHTML = `
    <div class="row">
      <input class="stopwatch-name-input" type="text" maxlength="40" value="${escapeHtml(getStopwatchDisplayLabel(stopwatch, index))}" aria-label="Stopwatch name" />
    </div>
    <div class="stopwatch-time">${fmt(elapsed, { showMs: true })}</div>
    <div class="btn-row">
      <button data-action="toggle" class="${stopwatch.running ? "" : "primary"}">${stopwatch.running ? "Stop" : "Start"}</button>
      <button data-action="lap">Lap</button>
      <button data-action="reset" class="danger">Reset</button>
      <button data-action="delete">Remove</button>
    </div>
    <div class="lap-list-item">
      ${laps || `<div class="lap-empty">No laps yet.</div>`}
    </div>
  `;

  return wrapper;
}

function renderPomodoroItem(pomo, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "item pomodoro-item";
  wrapper.dataset.id = pomo.id;
  wrapper.dataset.index = String(index);

  let displayMs = 0;
  if (pomo.running && pomo.endAt != null) {
    displayMs = pomo.endAt - now();
  } else if (pomo.remainingMs > 0) {
    displayMs = pomo.remainingMs;
  } else {
    displayMs = pomo.phase === "break" ? pomo.breakMs : pomo.workMs;
  }
  if (displayMs < 0) displayMs = 0;

  const workMin = Math.max(1, Math.round(pomo.workMs / 60000));
  const breakMin = Math.max(1, Math.round(pomo.breakMs / 60000));

  wrapper.innerHTML = `
    <div class="row">
      <input class="pomodoro-name-input timer-name-input" type="text" maxlength="40" value="${escapeHtml(getPomodoroDisplayLabel(pomo, index))}" aria-label="Pomodoro name" />
      <button data-action="move-up" class="move-btn" title="Move pomodoro up">↑</button>
      <button data-action="move-down" class="move-btn" title="Move pomodoro down">↓</button>
    </div>
    <div class="time" style="font-size: 24px; margin: 2px 0 6px;">
      ${fmt(displayMs)}
    </div>
    <div class="row">
      <input data-field="work" class="pomodoro-input" type="number" min="1" max="999" placeholder="Session min" value="${workMin}" />
      <input data-field="break" class="pomodoro-input" type="number" min="1" max="999" placeholder="Break min" value="${breakMin}" />
    </div>
    <div class="row pomodoro-recurring">
      <input data-field="recurring" class="pomodoro-input" type="checkbox" ${pomo.recurring ? "checked" : ""} />
      <span class="small">Recurring cycles</span>
    </div>
    <div class="btn-row">
      <button data-action="start" class="primary">Start</button>
      <button data-action="pause">Pause</button>
      <button data-action="reset" class="danger">Reset</button>
      <button data-action="delete">Remove</button>
    </div>
  `;

  return wrapper;
}

function markPointerAction(id, action) {
  lastPointerAction = { id, action, at: now() };
}

function wasRecentPointerAction(id, action) {
  return (
    lastPointerAction.id === id &&
    lastPointerAction.action === action &&
    now() - lastPointerAction.at < POINTER_ACTION_WINDOW_MS
  );
}

async function render() {
  const st = await getState();

  if (tabTimer && tabStopwatch && timerSection && stopwatchSection) {
    const active = st.activeTab === "stopwatch" ? "stopwatch" : "timer";
    tabTimer.classList.toggle("active", active === "timer");
    tabStopwatch.classList.toggle("active", active === "stopwatch");
    timerSection.classList.toggle("hidden", active !== "timer");
    stopwatchSection.classList.toggle("hidden", active !== "stopwatch");
  }

  if (timerListEl) {
    timerListEl.innerHTML = "";
    const timerById = new Map(st.timers.map((t) => [t.id, t]));
    const pomodoroById = new Map(st.pomodoros.map((p) => [p.id, p]));
    let timerIndex = 0;
    let pomodoroIndex = 0;
    st.timerOrder.forEach((key) => {
      const [type, id] = String(key).split(":");
      if (type === "timer") {
        const timer = timerById.get(id);
        if (timer) {
          timerListEl.appendChild(renderTimerItem(timer, timerIndex));
          timerIndex += 1;
        }
      } else if (type === "pomodoro") {
        const pomo = pomodoroById.get(id);
        if (pomo) {
          timerListEl.appendChild(renderPomodoroItem(pomo, pomodoroIndex));
          pomodoroIndex += 1;
        }
      }
    });
  }

  if (stopwatchListEl) {
    stopwatchListEl.innerHTML = "";
    st.stopwatches.forEach((sw, index) => stopwatchListEl.appendChild(renderStopwatchItem(sw, index)));
  }

  if (anyRunning(st)) startUiTick();
  else stopUiTick();
}

async function addTimer() {
  const st = await getState();
  const label = `Timer ${st.timers.length + 1}`;
  const nextTimer = createTimer(label);
  const timers = [...st.timers, nextTimer];
  const timerOrder = [...st.timerOrder, `timer:${nextTimer.id}`];
  await setState({ timers, timerOrder });
  await render();
}

async function addPomodoro() {
  const st = await getState();
  const label = `Pomodoro ${st.pomodoros.length + 1}`;
  const nextPomodoro = createPomodoro(label);
  const pomodoros = [...st.pomodoros, nextPomodoro];
  const timerOrder = [...st.timerOrder, `pomodoro:${nextPomodoro.id}`];
  await setState({ pomodoros, timerOrder });
  await render();
}

async function addStopwatch() {
  const st = await getState();
  const label = `Stopwatch ${st.stopwatches.length + 1}`;
  const stopwatches = [...st.stopwatches, createStopwatch(label)];
  await setState({ stopwatches });
  await render();
}

async function updateTimer(id, updater) {
  const st = await getState();
  const timers = st.timers.map((t) => (t.id === id ? updater({ ...t }) : t));
  await setState({ timers });
}

async function updatePomodoro(id, updater) {
  const st = await getState();
  const pomodoros = st.pomodoros.map((p) => (p.id === id ? updater({ ...p }) : p));
  await setState({ pomodoros });
}

async function updateStopwatch(id, updater) {
  const st = await getState();
  const stopwatches = st.stopwatches.map((s) => (s.id === id ? updater({ ...s }) : s));
  await setState({ stopwatches });
}

async function startTimer(id) {
  const st = await getState();
  const timer = st.timers.find((t) => t.id === id);
  if (!timer || timer.running) return;

  const { hasInput, durationMs } = getCountdownInputMsFromTimer(timer);
  if (!hasInput || durationMs == null || durationMs <= 0) return;
  const endAt = now() + durationMs;
  await updateTimer(id, (t) => ({
    ...t,
    running: true,
    durationMs,
    endAt
  }));
  chrome.alarms.clear(`timerDone:${id}`, () => {
    chrome.alarms.create(`timerDone:${id}`, { when: endAt });
  });

  await render();
}

async function pauseTimer(id) {
  const st = await getState();
  const timer = st.timers.find((t) => t.id === id);
  if (!timer || !timer.running) return;

  const remaining = timer.endAt != null ? timer.endAt - now() : timer.durationMs;
  const clamped = Math.max(0, remaining);
  await updateTimer(id, (t) => ({
    ...t,
    running: false,
    endAt: null,
    durationMs: clamped
  }));
  chrome.alarms.clear(`timerDone:${id}`);

  await render();
}

async function resetTimer(id) {
  const st = await getState();
  const timer = st.timers.find((t) => t.id === id);
  if (!timer) return;

  const input = getCountdownInputMsFromTimer(timer);
  let durationMs = 0;
  if (input.hasInput && input.durationMs != null) durationMs = input.durationMs;
  else durationMs = timer.durationMs || 0;
  await updateTimer(id, (t) => ({
    ...t,
    running: false,
    durationMs,
    endAt: null
  }));

  chrome.alarms.clear(`timerDone:${id}`);
  await render();
}

async function startStopwatch(id) {
  const st = await getState();
  const sw = st.stopwatches.find((s) => s.id === id);
  if (!sw || sw.running) return;
  await updateStopwatch(id, (s) => ({
    ...s,
    running: true,
    startAt: now()
  }));
  await render();
}

async function pauseStopwatch(id) {
  const st = await getState();
  const sw = st.stopwatches.find((s) => s.id === id);
  if (!sw || !sw.running) return;
  const elapsed = stopwatchElapsedMs(sw);
  await updateStopwatch(id, (s) => ({
    ...s,
    running: false,
    startAt: null,
    elapsedBeforeStart: elapsed
  }));
  await render();
}

async function lapStopwatch(id) {
  const st = await getState();
  const sw = st.stopwatches.find((s) => s.id === id);
  if (!sw) return;
  const elapsed = stopwatchElapsedMs(sw);
  if (elapsed <= 0) return;
  await updateStopwatch(id, (s) => ({
    ...s,
    laps: [...s.laps, elapsed]
  }));
  await render();
}

async function resetStopwatch(id) {
  await updateStopwatch(id, (s) => ({
    ...s,
    running: false,
    startAt: null,
    elapsedBeforeStart: 0,
    laps: []
  }));
  await render();
}

async function toggleStopwatch(id) {
  const st = await getState();
  const sw = st.stopwatches.find((s) => s.id === id);
  if (!sw) return;
  if (sw.running) {
    await pauseStopwatch(id);
    return;
  }
  await startStopwatch(id);
}

async function deleteStopwatch(id) {
  const st = await getState();
  const stopwatches = st.stopwatches.filter((s) => s.id !== id);
  await setState({ stopwatches });
  await render();
}

async function deleteTimer(id) {
  const st = await getState();
  const timers = st.timers.filter((t) => t.id !== id);
  const timerOrder = st.timerOrder.filter((key) => key !== `timer:${id}`);
  await setState({ timers, timerOrder });
  chrome.alarms.clear(`timerDone:${id}`);
  await render();
}

async function moveTimerEntry(type, id, direction) {
  const st = await getState();
  const timerOrder = [...st.timerOrder];
  const key = `${type}:${id}`;
  const index = timerOrder.indexOf(key);
  if (index < 0) return;

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= timerOrder.length) return;

  [timerOrder[index], timerOrder[target]] = [timerOrder[target], timerOrder[index]];
  await setState({ timerOrder });
  await render();
}

function pomodoroDurationForPhase(pomo) {
  return pomo.phase === "break" ? pomo.breakMs : pomo.workMs;
}

async function startPomodoro(id) {
  const st = await getState();
  const pomo = st.pomodoros.find((p) => p.id === id);
  if (!pomo || pomo.running) return;

  const remaining = pomo.remainingMs > 0 ? pomo.remainingMs : pomodoroDurationForPhase(pomo);
  if (remaining <= 0) return;
  const endAt = now() + remaining;

  await updatePomodoro(id, (p) => ({
    ...p,
    running: true,
    endAt,
    remainingMs: 0
  }));

  chrome.alarms.clear(`pomodoroPhase:${id}`, () => {
    chrome.alarms.create(`pomodoroPhase:${id}`, { when: endAt });
  });

  await render();
}

async function pausePomodoro(id) {
  const st = await getState();
  const pomo = st.pomodoros.find((p) => p.id === id);
  if (!pomo || !pomo.running) return;

  const remaining = pomo.endAt != null ? pomo.endAt - now() : pomo.remainingMs;
  const clamped = Math.max(0, remaining);
  await updatePomodoro(id, (p) => ({
    ...p,
    running: false,
    endAt: null,
    remainingMs: clamped
  }));
  chrome.alarms.clear(`pomodoroPhase:${id}`);
  await render();
}

async function resetPomodoro(id) {
  await updatePomodoro(id, (p) => ({
    ...p,
    running: false,
    phase: "work",
    endAt: null,
    remainingMs: 0
  }));
  chrome.alarms.clear(`pomodoroPhase:${id}`);
  await render();
}

async function deletePomodoro(id) {
  const st = await getState();
  const pomodoros = st.pomodoros.filter((p) => p.id !== id);
  const timerOrder = st.timerOrder.filter((key) => key !== `pomodoro:${id}`);
  await setState({ pomodoros, timerOrder });
  chrome.alarms.clear(`pomodoroPhase:${id}`);
  await render();
}

async function handleTimerAction(action, id) {
  if (action === "start") await startTimer(id);
  if (action === "pause") await pauseTimer(id);
  if (action === "reset") await resetTimer(id);
  if (action === "delete") await deleteTimer(id);
  if (action === "move-up") await moveTimerEntry("timer", id, "up");
  if (action === "move-down") await moveTimerEntry("timer", id, "down");
}

async function handlePomodoroAction(action, id) {
  if (action === "start") await startPomodoro(id);
  if (action === "pause") await pausePomodoro(id);
  if (action === "reset") await resetPomodoro(id);
  if (action === "delete") await deletePomodoro(id);
  if (action === "move-up") await moveTimerEntry("pomodoro", id, "up");
  if (action === "move-down") await moveTimerEntry("pomodoro", id, "down");
}

async function handleStopwatchAction(action, id) {
  if (action === "toggle") await toggleStopwatch(id);
  if (action === "lap") await lapStopwatch(id);
  if (action === "reset") await resetStopwatch(id);
  if (action === "delete") await deleteStopwatch(id);
}

timerListEl.addEventListener("pointerdown", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const timerItem = btn.closest(".timer-item");
  const pomodoroItem = btn.closest(".pomodoro-item");
  if (!timerItem && !pomodoroItem) return;
  const id = (timerItem || pomodoroItem).dataset.id;
  const action = btn.dataset.action;
  markPointerAction(id, action);
  if (timerItem) await handleTimerAction(action, id);
  else await handlePomodoroAction(action, id);
});

timerListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const timerItem = btn.closest(".timer-item");
  const pomodoroItem = btn.closest(".pomodoro-item");
  if (!timerItem && !pomodoroItem) return;
  const id = (timerItem || pomodoroItem).dataset.id;
  const action = btn.dataset.action;
  if (wasRecentPointerAction(id, action)) return;
  if (timerItem) await handleTimerAction(action, id);
  else await handlePomodoroAction(action, id);
});

timerListEl.addEventListener("change", async (e) => {
  const nameInput = e.target.closest(".timer-name-input");
  if (nameInput && !nameInput.classList.contains("pomodoro-name-input")) {
    const item = nameInput.closest(".timer-item");
    if (!item) return;
    const id = item.dataset.id;
    const index = Number(item.dataset.index);
    const defaultName = getDefaultTimerLabel(Number.isFinite(index) ? index : 0);
    const nextName = (nameInput.value ?? "").trim().slice(0, 40);

    await updateTimer(id, (t) => ({
      ...t,
      label: nextName === defaultName ? "" : nextName
    }));

    await render();
    return;
  }

  const pomodoroNameInput = e.target.closest(".pomodoro-name-input");
  if (pomodoroNameInput) {
    const item = pomodoroNameInput.closest(".pomodoro-item");
    if (!item) return;
    const id = item.dataset.id;
    const index = Number(item.dataset.index);
    const defaultName = getDefaultPomodoroLabel(Number.isFinite(index) ? index : 0);
    const nextName = (pomodoroNameInput.value ?? "").trim().slice(0, 40);

    await updatePomodoro(id, (p) => ({
      ...p,
      label: nextName === defaultName ? "" : nextName
    }));

    await render();
    return;
  }

  const input = e.target.closest(".timer-input");
  if (input) {
    const item = input.closest(".timer-item");
    if (!item) return;
    const id = item.dataset.id;
    const field = input.dataset.field;
    const value = input.value;

    await updateTimer(id, (t) => {
      const next = { ...t };
      if (field === "hours") next.inputHours = value;
      if (field === "minutes") next.inputMinutes = value;
      if (field === "seconds") next.inputSeconds = value;

      if (!next.running) {
        const inputState = getCountdownInputMsFromTimer(next);
        if (inputState.hasInput && inputState.durationMs != null) {
          next.durationMs = inputState.durationMs;
          next.endAt = null;
        } else if (!inputState.hasInput || inputState.durationMs == null) {
          next.durationMs = 0;
          next.endAt = null;
        }
      }
      return next;
    });

    await render();
    return;
  }

  const pomodoroInput = e.target.closest(".pomodoro-input");
  if (!pomodoroInput) return;
  const pomodoroItem = pomodoroInput.closest(".pomodoro-item");
  if (!pomodoroItem) return;
  const pomodoroId = pomodoroItem.dataset.id;
  const field = pomodoroInput.dataset.field;

  await updatePomodoro(pomodoroId, (p) => {
    const next = { ...p };
    if (field === "work") {
      const num = Number(pomodoroInput.value);
      if (Number.isFinite(num) && num > 0) next.workMs = Math.floor(num) * 60000;
    }
    if (field === "break") {
      const num = Number(pomodoroInput.value);
      if (Number.isFinite(num) && num > 0) next.breakMs = Math.floor(num) * 60000;
    }
    if (field === "recurring") {
      next.recurring = pomodoroInput.checked;
    }
    return next;
  });

  await render();
});

stopwatchListEl.addEventListener("pointerdown", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const item = btn.closest(".stopwatch-item");
  if (!item) return;
  const id = item.dataset.id;
  const action = btn.dataset.action;
  markPointerAction(id, action);
  await handleStopwatchAction(action, id);
});

stopwatchListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const item = btn.closest(".stopwatch-item");
  if (!item) return;
  const id = item.dataset.id;
  const action = btn.dataset.action;
  if (wasRecentPointerAction(id, action)) return;
  await handleStopwatchAction(action, id);
});

stopwatchListEl.addEventListener("change", async (e) => {
  const nameInput = e.target.closest(".stopwatch-name-input");
  if (!nameInput) return;
  const item = nameInput.closest(".stopwatch-item");
  if (!item) return;
  const id = item.dataset.id;
  const index = Number(item.dataset.index);
  const defaultName = getDefaultStopwatchLabel(Number.isFinite(index) ? index : 0);
  const nextName = (nameInput.value ?? "").trim().slice(0, 40);

  await updateStopwatch(id, (s) => ({
    ...s,
    label: nextName === defaultName ? "" : nextName
  }));

  await render();
});

addTimerBtn.addEventListener("click", addTimer);
addPomodoroBtn.addEventListener("click", addPomodoro);
addStopwatchBtn.addEventListener("click", addStopwatch);
openInstructionsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: GITHUB_INSTRUCTIONS_URL });
});

tabTimer.addEventListener("click", async () => {
  await setState({ activeTab: "timer" });
  await render();
});

tabStopwatch.addEventListener("click", async () => {
  await setState({ activeTab: "stopwatch" });
  await render();
});

async function cleanupExpired() {
  const st = await getState();
  let changed = false;

  const timers = st.timers.map((t) => {
    if (t.running && t.endAt != null && t.endAt <= now()) {
      changed = true;
      return { ...t, running: false, endAt: null, durationMs: 0, mode: "countdown" };
    }
    if (t.running && t.endAt != null) {
      chrome.alarms.create(`timerDone:${t.id}`, { when: t.endAt });
    }
    if (t.mode === "stopwatch") {
      changed = true;
      return {
        ...t,
        mode: "countdown",
        running: false,
        endAt: null,
        durationMs: 0
      };
    }
    return { ...t, mode: "countdown" };
  });

  const pomodoros = st.pomodoros.map((p) => {
    if (p.running && p.endAt != null && p.endAt <= now()) {
      if (p.recurring) {
        const nextPhase = p.phase === "break" ? "work" : "break";
        const duration = nextPhase === "break" ? p.breakMs : p.workMs;
        const endAt = now() + duration;
        chrome.alarms.create(`pomodoroPhase:${p.id}`, { when: endAt });
        changed = true;
        return { ...p, phase: nextPhase, endAt, remainingMs: 0, running: true };
      }
      changed = true;
      return { ...p, running: false, endAt: null, remainingMs: 0, phase: "work" };
    }
    if (p.running && p.endAt != null) {
      chrome.alarms.create(`pomodoroPhase:${p.id}`, { when: p.endAt });
    }
    return p;
  });

  if (changed) await setState({ timers, pomodoros });
}

// Initialize on popup open
(async () => {
  await migrateIfNeeded();
  let st = await getState();
  if (st.timers.length === 0) {
    const nextTimer = createTimer("Timer 1");
    await setState({
      timers: [nextTimer],
      timerOrder: [...st.timerOrder, `timer:${nextTimer.id}`]
    });
    st = await getState();
  }
  if (st.pomodoros.length === 0) {
    const nextPomodoro = createPomodoro("Pomodoro 1");
    await setState({
      pomodoros: [nextPomodoro],
      timerOrder: [...st.timerOrder, `pomodoro:${nextPomodoro.id}`]
    });
    st = await getState();
  }
  if (!Array.isArray(st.stopwatches) || st.stopwatches.length === 0) {
    await setState({ stopwatches: [createStopwatch("Stopwatch 1")] });
  }
  await cleanupExpired();
  await render();
})();
