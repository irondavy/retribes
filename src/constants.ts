export type GravityCameraMode =
  | "none"         // fully manual
  | "smooth"       // slerp on flip
  | "snap"         // instant on land
  | "spring"       // parameterized spring correction (target/gating/fallback sub-options)
  | "damping"      // damps roll rate instead of seeking a target
  | "trajectory"   // up derived from non-gravitational forces (felt acceleration)
  | "horizon-lock" // hard roll lock to current gravity direction
  | "predictive";  // anticipates gravity change based on trajectory
export type GravCamTarget = "gravity" | "blended" | "surface";
export type GravCamGating = "none" | "velocity" | "velocity+deadzone";
export type GravCamAirborneFallback = "gravity" | "blended" | "hold";
export type MapType = "flat" | "sphere";
export type GrappleMode = "winch" | "pendulum";

export interface GameTuning {
  mapType: MapType;
  gravity: number;
  skiFriction: number;
  groundFriction: number;
  jetThrust: number;
  jetEnergyDrain: number;
  jetEnergyRegen: number;
  airControl: number;
  playerHeight: number;
  walkSpeed: number;
  mouseSensitivity: number;
  invertY: boolean;
  groundSnapThreshold: number;
  skiSteerFactor: number;
  jetForwardBias: number;
  gravityCamera: GravityCameraMode;
  gravCamTarget: GravCamTarget;
  gravCamGating: GravCamGating;
  gravCamAirborneFallback: GravCamAirborneFallback;
  gravityRotSpeed: number;
  gravCamDeadZone: number;
  gravCamVelGate: number;
  gravCamDamping: number;
  grappleMode: GrappleMode;
  grappleRange: number;
  grappleSpeed: number;
  grapplePull: number;
  grappleSwingDamping: number;
  grappleReelSpeed: number;
  grappleConnectBoost: number;
  grappleConnectUpBias: number;
  grappleAutoDetachRadius: number;

  enableSkyGradient: boolean;
  enableVertexColors: boolean;
  enableHemisphereLight: boolean;
  hemisphereLightIntensity: number;
  enableFovScaling: boolean;
  fovScaleAmount: number;
  enableJetParticles: boolean;
  enableSkiParticles: boolean;
  enableToneMapping: boolean;
  toneMappingExposure: number;
  enableMarkers: boolean;
  enableCeiling: boolean;
  fogNear: number;
  fogFar: number;
  cameraFar: number;

  impactThreshold: number;
  impactShakeIntensity: number;
  impactFovPunch: number;
  impactVignette: number;

  // Feel
  coyoteTime: number;
  landingSquashFov: number;
  skiEntryBoost: number;
  strafeRollAngle: number;
  slopeTiltIntensity: number;
  enableSpeedLines: boolean;
  speedLineIntensity: number;
  grappleReleaseBoost: number;
  enableJetKick: boolean;
  enableSlopeFriction: boolean;
  landingRecoveryTime: number;
  skiCamSmoothing: number;
  enableFovRateScaling: boolean;
  enableLandingAngle: boolean;
  landingAngleBoost: number;
  landingAnglePenalty: number;
  skiGroundAdherence: number;

  jetRegenDelay: number;
  airDrag: number;
  slopeSpeedBonus: number;
  chainBonusWindow: number;
  chainBonusMultiplier: number;
  grappleCameraPull: number;
  airControlSpeedReduction: number;
  landingCameraDip: number;
  turnInertia: number;
  jetStartupTime: number;

  enableMantle: boolean;
  mantleReach: number;
  mantleSpeed: number;
  mantleMomentumPreserve: number;
}

