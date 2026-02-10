// popup.js

const tabTimer = document.getElementById("tabTimer");
const tabPomodoro = document.getElementById("tabPomodoro");
const timerSection = document.getElementById("timerSection");
const pomodoroSection = document.getElementById("pomodoroSection");

const timerListEl = document.getElementById("timerList");
const addTimerBtn = document.getElementById("addTimerBtn");
const pomodoroListEl = document.getElementById("pomodoroList");
const addPomodoroBtn = document.getElementById("addPomodoroBtn");

const songFileEl = document.getElementById("songFile");
const saveSongBtn = document.getElementById("saveSongBtn");
const testSongBtn = document.getElementById("testSongBtn");
const stopSongBtn = document.getElementById("stopSongBtn");
const songStatus = document.getElementById("songStatus");
const ringtoneVolumeEl = document.getElementById("ringtoneVolume");
const ringtoneVolumeLabel = document.getElementById("ringtoneVolumeLabel");

let uiInterval = null;

const DB_NAME = "timerDB";
const DB_STORE = "audio";
const DB_KEY = "alarmSound";

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

  await idbSet(DB_KEY, { blob, name: file.name, type: blob.type });
  await chrome.storage.local.set({ alarmSoundName: file.name, alarmSoundType: blob.type });

  songStatus.textContent = `Saved: ${file.name}`;
});

testSongBtn.addEventListener("click", async () => {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: "PLAY_SOUND" });
});

stopSongBtn.addEventListener("click", async () => {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: "STOP_SOUND" });
});

function updateVolumeLabel(value) {
  if (ringtoneVolumeLabel) ringtoneVolumeLabel.textContent = `Volume: ${value}%`;
}

ringtoneVolumeEl?.addEventListener("input", async () => {
  const value = Number(ringtoneVolumeEl.value);
  if (!Number.isFinite(value)) return;
  await chrome.storage.local.set({ alarmVolume: value / 100 });
  updateVolumeLabel(value);
});

// On popup open, show saved name
(async () => {
  const { alarmSoundName, alarmVolume } = await chrome.storage.local.get(["alarmSoundName", "alarmVolume"]);
  if (alarmSoundName) songStatus.textContent = `Current sound: ${alarmSoundName}`;
  const vol = Number.isFinite(alarmVolume) ? Math.round(alarmVolume * 100) : 80;
  if (ringtoneVolumeEl) ringtoneVolumeEl.value = String(vol);
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
    mode: "stopwatch",
    running: false,
    startAt: null,
    elapsedBeforeStart: 0,
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
    pomodoros: []
  };
  const stored = await chrome.storage.local.get(Object.keys(defaults));
  return {
    ...defaults,
    ...stored,
    timers: Array.isArray(stored.timers) ? stored.timers : [],
    pomodoros: Array.isArray(stored.pomodoros) ? stored.pomodoros : []
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

  const hasLegacyTimer =
    stored.mode || stored.running || stored.startAt || stored.endAt || stored.durationMs || stored.elapsedBeforeStart;
  if (timers.length === 0 && hasLegacyTimer) {
    timers = [
      {
        id: makeId("t"),
        label: "Timer 1",
        inputHours: "",
        inputMinutes: "",
        inputSeconds: "",
        mode: stored.mode || "stopwatch",
        running: !!stored.running,
        startAt: stored.startAt ?? null,
        elapsedBeforeStart: stored.elapsedBeforeStart ?? 0,
        endAt: stored.endAt ?? null,
        durationMs: stored.durationMs ?? 0
      }
    ];
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
    migratedToMulti: true
  });
}

function startUiTick() {
  if (uiInterval) return;
  uiInterval = setInterval(render, 200);
}

function stopUiTick() {
  if (uiInterval) {
    clearInterval(uiInterval);
    uiInterval = null;
  }
}

function anyRunning(st) {
  return st.timers.some((t) => t.running) || st.pomodoros.some((p) => p.running);
}

