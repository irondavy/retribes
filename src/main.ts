import * as THREE from "three";
import { InputState } from "./input";
import { PlayerController } from "./player";
import { createTerrain, randomSpawn, type TerrainResult } from "./terrain";
import { initHUD, updateHUD } from "./hud";
import { initTunePanel, TUNE_PANEL_WIDTH, onTunePanelToggle, onMapChange } from "./tunePanel";
import { tuning } from "./constants";
import type { MapType } from "./constants";
import { VisualSystem } from "./visuals";
import { NetworkManager } from "./network";
import { RemotePlayerManager } from "./remotePlayers";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 150, 400);

let panelWidth = TUNE_PANEL_WIDTH;

function gameWidth(): number {
  return window.innerWidth - panelWidth;
}

const camera = new THREE.PerspectiveCamera(
  90,
  gameWidth() / window.innerHeight,
  0.1,
  1000,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(gameWidth(), window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.domElement.style.position = "fixed";
renderer.domElement.style.left = TUNE_PANEL_WIDTH + "px";
renderer.domElement.style.top = "0";
document.body.appendChild(renderer.domElement);

const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(50, 80, 30);
sun.castShadow = true;
scene.add(sun);

// Upward light so the inverted ceiling terrain is visible
const ceilLight = new THREE.DirectionalLight(0xffffff, 1.0);
ceilLight.position.set(-30, -80, -20);
scene.add(ceilLight);

const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);

// Terrain state
let currentTerrain: TerrainResult = createTerrain(tuning.mapType);
scene.add(currentTerrain.group);

const input = new InputState();
const player = new PlayerController(camera);

function wirePlayerTerrain(t: TerrainResult): void {
  player.setTerrain(
    t.groundMeshes,
    t.ceilingMeshes,
    t.mirrorY,
    t.mapType,
    t.sphereCenter,
    t.sphereRadius,
  );
}

wirePlayerTerrain(currentTerrain);

const visuals = new VisualSystem(scene, renderer, camera, ambient);
visuals.setTerrainMaterials(currentTerrain.groundMaterial, currentTerrain.ceilingMaterial);

// Grapple rope visual
const grappleRopeGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 5, 1);
const grappleRopeMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, fog: false });
const grappleRope = new THREE.Mesh(grappleRopeGeo, grappleRopeMat);
grappleRope.frustumCulled = false;
grappleRope.visible = false;
scene.add(grappleRope);

// ─── Multiplayer ─────────────────────────────────────────────────

const network = new NetworkManager(tuning.mapType);
const remotePlayers = new RemotePlayerManager();
remotePlayers.setScene(scene);

network.onPlayerJoin = (id) => remotePlayers.addPlayer(id);
network.onPlayerLeave = (id) => remotePlayers.removePlayer(id);
network.onPlayerSnapshot = (id, snap) => remotePlayers.updateSnapshot(id, snap);
network.onPlayerList = (ids) => { for (const id of ids) remotePlayers.addPlayer(id); };

function respawn(): void {
  const sp = randomSpawn(currentTerrain.spawnPoints);
  player.spawn(sp.x, sp.z, sp.facingAngle, sp.y);
}
respawn();

function switchMap(mapType: MapType): void {
  scene.remove(currentTerrain.group);
  currentTerrain = createTerrain(mapType);
  scene.add(currentTerrain.group);
  wirePlayerTerrain(currentTerrain);
  visuals.setTerrainMaterials(currentTerrain.groundMaterial, currentTerrain.ceilingMaterial);

  if (mapType === "sphere") {
    scene.fog = new THREE.Fog(0x87ceeb, 200, 600);
    sun.position.set(0, 0, 0);
  } else {
    scene.fog = new THREE.Fog(0x87ceeb, 150, 400);
    sun.position.set(50, 80, 30);
  }

  respawn();
}

document.addEventListener("keydown", (e) => {
  if (e.code === "KeyR" && document.pointerLockElement) {
    respawn();
  }
});

const blocker = document.getElementById("blocker")!;

const { initialVisible } = initTunePanel(player);
panelWidth = initialVisible ? TUNE_PANEL_WIDTH : 0;

initHUD(initialVisible);

function resizeViewport(): void {
  const w = gameWidth();
  renderer.domElement.style.left = panelWidth + "px";
  blocker.style.left = panelWidth + "px";
  camera.aspect = w / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(w, window.innerHeight);
}

resizeViewport();

onTunePanelToggle((visible) => {
  panelWidth = visible ? TUNE_PANEL_WIDTH : 0;
  resizeViewport();
});

onMapChange((mapType) => {
  switchMap(mapType);
  network.sendMapChange(mapType);
  remotePlayers.removeAll();
});

blocker.addEventListener("click", () => {
  renderer.domElement.requestPointerLock();
});

document.addEventListener("pointerlockchange", () => {
  blocker.style.display = document.pointerLockElement ? "none" : "flex";
  if (document.pointerLockElement) {
    input.clearAll();
  }
});

let lastTime = performance.now();

function gameLoop(now: number): void {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  visuals.update(dt, player);

  if (document.pointerLockElement) {
    player.update(dt, input);
    updateHUD(player, remotePlayers.playerCount);
  }

  network.sendSnapshot(player, dt);
  remotePlayers.update(dt);

  // Update grapple rope visual
  if (player.grappleAttached) {
    const handOffset = new THREE.Vector3(1.2, -1.0, -0.3);
    handOffset.applyQuaternion(camera.quaternion);
    const start = player.position.clone().add(handOffset);
    const end = player.grappleAnchor;
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const axis = new THREE.Vector3().subVectors(end, start);
    const len = axis.length();

    grappleRope.position.copy(mid);
    grappleRope.scale.set(1, len, 1);
    if (len > 0.01) {
      grappleRope.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        axis.normalize(),
      );
    }
    grappleRope.visible = true;
  } else {
    grappleRope.visible = false;
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(gameLoop);

window.addEventListener("resize", () => {
  const w = gameWidth();
  camera.aspect = w / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(w, window.innerHeight);
});
