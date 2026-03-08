"""
EEG Trial Recorder — records data while the user learns via different study techniques.

Usage (from terminal while server.py is running):
    python backend/recorder.py --user alice --duration 180

This walks through all 5 study techniques, records EEG for each, and saves
per-channel CSVs into  data/{user}/{technique}/.
"""

import argparse
import asyncio
import csv
import json
import os
import time
from pathlib import Path

import websockets

TECHNIQUES = [
    "active_recall",
    "feynman",
    "writing_notes",
    "music_vs_no_music",
]

TECHNIQUE_DESCRIPTIONS = {
    "active_recall": "Active Recall — Test yourself on the material without looking at notes",
    "feynman": "Feynman Technique — Explain the concept out loud as if teaching someone",
    "writing_notes": "Writing Notes — Write down key points and summaries by hand",
    "music_vs_no_music": "Music vs No Music — Learn with background music playing",
}

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


async def record_trial(user: str, technique: str, duration: int, ws_url: str):
    """Connect to the running server's WebSocket and record EEG for one trial."""
    trial_dir = DATA_DIR / user / technique
    trial_dir.mkdir(parents=True, exist_ok=True)

    # Figure out which trial number this is (for display)
    if technique in TECHNIQUES:
        trial_num = TECHNIQUES.index(technique) + 1
        total = len(TECHNIQUES)
        header = f"  TRIAL {trial_num}/{total}: {TECHNIQUE_DESCRIPTIONS[technique]}"
    else:
        header = f"  {TECHNIQUE_DESCRIPTIONS.get(technique, technique.upper())}"

    print(f"\n{'='*60}")
    print(header)
    print(f"  Duration:  {duration} seconds ({duration // 60}m {duration % 60}s)")
    print(f"  Saving to: {trial_dir}")
    if technique in TECHNIQUES:
        remaining_techniques = TECHNIQUES[TECHNIQUES.index(technique) + 1:]
        if remaining_techniques:
            upcoming = ", ".join(TECHNIQUE_DESCRIPTIONS[t].split(" — ")[0] for t in remaining_techniques)
            print(f"  Up next:   {upcoming}")
        else:
            print(f"  This is the LAST technique!")
    print(f"{'='*60}")
    input("  Press ENTER when the subject is ready to begin...")

    # Accumulate samples per channel: { channel_name: [(timestamp, value), ...] }
    channel_data: dict[str, list[tuple[float, float]]] = {}
    sample_rate_seen = 0

    start_time = time.time()

    async with websockets.connect(ws_url) as ws:
        print(f"  Recording... ({duration}s)")
        while time.time() - start_time < duration:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
            except asyncio.TimeoutError:
                continue

            msg = json.loads(raw)
            if msg.get("type") != "eeg":
                continue

            sample_rate_seen = msg.get("sample_rate", sample_rate_seen)
            channel_names = msg.get("channel_names", [])
            channels = msg.get("channels", [])
            timestamps = msg.get("timestamps", [])

            elapsed = time.time() - start_time
            remaining = max(0, duration - int(elapsed))
            print(f"\r  Recording... {remaining}s remaining  ", end="", flush=True)

            for i, name in enumerate(channel_names):
                if i >= len(channels):
                    break
                if name not in channel_data:
                    channel_data[name] = []
                samples = channels[i]
                # Pair each sample with a timestamp (interpolate if counts differ)
                for j, val in enumerate(samples):
                    if j < len(timestamps):
                        ts = timestamps[j]
                    else:
                        ts = timestamps[-1] if timestamps else time.time()
                    channel_data[name].append((ts, val))

    print(f"\n  Done! Recorded {len(channel_data)} channels.")

    # Save one CSV per channel
    for ch_name, rows in channel_data.items():
        csv_path = trial_dir / f"{ch_name}.csv"
        with open(csv_path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["timestamp", "value"])
            writer.writerows(rows)
        print(f"    Saved {csv_path.name} ({len(rows)} samples)")

    # Save metadata
    meta_path = trial_dir / "meta.json"
    meta = {
        "user": user,
        "technique": technique,
        "duration_seconds": duration,
        "sample_rate": sample_rate_seen,
        "channels_recorded": list(channel_data.keys()),
        "total_samples_per_channel": {k: len(v) for k, v in channel_data.items()},
        "recorded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"    Saved meta.json")


async def run_all_trials(user: str, duration: int, ws_url: str):
    total_time = 30 + len(TECHNIQUES) * duration
    print(f"\n{'='*60}")
    print(f"  NeuralTrace Study Session")
    print(f"{'='*60}")
    print(f"  Subject:       {user}")
    print(f"  Techniques:    {len(TECHNIQUES)}")
    for i, t in enumerate(TECHNIQUES, 1):
        print(f"    {i}. {TECHNIQUE_DESCRIPTIONS[t]}")
    print(f"  Duration each: {duration}s ({duration // 60}m {duration % 60}s)")
    print(f"  Total time:    ~{total_time // 60}m {total_time % 60}s (incl. 30s baseline)")
    print(f"  Data dir:      {DATA_DIR / user}")
    print(f"{'='*60}")

    # Baseline recording
    print(f"\n{'='*60}")
    print(f"  BASELINE — Resting state (eyes open, relaxed)")
    print(f"  Duration: 30 seconds")
    print(f"{'='*60}")
    input("  Press ENTER to record baseline...")

    await record_trial(user, "baseline", 30, ws_url)

    for technique in TECHNIQUES:
        await record_trial(user, technique, duration, ws_url)

    print(f"\n{'='*60}")
    print(f"  ALL {len(TECHNIQUES)} TRIALS COMPLETE for {user}")
    print(f"  Data saved to: {DATA_DIR / user}")
    print(f"  Run analysis:  python backend/analyze.py --user {user}")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="Record EEG data for study technique trials")
    parser.add_argument("--user", type=str, required=True, help="Subject/user name")
    parser.add_argument("--duration", type=int, default=90,
                        help="Duration per technique in seconds (default: 90s)")
    parser.add_argument("--ws-url", type=str, default="ws://127.0.0.1:8000/ws",
                        help="WebSocket URL of the running server")
    args = parser.parse_args()

    asyncio.run(run_all_trials(args.user, args.duration, args.ws_url))


if __name__ == "__main__":
    main()