export const _builtinDefaults: GameTuning = {
  mapType: "flat",
  gravity: 20,
  skiFriction: 0.001,
  groundFriction: 0.15,
  jetThrust: 38,
  jetEnergyDrain: 25,
  jetEnergyRegen: 15,
  airControl: 0.02,
  playerHeight: 1.8,
  walkSpeed: 12,
  mouseSensitivity: 0.002,
  invertY: false,
  groundSnapThreshold: 0.5,
  skiSteerFactor: 0.08,
  jetForwardBias: 0.15,
  gravityCamera: "none",
  gravCamTarget: "gravity",
  gravCamGating: "none",
  gravCamAirborneFallback: "gravity",
  gravityRotSpeed: 2.0,
  gravCamDeadZone: 15,
  gravCamVelGate: 8,
  gravCamDamping: 3.0,
  grappleMode: "pendulum",
  grappleRange: 200,
  grappleSpeed: 120,
  grapplePull: 60,
  grappleSwingDamping: 0.98,
  grappleReelSpeed: 40,
  grappleConnectBoost: 15,
  grappleConnectUpBias: 10,
  grappleAutoDetachRadius: 5,

  enableSkyGradient: true,
  enableVertexColors: true,
  enableHemisphereLight: true,
  hemisphereLightIntensity: 0.6,
  enableFovScaling: true,
  fovScaleAmount: 0.15,
  enableJetParticles: true,
  enableSkiParticles: true,
  enableToneMapping: true,
  toneMappingExposure: 1.0,
  enableMarkers: true,
  enableCeiling: true,
  fogNear: 300,
  fogFar: 800,
  cameraFar: 2500,

  impactThreshold: 8,
  impactShakeIntensity: 1.0,
  impactFovPunch: 1.0,
  impactVignette: 1.0,

  coyoteTime: 0,
  landingSquashFov: 0,
  skiEntryBoost: 0,
  strafeRollAngle: 0,
  slopeTiltIntensity: 0,
  enableSpeedLines: false,
  speedLineIntensity: 0.5,
  grappleReleaseBoost: 0,
  enableJetKick: false,
  enableSlopeFriction: false,
  landingRecoveryTime: 0,
  skiCamSmoothing: 0,
  enableFovRateScaling: false,
  enableLandingAngle: false,
  landingAngleBoost: 1.0,
  landingAnglePenalty: 1.0,
  skiGroundAdherence: 0,

  jetRegenDelay: 0,
  airDrag: 0,
  slopeSpeedBonus: 0,
  chainBonusWindow: 0,
  chainBonusMultiplier: 0,
  grappleCameraPull: 0,
  airControlSpeedReduction: 0,
  landingCameraDip: 0,
  turnInertia: 0,
  jetStartupTime: 0,

  enableMantle: false,
  mantleReach: 4,
  mantleSpeed: 8,
  mantleMomentumPreserve: 0.5,
};

const STORAGE_KEY = "retribes_tuning";
const CUSTOM_PRESETS_KEY = "retribes_customPresets";
const ACTIVE_PRESET_KEY = "retribes_activePreset";

function loadFromStorage(key: string): Partial<GameTuning> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt data */ }
  return {};
}

/** Live values — mutated by the tune panel at runtime. */
export const tuning: GameTuning = { ..._builtinDefaults, ...loadFromStorage(STORAGE_KEY) };

export function saveTuning(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
  } catch { /* storage full / blocked */ }
}

export function loadCustomPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt data */ }
  return [];
}

export function saveCustomPresets(presets: Preset[]): void {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  } catch { /* storage full / blocked */ }
}

export function getActivePresetId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PRESET_KEY);
  } catch { return null; }
}

export function setActivePresetId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(ACTIVE_PRESET_KEY);
    else localStorage.setItem(ACTIVE_PRESET_KEY, id);
  } catch { /* noop */ }
}

export function getCurrentTuningSnapshot(): GameTuning {
  return { ...tuning };
}

/** Resolve what a preset's full tuning state would be. */
export function resolvePresetValues(preset: Preset, isBuiltIn: boolean): GameTuning {
  if (isBuiltIn) {
    return { ..._builtinDefaults, ...preset.values };
  }
  return preset.values as GameTuning;
}

export interface Preset {
  id: string;
  label: string;
  values: Partial<GameTuning>;
}

