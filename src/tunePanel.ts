import type { GameTuning, MapType, Preset } from "./constants";
import {
  tuning, saveTuning, _builtinDefaults,
  BUILT_IN_PRESETS, applyBuiltInPreset, applyCustomPreset,
  loadCustomPresets, saveCustomPresets,
  getActivePresetId, setActivePresetId,
  getCurrentTuningSnapshot, resolvePresetValues,
} from "./constants";
import type { PlayerController } from "./player";

const mapChangeListeners: Array<(mapType: MapType) => void> = [];

export function onMapChange(fn: (mapType: MapType) => void): void {
  mapChangeListeners.push(fn);
}

export const TUNE_PANEL_WIDTH = 280;

type SliderDef = {
  key: keyof GameTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
};

type ToggleDef = {
  key: keyof GameTuning;
  label: string;
};

type DropdownDef = {
  key: keyof GameTuning;
  label: string;
  options: { value: string; label: string }[];
  hints?: Record<string, string>;
};

type Section = {
  id: string;
  title: string;
  open?: boolean;
  dropdowns?: DropdownDef[];
  toggles?: ToggleDef[];
  sliders: SliderDef[];
};

const SECTION_STATE_KEY = "retribes_sectionState";

function loadSectionState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTION_STATE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSectionState(id: string, open: boolean): void {
  const state = loadSectionState();
  state[id] = open;
  localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(state));
}

const CAMERA_MODES: { value: string; label: string }[] = [
  { value: "none", label: "None (manual)" },
  { value: "spring", label: "Spring" },
  { value: "smooth", label: "Smooth slerp (on flip)" },
  { value: "snap", label: "Snap on land" },
  { value: "damping", label: "Roll damping" },
  { value: "trajectory", label: "Trajectory (felt forces)" },
  { value: "horizon-lock", label: "Horizon lock (hard)" },
  { value: "predictive", label: "Predictive (look-ahead)" },
];

const CAMERA_MODE_HINTS: Record<string, string> = {
  "none": "No automatic correction — camera roll drifts freely as gravity changes.",
  "spring": "Springs toward a target 'up' direction. Configure target, gating, and fallback below.",
  "smooth": "Smoothly interpolates upright orientation only when gravity flips.",
  "snap": "Instantly snaps to upright the moment you touch the ground.",
  "damping": "Resists roll rate rather than targeting a direction — feels loose but stable.",
  "trajectory": "Derives 'up' from felt acceleration (gravity + thrust) — tilts into movement like a cockpit.",
  "horizon-lock": "Hard-locks roll to the current gravity direction with zero drift tolerance.",
  "predictive": "Anticipates upcoming gravity changes based on your trajectory and pre-rotates.",
};

const SPRING_TARGETS: { value: string; label: string }[] = [
  { value: "gravity", label: "Gravity direction" },
  { value: "blended", label: "Blended (smooth transition)" },
  { value: "surface", label: "Surface normal (grounded)" },
];

const SPRING_GATINGS: { value: string; label: string }[] = [
  { value: "none", label: "None (always active)" },
  { value: "velocity", label: "Velocity-gated" },
  { value: "velocity+deadzone", label: "Velocity + dead zone" },
];

const SPRING_FALLBACKS: { value: string; label: string }[] = [
  { value: "gravity", label: "Gravity direction" },
  { value: "blended", label: "Blended" },
  { value: "hold", label: "Hold (no correction)" },
];

const GRAPPLE_MODES: { value: string; label: string }[] = [
  { value: "winch", label: "Winch (constant pull)" },
  { value: "pendulum", label: "Pendulum (Titanfall)" },
];

