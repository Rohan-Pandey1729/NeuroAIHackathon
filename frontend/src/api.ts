/**
 * In-browser recording — replaces the Python backend API.
 * Buffers EEG samples in memory during recording and downloads CSVs on stop.
 */

import { onEegData } from './socket.ts';
import type { EegMessage } from './socket.ts';

export interface RecordStatus {
  recording: boolean;
  technique: string;
  elapsed: number;
  duration: number;
  user: string;
}

export interface AnalysisResult {
  user: string;
  ranking: {
    technique: string;
    composite_score: number;
    metrics: Record<string, number>;
  }[];
  best_technique: string;
  baseline_metrics: Record<string, number> | null;
}

// Recording state
let _recording = false;
let _user = '';
let _technique = '';
let _startTime = 0;
let _duration = 0;
// channel name → [[timestamp, value], ...]
const _buffers = new Map<string, [number, number][]>();

// Persistent listener that buffers samples while recording is active
onEegData((msg: EegMessage) => {
  if (!_recording) return;
  const now = Date.now() / 1000;
  for (let ch = 0; ch < msg.channel_names.length; ch++) {
    const name = msg.channel_names[ch];
    if (!_buffers.has(name)) _buffers.set(name, []);
    const buf = _buffers.get(name)!;
    const samples = msg.channels[ch];
    for (let i = 0; i < samples.length; i++) {
      buf.push([msg.timestamps[i] ?? (now + i / msg.sample_rate), samples[i]]);
    }
  }
});

export async function startRecording(user: string, technique: string, duration: number): Promise<void> {
  _user = user;
  _technique = technique;
  _duration = duration;
  _startTime = Date.now() / 1000;
  _buffers.clear();
  _recording = true;
}

export async function stopRecording(): Promise<void> {
  _recording = false;
  for (const [channelName, rows] of _buffers) {
    if (rows.length > 0) {
      _downloadCSV(`${_user}_${_technique}_${channelName}.csv`, rows);
    }
  }
  _buffers.clear();
}

export async function getRecordStatus(): Promise<RecordStatus> {
  const elapsed = _recording ? Date.now() / 1000 - _startTime : 0;
  return { recording: _recording, technique: _technique, elapsed, duration: _duration, user: _user };
}

export async function runAnalysis(user: string): Promise<AnalysisResult> {
  throw new Error(
    'Analysis requires the Python backend. Download your CSVs and run:\n' +
    `  python backend/analyze.py --user ${user}`,
  );
}

export async function listUsers(): Promise<string[]> {
  throw new Error('User listing requires the Python backend.');
}

function _downloadCSV(filename: string, rows: [number, number][]): void {
  const csv = 'timestamp,value\n' + rows.map(([t, v]) => `${t},${v}`).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
