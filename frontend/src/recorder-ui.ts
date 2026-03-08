import { startRecording, stopRecording, runAnalysis } from './api';
import type { AnalysisResult } from './api';

const TECHNIQUES = [
  { id: 'active_recall', name: 'Active Recall', desc: 'Test yourself on the material without looking at notes' },
  { id: 'feynman', name: 'Feynman Technique', desc: 'Explain the concept out loud as if teaching someone' },
  { id: 'writing_notes', name: 'Writing Notes', desc: 'Write down key points and summaries by hand' },
  { id: 'music_vs_no_music', name: 'Music', desc: 'Learn with background music playing' },
];

const BASELINE_DURATION = 30;
const TECHNIQUE_DURATION = 90;

type Phase = 'setup' | 'baseline' | 'technique' | 'complete' | 'results';

export class RecorderUI {
  private bar: HTMLDivElement;
  private resultsPanel: HTMLDivElement;
  private phase: Phase = 'setup';
  private user = '';
  private techniqueIndex = 0;
  private countdownTimer: number | null = null;
  private pollTimer: number | null = null;

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
    if (this.pollTimer !== null) { clearInterval(this.pollTimer); this.pollTimer = null; }
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
      case 'results': return; // rendered by showResults
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
          this.onPhaseComplete();
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
        </div>
        <div class="session-bar-right">
          <button id="rec-analyze-btn" class="rec-btn rec-btn-primary session-btn">Analyze</button>
          <button id="rec-close-btn" class="session-close" title="Close">&times;</button>
        </div>
      </div>
    `;
    this.bar.querySelector<HTMLButtonElement>('#rec-analyze-btn')!.addEventListener('click', () => this.doAnalysis());
    this.bar.querySelector<HTMLButtonElement>('#rec-close-btn')!.addEventListener('click', () => this.destroy());
  }

  private async doAnalysis(): Promise<void> {
    this.bar.innerHTML = `
      <div class="session-bar-inner">
        <div class="session-bar-left">
          <div class="rec-progress">${this.renderProgressDots()}</div>
        </div>
        <div class="session-bar-center">
          <span class="session-technique-name">Analyzing EEG data...</span>
        </div>
        <div class="session-bar-right">
          <div class="session-spinner"></div>
        </div>
      </div>
    `;

    try {
      const result = await runAnalysis(this.user);
      this.phase = 'results';
      this.showResults(result);
    } catch (e) {
      this.bar.innerHTML = `
        <div class="session-bar-inner">
          <div class="session-bar-left">
            <span class="session-phase-label" style="color:#ff6384">Analysis Error</span>
          </div>
          <div class="session-bar-center">
            <span class="session-technique-desc" style="color:#ff6384">${e}</span>
          </div>
          <div class="session-bar-right">
            <button id="rec-retry-btn" class="rec-btn rec-btn-primary session-btn">Retry</button>
            <button id="rec-close-btn" class="session-close" title="Close">&times;</button>
          </div>
        </div>
      `;
      this.bar.querySelector<HTMLButtonElement>('#rec-retry-btn')!.addEventListener('click', () => this.doAnalysis());
      this.bar.querySelector<HTMLButtonElement>('#rec-close-btn')!.addEventListener('click', () => this.destroy());
    }
  }

  private showResults(result: AnalysisResult): void {
    const techNames: Record<string, string> = {};
    for (const t of TECHNIQUES) techNames[t.id] = t.name;

    const bestName = techNames[result.best_technique] ?? result.best_technique;

    // Collapse the bar to a summary
    this.bar.innerHTML = `
      <div class="session-bar-inner session-bar-result">
        <div class="session-bar-left">
          <span class="session-result-badge">RESULT</span>
          <span class="session-technique-name">Best technique: <strong>${bestName}</strong></span>
        </div>
        <div class="session-bar-right">
          <button id="rec-close-btn" class="session-close" title="Close">&times;</button>
        </div>
      </div>
    `;
    this.bar.querySelector<HTMLButtonElement>('#rec-close-btn')!.addEventListener('click', () => this.destroy());

    // Show full results table in the results panel below the dashboard
    const rows = result.ranking.map((r, i) => {
      const name = techNames[r.technique] ?? r.technique;
      const score = r.composite_score.toFixed(4);
      const theta = r.metrics.frontal_theta?.toFixed(4) ?? '—';
      const engagement = r.metrics.engagement_index?.toFixed(4) ?? '—';
      const coherence = r.metrics.frontal_parietal_theta_coherence?.toFixed(4) ?? '—';
      const isBest = i === 0;
      return `
        <tr class="${isBest ? 'rec-best' : ''}">
          <td>${i + 1}${isBest ? ' <span class="rec-badge">BEST</span>' : ''}</td>
          <td>${name}</td>
          <td>${score}</td>
          <td>${theta}</td>
          <td>${engagement}</td>
          <td>${coherence}</td>
        </tr>
      `;
    }).join('');

    this.resultsPanel.innerHTML = `
      <div class="results-card">
        <div class="results-header">
          <h2>Analysis Results — ${result.user}</h2>
          <p class="results-subtitle">Your brain learns most effectively with <strong>${bestName}</strong></p>
        </div>
        <div class="rec-table-wrap">
          <table class="rec-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Technique</th>
                <th>Score</th>
                <th>Frontal &theta;</th>
                <th>Engagement</th>
                <th>F-P Coherence</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
    this.resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
