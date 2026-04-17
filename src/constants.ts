export type GravityCameraMode =
  | "none"        // fully manual
  | "smooth"      // slerp on flip
  | "snap"        // instant on land
  | "spring"      // continuous spring toward hard target up
  | "blend"       // spring toward blended target up (smooth through transition)
  | "velocity"    // spring only when near ground / low vertical speed
  | "damping"     // damps roll rate instead of seeking a target
  | "blend+vel"   // blend + velocity gating combined
  | "surface"     // ground normal when grounded, gravity when airborne
  | "hybrid"      // ground normal when grounded, blended when airborne
  | "trajectory"  // up derived from non-gravitational forces (felt acceleration)
  | "horizon-lock" // hard roll lock to current gravity direction
  | "predictive"; // anticipates gravity change based on trajectory
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
  groundSnapThreshold: number;
  skiSteerFactor: number;
  jetForwardBias: number;
  gravityCamera: GravityCameraMode;
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
  groundSnapThreshold: 0.5,
  skiSteerFactor: 0.08,
  jetForwardBias: 0.15,
  gravityCamera: "none",
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
};

const STORAGE_KEY = "retribes_tuning";
const DEFAULTS_KEY = "retribes_customDefaults";

function loadFromStorage(key: string): Partial<GameTuning> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt data */ }
  return {};
}

export const tuningDefaults: GameTuning = { ..._builtinDefaults, ...loadFromStorage(DEFAULTS_KEY) };

/** Live values — mutated by the tune panel at runtime. */
export const tuning: GameTuning = { ...tuningDefaults, ...loadFromStorage(STORAGE_KEY) };

export function saveTuning(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
  } catch { /* storage full / blocked */ }
}

export function resetTuning(): void {
  Object.assign(tuning, tuningDefaults);
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

export function saveAsDefaults(): void {
  Object.assign(tuningDefaults, tuning);
  try {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(tuningDefaults));
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage full / blocked */ }
}

export interface Preset {
  id: string;
  label: string;
  values: Partial<GameTuning>;
}

export const PRESETS: Preset[] = [
  {
    id: "default",
    label: "Default",
    values: {},
  },
  {
    id: "tribes",
    label: "Tribes purist",
    values: {
      enableSlopeFriction: true,
      enableLandingAngle: true,
      landingAngleBoost: 1,
      landingAnglePenalty: 1,
      skiGroundAdherence: 2,
      skiCamSmoothing: 0.5,
      gravityCamera: "surface",
      jetRegenDelay: 0.4,
      airDrag: 0.15,
      slopeSpeedBonus: 1.5,
    },
  },
  {
    id: "momentum",
    label: "Momentum",
    values: {
      grappleMode: "pendulum",
      grappleReleaseBoost: 10,
      skiEntryBoost: 5,
      strafeRollAngle: 3,
      enableFovRateScaling: true,
      enableSpeedLines: true,
      speedLineIntensity: 0.7,
      gravityCamera: "trajectory",
      chainBonusWindow: 2,
      chainBonusMultiplier: 0.08,
      grappleCameraPull: 0.4,
      airControlSpeedReduction: 0.5,
    },
  },
  {
    id: "weighted",
    label: "Weighted",
    values: {
      coyoteTime: 100,
      enableJetKick: true,
      landingSquashFov: 2,
      landingRecoveryTime: 0.15,
      slopeTiltIntensity: 2,
      impactShakeIntensity: 1.5,
      impactFovPunch: 1.5,
      impactVignette: 1.5,
      landingCameraDip: 2,
      turnInertia: 0.5,
      jetStartupTime: 0.04,
    },
  },
  {
    id: "full-juice",
    label: "Full juice",
    values: {
      grappleMode: "pendulum",
      grappleReleaseBoost: 10,
      skiEntryBoost: 5,
      strafeRollAngle: 3,
      enableFovRateScaling: true,
      enableSpeedLines: true,
      speedLineIntensity: 0.7,
      gravityCamera: "trajectory",
      coyoteTime: 100,
      enableJetKick: true,
      landingSquashFov: 2,
      landingRecoveryTime: 0.15,
      slopeTiltIntensity: 2,
      impactShakeIntensity: 1.5,
      impactFovPunch: 1.5,
      impactVignette: 1.5,
      enableSlopeFriction: true,
      enableLandingAngle: true,
      skiGroundAdherence: 1.5,
      skiCamSmoothing: 0.3,
      chainBonusWindow: 2,
      chainBonusMultiplier: 0.08,
      grappleCameraPull: 0.4,
      landingCameraDip: 1.5,
      turnInertia: 0.3,
      slopeSpeedBonus: 1,
      airDrag: 0.05,
    },
  },
  {
    id: "competitive",
    label: "Clean competitive",
    values: {
      coyoteTime: 80,
      enableSlopeFriction: true,
      enableLandingAngle: true,
      skiGroundAdherence: 1.5,
      grappleReleaseBoost: 5,
      gravityCamera: "horizon-lock",
      jetRegenDelay: 0.3,
      airDrag: 0.1,
      airControlSpeedReduction: 0.4,
    },
  },
  {
    id: "custom",
    label: "Custom defaults",
    values: {},
  },
];

export function applyPreset(id: string): void {
  if (id === "custom") {
    Object.assign(tuning, tuningDefaults);
  } else {
    const preset = PRESETS.find(p => p.id === id);
    if (!preset) return;
    Object.assign(tuning, _builtinDefaults, preset.values);
  }
  saveTuning();
}
