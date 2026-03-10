import { startRecording, stopRecording, getRecordings } from './api';
import type { AnalysisResult } from './analyze';
import AnalyzeWorker from './analyze.worker?worker';

const TECHNIQUES = [
  { id: 'active_recall', name: 'Active Recall', desc: 'Test yourself on the material without looking at notes' },
  { id: 'feynman', name: 'Feynman Technique', desc: 'Explain the concept out loud as if teaching someone' },
  { id: 'writing_notes', name: 'Writing Notes', desc: 'Write down key points and summaries by hand' },
  { id: 'music_vs_no_music', name: 'Music', desc: 'Learn with background music playing' },
];

const BASELINE_DURATION = 30;
const TECHNIQUE_DURATION = 90;

type Phase = 'setup' | 'baseline' | 'technique' | 'complete';

export class RecorderUI {
  private bar: HTMLDivElement;
  private resultsPanel: HTMLDivElement;
  private phase: Phase = 'setup';
  private user = '';
  private techniqueIndex = 0;
  private countdownTimer: number | null = null;

  constructor(parent: HTMLElement) {
    // Session bar sits in the recorder-mount (between topbar and dashboard)
    this.bar = document.createElement('div');
    this.bar.id = 'recorder-panel';
    this.bar.className = 'session-bar';
    parent.appendChild(this.bar);

    // Results panel goes after the dashboard
    this.resultsPanel = document.createElement('div');
    this.resultsPanel.id = 'recorder-results';
    this.resultsPanel.className = 'results-panel';
    const dashboard = document.getElementById('dashboard');
    if (dashboard) dashboard.after(this.resultsPanel);

    this.render();
  }

  destroy(): void {
    this.clearTimers();
    this.setRecordingGlow(false);
    this.bar.remove();
    this.resultsPanel.remove();
  }

  private clearTimers(): void {
    if (this.countdownTimer !== null) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
  }

  private setRecordingGlow(on: boolean): void {
    const brain = document.getElementById('brain-container');
    if (brain) {
      brain.classList.toggle('recording', on);
    }
  }

  private render(): void {
    switch (this.phase) {
      case 'setup': return this.renderSetup();
      case 'baseline': return this.renderRecordingPhase('baseline', 'Baseline — Resting State', 'Sit still with eyes open, relaxed.', BASELINE_DURATION);
      case 'technique': return this.renderRecordingPhase('technique', TECHNIQUES[this.techniqueIndex].name, TECHNIQUES[this.techniqueIndex].desc, TECHNIQUE_DURATION);
      case 'complete': return this.renderComplete();
    }
  }

  private renderProgressDots(): string {
    const dots = ['baseline', ...TECHNIQUES.map(t => t.id)];
    const currentIdx = this.phase === 'baseline' ? 0 : this.techniqueIndex + 1;
    return dots.map((_, i) =>
      `<span class="rec-dot ${i < currentIdx ? 'done' : i === currentIdx ? 'active' : ''}"></span>`
    ).join('');
  }

  private renderSetup(): void {
    this.bar.innerHTML = `
      <div class="session-bar-inner">
        <div class="session-bar-left">
          <span class="session-label">New Session</span>
          <span class="session-meta">${TECHNIQUES.length + 1} recordings &middot; ~${Math.ceil((BASELINE_DURATION + TECHNIQUES.length * TECHNIQUE_DURATION) / 60)} min</span>
        </div>
        <div class="session-bar-center">
          <input id="rec-user" class="session-input" type="text" placeholder="Your name (e.g. alice)" value="${this.user}" autocomplete="off" />
          <button id="rec-start-btn" class="rec-btn rec-btn-primary session-btn">Start</button>
        </div>
        <button id="rec-close-btn" class="session-close" title="Cancel">&times;</button>
      </div>
    `;
    const input = this.bar.querySelector<HTMLInputElement>('#rec-user')!;
    const startBtn = this.bar.querySelector<HTMLButtonElement>('#rec-start-btn')!;

    input.focus();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') startBtn.click(); });
    startBtn.addEventListener('click', () => {
      const name = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      if (!name) { input.focus(); return; }
      this.user = name;
      this.phase = 'baseline';
      this.render();
    });
    this.bar.querySelector<HTMLButtonElement>('#rec-close-btn')!.addEventListener('click', () => this.destroy());
  }

