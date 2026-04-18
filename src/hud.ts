import { PlayerController } from "./player";
import { TUNE_PANEL_WIDTH, onTunePanelToggle } from "./tunePanel";
import { tuning } from "./constants";

const HUD_HTML = `
<div id="hud" style="
  position: fixed; top: 0; bottom: 0; right: 0; pointer-events: none; z-index: 5;
  font-family: 'Consolas', 'SF Mono', monospace; color: #fff;
">
  <!-- Crosshair -->
  <div style="
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 24px; height: 24px;
  ">
    <div style="position:absolute; top:50%; left:0; right:0; height:2px; margin-top:-1px; background:rgba(255,255,255,0.7);"></div>
    <div style="position:absolute; left:50%; top:0; bottom:0; width:2px; margin-left:-1px; background:rgba(255,255,255,0.7);"></div>
  </div>

  <!-- Bottom-left readouts -->
  <div style="position:absolute; bottom:32px; left:32px;">
    <div style="margin-bottom:12px;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; opacity:0.6; margin-bottom:2px;">Speed</div>
      <div id="hud-speed" style="font-size:28px; font-weight:bold; text-shadow:0 1px 4px rgba(0,0,0,0.5);">0</div>
    </div>
    <div>
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; opacity:0.6; margin-bottom:2px;">Alt</div>
      <div id="hud-alt" style="font-size:18px; text-shadow:0 1px 4px rgba(0,0,0,0.5);">0</div>
    </div>
  </div>

  <!-- Bottom-right energy bar -->
  <div style="position:absolute; bottom:32px; right:32px; text-align:right;">
    <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; opacity:0.6; margin-bottom:4px;">Energy</div>
    <div style="
      width: 140px; height: 14px;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 2px;
      overflow: hidden;
    ">
      <div id="hud-energy-fill" style="
        height: 100%;
        width: 100%;
        background: #44bbff;
        transition: width 0.05s linear;
      "></div>
    </div>
  </div>

  <!-- Top-center state indicators -->
  <div style="position:absolute; top:32px; left:50%; transform:translateX(-50%); display:flex; gap:12px;">
    <div id="hud-ski-badge" class="hud-badge">ski</div>
    <div id="hud-jet-badge" class="hud-badge">jet</div>
    <div id="hud-grapple-badge" class="hud-badge">grapple</div>
  </div>

  <!-- Player count -->
  <div id="hud-players" style="
    position:absolute; top:32px; right:32px;
    font-size:12px; text-transform:uppercase; letter-spacing:1px;
    opacity:0.6; text-shadow:0 1px 4px rgba(0,0,0,0.5);
  ">1 player</div>

  <!-- Impact vignette overlay -->
  <div id="hud-vignette" style="
    position:absolute; inset:0; pointer-events:none; opacity:0;
    background: radial-gradient(ellipse at center, transparent 40%, rgba(180,30,20,0.6) 100%);
  "></div>

  <!-- Speed lines overlay -->
  <div id="hud-speed-lines" style="
    position:absolute; inset:0; pointer-events:none; opacity:0;
    background: radial-gradient(ellipse at center, transparent 30%, rgba(255,255,255,0.12) 70%, rgba(255,255,255,0.25) 100%);
    mix-blend-mode: overlay;
  "></div>
</div>
`;

let speedEl: HTMLElement;
let altEl: HTMLElement;
let energyFillEl: HTMLElement;
let skiBadge: HTMLElement;
let jetBadge: HTMLElement;
let grappleBadge: HTMLElement;
let playersEl: HTMLElement;
let vignetteEl: HTMLElement;
let speedLinesEl: HTMLElement;

let lastSpeed = -1;
let lastAlt = -1;
let lastEnergy = -1;
let lastEnergyColor = "";
let lastPlayerCount = -1;
let lastVignetteOp = "";
let lastSpeedLinesOp = "";

export function initHUD(initialPanelVisible: boolean): void {
  const badgeStyle = document.createElement("style");
  badgeStyle.textContent = `
    .hud-badge {
      font-size: 12px; padding: 3px 10px; border-radius: 3px;
      text-transform: uppercase; letter-spacing: 1px;
      background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.3);
      border: 1px solid rgba(255,255,255,0.1);
      transition: background 0.1s, color 0.1s, border-color 0.1s;
    }
    .hud-badge.active {
      background: rgba(255,255,255,0.2); color: #fff;
      border-color: rgba(255,255,255,0.4);
    }
  `;
  document.head.appendChild(badgeStyle);

  document.body.insertAdjacentHTML("beforeend", HUD_HTML);
  const hud = document.getElementById("hud")!;
  hud.style.left = (initialPanelVisible ? TUNE_PANEL_WIDTH : 0) + "px";

  onTunePanelToggle((visible) => {
    hud.style.left = (visible ? TUNE_PANEL_WIDTH : 0) + "px";
  });

  speedEl = document.getElementById("hud-speed")!;
  altEl = document.getElementById("hud-alt")!;
  energyFillEl = document.getElementById("hud-energy-fill")!;
  skiBadge = document.getElementById("hud-ski-badge")!;
  jetBadge = document.getElementById("hud-jet-badge")!;
  grappleBadge = document.getElementById("hud-grapple-badge")!;
  playersEl = document.getElementById("hud-players")!;
  vignetteEl = document.getElementById("hud-vignette")!;
  speedLinesEl = document.getElementById("hud-speed-lines")!;
}

export function updateHUD(player: PlayerController, remoteCount = 0, impactFlash = 0): void {
  const speed = Math.round(player.speed * 3.6);
  if (speed !== lastSpeed) {
    speedEl.textContent = `${speed} km/h`;
    lastSpeed = speed;
  }

  const alt = Math.round(player.altitude);
  if (alt !== lastAlt) {
    altEl.textContent = `${alt} m`;
    lastAlt = alt;
  }

  const energy = Math.round(player.energy);
  if (energy !== lastEnergy) {
    energyFillEl.style.width = `${player.energy}%`;
    lastEnergy = energy;
  }
  const color = player.energy < 20 ? "#ff4444" : player.energy < 50 ? "#ffaa22" : "#44bbff";
  if (color !== lastEnergyColor) {
    energyFillEl.style.background = color;
    lastEnergyColor = color;
  }

  skiBadge.classList.toggle("active", player.skiing && player.grounded);
  jetBadge.classList.toggle("active", player.jetting);
  grappleBadge.classList.toggle("active", player.grappleAttached);

  const total = 1 + remoteCount;
  if (total !== lastPlayerCount) {
    playersEl.textContent = `${total} player${total !== 1 ? "s" : ""}`;
    lastPlayerCount = total;
  }

  const vignetteOpacity = impactFlash * tuning.impactVignette;
  const vigOp = vignetteOpacity > 0.01 ? String(vignetteOpacity) : "0";
  if (vigOp !== lastVignetteOp) {
    vignetteEl.style.opacity = vigOp;
    lastVignetteOp = vigOp;
  }

  let slOp: string;
  if (tuning.enableSpeedLines) {
    const speedThreshold = 20;
    const speedMax = 80;
    const t = Math.max(0, Math.min(1, (player.speed - speedThreshold) / (speedMax - speedThreshold)));
    const lineOpacity = t * tuning.speedLineIntensity;
    slOp = lineOpacity > 0.01 ? String(lineOpacity) : "0";
  } else {
    slOp = "0";
  }
  if (slOp !== lastSpeedLinesOp) {
    speedLinesEl.style.opacity = slOp;
    lastSpeedLinesOp = slOp;
  }
}