const SECTIONS: Section[] = [
  {
    id: "general",
    title: "General",
    open: true,
    sliders: [
      { key: "gravity", label: "Gravity", min: 5, max: 50, step: 0.5 },
      { key: "walkSpeed", label: "Walk speed", min: 4, max: 30, step: 0.5 },
      { key: "skiFriction", label: "Ski friction", min: 0.0001, max: 0.02, step: 0.0001, format: (v) => v.toFixed(4) },
      { key: "groundFriction", label: "Ground friction (walk)", min: 0.02, max: 0.5, step: 0.01 },
      { key: "skiSteerFactor", label: "Ski steering", min: 0.02, max: 0.25, step: 0.01 },
      { key: "airControl", label: "Air control", min: 0.005, max: 0.15, step: 0.005, format: (v) => v.toFixed(3) },
      { key: "playerHeight", label: "Eye height", min: 1.2, max: 2.5, step: 0.05 },
      { key: "groundSnapThreshold", label: "Ground snap", min: 0.05, max: 1.5, step: 0.05 },
      { key: "mouseSensitivity", label: "Mouse sensitivity", min: 0.0005, max: 0.012, step: 0.0001, format: (v) => v.toFixed(4) },
    ],
  },
  {
    id: "gravcam",
    title: "Gravity Camera",
    open: false,
    dropdowns: [
      { key: "gravityCamera", label: "Mode", options: CAMERA_MODES, hints: CAMERA_MODE_HINTS },
      { key: "gravCamTarget", label: "Target", options: SPRING_TARGETS },
      { key: "gravCamGating", label: "Gating", options: SPRING_GATINGS },
      { key: "gravCamAirborneFallback", label: "Airborne fallback", options: SPRING_FALLBACKS },
    ],
    sliders: [
      { key: "gravityRotSpeed", label: "Spring strength", min: 0.5, max: 10.0, step: 0.1 },
      { key: "gravCamDeadZone", label: "Dead zone (m)", min: 0, max: 50, step: 1 },
      { key: "gravCamVelGate", label: "Vel gate threshold", min: 1, max: 30, step: 0.5 },
      { key: "gravCamDamping", label: "Roll damping", min: 0.5, max: 10, step: 0.1 },
    ],
  },
  {
    id: "jetpack",
    title: "Jetpack",
    open: true,
    sliders: [
      { key: "jetThrust", label: "Thrust", min: 10, max: 80, step: 1 },
      { key: "jetEnergyDrain", label: "Energy drain / s", min: 5, max: 60, step: 1 },
      { key: "jetEnergyRegen", label: "Energy regen / s", min: 5, max: 40, step: 1 },
      { key: "jetForwardBias", label: "Forward bias", min: 0, max: 0.5, step: 0.01 },
      { key: "jetRegenDelay", label: "Regen delay (s)", min: 0, max: 1, step: 0.05, format: (v: number) => v.toFixed(2) },
      { key: "jetStartupTime", label: "Startup delay (s)", min: 0, max: 0.1, step: 0.005, format: (v: number) => v.toFixed(3) },
    ],
  },
  {
    id: "grapple",
    title: "Grapple",
    open: false,
    dropdowns: [
      { key: "grappleMode", label: "Mode", options: GRAPPLE_MODES },
    ],
    sliders: [
      { key: "grappleRange", label: "Range", min: 50, max: 500, step: 10 },
      { key: "grappleSpeed", label: "Hook speed", min: 50, max: 600, step: 10 },
      { key: "grapplePull", label: "Pull (winch)", min: 10, max: 150, step: 5 },
      { key: "grappleSwingDamping", label: "Swing damp (winch)", min: 0.8, max: 1, step: 0.01 },
      { key: "grappleReelSpeed", label: "Reel speed", min: 5, max: 120, step: 5 },
      { key: "grappleConnectBoost", label: "Connect boost", min: 0, max: 50, step: 1 },
      { key: "grappleConnectUpBias", label: "Connect up bias", min: 0, max: 30, step: 1 },
      { key: "grappleAutoDetachRadius", label: "Auto-detach dist", min: 1, max: 20, step: 1 },
      { key: "grappleCameraPull", label: "Camera pull", min: 0, max: 1, step: 0.05, format: (v: number) => v.toFixed(2) },
    ],
  },
  {
    id: "impact",
    title: "Impact Feel",
    open: false,
    sliders: [
      { key: "impactThreshold", label: "Threshold", min: 2, max: 30, step: 1 },
      { key: "impactShakeIntensity", label: "Shake", min: 0, max: 3, step: 0.1 },
      { key: "impactFovPunch", label: "FOV punch", min: 0, max: 3, step: 0.1 },
      { key: "impactVignette", label: "Vignette", min: 0, max: 3, step: 0.1 },
    ],
  },
  {
    id: "feel",
    title: "Feel",
    open: false,
    toggles: [
      { key: "enableJetKick", label: "Jet kick (sharp initial burst)" },
      { key: "enableSlopeFriction", label: "Slope-relative ski friction" },
      { key: "enableSpeedLines", label: "Speed lines" },
      { key: "enableFovRateScaling", label: "FOV rate scaling (accel)" },
      { key: "enableLandingAngle", label: "Landing angle matters" },
    ],
    sliders: [
      { key: "coyoteTime", label: "Coyote time (ms)", min: 0, max: 200, step: 10 },
      { key: "landingSquashFov", label: "Landing squash FOV", min: 0, max: 5, step: 0.1 },
      { key: "skiEntryBoost", label: "Ski entry boost", min: 0, max: 15, step: 0.5 },
      { key: "strafeRollAngle", label: "Strafe camera roll (°)", min: 0, max: 8, step: 0.5 },
      { key: "slopeTiltIntensity", label: "Slope camera tilt", min: 0, max: 5, step: 0.1 },
      { key: "speedLineIntensity", label: "Speed line intensity", min: 0.1, max: 2, step: 0.1 },
      { key: "grappleReleaseBoost", label: "Grapple release boost", min: 0, max: 20, step: 1 },
      { key: "landingRecoveryTime", label: "Landing recovery (s)", min: 0, max: 0.5, step: 0.02, format: (v: number) => v.toFixed(2) },
      { key: "skiCamSmoothing", label: "Ski cam smoothing", min: 0, max: 0.95, step: 0.05, format: (v: number) => v.toFixed(2) },
      { key: "landingAngleBoost", label: "Landing align boost", min: 0, max: 3, step: 0.1 },
      { key: "landingAnglePenalty", label: "Landing align penalty", min: 0, max: 3, step: 0.1 },
      { key: "skiGroundAdherence", label: "Ski ground adherence", min: 0, max: 5, step: 0.25, format: (v: number) => v.toFixed(2) },
      { key: "airDrag", label: "Air drag", min: 0, max: 0.5, step: 0.01, format: (v: number) => v.toFixed(2) },
      { key: "slopeSpeedBonus", label: "Slope speed bonus", min: 0, max: 3, step: 0.1 },
      { key: "turnInertia", label: "Turn inertia", min: 0, max: 1, step: 0.05, format: (v: number) => v.toFixed(2) },
      { key: "airControlSpeedReduction", label: "Air ctrl speed decay", min: 0, max: 1, step: 0.05, format: (v: number) => v.toFixed(2) },
      { key: "landingCameraDip", label: "Landing camera dip", min: 0, max: 5, step: 0.1 },
      { key: "chainBonusWindow", label: "Chain bonus window (s)", min: 0, max: 5, step: 0.25, format: (v: number) => v.toFixed(2) },
      { key: "chainBonusMultiplier", label: "Chain bonus per link", min: 0, max: 0.2, step: 0.01, format: (v: number) => v.toFixed(2) },
    ],
  },
  {
    id: "visuals",
    title: "Visuals",
    open: false,
    toggles: [
      { key: "enableToneMapping", label: "Tone mapping" },
      { key: "enableSkyGradient", label: "Sky gradient" },
      { key: "enableVertexColors", label: "Terrain colors" },
      { key: "enableHemisphereLight", label: "Hemisphere light" },
      { key: "enableFovScaling", label: "Speed FOV" },
      { key: "enableJetParticles", label: "Jet particles" },
      { key: "enableSkiParticles", label: "Ski dust" },
      { key: "enableMarkers", label: "Terrain markers" },
      { key: "enableCeiling", label: "Ceiling (flat)" },
    ],
    sliders: [
      { key: "toneMappingExposure", label: "Exposure", min: 0.3, max: 2.5, step: 0.05 },
      { key: "hemisphereLightIntensity", label: "Hemi intensity", min: 0.1, max: 1.5, step: 0.05 },
      { key: "fovScaleAmount", label: "FOV scale", min: 0.05, max: 0.4, step: 0.01 },
      { key: "fogNear", label: "Fog near", min: 20, max: 1000, step: 10 },
      { key: "fogFar", label: "Fog far", min: 100, max: 3000, step: 25 },
      { key: "cameraFar", label: "Render dist", min: 500, max: 4000, step: 50 },
    ],
  },
];

