export type GravityCameraMode =
  | "none"        // fully manual
  | "smooth"      // slerp on flip
  | "snap"        // instant on land
  | "spring"      // continuous spring toward hard target up
  | "blend"       // spring toward blended target up (smooth through transition)
  | "velocity"    // spring only when near ground / low vertical speed
  | "damping"     // damps roll rate instead of seeking a target
  | "blend+vel";  // blend + velocity gating combined
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
}

const _builtinDefaults: GameTuning = {
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
