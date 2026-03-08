"""
Analyze recorded EEG trials to determine which study technique produced the
strongest learning signals for a given user.

Usage:
    python backend/analyze.py --user alice

Metrics computed per technique:
  - Theta power (4-8 Hz)  at frontal channels  → memory encoding
  - Gamma power (30-50 Hz) at frontal channels  → cognitive binding
  - Cross-channel coherence (frontal-parietal)  → network synchronization
  - Engagement index: beta / (alpha + theta)    → sustained attention

The technique with the highest composite learning score wins.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
from scipy.signal import welch, coherence

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Channel groupings by brain region
FRONTAL = ["F3", "F4"]
PARIETAL = ["P3", "P4"]
TEMPORAL = ["T3", "T4"]
CENTRAL = ["C3", "C4"]

# Frequency bands (Hz)
BANDS = {
    "delta": (1, 4),
    "theta": (4, 8),
    "alpha": (8, 13),
    "beta": (13, 30),
    "gamma": (30, 50),
}


def load_channel(trial_dir: Path, channel_name: str) -> tuple[np.ndarray, np.ndarray]:
    """Load a channel CSV and return (timestamps, values)."""
    csv_path = trial_dir / f"{channel_name}.csv"
    if not csv_path.exists():
        return np.array([]), np.array([])
    timestamps = []
    values = []
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            timestamps.append(float(row["timestamp"]))
            values.append(float(row["value"]))
    return np.array(timestamps), np.array(values)


def get_sample_rate(trial_dir: Path) -> float:
    meta_path = trial_dir / "meta.json"
    if meta_path.exists():
        with open(meta_path) as f:
            meta = json.load(f)
        sr = meta.get("sample_rate", 250)
        if sr > 0:
            return float(sr)
    return 250.0


def band_power(signal: np.ndarray, fs: float, band: tuple[float, float]) -> float:
    """Compute average power in a frequency band using Welch's method."""
    if len(signal) < 256:
        return 0.0
    nperseg = min(256, len(signal))
    freqs, psd = welch(signal, fs=fs, nperseg=nperseg)
    idx = np.where((freqs >= band[0]) & (freqs <= band[1]))[0]
    if len(idx) == 0:
        return 0.0
    return float(np.trapezoid(psd[idx], freqs[idx]))

def channel_coherence(sig1: np.ndarray, sig2: np.ndarray, fs: float,
                      band: tuple[float, float]) -> float:
    """Compute mean magnitude-squared coherence in a frequency band."""
    min_len = min(len(sig1), len(sig2))
    if min_len < 256:
        return 0.0
    sig1 = sig1[:min_len]
    sig2 = sig2[:min_len]
    nperseg = min(256, min_len)
    freqs, coh = coherence(sig1, sig2, fs=fs, nperseg=nperseg)
    idx = np.where((freqs >= band[0]) & (freqs <= band[1]))[0]
    if len(idx) == 0:
        return 0.0
    return float(np.mean(coh[idx]))


def analyze_trial(trial_dir: Path) -> dict:
    """Compute all learning metrics for a single trial."""
    fs = get_sample_rate(trial_dir)
    results = {}

    # Load all available channels
    channels: dict[str, np.ndarray] = {}
    for group in [FRONTAL, PARIETAL, TEMPORAL, CENTRAL]:
        for ch in group:
            _, vals = load_channel(trial_dir, ch)
            if len(vals) > 0:
                channels[ch] = vals

    # Band powers per region
    for band_name, band_range in BANDS.items():
        for region_name, region_chs in [("frontal", FRONTAL), ("parietal", PARIETAL),
                                         ("temporal", TEMPORAL), ("central", CENTRAL)]:
            powers = []
            for ch in region_chs:
                if ch in channels:
                    powers.append(band_power(channels[ch], fs, band_range))
            if powers:
                results[f"{band_name}_{region_name}"] = float(np.mean(powers))

    # Frontal theta (key learning marker)
    results["frontal_theta"] = results.get("theta_frontal", 0.0)
    # Frontal gamma (cognitive binding)
    results["frontal_gamma"] = results.get("gamma_frontal", 0.0)

    # Engagement index: beta / (alpha + theta) averaged across frontal
    alpha_f = results.get("alpha_frontal", 0.0)
    theta_f = results.get("theta_frontal", 0.0)
    beta_f = results.get("beta_frontal", 0.0)
    denom = alpha_f + theta_f
    results["engagement_index"] = beta_f / denom if denom > 0 else 0.0

    # Cross-region coherence (frontal-parietal in theta band = long-range memory network)
    coh_pairs = []
    for f_ch in FRONTAL:
        for p_ch in PARIETAL:
            if f_ch in channels and p_ch in channels:
                coh_pairs.append(
                    channel_coherence(channels[f_ch], channels[p_ch], fs, BANDS["theta"])
                )
    results["frontal_parietal_theta_coherence"] = float(np.mean(coh_pairs)) if coh_pairs else 0.0

    # Frontal-temporal coherence (memory encoding network)
    coh_ft = []
    for f_ch in FRONTAL:
        for t_ch in TEMPORAL:
            if f_ch in channels and t_ch in channels:
                coh_ft.append(
                    channel_coherence(channels[f_ch], channels[t_ch], fs, BANDS["theta"])
                )
    results["frontal_temporal_theta_coherence"] = float(np.mean(coh_ft)) if coh_ft else 0.0

    return results


