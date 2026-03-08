const BASE = '';

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

export async function startRecording(user: string, technique: string, duration: number): Promise<void> {
  const res = await fetch(`${BASE}/api/record/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, technique, duration }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function stopRecording(): Promise<void> {
  const res = await fetch(`${BASE}/api/record/stop`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
}

export async function getRecordStatus(): Promise<RecordStatus> {
  const res = await fetch(`${BASE}/api/record/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runAnalysis(user: string): Promise<AnalysisResult> {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listUsers(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/users`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
