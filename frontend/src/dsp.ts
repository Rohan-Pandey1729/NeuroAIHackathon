/**
 * Real-time IIR bandpass filter for EEG signals.
 * 2nd-order Butterworth sections computed via bilinear transform.
 */

// Direct-form II 2nd-order biquad filter
export class BiquadFilter {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private x1 = 0; private x2 = 0;
  private y1 = 0; private y2 = 0;

  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.b0 = b0; this.b1 = b1; this.b2 = b2;
    this.a1 = a1; this.a2 = a2;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
            - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
}

/**
 * 2nd-order Butterworth highpass filter via bilinear transform.
 * Removes DC drift and sub-Hz artifacts.
 */
export function makeButterworthHP(fc: number, fs: number): BiquadFilter {
  const wc = 2 * Math.PI * fc / fs;
  const k = Math.tan(wc / 2);
  const k2 = k * k;
  const sqrt2k = Math.SQRT2 * k;
  const denom = k2 + sqrt2k + 1;
  // Highpass: H(z) with zeros at z=1
  const b0 = 1 / denom;
  const b1 = -2 / denom;
  const b2 = 1 / denom;
  const a1 = 2 * (k2 - 1) / denom;
  const a2 = (k2 - sqrt2k + 1) / denom;
  return new BiquadFilter(b0, b1, b2, a1, a2);
}

/**
 * 2nd-order Butterworth lowpass filter via bilinear transform.
 * Removes high-frequency noise and line interference above 50 Hz.
 */
export function makeButterworthLP(fc: number, fs: number): BiquadFilter {
  const wc = 2 * Math.PI * fc / fs;
  const k = Math.tan(wc / 2);
  const k2 = k * k;
  const sqrt2k = Math.SQRT2 * k;
  const denom = k2 + sqrt2k + 1;
  // Lowpass: H(z) with zeros at z=-1
  const b0 = k2 / denom;
  const b1 = 2 * k2 / denom;
  const b2 = k2 / denom;
  const a1 = 2 * (k2 - 1) / denom;
  const a2 = (k2 - sqrt2k + 1) / denom;
  return new BiquadFilter(b0, b1, b2, a1, a2);
}

/**
 * Per-channel bandpass filter: highpass at 1 Hz then lowpass at 50 Hz.
 * Equivalent to a 1–50 Hz bandpass at 250 Hz sample rate.
 */
export class ChannelFilter {
  private readonly hp: BiquadFilter;
  private readonly lp: BiquadFilter;

  constructor(fs = 250) {
    this.hp = makeButterworthHP(1, fs);
    this.lp = makeButterworthLP(50, fs);
  }

  process(x: number): number {
    return this.lp.process(this.hp.process(x));
  }

  reset(): void {
    this.hp.reset();
    this.lp.reset();
  }
}
