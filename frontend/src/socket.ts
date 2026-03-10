/**
 * EEG data source adapter.
 * Replaces the previous WebSocket client with direct Cyton serial communication.
 * Automatically falls back to synthetic data when Web Serial is unsupported.
 */

import { CytonSource, isSerialSupported } from './cyton-serial.ts';
export type { EegMessage } from './cyton-serial.ts';

const _source = new CytonSource();

export { isSerialSupported };

export function onEegData(handler: (data: import('./cyton-serial.ts').EegMessage) => void): void {
  _source.onData(handler);
}

export function onModeChange(handler: (mode: 'serial' | 'synthetic' | 'idle') => void): void {
  _source.onModeChange(handler);
}

export async function connectCyton(): Promise<boolean> {
  return _source.connect();
}

export function startSynthetic(): void {
  _source.startSynthetic();
}

/** Stop any active serial connection and switch to synthetic data. */
export async function useSynthetic(): Promise<void> {
  await _source.stop();
  _source.startSynthetic();
}

export function getMode(): 'serial' | 'synthetic' | 'idle' {
  return _source.mode;
}

// Auto-start synthetic fallback on load
if (!isSerialSupported()) {
  _source.startSynthetic();
}
