/**
 * OpenBCI Cyton direct serial communication via Web Serial API.
 * Falls back to synthetic EEG generation when hardware is unavailable.
 *
 * Cyton packet format (33 bytes):
 *   Byte  0:     0xA0 (start byte)
 *   Byte  1:     sample number (0–255 cycling)
 *   Bytes 2–25:  8 × 3-byte 24-bit big-endian signed EEG (ADS1299)
 *   Bytes 26–31: 3 × 2-byte 16-bit big-endian signed accelerometer (LIS3DH)
 *   Byte  32:    stop byte (0xC0 = accel present)
 */

import { ChannelFilter } from "./dsp.ts";

export interface EegMessage {
  type: "eeg";
  channels: number[][]; // [channel][sample], µV
  channel_names: string[];
  accel: number[]; // [x, y, z] in g
  timestamps: number[]; // Unix seconds
  sample_rate: number;
  num_samples: number;
}

type DataHandler = (msg: EegMessage) => void;
export type CytonMode = "serial" | "connecting" | "synthetic" | "idle";
type ModeChangeHandler = (mode: CytonMode) => void;

const PACKET_LEN = 33;
const START_BYTE = 0xa0;
const EEG_SCALE = (4.5 / (8_388_607 * 24)) * 1e6; // µV per ADS1299 count (gain=24)
const ACCEL_SCALE = 0.000122; // g per LIS3DH count (±4g)
const SAMPLE_RATE = 250;
const EMIT_CHUNK = 25; // samples per EegMessage (~100 ms)

const CHANNEL_NAMES = [
  "F3",
  "F4",
  "C4",
  "C3",
  "T4",
  "T3",
  "P4",
  "P3",
  "A1",
  "A2",
] as const;
const EEG_CHANNEL_COUNT = 8; // hardware channels (A1/A2 not on Cyton ADS1299)

// Synthetic generation parameters, ported from backend/server.py _generate_synthetic_eeg
const REGION_SPEC: Record<string, [number, number][]> = {
  F3: [
    [18.0, 40],
    [10.0, 20],
    [6.0, 10],
  ],
  F4: [
    [20.0, 38],
    [10.0, 18],
    [6.0, 12],
  ],
  C3: [
    [10.0, 50],
    [20.0, 15],
    [4.0, 10],
  ],
  C4: [
    [11.0, 48],
    [22.0, 14],
    [5.0, 12],
  ],
  T3: [
    [5.5, 45],
    [10.0, 15],
    [18.0, 8],
  ],
  T4: [
    [6.0, 42],
    [10.0, 14],
    [19.0, 10],
  ],
  P3: [
    [9.5, 55],
    [18.0, 12],
    [5.0, 15],
  ],
  P4: [
    [10.0, 52],
    [20.0, 10],
    [4.5, 14],
  ],
  A1: [
    [10.0, 5],
    [6.0, 3],
  ],
  A2: [
    [10.0, 5],
    [6.0, 3],
  ],
};

const REGION_PHASE: Record<string, number> = {
  F3: 0.0,
  F4: 0.15,
  C3: 0.3,
  C4: 0.45,
  T3: 0.55,
  T4: 0.7,
  P3: 0.8,
  P4: 0.9,
  A1: 0.5,
  A2: 0.5,
};

const SWEEP_PERIOD = 4.0; // seconds

export function isSerialSupported(): boolean {
  return "serial" in navigator;
}

export class CytonSource {
  mode: CytonMode = "idle";

  private readonly dataListeners: DataHandler[] = [];
  private readonly modeListeners: ModeChangeHandler[] = [];

  // Serial state
  private port: SerialPort | null = null;
  private serialRunning = false;

  // Synthetic state
  private synthInterval: number | null = null;
  private synthTime = 0;
  private readonly pinkAccum: number[] = new Array(CHANNEL_NAMES.length).fill(
    0,
  );

  // Serial packet accumulation
  private buf = new Uint8Array(0);
  private readonly chunkChannels: number[][] = Array.from(
    { length: CHANNEL_NAMES.length },
    () => [],
  );
  private chunkTimestamps: number[] = [];
  private lastAccel = [0, 0, 1];
  private readonly filters: ChannelFilter[] = Array.from(
    { length: CHANNEL_NAMES.length },
    () => new ChannelFilter(SAMPLE_RATE),
  );

  onData(handler: DataHandler): void {
    this.dataListeners.push(handler);
  }

  onModeChange(handler: ModeChangeHandler): void {
    this.modeListeners.push(handler);
  }

