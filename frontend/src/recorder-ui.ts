import { startRecording, stopRecording, runAnalysis } from './api';
import type { AnalysisResult } from './api';

const TECHNIQUES = [
  { id: 'active_recall', name: 'Active Recall', desc: 'Test yourself on the material without looking at notes' },
  { id: 'feynman', name: 'Feynman Technique', desc: 'Explain the concept out loud as if teaching someone' },
  { id: 'writing_notes', name: 'Writing Notes', desc: 'Write down key points and summaries by hand' },
  { id: 'music_vs_no_music', name: 'Music vs No Music', desc: 'Learn with background music playing' },
];

const BASELINE_DURATION = 30;
const TECHNIQUE_DURATION = 90;

type Phase = 'setup' | 'baseline' | 'technique' | 'complete' | 'results';

export class RecorderUI {
  private container: HTMLDivElement;
  private phase: Phase = 'setup';
  private user = '';
  private techniqueIndex = 0;
  private countdownTimer: number | null = null;
  private pollTimer: number | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'recorder-panel';
    this.container.className = 'recorder-panel';
    parent.appendChild(this.container);
    this.render();
  }

  destroy(): void {
    this.clearTimers();
    this.container.remove();
  }

  private clearTimers(): void {
    if (this.countdownTimer !== null) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    if (this.pollTimer !== null) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  private render(): void {
    switch (this.phase) {
      case 'setup': return this.renderSetup();
      case 'baseline': return this.renderRecordingPhase('baseline', 'Baseline — Resting State', 'Sit still with eyes open, relaxed. This establishes your resting brain activity.', BASELINE_DURATION);
      case 'technique': return this.renderRecordingPhase('technique', `Trial ${this.techniqueIndex + 1}/${TECHNIQUES.length}: ${TECHNIQUES[this.techniqueIndex].name}`, TECHNIQUES[this.techniqueIndex].desc, TECHNIQUE_DURATION);
      case 'complete': return this.renderComplete();
      case 'results': return; // rendered by showResults
    }
  }

  private renderSetup(): void {
    this.container.innerHTML = `
      <div class="rec-card">
        <h2>Recording Session</h2>
        <p class="rec-subtitle">Record EEG during different study techniques to find your optimal learning style.</p>
        <div class="rec-session-info">
          <span>5 recordings</span>
          <span>~${Math.ceil((BASELINE_DURATION + TECHNIQUES.length * TECHNIQUE_DURATION) / 60)} min total</span>
        </div>
        <div class="rec-form">
          <label for="rec-user">Your Name</label>
          <input id="rec-user" type="text" placeholder="e.g. alice" value="${this.user}" autocomplete="off" />
          <button id="rec-start-btn" class="rec-btn rec-btn-primary">Start Session</button>
        </div>
        <button id="rec-close-btn" class="rec-btn rec-btn-ghost">Cancel</button>
      </div>
    `;
    const input = this.container.querySelector<HTMLInputElement>('#rec-user')!;
    const startBtn = this.container.querySelector<HTMLButtonElement>('#rec-start-btn')!;
    const closeBtn = this.container.querySelector<HTMLButtonElement>('#rec-close-btn')!;

    input.focus();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') startBtn.click(); });
    startBtn.addEventListener('click', () => {
      const name = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      if (!name) { input.focus(); return; }
      this.user = name;
      this.phase = 'baseline';
      this.render();
    });
    closeBtn.addEventListener('click', () => this.destroy());
  }

  private renderRecordingPhase(type: 'baseline' | 'technique', title: string, description: string, duration: number): void {
    const techniqueId = type === 'baseline' ? 'baseline' : TECHNIQUES[this.techniqueIndex].id;

    // Progress dots
    const dots = ['baseline', ...TECHNIQUES.map(t => t.id)];
    const currentIdx = type === 'baseline' ? 0 : this.techniqueIndex + 1;
    const dotsHtml = dots.map((_, i) =>
      `<span class="rec-dot ${i < currentIdx ? 'done' : i === currentIdx ? 'active' : ''}"></span>`
    ).join('');

    this.container.innerHTML = `
      <div class="rec-card">
        <div class="rec-progress">${dotsHtml}</div>
        <h2>${title}</h2>
        <p class="rec-subtitle">${description}</p>
        <div id="rec-countdown" class="rec-countdown">Ready</div>
        <button id="rec-record-btn" class="rec-btn rec-btn-primary rec-btn-record">Start Recording</button>
        <div id="rec-recording-status" class="rec-recording-status" style="display:none">
          <span class="rec-pulse"></span> Recording...
        </div>
      </div>
    `;

    const recordBtn = this.container.querySelector<HTMLButtonElement>('#rec-record-btn')!;
    const countdownEl = this.container.querySelector<HTMLDivElement>('#rec-countdown')!;
    const statusEl = this.container.querySelector<HTMLDivElement>('#rec-recording-status')!;

    recordBtn.addEventListener('click', async () => {
      recordBtn.style.display = 'none';
      statusEl.style.display = 'flex';

      try {
        await startRecording(this.user, techniqueId, duration);
      } catch (e) {
        countdownEl.textContent = `Error: ${e}`;
        recordBtn.style.display = '';
        statusEl.style.display = 'none';
        return;
      }

      let remaining = duration;
      countdownEl.textContent = `${remaining}s`;
      this.countdownTimer = window.setInterval(() => {
        remaining--;
        countdownEl.textContent = `${remaining}s`;
        if (remaining <= 0) {
          this.clearTimers();
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
    this.container.innerHTML = `
      <div class="rec-card">
        <h2>All Trials Complete!</h2>
        <p class="rec-subtitle">Recorded baseline + ${TECHNIQUES.length} techniques for <strong>${this.user}</strong>.</p>
        <button id="rec-analyze-btn" class="rec-btn rec-btn-primary">Run Analysis</button>
        <button id="rec-close-btn" class="rec-btn rec-btn-ghost">Close</button>
      </div>
    `;
    this.container.querySelector<HTMLButtonElement>('#rec-analyze-btn')!.addEventListener('click', () => this.doAnalysis());
    this.container.querySelector<HTMLButtonElement>('#rec-close-btn')!.addEventListener('click', () => this.destroy());
  }

  private async doAnalysis(): Promise<void> {
    this.container.innerHTML = `
      <div class="rec-card">
        <h2>Analyzing...</h2>
        <p class="rec-subtitle">Computing learning scores from your EEG data.</p>
      </div>
    `;

    try {
      const result = await runAnalysis(this.user);
      this.phase = 'results';
      this.showResults(result);
    } catch (e) {
      this.container.innerHTML = `
        <div class="rec-card">
          <h2>Analysis Error</h2>
          <p class="rec-subtitle" style="color:#ff6384">${e}</p>
          <button id="rec-retry-btn" class="rec-btn rec-btn-primary">Retry</button>
          <button id="rec-close-btn" class="rec-btn rec-btn-ghost">Close</button>
        </div>
      `;
      this.container.querySelector<HTMLButtonElement>('#rec-retry-btn')!.addEventListener('click', () => this.doAnalysis());
      this.container.querySelector<HTMLButtonElement>('#rec-close-btn')!.addEventListener('click', () => this.destroy());
    }
  }

  private showResults(result: AnalysisResult): void {
    const techNames: Record<string, string> = {};
    for (const t of TECHNIQUES) techNames[t.id] = t.name;

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

    const bestName = techNames[result.best_technique] ?? result.best_technique;

    this.container.innerHTML = `
      <div class="rec-card rec-card-wide">
        <h2>Results for ${result.user}</h2>
        <p class="rec-subtitle">Your brain learns most effectively with: <strong>${bestName}</strong></p>
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
        <button id="rec-close-btn" class="rec-btn rec-btn-ghost" style="margin-top:1rem">Close</button>
      </div>
    `;
    this.container.querySelector<HTMLButtonElement>('#rec-close-btn')!.addEventListener('click', () => this.destroy());
  }
}