// --- FPS counter ---
let fpsEl: HTMLElement | null = null;
let fpsFrames = 0;
let fpsLastTime = performance.now();

export function updateFPS(): void {
  if (!fpsEl) return;
  fpsFrames++;
  const now = performance.now();
  const elapsed = now - fpsLastTime;
  if (elapsed >= 500) {
    const fps = Math.round((fpsFrames * 1000) / elapsed);
    fpsEl.textContent = `${fps} fps`;
    fpsFrames = 0;
    fpsLastTime = now;
  }
}

const PANEL_VISIBLE_KEY = "retribes_panelVisible";
let panelVisible = (() => {
  try {
    const v = localStorage.getItem(PANEL_VISIBLE_KEY);
    return v === null ? false : v === "1";
  } catch {
    return true;
  }
})();
const visibilityListeners: Array<(visible: boolean) => void> = [];

export function onTunePanelToggle(fn: (visible: boolean) => void): void {
  visibilityListeners.push(fn);
}

export function initTunePanel(player: PlayerController): { initialVisible: boolean } {
  const root = document.createElement("div");
  root.id = "tune-panel";
  root.innerHTML = `
    <div class="tune-panel__top-bar">
      <div class="tune-panel__header">Game feel</div>
      <div class="tune-panel__fps" id="tune-fps"></div>
    </div>
    <div class="tune-panel__rows" id="tune-rows"></div>
    <div class="tune-panel__buttons">
      <button type="button" class="tune-panel__save-btn" id="tune-save-preset">Save preset</button>
      <button type="button" class="tune-panel__delete-btn" id="tune-delete-preset" style="display:none">Delete</button>
    </div>
  `;
  fpsEl = root.querySelector("#tune-fps")!;

  const style = document.createElement("style");
  style.textContent = `
    #tune-panel {
      position: fixed;
      left: 0;
      top: 0;
      width: ${TUNE_PANEL_WIDTH}px;
      height: 100%;
      z-index: 8;
      background: rgba(18, 22, 28, 0.92);
      border-right: 1px solid rgba(255,255,255,0.12);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #e8eaed;
      display: flex;
      flex-direction: column;
      padding: 12px 14px 16px;
      box-sizing: border-box;
      overflow: hidden;
    }
    .tune-panel__top-bar {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 10px;
      flex-shrink: 0;
    }
    .tune-panel__header {
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.02em;
    }
    .tune-panel__fps {
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      color: #8ab4f8;
      opacity: 0.85;
    }
    .tune-panel__rows {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding-right: 4px;
      margin-bottom: 12px;
    }
    .tune-section {
      margin-bottom: 6px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      overflow: hidden;
    }
    .tune-section summary {
      padding: 7px 10px;
      cursor: pointer;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      opacity: 0.7;
      background: rgba(255,255,255,0.04);
      user-select: none;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tune-section summary::-webkit-details-marker { display: none; }
    .tune-section summary::before {
      content: "\\25B8";
      font-size: 10px;
      transition: transform 0.15s;
    }
    .tune-section[open] summary::before {
      transform: rotate(90deg);
    }
    .tune-section summary:hover {
      opacity: 0.9;
    }
    .tune-section__body {
      padding: 8px 10px 4px;
    }
    .tune-row {
      margin-bottom: 10px;
    }
    .tune-row label {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 4px;
      gap: 8px;
    }
    .tune-row .tune-name {
      opacity: 0.85;
    }
    .tune-row .tune-val {
      font-variant-numeric: tabular-nums;
      opacity: 0.65;
      font-size: 11px;
    }
    .tune-row input[type="range"] {
      width: 100%;
      height: 6px;
      accent-color: #5b9fd4;
    }
    .tune-row select {
      width: 100%;
      padding: 4px 6px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 4px;
      color: inherit;
      font-size: 12px;
    }
    .tune-toggle {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .tune-toggle .tune-name {
      opacity: 0.85;
    }
    .tune-toggle input[type="checkbox"] {
      appearance: none;
      -webkit-appearance: none;
      width: 32px;
      height: 18px;
      min-width: 32px;
      background: rgba(255,255,255,0.15);
      border-radius: 9px;
      position: relative;
      cursor: pointer;
      transition: background 0.2s;
    }
    .tune-toggle input[type="checkbox"]::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      background: #fff;
      border-radius: 50%;
      transition: left 0.15s;
    }
    .tune-toggle input[type="checkbox"]:checked {
      background: #5b9fd4;
    }
    .tune-toggle input[type="checkbox"]:checked::after {
      left: 16px;
    }
    .tune-panel__buttons {
      flex-shrink: 0;
      display: flex;
      gap: 8px;
    }
    .tune-panel__save-btn {
      flex: 1;
      padding: 8px 12px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      color: inherit;
      cursor: pointer;
      font-size: 12px;
    }
    .tune-panel__save-btn:hover {
      background: rgba(255,255,255,0.12);
    }
    .tune-panel__save-btn.dirty {
      border-color: #5b9fd4;
      color: #8ab4f8;
    }
    .tune-panel__delete-btn {
      padding: 8px 12px;
      background: rgba(255,80,80,0.15);
      border: 1px solid rgba(255,80,80,0.3);
      border-radius: 6px;
      color: #ff8888;
      cursor: pointer;
      font-size: 12px;
    }
    .tune-panel__delete-btn:hover {
      background: rgba(255,80,80,0.25);
    }
    .tune-dropdown-hint {
      font-size: 11px;
      color: rgba(255,255,255,0.45);
      line-height: 1.3;
      padding: 2px 0 6px;
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(root);

  const rowsEl = root.querySelector("#tune-rows")!;
  const valueEls = new Map<keyof GameTuning, HTMLElement>();
  const allSliderInputs: { def: SliderDef; input: HTMLInputElement }[] = [];
  const allToggleInputs: { def: ToggleDef; input: HTMLInputElement }[] = [];

  // --- Map selector dropdown ---
  const mapRow = document.createElement("div");
  mapRow.className = "tune-row";
  mapRow.style.marginBottom = "12px";
  const mapLabel = document.createElement("label");
  const mapName = document.createElement("span");
  mapName.className = "tune-name";
  mapName.textContent = "Map";
  mapLabel.appendChild(mapName);

  const MAP_TYPES: { value: MapType; label: string }[] = [
    { value: "flat", label: "Flat (dual gravity)" },
    { value: "sphere", label: "Inside sphere" },
  ];

  const mapSelect = document.createElement("select");
  for (const mt of MAP_TYPES) {
    const opt = document.createElement("option");
    opt.value = mt.value;
    opt.textContent = mt.label;
    mapSelect.appendChild(opt);
  }
  mapSelect.value = tuning.mapType;

  mapSelect.addEventListener("change", () => {
    tuning.mapType = mapSelect.value as MapType;
    saveTuning();
    updateDirtyState();
    for (const fn of mapChangeListeners) fn(tuning.mapType);
  });

  mapRow.appendChild(mapLabel);
  mapRow.appendChild(mapSelect);
  rowsEl.appendChild(mapRow);

  // --- Preset selector ---
  let customPresets = loadCustomPresets();
  let currentPresetId: string | null = getActivePresetId();
  let currentPresetBuiltIn = currentPresetId !== null
    ? BUILT_IN_PRESETS.some(p => p.id === currentPresetId)
    : true;

  const NEW_PRESET_VALUE = "__new__";

  const presetRow = document.createElement("div");
  presetRow.className = "tune-row";
  presetRow.style.marginBottom = "12px";
  const presetLabel = document.createElement("label");
  const presetName = document.createElement("span");
  presetName.className = "tune-name";
  presetName.textContent = "Preset";
  presetLabel.appendChild(presetName);

  const presetSelect = document.createElement("select");

  function rebuildPresetOptions(): void {
    presetSelect.innerHTML = "";
    for (const p of BUILT_IN_PRESETS) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      presetSelect.appendChild(opt);
    }
    for (const p of customPresets) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      presetSelect.appendChild(opt);
    }
    const newOpt = document.createElement("option");
    newOpt.value = NEW_PRESET_VALUE;
    newOpt.textContent = "+ New preset";
    presetSelect.appendChild(newOpt);
  }
  rebuildPresetOptions();

  if (currentPresetId) {
    presetSelect.value = currentPresetId;
  } else {
    presetSelect.value = BUILT_IN_PRESETS[0].id;
    currentPresetId = BUILT_IN_PRESETS[0].id;
    currentPresetBuiltIn = true;
  }

  const saveBtn = root.querySelector("#tune-save-preset") as HTMLButtonElement;
  const deleteBtn = root.querySelector("#tune-delete-preset") as HTMLButtonElement;

  function getActivePresetResolved(): GameTuning {
    if (currentPresetId === null) return getCurrentTuningSnapshot();
    if (currentPresetBuiltIn) {
      const p = BUILT_IN_PRESETS.find(bp => bp.id === currentPresetId);
      return p ? resolvePresetValues(p, true) : { ..._builtinDefaults };
    }
    const cp = customPresets.find(p => p.id === currentPresetId);
    return cp ? resolvePresetValues(cp, false) : { ..._builtinDefaults };
  }

  function isPresetDirty(): boolean {
    if (currentPresetId === null) return true;
    const resolved = getActivePresetResolved();
    for (const key of Object.keys(resolved) as (keyof GameTuning)[]) {
      if (tuning[key] !== resolved[key]) return true;
    }
    return false;
  }

  function updateDirtyState(): void {
    const dirty = isPresetDirty();
    saveBtn.textContent = dirty ? "Save preset *" : "Save preset";
    saveBtn.classList.toggle("dirty", dirty);
    deleteBtn.style.display = (!currentPresetBuiltIn && currentPresetId !== null) ? "" : "none";
  }

  function generateCustomName(baseName: string): string {
    const existing = customPresets.map(p => p.label);
    for (let i = 1; ; i++) {
      const name = `${baseName} ${i}`;
      if (!existing.includes(name)) return name;
    }
  }

  function generateCustomId(): string {
    return "custom_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  presetSelect.addEventListener("change", () => {
    const val = presetSelect.value;
    const prevMap = tuning.mapType;

    if (val === NEW_PRESET_VALUE) {
      currentPresetId = null;
      currentPresetBuiltIn = false;
      setActivePresetId(null);
      updateDirtyState();
      return;
    }

    const builtIn = BUILT_IN_PRESETS.find(p => p.id === val);
    if (builtIn) {
      applyBuiltInPreset(val);
      currentPresetId = val;
      currentPresetBuiltIn = true;
    } else {
      const custom = customPresets.find(p => p.id === val);
      if (custom) {
        applyCustomPreset(custom);
        currentPresetId = val;
        currentPresetBuiltIn = false;
      }
    }

    setActivePresetId(currentPresetId);
    syncUIFromTuning();
    updateDirtyState();
    if (tuning.mapType !== prevMap) {
      for (const fn of mapChangeListeners) fn(tuning.mapType);
    }
    player.snapToGround();
  });

  presetRow.appendChild(presetLabel);
  presetRow.appendChild(presetSelect);
  rowsEl.appendChild(presetRow);

  // --- Per-mode visibility for gravity camera ---
  let gravCamBody: HTMLElement | null = null;

  function updateGravCamVisibility(): void {
    if (!gravCamBody) return;
    const mode = tuning.gravityCamera;
    const isSpring = mode === "spring";
    const target = tuning.gravCamTarget;
    const gating = tuning.gravCamGating;

    const visibility: Record<string, boolean> = {
      gravCamTarget: isSpring,
      gravCamGating: isSpring,
      gravCamAirborneFallback: isSpring && target === "surface",
      gravityRotSpeed: isSpring || mode === "smooth" || mode === "trajectory" || mode === "predictive",
      gravCamVelGate: isSpring && (gating === "velocity" || gating === "velocity+deadzone"),
      gravCamDeadZone: isSpring && gating === "velocity+deadzone",
      gravCamDamping: mode === "damping",
    };

    const rows = gravCamBody.querySelectorAll<HTMLElement>("[data-tuning-key]");
    for (const el of rows) {
      const key = el.dataset.tuningKey!;
      if (key in visibility) {
        el.style.display = visibility[key] ? "" : "none";
      }
    }
  }

  // --- Collapsible sections ---
  const allDropdownInputs: { key: keyof GameTuning; select: HTMLSelectElement; hintEl?: HTMLElement; hints?: Record<string, string> }[] = [];
  function buildSliderRow(def: SliderDef, container: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "tune-row";
    row.dataset.tuningKey = def.key;
    const valSpan = document.createElement("span");
    valSpan.className = "tune-val";
    valueEls.set(def.key, valSpan);

    const label = document.createElement("label");
    const name = document.createElement("span");
    name.className = "tune-name";
    name.textContent = def.label;
    label.appendChild(name);
    label.appendChild(valSpan);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);

    const fmt = def.format ?? ((v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2)));

    const v = tuning[def.key] as number;
    input.value = String(v);
    valSpan.textContent = fmt(v);

    input.addEventListener("input", () => {
      const val = parseFloat(input.value);
      (tuning as unknown as Record<string, number>)[def.key] = val;
      valSpan.textContent = fmt(val);
      saveTuning();
      updateDirtyState();
      if (def.key === "playerHeight") {
        player.snapToGround();
      }
    });

    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
    allSliderInputs.push({ def, input });
  }

  function buildToggleRow(def: ToggleDef, container: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "tune-toggle";

    const name = document.createElement("span");
    name.className = "tune-name";
    name.textContent = def.label;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = tuning[def.key] as boolean;

    input.addEventListener("change", () => {
      (tuning as unknown as Record<string, boolean>)[def.key] = input.checked;
      saveTuning();
      updateDirtyState();
    });

    row.appendChild(name);
    row.appendChild(input);
    container.appendChild(row);
    allToggleInputs.push({ def, input });
  }

  const savedState = loadSectionState();

  for (const section of SECTIONS) {
    const details = document.createElement("details");
    details.className = "tune-section";
    const isOpen = savedState[section.id] ?? section.open ?? false;
    if (isOpen) details.open = true;

    details.addEventListener("toggle", () => {
      saveSectionState(section.id, details.open);
    });

    const summary = document.createElement("summary");
    summary.textContent = section.title;
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "tune-section__body";

    if (section.dropdowns) {
      for (const dd of section.dropdowns) {
        const row = document.createElement("div");
        row.className = "tune-row";
        row.dataset.tuningKey = dd.key;
        const label = document.createElement("label");
        const name = document.createElement("span");
        name.className = "tune-name";
        name.textContent = dd.label;
        label.appendChild(name);

        const sel = document.createElement("select");
        for (const o of dd.options) {
          const opt = document.createElement("option");
          opt.value = o.value;
          opt.textContent = o.label;
          sel.appendChild(opt);
        }
        sel.value = tuning[dd.key] as string;
        let hintEl: HTMLElement | null = null;
        if (dd.hints) {
          hintEl = document.createElement("div");
          hintEl.className = "tune-dropdown-hint";
          hintEl.dataset.tuningKey = dd.key;
          hintEl.textContent = dd.hints[sel.value] ?? "";
        }

        sel.addEventListener("change", () => {
          (tuning as unknown as Record<string, string>)[dd.key] = sel.value;
          saveTuning();
          updateDirtyState();
          if (hintEl && dd.hints) {
            hintEl.textContent = dd.hints[sel.value] ?? "";
          }
          updateGravCamVisibility();
        });

        row.appendChild(label);
        row.appendChild(sel);
        body.appendChild(row);
        if (hintEl) body.appendChild(hintEl);
        allDropdownInputs.push({ key: dd.key, select: sel, hintEl: hintEl ?? undefined, hints: dd.hints });
      }
    }
    if (section.toggles) {
      for (const def of section.toggles) {
        buildToggleRow(def, body);
      }
    }
    for (const def of section.sliders) {
      buildSliderRow(def, body);
    }

    if (section.id === "gravcam") {
      gravCamBody = body;
    }

    details.appendChild(body);
    rowsEl.appendChild(details);
  }

  updateGravCamVisibility();

  function syncUIFromTuning(): void {
    mapSelect.value = tuning.mapType;
    for (const { key, select, hintEl, hints } of allDropdownInputs) {
      select.value = tuning[key] as string;
      if (hintEl && hints) {
        hintEl.textContent = hints[select.value] ?? "";
      }
    }
    for (const { def, input } of allSliderInputs) {
      const v = tuning[def.key] as number;
      const fmt = def.format ?? ((vn: number) => (Number.isInteger(vn) ? String(vn) : vn.toFixed(2)));
      input.value = String(v);
      const valSpan = valueEls.get(def.key)!;
      valSpan.textContent = fmt(v);
    }
    for (const { def, input } of allToggleInputs) {
      input.checked = tuning[def.key] as boolean;
    }
    updateGravCamVisibility();
  }

  // --- Save preset ---
  saveBtn.addEventListener("click", () => {
    const snapshot = getCurrentTuningSnapshot();

    if (currentPresetBuiltIn && currentPresetId !== null) {
      const builtIn = BUILT_IN_PRESETS.find(p => p.id === currentPresetId);
      const baseName = builtIn ? builtIn.label : "Custom";
      const newPreset: Preset = {
        id: generateCustomId(),
        label: generateCustomName(baseName),
        values: snapshot,
      };
      customPresets.push(newPreset);
      saveCustomPresets(customPresets);
      currentPresetId = newPreset.id;
      currentPresetBuiltIn = false;
      setActivePresetId(currentPresetId);
      rebuildPresetOptions();
      presetSelect.value = currentPresetId;
    } else if (currentPresetId === null) {
      const newPreset: Preset = {
        id: generateCustomId(),
        label: generateCustomName("Custom"),
        values: snapshot,
      };
      customPresets.push(newPreset);
      saveCustomPresets(customPresets);
      currentPresetId = newPreset.id;
      currentPresetBuiltIn = false;
      setActivePresetId(currentPresetId);
      rebuildPresetOptions();
      presetSelect.value = currentPresetId;
    } else {
      const idx = customPresets.findIndex(p => p.id === currentPresetId);
      if (idx !== -1) {
        customPresets[idx].values = snapshot;
        saveCustomPresets(customPresets);
      }
    }
    updateDirtyState();
  });

  // --- Delete preset ---
  deleteBtn.addEventListener("click", () => {
    if (currentPresetBuiltIn || currentPresetId === null) return;
    customPresets = customPresets.filter(p => p.id !== currentPresetId);
    saveCustomPresets(customPresets);
    currentPresetId = BUILT_IN_PRESETS[0].id;
    currentPresetBuiltIn = true;
    setActivePresetId(currentPresetId);

    const prevMap = tuning.mapType;
    applyBuiltInPreset(currentPresetId);
    rebuildPresetOptions();
    presetSelect.value = currentPresetId;
    syncUIFromTuning();
    updateDirtyState();
    if (tuning.mapType !== prevMap) {
      for (const fn of mapChangeListeners) fn(tuning.mapType);
    }
    player.snapToGround();
  });

  // Set initial dirty state
  updateDirtyState();

  // Apply initial visibility from localStorage
  if (!panelVisible) {
    root.style.display = "none";
    for (const fn of visibilityListeners) fn(false);
  }

  // --- Toggle visibility ---
  document.addEventListener("keydown", (e) => {
    if ((e.code === "KeyF" || e.code === "Tab") && document.pointerLockElement) {
      e.preventDefault();
      panelVisible = !panelVisible;
      root.style.display = panelVisible ? "flex" : "none";
      localStorage.setItem(PANEL_VISIBLE_KEY, panelVisible ? "1" : "0");
      for (const fn of visibilityListeners) fn(panelVisible);
    }
  });

  return { initialVisible: panelVisible };
}
