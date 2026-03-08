/**
 * Biophysical EEG Forward/Inverse Model
 *
 * Maps between scalp EEG voltage and underlying neural population activity
 * using a 4-concentric-sphere volume conductor model of the head.
 *
 * Forward model:  V_scalp = G × n × q
 *   V = scalp voltage (V)
 *   G = lead field gain (V per A·m) — from volume conductor geometry
 *   n = number of synchronously active pyramidal neurons
 *   q = single-neuron PSP dipole moment (A·m)
 *
 * Inverse:  n = V / (G × q)
 *
 * References:
 *   Nunez & Srinivasan (2006). Electric Fields of the Brain. Oxford.
 *   Murakami & Okada (2006). J Physiol, 575(3), 925-936.
 *   Rush & Driscoll (1968). IEEE Trans BME, 15(3), 174-182.
 *   Hämäläinen et al. (1993). Rev Mod Phys, 65(2), 413-497.
 *   Rockel, Hiorns & Powell (1980). Brain, 103, 221-244.
 */

/* ─── 4-Sphere Volume Conductor Parameters ─── */

/**
 * Head model layer radii (meters).
 * Standard values from Nunez & Srinivasan (2006), Table 1.3.
 */
export const HEAD_MODEL = {
  r_brain: 0.080,  // inner skull radius (cortical surface)
  r_csf:   0.082,  // outer CSF boundary
  r_skull: 0.088,  // outer skull boundary
  r_scalp: 0.092,  // scalp surface
} as const;

/**
 * Tissue conductivities (Siemens/meter).
 * The skull is ~80× less conductive than brain tissue — this is the
 * primary reason EEG signals are so attenuated at the scalp.
 */
export const CONDUCTIVITY = {
  brain: 0.33,    // S/m — gray matter
  csf:   1.0,     // S/m — cerebrospinal fluid (highly conductive)
  skull: 0.0042,  // S/m — compact bone (major attenuator)
  scalp: 0.33,    // S/m — skin + connective tissue
} as const;

/**
 * Single-neuron postsynaptic potential (PSP) dipole moment.
 *
 * When a pyramidal neuron fires a PSP, current flows along its ~1 mm
 * apical dendrite, creating a microscopic current dipole. The net
 * contribution of one neuron to the population dipole is ~1 pAm.
 *
 * This value is consistent with:
 * - Murakami & Okada (2006): measured population dipoles of cortical columns
 * - Hämäläinen et al. (1993): ~10 nAm dipoles from ~10⁴ synchronous neurons
 */
const Q_SINGLE_NEURON = 1e-12; // A·m (1 picoampere·meter)

/* ─── Regional Lead Field Values ─── */

/**
 * Effective lead field G (V per A·m) for each 10-20 electrode.
 *
 * The lead field captures how efficiently a unit current dipole at the
 * cortical surface produces voltage at the overlying scalp electrode,
 * accounting for:
 *  - Tissue conductivity layering (skull attenuation dominates)
 *  - Geometric spreading (1/r² falloff)
 *  - Dipole orientation (radial dipoles measured most efficiently)
 *  - Local skull thickness (temporal bone is thinnest)
 *
 * Derived from 4-sphere model numerical solutions (Rush & Driscoll, 1968)
 * for radial dipoles at cortical surface directly under each electrode.
 */
const LEAD_FIELD: Record<string, number> = {
  F3: 28,  F4: 28,   // Frontal convexity — good radial alignment
  C3: 32,  C4: 32,   // Vertex — most radial orientation, shortest skull path
  T3: 22,  T4: 22,   // Lateral — thin temporal bone but more tangential dipoles
  P3: 30,  P4: 30,   // Posterior convexity — good radial alignment
  A1: 10,  A2: 10,   // Below-ear reference — minimal cortical sensitivity
};

/* ─── Cortical Neuron Density ─── */

/**
 * Neuron density per mm² of cortical surface (all 6 layers combined).
 *
 * Human cortex averages ~100,000 neurons/mm² but varies regionally:
 * - Motor cortex (BA4) is notably lower because giant Betz cells in
 *   layer V occupy far more volume per neuron
 * - Prefrontal cortex has many small, densely packed pyramidal cells
 * - Visual cortex (not measured here) is the densest at ~120,000/mm²
 *
 * Sources:
 *   Rockel, Hiorns & Powell (1980). Brain, 103, 221-244.
 *   Collins et al. (2010). J Comp Neurol, 518(16), 3177-3193.
 *   Herculano-Houzel (2009). Front Hum Neurosci, 3, 31.
 */
