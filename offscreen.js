const DB_NAME = "timerDB";
const DB_STORE = "audio";
const DB_KEY = "alarmSound";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let currentObjectUrl = null;

function getAudio() {
  const audio = document.getElementById("player");
  if (!audio) {
    console.warn("Audio element not found in offscreen document.");
    return null;
  }
  return audio;
}

async function setSourceAndPlay(src, { revokeObjectUrl = false } = {}) {
  const audio = getAudio();
  if (!audio) return;

  if (revokeObjectUrl && currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  try {
    audio.pause();
  } catch {
    // ignore
  }

  const { alarmVolume } = await chrome.storage.local.get(["alarmVolume"]);
  if (Number.isFinite(alarmVolume)) {
    audio.volume = Math.min(1, Math.max(0, alarmVolume));
  } else {
    audio.volume = 0.8;
  }

  audio.src = src;
  audio.currentTime = 0;
  audio.load();
  await audio.play();
}

async function playBlob(blob) {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(blob);
  await setSourceAndPlay(currentObjectUrl);
}

async function playDefault() {
  const url = chrome.runtime.getURL("ding.mp3");
  await setSourceAndPlay(url, { revokeObjectUrl: true });
}

async function playSavedSound() {
  try {
    const record = await idbGet(DB_KEY);
    if (record?.blob) {
      await playBlob(record.blob);
    } else {
      console.warn("No saved sound found. Playing default ding.");
      await playDefault();
    }
  } catch (e) {
    console.warn("Audio play blocked or failed:", e);
  }
}


chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "PLAY_SOUND") {
    console.log("Offscreen received PLAY_SOUND");
    playSavedSound();
    return;
  }
  if (msg?.type === "STOP_SOUND") {
    const audio = getAudio();
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
    } catch (e) {
      console.warn("Stop sound failed:", e);
    }
  }
});