function renderTimerItem(timer) {
  const wrapper = document.createElement("div");
  wrapper.className = "item timer-item";
  wrapper.dataset.id = timer.id;

  let displayMs = 0;
  if (timer.mode === "stopwatch") {
    if (timer.running && timer.startAt != null) {
      displayMs = timer.elapsedBeforeStart + (now() - timer.startAt);
    } else {
      displayMs = timer.elapsedBeforeStart;
    }
  } else {
    if (timer.running && timer.endAt != null) {
      displayMs = timer.endAt - now();
    } else if (timer.endAt != null) {
      displayMs = timer.endAt - now();
    } else {
      displayMs = timer.durationMs;
    }
  }
  if (displayMs < 0) displayMs = 0;

  wrapper.innerHTML = `
    <div class="row" style="justify-content: space-between;">
      <div class="item-title">${timer.label}</div>
      <span class="pill">${timer.mode === "countdown" ? "Countdown" : "Stopwatch"}</span>
    </div>
    <div class="time" style="font-size: 28px; margin: 4px 0 8px;">
      ${fmt(displayMs, { showMs: timer.mode === "stopwatch" })}
    </div>
    <div class="row">
      <input data-field="hours" class="timer-input" type="number" min="0" max="99" placeholder="H" value="${timer.inputHours ?? ""}" />
      <input data-field="minutes" class="timer-input" type="number" min="0" max="59" placeholder="M" value="${timer.inputMinutes ?? ""}" />
      <input data-field="seconds" class="timer-input" type="number" min="0" max="59" placeholder="S" value="${timer.inputSeconds ?? ""}" />
    </div>
    <div class="small" style="text-align:center; margin-top:6px;">Leave blank for stopwatch.</div>
    <div class="btn-row">
      <button data-action="start" class="primary">Start</button>
      <button data-action="pause">Pause</button>
      <button data-action="reset" class="danger">Reset</button>
      <button data-action="delete">Remove</button>
    </div>
  `;

  return wrapper;
}

function renderPomodoroItem(pomo) {
  const wrapper = document.createElement("div");
  wrapper.className = "item pomodoro-item";
  wrapper.dataset.id = pomo.id;

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
    <div class="row" style="justify-content: space-between;">
      <div class="item-title">${pomo.label}</div>
      <span class="pill">${pomo.phase === "break" ? "Break" : "Work"}</span>
    </div>
    <div class="time" style="font-size: 28px; margin: 4px 0 8px;">
      ${fmt(displayMs)}
    </div>
    <div class="row">
      <input data-field="work" class="pomodoro-input" type="number" min="1" max="999" placeholder="Work min" value="${workMin}" />
      <input data-field="break" class="pomodoro-input" type="number" min="1" max="999" placeholder="Break min" value="${breakMin}" />
    </div>
    <div class="row" style="margin-top: 6px; gap: 6px;">
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

async function render() {
  const st = await getState();

  if (tabTimer && tabPomodoro && timerSection && pomodoroSection) {
    const isPomodoro = st.activeTab === "pomodoro";
    tabTimer.classList.toggle("active", !isPomodoro);
    tabPomodoro.classList.toggle("active", isPomodoro);
    timerSection.classList.toggle("hidden", isPomodoro);
    pomodoroSection.classList.toggle("hidden", !isPomodoro);
  }

  if (timerListEl) {
    timerListEl.innerHTML = "";
    st.timers.forEach((timer) => timerListEl.appendChild(renderTimerItem(timer)));
  }

  if (pomodoroListEl) {
    pomodoroListEl.innerHTML = "";
    st.pomodoros.forEach((pomo) => pomodoroListEl.appendChild(renderPomodoroItem(pomo)));
  }

  if (anyRunning(st)) startUiTick();
  else stopUiTick();
}

async function addTimer() {
  const st = await getState();
  const label = `Timer ${st.timers.length + 1}`;
  const timers = [...st.timers, createTimer(label)];
  await setState({ timers });
  await render();
}

async function addPomodoro() {
  const st = await getState();
  const label = `Pomodoro ${st.pomodoros.length + 1}`;
  const pomodoros = [...st.pomodoros, createPomodoro(label)];
  await setState({ pomodoros });
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

async function startTimer(id) {
  const st = await getState();
  const timer = st.timers.find((t) => t.id === id);
  if (!timer || timer.running) return;

  const { hasInput, durationMs } = getCountdownInputMsFromTimer(timer);
  if (hasInput) {
    if (durationMs == null || durationMs <= 0) return;
    const endAt = now() + durationMs;
    await updateTimer(id, (t) => ({
      ...t,
      mode: "countdown",
      running: true,
      durationMs,
      endAt,
      startAt: null
    }));
    chrome.alarms.clear(`timerDone:${id}`, () => {
      chrome.alarms.create(`timerDone:${id}`, { when: endAt });
    });
  } else {
    const startAt = now();
    await updateTimer(id, (t) => ({
      ...t,
      mode: "stopwatch",
      running: true,
      startAt,
      endAt: null
    }));
    chrome.alarms.clear(`timerDone:${id}`);
  }

  await render();
}

async function pauseTimer(id) {
  const st = await getState();
  const timer = st.timers.find((t) => t.id === id);
  if (!timer || !timer.running) return;

  if (timer.mode === "stopwatch") {
    const elapsed =
      timer.elapsedBeforeStart + (timer.startAt != null ? now() - timer.startAt : 0);
    await updateTimer(id, (t) => ({
      ...t,
      running: false,
      startAt: null,
      elapsedBeforeStart: elapsed
    }));
  } else {
    const remaining = timer.endAt != null ? timer.endAt - now() : timer.durationMs;
    const clamped = Math.max(0, remaining);
    await updateTimer(id, (t) => ({
      ...t,
      running: false,
      endAt: null,
      durationMs: clamped
    }));
    chrome.alarms.clear(`timerDone:${id}`);
  }

  await render();
}

async function resetTimer(id) {
  const st = await getState();
  const timer = st.timers.find((t) => t.id === id);
  if (!timer) return;

  if (timer.mode === "countdown") {
    const input = getCountdownInputMsFromTimer(timer);
    let durationMs = 0;
    if (input.hasInput && input.durationMs != null) durationMs = input.durationMs;
    else durationMs = timer.durationMs || 0;
    await updateTimer(id, (t) => ({
      ...t,
      mode: "countdown",
      running: false,
      durationMs,
      endAt: null,
      startAt: null,
      elapsedBeforeStart: 0
    }));
  } else {
    await updateTimer(id, (t) => ({
      ...t,
      mode: "stopwatch",
      running: false,
      startAt: null,
      elapsedBeforeStart: 0,
      endAt: null,
      durationMs: 0
    }));
  }

  chrome.alarms.clear(`timerDone:${id}`);
  await render();
}

async function deleteTimer(id) {
  const st = await getState();
  const timers = st.timers.filter((t) => t.id !== id);
  await setState({ timers });
  chrome.alarms.clear(`timerDone:${id}`);
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
  await setState({ pomodoros });
  chrome.alarms.clear(`pomodoroPhase:${id}`);
  await render();
}

timerListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const item = btn.closest(".timer-item");
  if (!item) return;
  const id = item.dataset.id;
  if (btn.dataset.action === "start") await startTimer(id);
  if (btn.dataset.action === "pause") await pauseTimer(id);
  if (btn.dataset.action === "reset") await resetTimer(id);
  if (btn.dataset.action === "delete") await deleteTimer(id);
});

