/**
 * EEG learning-technique analysis — pure TypeScript port of backend/analyze.py.
 *
 * Metrics per recording:
 *   - Band powers (delta/theta/alpha/beta/gamma) per region
 *   - Engagement index: beta / (alpha + theta) at frontal channels
 *   - Frontal-parietal theta coherence  (long-range memory network)
 *   - Frontal-temporal theta coherence  (memory encoding circuit)
 *
 * Power spectra use Welch's method (Hann window, 50% overlap, nperseg=256).
 * Coherence uses magnitude-squared coherence averaged over the band.
 *
 * Optimisation: PSD is computed once per channel, then all band powers are
 * extracted from the same result — avoiding the previous 5× redundant recompute.
 */

import type { Recording } from './api';

// ─── Channel groupings ────────────────────────────────────────────────────────

const FRONTAL  = ['F3', 'F4'] as const;
const PARIETAL = ['P3', 'P4'] as const;
const TEMPORAL = ['T3', 'T4'] as const;
const CENTRAL  = ['C3', 'C4'] as const;

const ALL_REGIONS = [
  ['frontal',  FRONTAL],
  ['parietal', PARIETAL],
  ['temporal', TEMPORAL],
  ['central',  CENTRAL],
] as const;

// ─── Frequency bands (Hz) ─────────────────────────────────────────────────────

const BANDS: Record<string, [number, number]> = {
  delta: [1,  4],
  theta: [4,  8],
  alpha: [8, 13],
  beta:  [13, 30],
  gamma: [30, 50],
};

// ─── Composite score weights ──────────────────────────────────────────────────

const WEIGHTS: Record<string, number> = {
  frontal_theta:                     0.30,
  frontal_parietal_theta_coherence:  0.25,
  engagement_index:                  0.20,
  frontal_gamma:                     0.15,
  frontal_temporal_theta_coherence:  0.10,
};

const FS = 250; // expected sample rate (Hz)

// ─── FFT (Cooley-Tukey radix-2 DIT, in-place) ────────────────────────────────

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let twRe = 1, twIm = 0;
      for (let j = 0; j < half; j++) {
        const u = i + j, v = i + j + half;
        const tRe = twRe * re[v] - twIm * im[v];
        const tIm = twRe * im[v] + twIm * re[v];
        re[v] = re[u] - tRe; im[v] = im[u] - tIm;
        re[u] += tRe;        im[u] += tIm;
        const nr = twRe * wRe - twIm * wIm;
        twIm = twRe * wIm + twIm * wRe;
        twRe = nr;
      }
    }
  }
}

function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  const c = 2 * Math.PI / (n - 1);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(c * i));
  return w;
}

// ─── Welch PSD ────────────────────────────────────────────────────────────────

interface PSD { freqs: Float64Array; psd: Float64Array }

// Pre-allocated Hann window (reused across calls)
const _win256 = hannWindow(256);
const _win256SumSq = _win256.reduce((s, w) => s + w * w, 0);