export const BUILT_IN_PRESETS: Preset[] = [
  {
    id: "default",
    label: "Default",
    values: {
      // Skiing focus
      enableSlopeFriction: true,
      enableLandingAngle: true,
      landingAngleBoost: 1,
      landingAnglePenalty: 1,
      skiGroundAdherence: 2,
      skiCamSmoothing: 0.5,
      slopeSpeedBonus: 1.5,
      // Gravity camera
      gravityCamera: "spring",
      gravCamTarget: "surface",
      gravCamAirborneFallback: "blended",
      gravityRotSpeed: 1,
      // Grapple (from Titanfall)
      grappleMode: "pendulum",
      grappleReelSpeed: 60,
      grappleConnectBoost: 20,
      grappleConnectUpBias: 12,
      grappleReleaseBoost: 10,
      grappleCameraPull: 0.5,
      // Air movement (from Titanfall)
      airControlSpeedReduction: 0.35,
      airDrag: 0.03,
      turnInertia: 0.2,
      // Momentum / jet (from Titanfall)
      coyoteTime: 100,
      enableJetKick: true,
      skiEntryBoost: 4,
      chainBonusWindow: 2,
      chainBonusMultiplier: 0.01,
      jetRegenDelay: 0.4,
      // Camera / feel (from Titanfall)
      strafeRollAngle: 3,
      enableFovRateScaling: true,
      enableSpeedLines: true,
      speedLineIntensity: 0.7,
      landingCameraDip: 1.0,
      landingSquashFov: 1.0,
      landingRecoveryTime: 0.1,
      // Player / visuals
      playerHeight: 1.8,
      enableSkyGradient: false,
      fogNear: 20,
      fogFar: 1500,
    },
  },
  {
    id: "tribes",
    label: "Tribes",
    values: {
      enableSlopeFriction: true,
      enableLandingAngle: true,
      landingAngleBoost: 1,
      landingAnglePenalty: 1,
      skiGroundAdherence: 2,
      skiCamSmoothing: 0.5,
      gravityCamera: "spring",
      gravCamTarget: "surface",
      gravCamAirborneFallback: "gravity",
      jetRegenDelay: 0.4,
      airDrag: 0.15,
      slopeSpeedBonus: 1.5,
      turnInertia: 0.35,
      airControlSpeedReduction: 0.45,
      landingRecoveryTime: 0.1,
    },
  },
  {
    id: "titanfall",
    label: "Titanfall",
    values: {
      grappleMode: "pendulum",
      grappleReelSpeed: 60,
      grappleConnectBoost: 20,
      grappleConnectUpBias: 12,
      grappleReleaseBoost: 10,
      grappleCameraPull: 0.5,
      coyoteTime: 100,
      enableJetKick: true,
      enableSlopeFriction: true,
      skiEntryBoost: 4,
      chainBonusWindow: 2,
      chainBonusMultiplier: 0.06,
      airControlSpeedReduction: 0.35,
      airDrag: 0.03,
      turnInertia: 0.2,
      strafeRollAngle: 3,
      enableFovRateScaling: true,
      enableSpeedLines: true,
      speedLineIntensity: 0.7,
      landingCameraDip: 1.0,
      landingSquashFov: 1.0,
      gravityCamera: "spring",
      gravCamTarget: "gravity",
      gravCamGating: "none",
      gravityRotSpeed: 3.5,
    },
  },
  {
    id: "heavy",
    label: "Heavy",
    values: {
      gravity: 28,
      airDrag: 0.25,
      turnInertia: 0.6,
      airControlSpeedReduction: 0.6,
      enableSlopeFriction: true,
      enableLandingAngle: true,
      landingAnglePenalty: 1.5,
      skiGroundAdherence: 2.5,
      landingRecoveryTime: 0.2,
      jetThrust: 32,
      jetStartupTime: 0.06,
      enableJetKick: true,
      jetRegenDelay: 0.6,
      impactShakeIntensity: 2,
      impactFovPunch: 2,
      impactVignette: 2,
      landingSquashFov: 3,
      landingCameraDip: 2.5,
      slopeTiltIntensity: 2,
      skiCamSmoothing: 0.6,
      gravityCamera: "spring",
      gravCamTarget: "gravity",
    },
  },
  {
    id: "frictionless",
    label: "Frictionless",
    values: {
      skiFriction: 0.0002,
      airDrag: 0,
      turnInertia: 0,
      landingRecoveryTime: 0,
      airControlSpeedReduction: 0,
      skiEntryBoost: 6,
      grappleReleaseBoost: 12,
      chainBonusWindow: 3,
      chainBonusMultiplier: 0.08,
      grappleMode: "pendulum",
      enableSpeedLines: true,
      speedLineIntensity: 0.9,
      enableFovRateScaling: true,
      strafeRollAngle: 4,
      gravityCamera: "trajectory",
    },
  },
  {
    id: "clean",
    label: "Clean",
    values: {
      enableSlopeFriction: true,
      enableLandingAngle: true,
      landingAngleBoost: 1,
      landingAnglePenalty: 1,
      skiGroundAdherence: 1.5,
      slopeSpeedBonus: 0.8,
      airDrag: 0.1,
      turnInertia: 0.25,
      airControlSpeedReduction: 0.4,
      landingRecoveryTime: 0.08,
      jetRegenDelay: 0.3,
      skiCamSmoothing: 0.4,
      coyoteTime: 80,
      gravityCamera: "horizon-lock",
    },
  },
];

export function applyBuiltInPreset(id: string): void {
  const preset = BUILT_IN_PRESETS.find(p => p.id === id);
  if (!preset) return;
  Object.assign(tuning, _builtinDefaults, preset.values);
  saveTuning();
}

export function applyCustomPreset(preset: Preset): void {
  Object.assign(tuning, preset.values);
  saveTuning();
}