  async connect(): Promise<boolean> {
    if (!isSerialSupported()) return false;

    try {
      this.port = await (
        navigator as Navigator & { serial: Serial }
      ).serial.requestPort();
      await this.port.open({ baudRate: 115200 });

      this._setMode("connecting");
      this._stopSynthetic();
      this.serialRunning = true;

      // Wait for board ready string (ends with "$$$"), then start streaming
      void this._initAndStream();
      return true;
    } catch {
      // User cancelled picker or device error — stay in current mode
      return false;
    }
  }

  /** Read board startup text until "$$$" appears, then send 'b' to begin streaming. */
  private async _initAndStream(): Promise<void> {
    if (!this.port?.readable || !this.port?.writable) return;

    // Send soft reset first to get a clean '$$$'
    const writer = this.port.writable.getWriter();
    await writer.write(new TextEncoder().encode("v"));
    writer.releaseLock();

    // Wait for '$$$' boot message
    const decoder = new TextDecoder();
    const reader = this.port.readable.getReader();
    let initText = "";
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      reader.cancel().catch(() => {});
    }, 5000);

    try {
      while (!timedOut) {
        const { value, done } = await reader.read();
        if (done) break;
        initText += decoder.decode(value, { stream: true });
        if (initText.includes("$$$")) break;
      }
    } catch {
      /* cancelled or error */
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }

    if (!this.serialRunning) return;

    // Send 'd' then 'b'
    const writer2 = this.port.writable.getWriter();
    await writer2.write(new TextEncoder().encode("d"));
    await writer2.write(new Uint8Array([0x62])); // 'b'
    writer2.releaseLock();

    void this._readLoop();
  }

  startSynthetic(): void {
    if (this.mode === "serial" || this.mode === "connecting") return;
    if (this.synthInterval !== null) return;
    this._setMode("synthetic");
    this.synthInterval = window.setInterval(() => this._emitSynthetic(), 100);
  }

  async stop(): Promise<void> {
    this._stopSynthetic();
    if (this.port) {
      this.serialRunning = false;
      try {
        if (this.port.writable) {
          const writer = this.port.writable.getWriter();
          await writer.write(new Uint8Array([0x73])); // 's'
          writer.releaseLock();
        }
        await this.port.close();
      } catch {
        /* ignore close errors */
      }
      this.port = null;
    }
    this._setMode("idle");
  }

  private _stopSynthetic(): void {
    if (this.synthInterval !== null) {
      clearInterval(this.synthInterval);
      this.synthInterval = null;
    }
  }

  private _setMode(m: CytonMode): void {
    this.mode = m;
    for (const h of this.modeListeners) h(m);
  }

  private _emit(msg: EegMessage): void {
    for (const h of this.dataListeners) h(msg);
  }

  // ─── Serial read loop ────────────────────────────────────────────────────────

  private async _readLoop(): Promise<void> {
    if (!this.port?.readable) return;
    const reader = this.port.readable.getReader();

    // Reset filter state on new connection
    for (const f of this.filters) f.reset();
    for (const ch of this.chunkChannels) ch.length = 0;
    this.chunkTimestamps = [];

    try {
      while (this.serialRunning) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this._consumeBytes(value);
      }
    } catch {
      // Connection lost
    } finally {
      reader.releaseLock();
    }

    if (this.mode === "serial") {
      // Reconnect fallback: revert to synthetic
      this._setMode("synthetic");
      this.startSynthetic();
    }
  }

  private _consumeBytes(incoming: Uint8Array): void {
    // Append to buffer
    const merged = new Uint8Array(this.buf.length + incoming.length);
    merged.set(this.buf);
    merged.set(incoming, this.buf.length);
    this.buf = merged;

    // Parse all complete packets
    let offset = 0;
    while (offset <= this.buf.length - PACKET_LEN) {
      if (this.buf[offset] !== START_BYTE) {
        offset++;
        continue;
      }
      const stopByte = this.buf[offset + 32];
      if ((stopByte & 0xF0) !== 0xC0) {
        offset++;
        continue;
      }

      // Valid packet found
      const { channels, accel } = this._parsePacket(this.buf, offset);
      this.lastAccel = accel;

      const ts = Date.now() / 1000;
      for (let ch = 0; ch < CHANNEL_NAMES.length; ch++) {
        const raw = ch < EEG_CHANNEL_COUNT ? channels[ch] : 0;
        this.chunkChannels[ch].push(this.filters[ch].process(raw));
      }
      this.chunkTimestamps.push(ts);

      // Confirm board is live on first packet
      if (this.mode === "connecting") this._setMode("serial");

      if (this.chunkTimestamps.length >= EMIT_CHUNK) {
        this._flushChunk();
      }

      offset += PACKET_LEN;
    }

    // Keep remainder
    this.buf = this.buf.slice(offset);

    // Guard against excessive buffering without valid packets
    if (this.buf.length > PACKET_LEN * 4) {
      this.buf = new Uint8Array(0);
    }
  }

  private _parsePacket(
    buf: Uint8Array,
    offset: number,
  ): { channels: number[]; accel: number[] } {
    const channels: number[] = [];
    for (let ch = 0; ch < EEG_CHANNEL_COUNT; ch++) {
      const base = offset + 2 + ch * 3;
      let val = (buf[base] << 16) | (buf[base + 1] << 8) | buf[base + 2];
      if (val & 0x800000) val -= 0x1000000; // sign-extend 24-bit
      channels.push(val * EEG_SCALE);
    }
    const accel: number[] = [];
    for (let ax = 0; ax < 3; ax++) {
      const base = offset + 26 + ax * 2;
      let val = (buf[base] << 8) | buf[base + 1];
      if (val & 0x8000) val -= 0x10000;
      accel.push(val * ACCEL_SCALE);
    }
    return { channels, accel };
  }

  private _flushChunk(): void {
    const channels = this.chunkChannels.map((ch) => [...ch]);
    const timestamps = [...this.chunkTimestamps];
    for (const ch of this.chunkChannels) ch.length = 0;
    this.chunkTimestamps = [];

    this._emit({
      type: "eeg",
      channels,
      channel_names: [...CHANNEL_NAMES],
      accel: [...this.lastAccel],
      timestamps,
      sample_rate: SAMPLE_RATE,
      num_samples: timestamps.length,
    });
  }

  // ─── Synthetic EEG generator ─────────────────────────────────────────────────

  private _emitSynthetic(): void {
    const N = EMIT_CHUNK;
    const channels: number[][] = [];
    const tOffset = this.synthTime;
    const now = Date.now() / 1000;
    const timestamps = Array.from(
      { length: N },
      (_, i) => now - (N - i) / SAMPLE_RATE,
    );

    for (let chIdx = 0; chIdx < CHANNEL_NAMES.length; chIdx++) {
      const chName = CHANNEL_NAMES[chIdx];
      const spec = REGION_SPEC[chName];
      const phase = REGION_PHASE[chName];
      const samples: number[] = [];

      for (let i = 0; i < N; i++) {
        const t = tOffset + i / SAMPLE_RATE;

        // Sweep envelope
        const envelope =
          0.3 +
          0.7 *
            (0.5 + 0.5 * Math.sin(2 * Math.PI * (t / SWEEP_PERIOD - phase)));

        // Sum characteristic oscillations
        let signal = 0;
        for (const [freq, amp] of spec) {
          const jitter = 1.0 + 0.02 * Math.sin(2 * Math.PI * 0.1 * t + freq);
          signal += amp * Math.sin(2 * Math.PI * freq * jitter * t);
        }
        signal *= envelope;

        // Pink-ish noise: running 1/f accumulator
        const white = (Math.random() * 2 - 1) * 8;
        this.pinkAccum[chIdx] = this.pinkAccum[chIdx] * 0.998 + white;
        const pink = this.pinkAccum[chIdx] * 0.05;
        signal += pink + white * 2;

        samples.push(signal);
      }

      channels.push(samples);
    }

    // Gentle head sway accelerometer simulation
    const tMid = tOffset + N / (2 * SAMPLE_RATE);
    const ax = 0.06 * Math.sin(2 * Math.PI * 0.15 * tMid);
    const ay = 0.04 * Math.sin(2 * Math.PI * 0.1 * tMid + 1.0);
    const az = Math.sqrt(Math.max(0, 1 - ax * ax - ay * ay));

    this.synthTime += N / SAMPLE_RATE;

    this._emit({
      type: "eeg",
      channels,
      channel_names: [...CHANNEL_NAMES],
      accel: [ax, ay, az],
      timestamps,
      sample_rate: SAMPLE_RATE,
      num_samples: N,
    });
  }
}

// Web Serial API ambient types (for TypeScript environments without full DOM.WebSerial)
interface Serial {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
}
interface SerialPortRequestOptions {
  filters?: SerialPortFilter[];
}
interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}
interface SerialPort {
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
}
interface SerialOptions {
  baudRate: number;
}
