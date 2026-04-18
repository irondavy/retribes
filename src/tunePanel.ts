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

type EnabledWhen = (t: GameTuning) => boolean;

type SliderDef = {
  key: keyof GameTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  /** When false, control is shown but disabled (e.g. master toggle off). */
  enabledWhen?: EnabledWhen;
};

type ToggleDef = {
  key: keyof GameTuning;
  label: string;
  enabledWhen?: EnabledWhen;
};

type DropdownDef = {
  key: keyof GameTuning;
  label: string;
  options: { value: string; label: string }[];
  hints?: Record<string, string>;
  enabledWhen?: EnabledWhen;
};

type TuneSubgroup = {
  title: string;
  dropdowns?: DropdownDef[];
  toggles?: ToggleDef[];
  sliders?: SliderDef[];
};

type Section = {
  id: string;
  title: string;
  open?: boolean;
  dropdowns?: DropdownDef[];
  toggles?: ToggleDef[];
  sliders?: SliderDef[];
  subgroups?: TuneSubgroup[];
};

const TIPS: Partial<Record<keyof GameTuning, string>> = {
  gravity: "Downward acceleration in m/s². Higher = heavier, faster falls.",
  walkSpeed: "Max speed while walking (not skiing) in m/s.",
  skiFriction: "Friction coefficient while skiing. Lower = more slippery.",
  groundFriction: "Walk deceleration rate per second (exponential). Higher = stop faster.",
  skiSteerFactor: "How sharply you can turn while skiing. Higher = tighter turns.",
  airControl: "Air steering strength (acceleration scale vs walk speed). Higher = more responsive.",
  playerHeight: "Camera eye height above ground in meters.",
  groundSnapThreshold: "Max distance to snap the player down to the ground each frame.",
  gravityBlendZone: "Meters from the gravity midpoint over which floor/ceiling gravity blends (flat map).",
  maxSpeed: "Max surface-parallel speed in m/s (flat: horizontal; sphere: tangent). 0 = no cap.",
  mouseSensitivity: "Camera rotation speed per mouse pixel.",
  invertY: "Invert the vertical mouse axis (pull down to look up).",
  gravityCamera: "How the camera corrects its roll when gravity changes direction.",
  gravCamTarget: "What the spring camera tries to align 'up' toward.",
  gravCamGating: "Whether the spring strength scales with player speed.",
  gravCamAirborneFallback: "What the spring targets when airborne and using surface-normal mode.",
  gravityRotSpeed: "How fast the spring camera corrects toward its target orientation.",
  gravCamDeadZone: "Distance from the gravity midpoint where spring correction pauses.",
  gravCamVelGate: "Speed (m/s) below which the spring strength ramps toward zero.",
  gravCamDamping: "Drag applied to camera roll rate in damping mode. Higher = more stable.",
  jetThrust: "Upward force applied while jetpacking in m/s².",
  jetEnergyDrain: "Energy consumed per second while jetting.",
  jetEnergyRegen: "Energy recovered per second while not jetting.",
  jetForwardBias: "Fraction of thrust diverted forward in your look direction.",
  jetRegenDelay: "Seconds after releasing jet before energy starts regenerating.",
  jetStartupTime: "Seconds of delay before thrust reaches full power after pressing jet.",
  jetKickMultiplier: "Thrust multiplier on the first frame of jetting (when Jet kick is enabled).",
  grappleMode: "Winch pulls you straight in; Pendulum lets you swing like Titanfall.",
  grappleRange: "Max distance the hook can travel before giving up.",
  grappleSpeed: "Travel speed of the hook projectile in m/s.",
  grapplePull: "Constant inward pull force in winch mode.",
  grappleSwingDamping: "Velocity damping per frame while swinging in winch mode (1 = none).",
  grappleReelSpeed: "How fast you're reeled in toward the anchor in pendulum mode.",
  grappleConnectBoost: "Instant forward speed added when the hook connects.",
  grappleConnectUpBias: "Upward impulse added when the hook connects.",
  grappleAutoDetachRadius: "Distance from anchor at which the grapple auto-releases.",
  grappleRetractSpeed: "How fast the rope reels in after you release (m/s). 0 = instant.",
  grappleHookVisualScale: "Radius scale of the sphere at the rope end. Bigger helps at very high hook speeds.",
  grappleCameraPull: "How much the camera tilts toward the grapple anchor point.",
  impactThreshold: "Minimum collision speed (m/s) to trigger impact effects.",
  impactShakeIntensity: "Camera shake strength on hard impacts.",
  impactFovPunch: "Hard landings only: brief FOV widen (into-surface speed above Impact threshold).",
  impactVignette: "Red edge flash intensity on hard impacts.",
  showImpactHud: "Toast with into-surface speed (m/s); if above Impact threshold, +% vs threshold and fx % (shake/FOV curve).",
  enableJetKick: "Sharp initial thrust burst when first pressing jet, then settles to sustained.",
  enableSlopeFriction: "Ski friction varies with slope — less friction going downhill.",
  enableSpeedLines: "Radial streak overlay that intensifies at high speeds.",
  enableFovRateScaling: "FOV widens when accelerating, not just at high speed.",
  enableLandingAngle: "Landing aligned with a slope gives a speed boost; misaligned penalizes.",
  showLandingAngleHud: "Brief center HUD text when a landing align boost or penalty is applied.",
  alignCancelsRecovery: "Nailing the slope (align boost) skips landing recovery — FX still play, but you keep your speed.",
  coyoteTime: "Milliseconds after leaving ground where you can still jump.",
  landingSquashFov: "Soft landings only: brief FOV narrow (compression); skipped when impact exceeds threshold.",
  skiEntryBoost: "Instant speed kick when transitioning from walk/air into skiing.",
  strafeRollAngle: "Degrees the camera tilts when strafing.",
  slopeTiltIntensity: "Camera tilts forward/back to reflect the slope you're skiing on.",
  speedLineIntensity: "Opacity multiplier for the speed-line overlay.",
  grappleReleaseBoost: "Extra forward speed added when you release the grapple.",
  landingRecoveryTime: "Seconds of reduced control after a hard landing.",
  skiCamSmoothing: "Smooths vertical camera jitter while skiing over bumpy terrain.",
  landingAngleBoost: "Multiplier for the speed bonus when landing aligned downhill.",
  landingAnglePenalty: "Multiplier for the speed penalty when landing against the slope.",
  skiGroundAdherence: "Extra downward force that sticks the skier to the terrain surface.",
  skiLaunchWindow: "Seconds after releasing ski where velocity is preserved — release at a crest to launch.",
  enableSkiReleaseBoost: "On ski release: add speed along your slide + a pop off the surface (great for lips).",
  skiReleaseBoost: "Extra tangent speed (m/s) added when you release ski (slide direction).",
  skiReleasePop: "Kick along surface up (grounded) or anti-gravity (coyote) in m/s — separates you from the hill.",
  skiReleaseMinSpeed: "Minimum tangent speed (m/s) required for release boost.",
  skiReleaseCoyoteMs: "Ms after leaving ground where release boost still works; 0 = only while grounded.",
  airDrag: "Speed decay in the air. Higher = more drag, slower top speed.",
  slopeSpeedBonus: "Extra acceleration gained from skiing down steep slopes.",
  turnInertia: "Velocity resists sudden direction changes. Higher = heavier, more committed turns.",
  airControlSpeedReduction: "Air control weakens at higher speeds. 0 = no reduction, 1 = full.",
  landingCameraDip: "Camera dip on landing proportional to impact speed.",
  landingImpactTangentWeight: "Parallel-to-surface speed mixed into landing impact (shallow fast landings).",
  chainBonusWindow: "Seconds after a ski-land or grapple-release to chain another for a bonus.",
  chainBonusMultiplier: "Speed multiplier added per link in a chain combo.",
  enableToneMapping: "Apply cinematic tone mapping to the rendered image.",
  enableSkyGradient: "Gradient sky background instead of a flat color.",
  enableVertexColors: "Show painted terrain vertex colors (biome tinting).",
  enableHemisphereLight: "Soft ambient light from above and below.",
  enableFovScaling: "FOV widens at high speed for a sense of velocity.",
  enableJetParticles: "Particle spray from the jetpack exhaust.",
  enableSkiParticles: "Dust cloud kicked up while skiing.",
  enableMarkers: "Colored markers scattered across the terrain for spatial reference.",
  enableCeiling: "Show the ceiling terrain on the flat dual-gravity map.",
  toneMappingExposure: "Brightness multiplier when tone mapping is enabled.",
  hemisphereLightIntensity: "Brightness of the hemisphere ambient light.",
  fovScaleAmount: "How much the FOV changes per unit of speed.",
  fogNear: "Distance where fog starts to appear.",
  fogFar: "Distance where fog fully obscures objects.",
  cameraFar: "Max render distance. Lower = better performance, less visible terrain.",
  enableMantle: "Auto-mantle onto structure edges when airborne and close enough.",
  mantleReach: "Max height above player that a ledge can be to trigger a mantle.",
  mantleSpeed: "How fast the mantle animation plays (m/s along the path).",
  mantleMomentumPreserve: "Fraction of horizontal speed kept after mantling (0 = stop, 1 = full).",
};