def composite_learning_score(metrics: dict, baseline: dict | None = None) -> float:
    """
    Compute a composite learning score from the metrics.
    If baseline is provided, scores are computed relative to baseline.

    Weights reflect neuroscience literature on EEG learning markers:
      - Frontal theta: strongest correlate of memory encoding
      - Frontal-parietal coherence: long-range network integration
      - Engagement index: sustained attention
      - Frontal gamma: active cognitive binding
      - Frontal-temporal coherence: memory circuit activation
    """
    weights = {
        "frontal_theta": 0.30,
        "frontal_parietal_theta_coherence": 0.25,
        "engagement_index": 0.20,
        "frontal_gamma": 0.15,
        "frontal_temporal_theta_coherence": 0.10,
    }

    score = 0.0
    for key, weight in weights.items():
        val = metrics.get(key, 0.0)
        base = baseline.get(key, 0.0) if baseline else 0.0
        # Use relative increase over baseline if available
        if baseline and base > 0:
            relative = (val - base) / base
            score += weight * relative
        else:
            score += weight * val

    return score


def analyze_user(user: str):
    user_dir = DATA_DIR / user
    if not user_dir.exists():
        print(f"No data found for user '{user}' at {user_dir}")
        sys.exit(1)

    # List available trials
    trials = sorted([d.name for d in user_dir.iterdir() if d.is_dir()])
    print(f"\nAnalyzing user: {user}")
    print(f"Found trials: {', '.join(trials)}")

    # Analyze baseline if available
    baseline_metrics = None
    if "baseline" in trials:
        print(f"\nAnalyzing baseline...")
        baseline_metrics = analyze_trial(user_dir / "baseline")
        trials = [t for t in trials if t != "baseline"]

    # Analyze each technique
    technique_results = {}
    for technique in trials:
        trial_dir = user_dir / technique
        print(f"\nAnalyzing: {technique}")
        metrics = analyze_trial(trial_dir)
        score = composite_learning_score(metrics, baseline_metrics)
        technique_results[technique] = {
            "metrics": metrics,
            "composite_score": score,
        }

        # Print key metrics
        print(f"  Frontal theta power:          {metrics.get('frontal_theta', 0):.4f}")
        print(f"  Frontal gamma power:          {metrics.get('frontal_gamma', 0):.6f}")
        print(f"  Engagement index:             {metrics.get('engagement_index', 0):.4f}")
        print(f"  F-P theta coherence:          {metrics.get('frontal_parietal_theta_coherence', 0):.4f}")
        print(f"  F-T theta coherence:          {metrics.get('frontal_temporal_theta_coherence', 0):.4f}")
        print(f"  >>> Composite learning score: {score:.4f}")

    # Rank techniques
    if technique_results:
        ranked = sorted(technique_results.items(), key=lambda x: x[1]["composite_score"], reverse=True)

        print(f"\n{'='*60}")
        print(f"  RESULTS FOR {user.upper()}")
        print(f"{'='*60}")
        for i, (tech, result) in enumerate(ranked):
            marker = " <-- BEST" if i == 0 else ""
            print(f"  {i+1}. {tech:25s}  score: {result['composite_score']:.4f}{marker}")
        print(f"{'='*60}")
        print(f"\n  Your brain learns most effectively with: {ranked[0][0].upper().replace('_', ' ')}")
        print()

        # Save results
        results_path = user_dir / "results.json"
        output = {
            "user": user,
            "ranking": [{"technique": t, **r} for t, r in ranked],
            "best_technique": ranked[0][0],
            "baseline_metrics": baseline_metrics,
        }
        with open(results_path, "w") as f:
            json.dump(output, f, indent=2, default=str)
        print(f"  Full results saved to: {results_path}")


def main():
    parser = argparse.ArgumentParser(description="Analyze EEG study technique trials")
    parser.add_argument("--user", type=str, required=True, help="User name to analyze")
    args = parser.parse_args()
    analyze_user(args.user)


if __name__ == "__main__":
    main()
