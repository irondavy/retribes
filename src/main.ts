import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { InputState } from "./input";
import { PlayerController } from "./player";
import { createTerrain, randomSpawn, type TerrainResult } from "./terrain";
import { initHUD, updateHUD } from "./hud";
import { initTunePanel, TUNE_PANEL_WIDTH, onTunePanelToggle, onMapChange, updateFPS } from "./tunePanel";
import { tuning, saveTuning } from "./constants";
import type { MapType } from "./constants";
import { VisualSystem } from "./visuals";
import { NetworkManager } from "./network";
import { RemotePlayerManager } from "./remotePlayers";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Teal atmospheric haze — chromatic mist (less gray-wash than neutral fog) */
const HALO_FOG_COLOR = 0x6e98b0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(HALO_FOG_COLOR);
scene.fog = new THREE.Fog(HALO_FOG_COLOR, 150, 400);

let panelWidth = TUNE_PANEL_WIDTH;

function gameWidth(): number {
  return window.innerWidth - panelWidth;
}

const camera = new THREE.PerspectiveCamera(
  90,
  gameWidth() / window.innerHeight,
  0.1,
  tuning.cameraFar,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(gameWidth(), window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.domElement.style.position = "fixed";
renderer.domElement.style.left = TUNE_PANEL_WIDTH + "px";
renderer.domElement.style.top = "0";
document.body.appendChild(renderer.domElement);

const sun = new THREE.DirectionalLight(0xf4f8f2, 1.75);
sun.position.set(50, 80, 30);
sun.castShadow = true;
scene.add(sun);

// Upward light so the inverted ceiling terrain is visible
const ceilLight = new THREE.DirectionalLight(0x7cc8e0, 0.82);
ceilLight.position.set(-30, -80, -20);
scene.add(ceilLight);

const ambient = new THREE.AmbientLight(0x8eb8c8, 0.6);
scene.add(ambient);

// Terrain state
let currentTerrain: TerrainResult = createTerrain(tuning.mapType);
scene.add(currentTerrain.group);
currentTerrain.markerGroup.visible = tuning.enableMarkers;
currentTerrain.ceilingMeshes.visible = tuning.enableCeiling;

const input = new InputState();
const player = new PlayerController(camera);

function buildBVH(t: TerrainResult): void {
  t.group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      mesh.geometry.computeBoundsTree();
    }
  });
}

function wirePlayerTerrain(t: TerrainResult): void {
  player.setTerrain(
    t.groundMeshes,
    t.ceilingMeshes,
    t.structureMeshes,
    t.structureBounds,
    t.mirrorY,
    t.mapType,
    t.sphereCenter,
    t.sphereRadius,
  );
}

buildBVH(currentTerrain);
wirePlayerTerrain(currentTerrain);

let prevEnableMarkers = tuning.enableMarkers;
let prevEnableCeiling = tuning.enableCeiling;

const visuals = new VisualSystem(scene, renderer, camera, ambient);
visuals.setTerrainMaterials(currentTerrain.groundMaterial, currentTerrain.ceilingMaterial);

// Grapple rope visual
const grappleRopeGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 5, 1);
const GRAPPLE_COLOR_TRAVELING = 0xc99030;
const GRAPPLE_COLOR_ATTACHED = 0xe0b060;
const grappleRopeMat = new THREE.MeshBasicMaterial({ color: GRAPPLE_COLOR_TRAVELING, fog: false });
const grappleRope = new THREE.Mesh(grappleRopeGeo, grappleRopeMat);
grappleRope.frustumCulled = false;
grappleRope.visible = false;
scene.add(grappleRope);

/** Separate from rope so we can disable depth write (avoids orb being erased by rope/terrain Z). */
const grappleOrbMat = new THREE.MeshBasicMaterial({
  color: GRAPPLE_COLOR_TRAVELING,
  fog: false,
  depthWrite: false,
  toneMapped: false,
});

/** Base radius before `grappleHookVisualScale`; center is offset past the rope cylinder end. */
const GRAPPLE_ORB_BASE_RADIUS = 0.12;

function createGrappleOrbMesh(mat: THREE.MeshBasicMaterial): THREE.Mesh {
  const orb = new THREE.Mesh(new THREE.SphereGeometry(GRAPPLE_ORB_BASE_RADIUS, 20, 16), mat);
  orb.frustumCulled = false;
  orb.renderOrder = 2;
  return orb;
}