function welchPSD(signal: ArrayLike<number>, fs: number, nperseg: number): PSD {
  const n = signal.length;
  const step = nperseg >> 1; // 50% overlap
  const nfft = nextPow2(nperseg);
  // Reuse pre-allocated window for the common nperseg=256 case
  const win    = (nperseg === 256) ? _win256 : hannWindow(nperseg);
  const winSq  = (nperseg === 256) ? _win256SumSq : win.reduce((s, w) => s + w * w, 0);
  const scale  = 1 / (fs * winSq);
  const nBins  = (nfft >> 1) + 1;
  const acc    = new Float64Array(nBins);
  const re     = new Float64Array(nfft);
  const im     = new Float64Array(nfft);
  let nSegs = 0;

  for (let start = 0; start + nperseg <= n; start += step) {
    // Detrend (remove mean) + apply window, then zero-pad
    let mean = 0;
    for (let i = 0; i < nperseg; i++) mean += signal[start + i];
    mean /= nperseg;
    re.fill(0); im.fill(0);
    for (let i = 0; i < nperseg; i++) re[i] = (signal[start + i] - mean) * win[i];
    fft(re, im);
    for (let k = 0; k < nBins; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    nSegs++;
  }

  const freqs = new Float64Array(nBins);
  const psd   = new Float64Array(nBins);
  if (nSegs > 0) {
    const nyq = nfft >> 1;
    for (let k = 0; k < nBins; k++) {
      freqs[k] = k * fs / nfft;
      const factor = (k === 0 || k === nyq) ? 1 : 2;
      psd[k] = (acc[k] / nSegs) * scale * factor;
    }
  }
  return { freqs, psd };
}

// ─── Welch magnitude-squared coherence ───────────────────────────────────────

function welchCoherence(
  sig1: ArrayLike<number>, sig2: ArrayLike<number>, fs: number, nperseg: number,
): { freqs: Float64Array; coh: Float64Array } {
  const n    = Math.min(sig1.length, sig2.length);
  const step = nperseg >> 1;
  const nfft = nextPow2(nperseg);
  const win  = (nperseg === 256) ? _win256 : hannWindow(nperseg);
  const nBins = (nfft >> 1) + 1;

  const csdRe = new Float64Array(nBins);
  const csdIm = new Float64Array(nBins);
  const pxx   = new Float64Array(nBins);
  const pyy   = new Float64Array(nBins);
  // Reuse buffers across segments
  const re1 = new Float64Array(nfft), im1 = new Float64Array(nfft);
  const re2 = new Float64Array(nfft), im2 = new Float64Array(nfft);
  let nSegs = 0;

  for (let start = 0; start + nperseg <= n; start += step) {
    let m1 = 0, m2 = 0;
    for (let i = 0; i < nperseg; i++) { m1 += sig1[start + i]; m2 += sig2[start + i]; }
    m1 /= nperseg; m2 /= nperseg;
    re1.fill(0); im1.fill(0); re2.fill(0); im2.fill(0);
    for (let i = 0; i < nperseg; i++) {
      re1[i] = (sig1[start + i] - m1) * win[i];
      re2[i] = (sig2[start + i] - m2) * win[i];
    }
    fft(re1, im1);
    fft(re2, im2);
    for (let k = 0; k < nBins; k++) {
      csdRe[k] += re1[k] * re2[k] + im1[k] * im2[k];
      csdIm[k] += re1[k] * im2[k] - im1[k] * re2[k];
      pxx[k]   += re1[k] * re1[k] + im1[k] * im1[k];
      pyy[k]   += re2[k] * re2[k] + im2[k] * im2[k];
    }
    nSegs++;
  }

  const freqs = new Float64Array(nBins);
  const coh   = new Float64Array(nBins);
  if (nSegs > 0) {
    for (let k = 0; k < nBins; k++) {
      freqs[k] = k * fs / nfft;
      const denom = (pxx[k] / nSegs) * (pyy[k] / nSegs);
      if (denom > 0) {
        const crRe = csdRe[k] / nSegs, crIm = csdIm[k] / nSegs;
        coh[k] = Math.min((crRe * crRe + crIm * crIm) / denom, 1);
      }
    }
  }
  return { freqs, coh };
}

// ─── Band-limited metrics (operate on pre-computed PSD) ──────────────────────

/** Trapezoidal integration of a pre-computed PSD over a frequency band. */
function bandPowerFromPSD({ freqs, psd }: PSD, band: [number, number]): number {
  let power = 0;
  for (let k = 0; k < freqs.length - 1; k++) {
    if (freqs[k] >= band[0] && freqs[k + 1] <= band[1]) {
      power += 0.5 * (psd[k] + psd[k + 1]) * (freqs[k + 1] - freqs[k]);
    }
  }
  return power;
}

function meanCoherence(
  sig1: ArrayLike<number>, sig2: ArrayLike<number>, fs: number, band: [number, number],
): number {
  const minLen = Math.min(sig1.length, sig2.length);
  if (minLen < 256) return 0;
  const { freqs, coh } = welchCoherence(sig1, sig2, fs, Math.min(256, minLen));
  let sum = 0, count = 0;
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k] >= band[0] && freqs[k] <= band[1]) { sum += coh[k]; count++; }
  }
  return count > 0 ? sum / count : 0;
}

// ─── Trial analysis ───────────────────────────────────────────────────────────

export type TrialMetrics = Record<string, number>;

function extractValues(rec: Recording, channel: string): Float64Array {
  const rows = rec.channels.get(channel);
  if (!rows || rows.length === 0) return new Float64Array(0);
  const out = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) out[i] = rows[i][1];
  return out;
}

