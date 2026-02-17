# TickUp

Chrome extension with countdown timers, pomodoros, and stopwatches.

## Features

- Timer tab with:
- Multiple simple countdown timers
- Multiple pomodoro timers
- Mixed ordering (move timers and pomodoros up/down together)
- Custom sound upload, preview, stop, and volume control
- Stopwatch tab with:
- Multiple stopwatches
- Start/Stop toggle
- Lap tracking
- Rename and reorder support

## Install (Load Unpacked in Chrome)

1. Download this project as ZIP and unzip it.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on `Developer mode` (top-right).
4. Click `Load unpacked`.
5. Select the folder that contains `manifest.json`.

## How To Use

### Timer Tab

1. Click `Add Timer` to create a simple timer.
2. Enter `H`, `M`, and/or `S`.
3. Click `Start`.
4. Use `Pause`, `Reset`, or `Remove` as needed.
5. Rename a timer by editing its title field.
6. Use `↑` / `↓` to reorder it.

### Pomodoro (inside Timer Tab)

1. Click `Add Pomodoro`.
2. Set `Session min` and `Break min`.
3. Optional: enable `Recurring cycles`.
4. Click `Start`.
5. Rename by editing the pomodoro title.
6. Use `↑` / `↓` to move it above/below simple timers.

### Ringtone

1. In `Ringtone`, choose an audio file.
2. Click `Preview` to test.
3. Set volume with slider or number input.
4. Click `Save Sound` to keep file + volume.
5. Click `Stop Sound` to stop playback.

### Stopwatch Tab

1. Click `Add Stopwatch`.
2. Click `Start` to run.
3. Click `Lap` to save lap times.
4. Click `Stop` to pause.
5. Click `Reset` to clear elapsed time and laps.
6. Rename and reorder with title field and `↑` / `↓`.

## Notes

- Timer-complete and pomodoro notifications use your saved ringtone and volume.
- Data is stored locally in Chrome storage (and IndexedDB for custom audio blob).