const grappleOrb = createGrappleOrbMesh(grappleOrbMat);
grappleOrb.visible = false;
scene.add(grappleOrb);

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
  buildBVH(currentTerrain);
  wirePlayerTerrain(currentTerrain);
  visuals.setTerrainMaterials(currentTerrain.groundMaterial, currentTerrain.ceilingMaterial);
  currentTerrain.markerGroup.visible = tuning.enableMarkers;
  currentTerrain.ceilingMeshes.visible = tuning.enableCeiling;

  if (mapType === "sphere") {
    scene.fog = new THREE.Fog(HALO_FOG_COLOR, 200, 600);
    sun.position.set(0, 0, 0);
  } else {
    scene.fog = new THREE.Fog(HALO_FOG_COLOR, 150, 400);
    sun.position.set(50, 80, 30);
  }

  respawn();
}

document.addEventListener("keydown", (e) => {
  if (e.code === "KeyR" && document.pointerLockElement) {
    respawn();
  }
  if (e.code === "KeyI" && document.pointerLockElement) {
    tuning.invertY = !tuning.invertY;
    saveTuning();
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

const _ropeHand = new THREE.Vector3();
const _ropeStart = new THREE.Vector3();
const _ropeMid = new THREE.Vector3();
const _ropeAxis = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

function gameLoop(now: number): void {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (document.pointerLockElement) {
    player.update(dt, input);
  }

  // After physics so landing `justLanded` / `lastImpact` match this frame (FX read the real contact).
  visuals.update(dt, player);

  if (document.pointerLockElement) {
    updateHUD(player, remotePlayers.playerCount, visuals.impactFlash);
  }

  network.sendSnapshot(player, dt);
  remotePlayers.update(dt);

  // Update grapple rope visual
  if (player.grappleAttached || player.grappleTraveling || player.grappleRetracting) {
    _ropeHand.set(0.15, -1.3, -0.6).applyQuaternion(camera.quaternion);
    _ropeStart.copy(player.position).add(_ropeHand);
    const ropeEnd = player.grappleAttached && !player.grappleTraveling
      ? player.grappleAnchor
      : player.grappleHookPos;
    _ropeMid.addVectors(_ropeStart, ropeEnd).multiplyScalar(0.5);
    _ropeAxis.subVectors(ropeEnd, _ropeStart);
    const len = _ropeAxis.length();

    grappleRope.position.copy(_ropeMid);
    grappleRope.scale.set(1, len, 1);
    if (len > 0.01) {
      grappleRope.quaternion.setFromUnitVectors(_UP, _ropeAxis.normalize());
    }
    const ropeHex =
      player.grappleAttached && !player.grappleRetracting ? GRAPPLE_COLOR_ATTACHED : GRAPPLE_COLOR_TRAVELING;
    grappleRopeMat.color.setHex(ropeHex);
    grappleOrbMat.color.setHex(ropeHex);
    grappleRope.visible = true;

    const orbScale = tuning.grappleHookVisualScale;
    grappleOrb.scale.setScalar(orbScale);
    const outward = _ropeAxis.subVectors(ropeEnd, _ropeStart);
    const outLen = outward.length();
    if (outLen > 0.01) {
      outward.multiplyScalar(1 / outLen);
      // Rope cylinder radius 0.06 + scaled orb radius so the sphere sits past the end cap.
      const pastCap = 0.06 + GRAPPLE_ORB_BASE_RADIUS * orbScale;
      grappleOrb.position.copy(ropeEnd).addScaledVector(outward, pastCap);
    } else {
      grappleOrb.position.copy(ropeEnd);
    }
    grappleOrb.visible = true;
  } else {
    grappleRope.visible = false;
    grappleOrb.visible = false;
  }

  // Toggle markers / ceiling visibility
  if (tuning.enableMarkers !== prevEnableMarkers) {
    currentTerrain.markerGroup.visible = tuning.enableMarkers;
    prevEnableMarkers = tuning.enableMarkers;
  }
  if (tuning.enableCeiling !== prevEnableCeiling) {
    currentTerrain.ceilingMeshes.visible = tuning.enableCeiling;
    ceilLight.visible = tuning.enableCeiling;
    prevEnableCeiling = tuning.enableCeiling;
  }

  renderer.render(scene, camera);
  updateFPS();
}

requestAnimationFrame(gameLoop);

window.addEventListener("resize", () => {
  const w = gameWidth();
  camera.aspect = w / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(w, window.innerHeight);
});