function analyzeRecording(rec: Recording): TrialMetrics {
  const metrics: TrialMetrics = {};

  // Load available channels
  const chData: Record<string, Float64Array> = {};
  for (const group of [FRONTAL, PARIETAL, TEMPORAL, CENTRAL]) {
    for (const ch of group) {
      const v = extractValues(rec, ch);
      if (v.length > 0) chData[ch] = v;
    }
  }

  // Compute PSD once per channel (key optimisation: was recomputed 5× per channel before)
  const psds: Record<string, PSD> = {};
  for (const ch of Object.keys(chData)) {
    const nperseg = Math.min(256, chData[ch].length);
    psds[ch] = chData[ch].length >= 256
      ? welchPSD(chData[ch], FS, nperseg)
      : { freqs: new Float64Array(0), psd: new Float64Array(0) };
  }

  // Band powers per region — extracted from pre-computed PSDs
  for (const [bandName, bandRange] of Object.entries(BANDS)) {
    for (const [regionName, regionChs] of ALL_REGIONS) {
      const powers = (regionChs as readonly string[])
        .filter(ch => psds[ch])
        .map(ch => bandPowerFromPSD(psds[ch], bandRange));
      if (powers.length > 0) {
        metrics[`${bandName}_${regionName}`] = powers.reduce((a, b) => a + b) / powers.length;
      }
    }
  }

  // Convenience aliases matching composite score keys
  metrics['frontal_theta'] = metrics['theta_frontal'] ?? 0;
  metrics['frontal_gamma'] = metrics['gamma_frontal'] ?? 0;

  // Engagement index: beta / (alpha + theta) at frontal
  const denom = (metrics['alpha_frontal'] ?? 0) + (metrics['theta_frontal'] ?? 0);
  metrics['engagement_index'] = denom > 0 ? (metrics['beta_frontal'] ?? 0) / denom : 0;

  // Frontal-parietal theta coherence
  const fpCoh: number[] = [];
  for (const fCh of FRONTAL) for (const pCh of PARIETAL) {
    if (chData[fCh] && chData[pCh])
      fpCoh.push(meanCoherence(chData[fCh], chData[pCh], FS, BANDS['theta']));
  }
  metrics['frontal_parietal_theta_coherence'] =
    fpCoh.length > 0 ? fpCoh.reduce((a, b) => a + b) / fpCoh.length : 0;

  // Frontal-temporal theta coherence
  const ftCoh: number[] = [];
  for (const fCh of FRONTAL) for (const tCh of TEMPORAL) {
    if (chData[fCh] && chData[tCh])
      ftCoh.push(meanCoherence(chData[fCh], chData[tCh], FS, BANDS['theta']));
  }
  metrics['frontal_temporal_theta_coherence'] =
    ftCoh.length > 0 ? ftCoh.reduce((a, b) => a + b) / ftCoh.length : 0;

  return metrics;
}

function compositeLearningScore(metrics: TrialMetrics, baseline: TrialMetrics | null): number {
  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const val  = metrics[key] ?? 0;
    const base = baseline?.[key] ?? 0;
    score += (baseline && base > 0)
      ? weight * (val - base) / base
      : weight * val;
  }
  return score;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TechniqueResult {
  technique: string;
  composite_score: number;
  metrics: TrialMetrics;
}

export interface AnalysisResult {
  user: string;
  ranking: TechniqueResult[];
  best_technique: string;
  baseline_metrics: TrialMetrics | null;
}

/**
 * Analyze all recordings for a user and return a ranked list of techniques.
 * Intended to run inside a Web Worker — see analyze.worker.ts.
 */
export function analyzeUser(recordings: Recording[]): AnalysisResult {
  if (recordings.length === 0) throw new Error('No recordings to analyze');
  const user = recordings[0].user;

  const baselineRec     = recordings.find(r => r.technique === 'baseline');
  const baselineMetrics = baselineRec ? analyzeRecording(baselineRec) : null;

  const ranking: TechniqueResult[] = recordings
    .filter(r => r.technique !== 'baseline')
    .map(rec => {
      const metrics = analyzeRecording(rec);
      return {
        technique: rec.technique,
        composite_score: compositeLearningScore(metrics, baselineMetrics),
        metrics,
      };
    })
    .sort((a, b) => b.composite_score - a.composite_score);

  return {
    user,
    ranking,
    best_technique: ranking[0]?.technique ?? '',
    baseline_metrics: baselineMetrics,
  };
}
