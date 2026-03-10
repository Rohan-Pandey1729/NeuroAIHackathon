/// <reference lib="webworker" />

import { analyzeUser } from './analyze';
import type { Recording } from './api';
import type { AnalysisResult } from './analyze';

export type WorkerResponse =
  | { ok: true;  result: AnalysisResult }
  | { ok: false; error: string };

self.onmessage = (e: MessageEvent<Recording[]>) => {
  try {
    const result = analyzeUser(e.data);
    self.postMessage({ ok: true, result } satisfies WorkerResponse);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) } satisfies WorkerResponse);
  }
};