timerListEl.addEventListener("change", async (e) => {
  const input = e.target.closest(".timer-input");
  if (!input) return;
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
        next.mode = "countdown";
        next.durationMs = inputState.durationMs;
        next.endAt = null;
      } else if (!inputState.hasInput) {
        next.mode = "stopwatch";
        next.durationMs = 0;
        next.endAt = null;
      }
    }
    return next;
  });

  await render();
});

pomodoroListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const item = btn.closest(".pomodoro-item");
  if (!item) return;
  const id = item.dataset.id;
  if (btn.dataset.action === "start") await startPomodoro(id);
  if (btn.dataset.action === "pause") await pausePomodoro(id);
  if (btn.dataset.action === "reset") await resetPomodoro(id);
  if (btn.dataset.action === "delete") await deletePomodoro(id);
});

pomodoroListEl.addEventListener("change", async (e) => {
  const input = e.target.closest(".pomodoro-input");
  if (!input) return;
  const item = input.closest(".pomodoro-item");
  if (!item) return;
  const id = item.dataset.id;
  const field = input.dataset.field;

  await updatePomodoro(id, (p) => {
    const next = { ...p };
    if (field === "work") {
      const num = Number(input.value);
      if (Number.isFinite(num) && num > 0) next.workMs = Math.floor(num) * 60000;
    }
    if (field === "break") {
      const num = Number(input.value);
      if (Number.isFinite(num) && num > 0) next.breakMs = Math.floor(num) * 60000;
    }
    if (field === "recurring") {
      next.recurring = input.checked;
    }
    return next;
  });

  await render();
});

addTimerBtn.addEventListener("click", addTimer);
addPomodoroBtn.addEventListener("click", addPomodoro);

tabTimer.addEventListener("click", async () => {
  await setState({ activeTab: "timer" });
  await render();
});

tabPomodoro.addEventListener("click", async () => {
  await setState({ activeTab: "pomodoro" });
  await render();
});

async function cleanupExpired() {
  const st = await getState();
  let changed = false;

  const timers = st.timers.map((t) => {
    if (t.mode === "countdown" && t.running && t.endAt != null && t.endAt <= now()) {
      changed = true;
      return { ...t, running: false, endAt: null, durationMs: 0 };
    }
    if (t.running && t.mode === "countdown" && t.endAt != null) {
      chrome.alarms.create(`timerDone:${t.id}`, { when: t.endAt });
    }
    return t;
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
  const st = await getState();
  if (st.timers.length === 0) {
    await setState({ timers: [createTimer("Timer 1")] });
  }
  if (st.pomodoros.length === 0) {
    await setState({ pomodoros: [createPomodoro("Pomodoro 1")] });
  }
  await cleanupExpired();
  await render();
})();
