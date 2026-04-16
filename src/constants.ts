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
  grappleRange: number;
  grapplePull: number;
  grappleSwingDamping: number;

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
  fogNear: number;
  fogFar: number;
}

export const tuningDefaults: GameTuning = {
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
  grappleRange: 200,
  grapplePull: 60,
  grappleSwingDamping: 0.98,

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
  fogNear: 150,
  fogFar: 400,
};

const STORAGE_KEY = "retribes_tuning";

function loadFromStorage(): Partial<GameTuning> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt data */ }
  return {};
}

/** Live values — mutated by the tune panel at runtime. */
export const tuning: GameTuning = { ...tuningDefaults, ...loadFromStorage() };

export function saveTuning(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
  } catch { /* storage full / blocked */ }
}

export function resetTuning(): void {
  Object.assign(tuning, tuningDefaults);
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
