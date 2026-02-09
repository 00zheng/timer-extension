// background.js

async function ensureOffscreen() {
  try {
    // If supported, avoid recreating
    if (chrome.offscreen?.hasDocument) {
      const has = await chrome.offscreen.hasDocument();
      if (has) return;
    }

    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play a sound when the timer ends"
    });
  } catch (e) {
    // Ignore "already exists" errors
    const msg = String(e?.message || e).toLowerCase();
    if (!msg.includes("only one offscreen document")) {
      console.warn("ensureOffscreen failed:", e);
    }
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "timerDone") {
    const st = await chrome.storage.local.get(["timers"]);
    const timers = Array.isArray(st.timers) ? st.timers : [];
    const first = timers[0];
    if (first) {
      const nextTimers = timers.map((t, i) =>
        i === 0 ? { ...t, running: false, mode: "countdown", endAt: null, durationMs: 0 } : t
      );
      await chrome.storage.local.set({ timers: nextTimers });
    }
    await ensureOffscreen();
    chrome.runtime.sendMessage({ type: "PLAY_SOUND" });
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon16.png"),
      title: "Timer",
      message: "Time's up!"
    });
    return;
  }

  if (alarm.name === "pomodoroPhase") {
    const st = await chrome.storage.local.get(["pomodoros"]);
    const pomodoros = Array.isArray(st.pomodoros) ? st.pomodoros : [];
    const target = pomodoros[0];
    if (!target) return;
    const currentPhase = target.phase === "break" ? "break" : "work";
    let nextPomodoros;

    if (target.recurring) {
      const nextPhase = currentPhase === "work" ? "break" : "work";
      const duration = nextPhase === "break" ? target.breakMs : target.workMs;
      const endAt = Date.now() + duration;
      nextPomodoros = pomodoros.map((p, i) =>
        i === 0 ? { ...p, running: true, phase: nextPhase, endAt, remainingMs: 0 } : p
      );
      chrome.alarms.create("pomodoroPhase", { when: endAt });
    } else {
      nextPomodoros = pomodoros.map((p, i) =>
        i === 0 ? { ...p, running: false, phase: "work", endAt: null, remainingMs: 0 } : p
      );
    }
    await chrome.storage.local.set({ pomodoros: nextPomodoros });
    await ensureOffscreen();
    chrome.runtime.sendMessage({ type: "PLAY_SOUND" });
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon16.png"),
      title: "Pomodoro",
      message: currentPhase === "work" ? "Work session done" : "Break over"
    });
    return;
  }

  if (alarm.name.startsWith("timerDone:")) {
    const id = alarm.name.split(":")[1];
    const st = await chrome.storage.local.get(["timers"]);
    const timers = Array.isArray(st.timers) ? st.timers : [];
    const nextTimers = timers.map((t) => {
      if (t.id !== id) return t;
      return {
        ...t,
        running: false,
        mode: "countdown",
        endAt: null,
        durationMs: 0
      };
    });

    await chrome.storage.local.set({ timers: nextTimers });
    await ensureOffscreen();
    chrome.runtime.sendMessage({ type: "PLAY_SOUND" });

    const label = timers.find((t) => t.id === id)?.label || "Timer";
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon16.png"),
      title: "Timer",
      message: `${label} done`
    });
    return;
  }

  if (alarm.name.startsWith("pomodoroPhase:")) {
    const id = alarm.name.split(":")[1];
    const st = await chrome.storage.local.get(["pomodoros"]);
    const pomodoros = Array.isArray(st.pomodoros) ? st.pomodoros : [];
    const target = pomodoros.find((p) => p.id === id);
    if (!target) return;

    const currentPhase = target.phase === "break" ? "break" : "work";
    let nextPomodoros;

    if (target.recurring) {
      const nextPhase = currentPhase === "work" ? "break" : "work";
      const duration = nextPhase === "break" ? target.breakMs : target.workMs;
      const endAt = Date.now() + duration;

      nextPomodoros = pomodoros.map((p) =>
        p.id === id
          ? { ...p, running: true, phase: nextPhase, endAt, remainingMs: 0 }
          : p
      );
      chrome.alarms.create(`pomodoroPhase:${id}`, { when: endAt });
    } else {
      nextPomodoros = pomodoros.map((p) =>
        p.id === id ? { ...p, running: false, phase: "work", endAt: null, remainingMs: 0 } : p
      );
    }

    await chrome.storage.local.set({ pomodoros: nextPomodoros });
    await ensureOffscreen();
    chrome.runtime.sendMessage({ type: "PLAY_SOUND" });

    const label = target.label || "Pomodoro";
    const message = currentPhase === "work" ? "Work session done" : "Break over";
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon16.png"),
      title: label,
      message
    });
  }
});
