/**
 * In-browser recording — buffers EEG samples in RAM for in-browser processing.
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

/** A completed EEG recording stored in memory. */
export interface Recording {
  user: string;
  technique: string;
  startTime: number; // Unix seconds
  duration: number;  // seconds
  /** channel name → [timestamp, value µV][] */
  channels: Map<string, [number, number][]>;
}

// Recording state
let _recording = false;
let _user = '';
let _technique = '';
let _startTime = 0;
let _duration = 0;
// channel name → [[timestamp, value], ...] (active buffer)
const _buffers = new Map<string, [number, number][]>();

// Completed recordings kept in RAM
const _recordings: Recording[] = [];

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
  const channels = new Map<string, [number, number][]>();
  for (const [name, rows] of _buffers) {
    if (rows.length > 0) channels.set(name, [...rows]);
  }
  _recordings.push({
    user: _user,
    technique: _technique,
    startTime: _startTime,
    duration: _duration,
    channels,
  });
  _buffers.clear();
}

/** Return all completed recordings for a given user (or all if no user specified). */
export function getRecordings(user?: string): Recording[] {
  if (!user) return [..._recordings];
  return _recordings.filter(r => r.user === user);
}

/** Clear all stored recordings from memory. */
export function clearRecordings(): void {
  _recordings.length = 0;
}

export async function getRecordStatus(): Promise<RecordStatus> {
  const elapsed = _recording ? Date.now() / 1000 - _startTime : 0;
  return { recording: _recording, technique: _technique, elapsed, duration: _duration, user: _user };
}