export const CORTICAL_DENSITY: Record<string, number> = {
  F3: 105_000, F4: 105_000,  // Prefrontal (BA9/46) — dense small pyramidals
  C3:  62_000, C4:  62_000,  // Motor (BA4) — sparse, large Betz cells
  T3:  95_000, T4:  95_000,  // Temporal (BA21/22) — dense, auditory/memory
  P3:  85_000, P4:  85_000,  // Parietal (BA7/39) — medium-high density
  A1:       0, A2:       0,  // Ear references — not cortical tissue
};

/**
 * Cortical surface area sampled by each 10-20 electrode (mm²).
 *
 * The 10-20 system spaces electrodes ~6 cm apart. Each electrode's
 * sensitivity footprint covers roughly 6 cm² = 600 mm² of cortical
 * surface. This includes both gyral crowns and sulcal walls (the
 * folded cortical surface is ~2-3× the projected area).
 */
const ELECTRODE_AREA_MM2 = 600;

/**
 * Mean pyramidal cell soma diameter by region (micrometers).
 *
 * Layer V pyramidal neurons are the primary generators of EEG signals
 * due to their long apical dendrites oriented perpendicular to the
 * cortical surface. Their size varies dramatically:
 *
 * - Betz cells in motor cortex: up to 100 µm soma diameter
 *   (among the largest neurons in the human nervous system)
 * - Standard pyramidal cells: 15-20 µm soma diameter
 *
 * Values represent the dominant pyramidal population per region.
 */
export const SOMA_DIAMETER_UM: Record<string, number> = {
  F3: 18, F4: 18,   // Standard layer III/V pyramidals
  C3: 35, C4: 35,   // Betz cells — giant pyramidals in primary motor cortex
  T3: 16, T4: 16,   // Slightly smaller pyramidals
  P3: 20, P4: 20,   // Medium-sized pyramidals
  A1: 15, A2: 15,
};

/* ─── Neural Population Estimate ─── */

export interface NeuralEstimate {
  /** Estimated synchronously active neurons under this electrode */
  activeNeurons: number;
  /** Total neurons in the cortical patch under the electrode */
  totalNeurons: number;
  /** Fraction of neurons synchronously active (0–1) */
  syncFraction: number;
  /** Cortical neuron density for this region (neurons/mm²) */
  density: number;
  /** Mean soma diameter for this region (µm) */
  somaDiameter: number;
  /** Lead field value used in the inversion (V/(A·m)) */
  leadField: number;
  /** Number of neurons to render in the animation (density-scaled) */
  renderCount: number;
  /** Relative soma size for rendering (1.0 = standard 18µm) */
  renderSomaScale: number;
}

/**
 * Invert the EEG forward model to estimate the neural population
 * generating the observed scalp voltage.
 *
 * @param voltageRMS_uV  RMS voltage at the electrode (microvolts)
 * @param region         10-20 electrode name (e.g. "F3", "C4")
 * @returns              Neural population estimate with rendering params
 */
export function estimateNeuralPopulation(
  voltageRMS_uV: number,
  region: string,
): NeuralEstimate {
  const G = LEAD_FIELD[region] ?? 25;
  const density = CORTICAL_DENSITY[region] ?? 80_000;
  const soma = SOMA_DIAMETER_UM[region] ?? 18;

  // Inverse model: n = V / (G × q)
  const V = Math.abs(voltageRMS_uV) * 1e-6;        // µV → V
  const Q_total = V / G;                            // total dipole moment (A·m)
  const activeNeurons = Math.round(Q_total / Q_SINGLE_NEURON);

  const totalNeurons = density * ELECTRODE_AREA_MM2;
  const syncFraction = totalNeurons > 0
    ? Math.min(activeNeurons / totalNeurons, 1.0)
    : 0;

  // Map cortical density to rendered neuron count (8–22 neurons).
  // Densest region (prefrontal, 105k/mm²) → 22 rendered neurons.
  // Sparsest cortical region (motor, 62k/mm²) → 8 rendered neurons.
  const MIN_DENSITY = 50_000;
  const MAX_DENSITY = 110_000;
  const densityNorm = Math.max(0, Math.min(1,
    (density - MIN_DENSITY) / (MAX_DENSITY - MIN_DENSITY),
  ));
  const renderCount = Math.round(8 + densityNorm * 14);

  // Soma rendering scale: motor cortex Betz cells are ~2× standard size
  const renderSomaScale = soma / 18;

  return {
    activeNeurons,
    totalNeurons,
    syncFraction,
    density,
    somaDiameter: soma,
    leadField: G,
    renderCount,
    renderSomaScale,
  };
}

/**
 * Format large neuron counts for display: 1,234,567 → "1.23M"
 */
export function formatNeuronCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}