const SECTION_STATE_KEY = "retribes_sectionState";

function loadSectionState(): Record<string, boolean> {
  try {
    const state: Record<string, boolean> = JSON.parse(localStorage.getItem(SECTION_STATE_KEY) || "{}");
    if ("general" in state && !("physics" in state)) {
      state.physics = state.general;
      delete state.general;
    }
    if ("gravcam" in state && !("camera" in state)) {
      state.camera = state.gravcam;
      delete state.gravcam;
    }
    return state;
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
    id: "physics",
    title: "Physics",
    open: true,
    sliders: [
      { key: "gravity", label: "Gravity", min: 5, max: 50, step: 0.5 },
      { key: "walkSpeed", label: "Walk speed", min: 4, max: 30, step: 0.5 },
      { key: "groundFriction", label: "Ground friction (walk)", min: 1.2, max: 30, step: 0.25, format: (v: number) => v.toFixed(2) },
      { key: "playerHeight", label: "Eye height", min: 1.2, max: 10, step: 0.05 },
      { key: "groundSnapThreshold", label: "Ground snap", min: 0.05, max: 1.5, step: 0.05 },
      { key: "coyoteTime", label: "Coyote time (ms)", min: 0, max: 200, step: 10 },
      { key: "airControl", label: "Air control", min: 0.3, max: 9, step: 0.05, format: (v) => v.toFixed(2) },
      { key: "maxSpeed", label: "Max speed (0=off)", min: 0, max: 200, step: 5 },
      { key: "airDrag", label: "Air drag", min: 0, max: 0.5, step: 0.01, format: (v: number) => v.toFixed(2) },
      { key: "airControlSpeedReduction", label: "Air ctrl speed decay", min: 0, max: 1, step: 0.05, format: (v: number) => v.toFixed(2) },
      { key: "turnInertia", label: "Turn inertia", min: 0, max: 1, step: 0.05, format: (v: number) => v.toFixed(2) },
    ],
    subgroups: [
      {
        title: "Dual gravity (flat map)",
        sliders: [
          {
            key: "gravityBlendZone",
            label: "Gravity blend zone (m)",
            min: 10,
            max: 150,
            step: 5,
            enabledWhen: (t) => t.mapType === "flat",
          },
        ],
      },
      {
        title: "Edge mantling",
        toggles: [{ key: "enableMantle", label: "Enable" }],
        sliders: [
          { key: "mantleReach", label: "Mantle reach", min: 1, max: 10, step: 0.5, enabledWhen: (t) => t.enableMantle },
          { key: "mantleSpeed", label: "Mantle speed", min: 2, max: 20, step: 0.5, enabledWhen: (t) => t.enableMantle },
          {
            key: "mantleMomentumPreserve",
            label: "Mantle momentum",
            min: 0,
            max: 1,
            step: 0.05,
            format: (v: number) => v.toFixed(2),
            enabledWhen: (t) => t.enableMantle,
          },
        ],
      },
    ],
  },
  {
    id: "skiing",
    title: "Skiing",
    open: false,
    toggles: [{ key: "enableSlopeFriction", label: "Slope-relative friction" }],
    sliders: [
      { key: "skiFriction", label: "Ski friction", min: 0.0001, max: 0.02, step: 0.0001, format: (v) => v.toFixed(4) },
      { key: "skiSteerFactor", label: "Ski steering", min: 0.02, max: 0.25, step: 0.01 },
      { key: "skiEntryBoost", label: "Ski entry boost", min: 0, max: 15, step: 0.5 },
      { key: "slopeSpeedBonus", label: "Slope speed bonus", min: 0, max: 3, step: 0.1 },
      { key: "skiGroundAdherence", label: "Ground adherence", min: 0, max: 5, step: 0.25, format: (v: number) => v.toFixed(2) },
      { key: "skiLaunchWindow", label: "Ski launch window (s)", min: 0, max: 0.5, step: 0.01, format: (v: number) => v.toFixed(2) },
      { key: "chainBonusWindow", label: "Chain bonus window (s)", min: 0, max: 5, step: 0.25, format: (v: number) => v.toFixed(2) },
      { key: "chainBonusMultiplier", label: "Chain bonus per link", min: 0, max: 0.2, step: 0.01, format: (v: number) => v.toFixed(2) },
    ],
    subgroups: [
      {
        title: "Landing angle",
        toggles: [
          { key: "enableLandingAngle", label: "Landing angle matters" },
          {
            key: "alignCancelsRecovery",
            label: "Align boost skips recovery",
            enabledWhen: (t) => t.enableLandingAngle,
          },
          {
            key: "showLandingAngleHud",
            label: "Landing angle HUD toast",
            enabledWhen: (t) => t.enableLandingAngle,
          },
        ],
        sliders: [
          {
            key: "landingAngleBoost",
            label: "Landing align boost",
            min: 0,
            max: 3,
            step: 0.1,
            enabledWhen: (t) => t.enableLandingAngle,
          },
          {
            key: "landingAnglePenalty",
            label: "Landing align penalty",
            min: 0,
            max: 3,
            step: 0.1,
            enabledWhen: (t) => t.enableLandingAngle,
          },
        ],
      },
      {
        title: "Ski release boost",
        toggles: [{ key: "enableSkiReleaseBoost", label: "Enable release boost" }],
        sliders: [
          {
            key: "skiReleaseBoost",
            label: "Release tangent boost",
            min: 0,
            max: 18,
            step: 0.5,
            enabledWhen: (t) => t.enableSkiReleaseBoost,
          },
          {
            key: "skiReleasePop",
            label: "Release pop (up)",
            min: 0,
            max: 16,
            step: 0.5,
            enabledWhen: (t) => t.enableSkiReleaseBoost,
          },
          {
            key: "skiReleaseMinSpeed",
            label: "Release min speed",
            min: 0,
            max: 25,
            step: 0.5,
            enabledWhen: (t) => t.enableSkiReleaseBoost,
          },
          {
            key: "skiReleaseCoyoteMs",
            label: "Release coyote (ms)",
            min: 0,
            max: 200,
            step: 5,
            enabledWhen: (t) => t.enableSkiReleaseBoost,
          },
        ],
      },
    ],
  },
  {
    id: "jetpack",
    title: "Jetpack",
    open: false,
    sliders: [
      { key: "jetThrust", label: "Thrust", min: 10, max: 80, step: 1 },
      { key: "jetEnergyDrain", label: "Energy drain / s", min: 5, max: 60, step: 1 },
      { key: "jetEnergyRegen", label: "Energy regen / s", min: 5, max: 40, step: 1 },
      { key: "jetForwardBias", label: "Forward bias", min: 0, max: 0.5, step: 0.01 },
      { key: "jetRegenDelay", label: "Regen delay (s)", min: 0, max: 1, step: 0.05, format: (v: number) => v.toFixed(2) },
      { key: "jetStartupTime", label: "Startup delay (s)", min: 0, max: 0.1, step: 0.005, format: (v: number) => v.toFixed(3) },
    ],
    subgroups: [
      {
        title: "Jet kick",
        toggles: [{ key: "enableJetKick", label: "Sharp initial burst" }],
        sliders: [
          {
            key: "jetKickMultiplier",
            label: "Kick multiplier",
            min: 1,
            max: 5,
            step: 0.1,
            format: (v: number) => v.toFixed(1),
            enabledWhen: (t) => t.enableJetKick,
          },
        ],
      },
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
      { key: "grappleConnectBoost", label: "Connect boost", min: 0, max: 50, step: 1 },
      { key: "grappleConnectUpBias", label: "Connect up bias", min: 0, max: 30, step: 1 },
      { key: "grappleAutoDetachRadius", label: "Auto-detach dist", min: 1, max: 20, step: 1 },
      { key: "grappleRetractSpeed", label: "Reel-in speed", min: 0, max: 400, step: 5 },
      { key: "grappleHookVisualScale", label: "Grapple orb size", min: 0.5, max: 16, step: 0.25, format: (v: number) => v.toFixed(2) },
      { key: "grappleReleaseBoost", label: "Release boost", min: 0, max: 20, step: 1 },
      { key: "grappleCameraPull", label: "Camera pull", min: 0, max: 1, step: 0.05, format: (v: number) => v.toFixed(2) },
    ],
    subgroups: [
      {
        title: "Winch",
        sliders: [
          {
            key: "grapplePull",
            label: "Pull force",
            min: 10,
            max: 150,
            step: 5,
            enabledWhen: (t) => t.grappleMode === "winch",
          },
          {
            key: "grappleSwingDamping",
            label: "Swing damping",
            min: 0.8,
            max: 1,
            step: 0.01,
            enabledWhen: (t) => t.grappleMode === "winch",
          },
        ],
      },
      {
        title: "Pendulum",
        sliders: [
          {
            key: "grappleReelSpeed",
            label: "Reel speed",
            min: 5,
            max: 120,
            step: 5,
            enabledWhen: (t) => t.grappleMode === "pendulum",
          },
        ],
      },
    ],
  },
  {
    id: "landing",
    title: "Landing & Impact",
    open: false,
    toggles: [
      { key: "showImpactHud", label: "Impact HUD toast" },
    ],
    sliders: [
      { key: "landingRecoveryTime", label: "Landing recovery (s)", min: 0, max: 0.5, step: 0.02, format: (v: number) => v.toFixed(2) },
      { key: "landingSquashFov", label: "Landing squash FOV", min: 0, max: 5, step: 0.1 },
      { key: "landingCameraDip", label: "Landing camera dip", min: 0, max: 5, step: 0.1 },
      {
        key: "landingImpactTangentWeight",
        label: "Impact tangent mix",
        min: 0,
        max: 0.5,
        step: 0.01,
        format: (v: number) => v.toFixed(2),
      },
      { key: "impactThreshold", label: "Impact threshold", min: 2, max: 100, step: 1 },
      { key: "impactShakeIntensity", label: "Impact shake", min: 0, max: 3, step: 0.1 },
      { key: "impactFovPunch", label: "Impact FOV punch", min: 0, max: 3, step: 0.1 },
      { key: "impactVignette", label: "Impact vignette", min: 0, max: 3, step: 0.1 },
    ],
  },
  {
    id: "camera",
    title: "Camera",
    open: false,
    toggles: [
      { key: "invertY", label: "Invert Y axis" },
    ],
    dropdowns: [
      { key: "gravityCamera", label: "Gravity mode", options: CAMERA_MODES, hints: CAMERA_MODE_HINTS },
    ],
    subgroups: [
      {
        title: "Spring targeting",
        dropdowns: [
          {
            key: "gravCamTarget",
            label: "Target",
            options: SPRING_TARGETS,
            enabledWhen: (t) => t.gravityCamera === "spring",
          },
          {
            key: "gravCamGating",
            label: "Gating",
            options: SPRING_GATINGS,
            enabledWhen: (t) => t.gravityCamera === "spring",
          },
          {
            key: "gravCamAirborneFallback",
            label: "Airborne fallback",
            options: SPRING_FALLBACKS,
            enabledWhen: (t) => t.gravityCamera === "spring" && t.gravCamTarget === "surface",
          },
        ],
      },
    ],
    sliders: [
      {
        key: "gravityRotSpeed",
        label: "Orientation strength",
        min: 0.5,
        max: 10.0,
        step: 0.1,
        enabledWhen: (t) => {
          const m = t.gravityCamera;
          return m === "spring" || m === "smooth" || m === "trajectory" || m === "predictive";
        },
      },
      {
        key: "gravCamVelGate",
        label: "Vel gate threshold",
        min: 1,
        max: 30,
        step: 0.5,
        enabledWhen: (t) =>
          t.gravityCamera === "spring" &&
          (t.gravCamGating === "velocity" || t.gravCamGating === "velocity+deadzone"),
      },
      {
        key: "gravCamDeadZone",
        label: "Dead zone (m)",
        min: 0,
        max: 50,
        step: 1,
        enabledWhen: (t) => t.gravityCamera === "spring" && t.gravCamGating === "velocity+deadzone",
      },
      {
        key: "gravCamDamping",
        label: "Roll damping",
        min: 0.5,
        max: 10,
        step: 0.1,
        enabledWhen: (t) => t.gravityCamera === "damping",
      },
      { key: "mouseSensitivity", label: "Mouse sensitivity", min: 0.0005, max: 0.012, step: 0.0001, format: (v) => v.toFixed(4) },
      { key: "strafeRollAngle", label: "Strafe roll (°)", min: 0, max: 8, step: 0.5 },
      { key: "slopeTiltIntensity", label: "Slope tilt", min: 0, max: 5, step: 0.1 },
      { key: "skiCamSmoothing", label: "Ski cam smoothing", min: 0, max: 0.95, step: 0.05, format: (v: number) => v.toFixed(2) },
    ],
  },
  {
    id: "speedfx",
    title: "Speed Feedback",
    open: false,
    subgroups: [
      {
        title: "Speed lines",
        toggles: [{ key: "enableSpeedLines", label: "Enable" }],
        sliders: [
          {
            key: "speedLineIntensity",
            label: "Intensity",
            min: 0.1,
            max: 2,
            step: 0.1,
            enabledWhen: (t) => t.enableSpeedLines,
          },
        ],
      },
      {
        title: "Speed FOV",
        toggles: [
          { key: "enableFovScaling", label: "Widen FOV with speed" },
          {
            key: "enableFovRateScaling",
            label: "Also widen on acceleration",
            enabledWhen: (t) => t.enableFovScaling,
          },
        ],
        sliders: [
          {
            key: "fovScaleAmount",
            label: "FOV scale amount",
            min: 0.05,
            max: 0.4,
            step: 0.01,
            enabledWhen: (t) => t.enableFovScaling,
          },
        ],
      },
    ],
  },
  {
    id: "rendering",
    title: "Rendering",
    open: false,
    toggles: [
      { key: "enableSkyGradient", label: "Sky gradient" },
      { key: "enableVertexColors", label: "Terrain colors" },
      { key: "enableJetParticles", label: "Jet particles" },
      { key: "enableSkiParticles", label: "Ski dust" },
      { key: "enableMarkers", label: "Terrain markers" },
    ],
    sliders: [
      { key: "fogNear", label: "Fog near", min: 20, max: 1000, step: 10 },
      { key: "fogFar", label: "Fog far", min: 100, max: 3000, step: 25 },
      { key: "cameraFar", label: "Render dist", min: 500, max: 4000, step: 50 },
    ],
    subgroups: [
      {
        title: "Tone mapping",
        toggles: [{ key: "enableToneMapping", label: "Enable" }],
        sliders: [
          {
            key: "toneMappingExposure",
            label: "Exposure",
            min: 0.3,
            max: 2.5,
            step: 0.05,
            enabledWhen: (t) => t.enableToneMapping,
          },
        ],
      },
      {
        title: "Hemisphere light",
        toggles: [{ key: "enableHemisphereLight", label: "Enable" }],
        sliders: [
          {
            key: "hemisphereLightIntensity",
            label: "Intensity",
            min: 0.1,
            max: 1.5,
            step: 0.05,
            enabledWhen: (t) => t.enableHemisphereLight,
          },
        ],
      },
      {
        title: "Dual surface (flat map)",
        toggles: [
          {
            key: "enableCeiling",
            label: "Show ceiling terrain",
            enabledWhen: (t) => t.mapType === "flat",
          },
        ],
      },
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
      <button type="button" class="tune-panel__discard-btn" id="tune-discard-preset">Discard</button>
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
    .tune-row.dirty,
    .tune-toggle.dirty {
      border-left: 2px solid #5b9fd4;
      padding-left: 6px;
    }
    .tune-panel__buttons {
      flex-shrink: 0;
      display: flex;
      gap: 8px;
    }
    .tune-panel__discard-btn {
      padding: 8px 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 6px;
      color: rgba(255,255,255,0.5);
      cursor: pointer;
      font-size: 12px;
      display: none;
    }
    .tune-panel__discard-btn:hover {
      background: rgba(255,255,255,0.1);
      color: #e8eaed;
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
    .tune-dropdown-stack {
      margin-bottom: 10px;
    }
    .tune-dropdown-stack:last-child {
      margin-bottom: 0;
    }
    .tune-subgroup {
      margin: 12px 0 10px;
      padding: 8px 10px 6px;
      border-left: 2px solid rgba(91, 159, 212, 0.4);
      border-radius: 4px;
      background: rgba(255,255,255,0.03);
    }
    .tune-subgroup__title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      opacity: 0.55;
      margin: 0 0 8px;
      font-weight: 600;
    }
    .tune-row--disabled,
    .tune-toggle.tune-row--disabled {
      opacity: 0.48;
    }
    .tune-row--disabled input[type="range"],
    .tune-toggle.tune-row--disabled input[type="checkbox"] {
      cursor: not-allowed;
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
  mapRow.title = "Which terrain to play on.";
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
    refreshDependencyStates();
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
  const discardBtn = root.querySelector("#tune-discard-preset") as HTMLButtonElement;

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
    discardBtn.style.display = dirty ? "" : "none";

    const resolved = currentPresetId !== null ? getActivePresetResolved() : null;
    const allRows = root.querySelectorAll<HTMLElement>("[data-tuning-key]");
    for (const el of allRows) {
      const key = el.dataset.tuningKey as keyof GameTuning;
      const isDirtyRow = resolved !== null && tuning[key] !== resolved[key];
      el.classList.toggle("dirty", isDirtyRow);
    }
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

  type DependencyBinding = {
    root: HTMLElement;
    inputs: Array<HTMLInputElement | HTMLSelectElement>;
    enabledWhen: EnabledWhen;
  };
  const dependencyBindings: DependencyBinding[] = [];

  function refreshDependencyStates(): void {
    for (const b of dependencyBindings) {
      const on = b.enabledWhen(tuning);
      b.root.classList.toggle("tune-row--disabled", !on);
      for (const inp of b.inputs) {
        inp.disabled = !on;
      }
    }
  }

  // --- Collapsible sections ---
  const allDropdownInputs: { key: keyof GameTuning; select: HTMLSelectElement; hintEl?: HTMLElement; hints?: Record<string, string> }[] = [];
  function buildDropdownRow(dd: DropdownDef, container: HTMLElement): void {
    const stack = document.createElement("div");
    stack.className = "tune-dropdown-stack";

    const row = document.createElement("div");
    row.className = "tune-row";
    row.dataset.tuningKey = dd.key;
    const ddTip = TIPS[dd.key];
    if (ddTip) row.title = ddTip;
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
      refreshDependencyStates();
    });

    row.appendChild(label);
    row.appendChild(sel);
    stack.appendChild(row);
    if (hintEl) stack.appendChild(hintEl);
    container.appendChild(stack);

    allDropdownInputs.push({ key: dd.key, select: sel, hintEl: hintEl ?? undefined, hints: dd.hints });

    if (dd.enabledWhen) {
      dependencyBindings.push({ root: stack, inputs: [sel], enabledWhen: dd.enabledWhen });
    }
  }

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
    const tip = TIPS[def.key];
    if (tip) row.title = tip;
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
    if (def.enabledWhen) {
      dependencyBindings.push({ root: row, inputs: [input], enabledWhen: def.enabledWhen });
    }
  }

  function buildToggleRow(def: ToggleDef, container: HTMLElement): void {
    const row = document.createElement("div");
    row.className = "tune-toggle";
    row.dataset.tuningKey = def.key;
    const tip = TIPS[def.key];
    if (tip) row.title = tip;

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
      refreshDependencyStates();
    });

    row.appendChild(name);
    row.appendChild(input);
    container.appendChild(row);
    allToggleInputs.push({ def, input });
    if (def.enabledWhen) {
      dependencyBindings.push({ root: row, inputs: [input], enabledWhen: def.enabledWhen });
    }
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

    for (const dd of section.dropdowns ?? []) {
      buildDropdownRow(dd, body);
    }
    for (const def of section.toggles ?? []) {
      buildToggleRow(def, body);
    }
    for (const def of section.sliders ?? []) {
      buildSliderRow(def, body);
    }
    for (const sg of section.subgroups ?? []) {
      const wrap = document.createElement("div");
      wrap.className = "tune-subgroup";
      const sgTitle = document.createElement("div");
      sgTitle.className = "tune-subgroup__title";
      sgTitle.textContent = sg.title;
      wrap.appendChild(sgTitle);
      for (const dd of sg.dropdowns ?? []) {
        buildDropdownRow(dd, wrap);
      }
      for (const def of sg.toggles ?? []) {
        buildToggleRow(def, wrap);
      }
      for (const def of sg.sliders ?? []) {
        buildSliderRow(def, wrap);
      }
      body.appendChild(wrap);
    }

    details.appendChild(body);
    rowsEl.appendChild(details);
  }

  refreshDependencyStates();

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
    refreshDependencyStates();
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

  // --- Discard changes ---
  discardBtn.addEventListener("click", () => {
    if (currentPresetId === null) return;
    const prevMap = tuning.mapType;
    if (currentPresetBuiltIn) {
      applyBuiltInPreset(currentPresetId);
    } else {
      const cp = customPresets.find(p => p.id === currentPresetId);
      if (cp) applyCustomPreset(cp);
    }
    syncUIFromTuning();
    updateDirtyState();
    if (tuning.mapType !== prevMap) {
      for (const fn of mapChangeListeners) fn(tuning.mapType);
    }
    player.snapToGround();
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