  private renderRecordingPhase(type: 'baseline' | 'technique', title: string, description: string, duration: number): void {
    const techniqueId = type === 'baseline' ? 'baseline' : TECHNIQUES[this.techniqueIndex].id;
    const phaseLabel = type === 'baseline' ? 'Baseline' : `Trial ${this.techniqueIndex + 1}/${TECHNIQUES.length}`;

    this.bar.innerHTML = `
      <div class="session-bar-inner">
        <div class="session-bar-left">
          <div class="rec-progress">${this.renderProgressDots()}</div>
          <span class="session-phase-label">${phaseLabel}</span>
        </div>
        <div class="session-bar-center">
          <div class="session-phase-info">
            <span class="session-technique-name">${title}</span>
            <span class="session-technique-desc">${description}</span>
          </div>
        </div>
        <div class="session-bar-right">
          <span id="rec-countdown" class="session-countdown">—</span>
          <button id="rec-record-btn" class="rec-btn rec-btn-primary session-btn session-btn-go">Record</button>
          <div id="rec-recording-status" class="session-recording-indicator" style="display:none">
            <span class="rec-pulse"></span>
            <span>REC</span>
          </div>
        </div>
      </div>
    `;

    const recordBtn = this.bar.querySelector<HTMLButtonElement>('#rec-record-btn')!;
    const countdownEl = this.bar.querySelector<HTMLSpanElement>('#rec-countdown')!;
    const statusEl = this.bar.querySelector<HTMLDivElement>('#rec-recording-status')!;

    recordBtn.addEventListener('click', async () => {
      recordBtn.style.display = 'none';
      statusEl.style.display = 'flex';
      this.setRecordingGlow(true);

      try {
        await startRecording(this.user, techniqueId, duration);
      } catch (e) {
        countdownEl.textContent = `Error`;
        recordBtn.style.display = '';
        statusEl.style.display = 'none';
        this.setRecordingGlow(false);
        return;
      }

      let remaining = duration;
      countdownEl.textContent = `${remaining}s`;
      this.countdownTimer = window.setInterval(() => {
        remaining--;
        countdownEl.textContent = `${remaining}s`;
        if (remaining <= 0) {
          this.clearTimers();
          this.setRecordingGlow(false);
          void this.onPhaseComplete();
        }
      }, 1000);
    });
  }

  private async onPhaseComplete(): Promise<void> {
    try { await stopRecording(); } catch { /* already stopped */ }

    if (this.phase === 'baseline') {
      this.phase = 'technique';
      this.techniqueIndex = 0;
    } else if (this.phase === 'technique') {
      this.techniqueIndex++;
      if (this.techniqueIndex >= TECHNIQUES.length) {
        this.phase = 'complete';
      }
    }
    this.render();
  }

  private renderComplete(): void {
    this.bar.innerHTML = `
      <div class="session-bar-inner">
        <div class="session-bar-left">
          <div class="rec-progress">${this.renderProgressDots()}</div>
          <span class="session-phase-label session-done-label">Complete</span>
        </div>
        <div class="session-bar-center">
          <span class="session-technique-name">All trials recorded for <strong>${this.user}</strong></span>
          <span class="session-technique-desc" id="rec-analysis-status">Analyzing EEG data…</span>
        </div>
        <div class="session-bar-right">
          <button id="rec-close-btn" class="session-close" title="Close">&times;</button>
        </div>
      </div>
    `;
    this.bar.querySelector<HTMLButtonElement>('#rec-close-btn')!.addEventListener('click', () => this.destroy());

    // Run analysis in a Web Worker so the main thread stays responsive
    const worker = new AnalyzeWorker();
    const statusEl = () => this.bar.querySelector<HTMLSpanElement>('#rec-analysis-status');

    worker.onmessage = (e: MessageEvent<import('./analyze.worker').WorkerResponse>) => {
      worker.terminate();
      if (e.data.ok) {
        this.renderResults(e.data.result);
        const el = statusEl();
        if (el) el.textContent = `Best: ${e.data.result.best_technique.replace(/_/g, ' ')}`;
      } else {
        const el = statusEl();
        if (el) el.textContent = `Analysis failed: ${e.data.error}`;
      }
    };

    worker.onerror = (e) => {
      worker.terminate();
      const el = statusEl();
      if (el) el.textContent = `Worker error: ${e.message}`;
    };

    worker.postMessage(getRecordings(this.user));
  }

  private renderResults(result: AnalysisResult): void {
    this.resultsPanel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'results-title';
    title.textContent = `Results for ${result.user}`;
    this.resultsPanel.appendChild(title);

    const TECHNIQUE_LABELS: Record<string, string> = {
      active_recall: 'Active Recall',
      feynman: 'Feynman Technique',
      writing_notes: 'Writing Notes',
      music_vs_no_music: 'Music',
      baseline: 'Baseline',
    };

    result.ranking.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = `results-row${i === 0 ? ' results-row-best' : ''}`;

      const score = item.composite_score;
      const scoreStr = score >= 0
        ? `+${(score * 100).toFixed(1)}%`
        : `${(score * 100).toFixed(1)}%`;
      const label = TECHNIQUE_LABELS[item.technique] ?? item.technique.replace(/_/g, ' ');

      row.innerHTML = `
        <span class="results-rank">${i + 1}</span>
        <span class="results-technique">${label}${i === 0 ? ' <span class="results-best-badge">BEST</span>' : ''}</span>
        <span class="results-metrics">
          θ ${(item.metrics['frontal_theta'] ?? 0).toFixed(2)}
          &nbsp;γ ${(item.metrics['frontal_gamma'] ?? 0).toFixed(3)}
          &nbsp;eng ${(item.metrics['engagement_index'] ?? 0).toFixed(2)}
        </span>
        <span class="results-score ${score >= 0 ? 'results-score-pos' : 'results-score-neg'}">${scoreStr}</span>
      `;
      this.resultsPanel.appendChild(row);
    });
  }
}
