import * as THREE from "three";

// ─── Shared types ────────────────────────────────────────────────

export type MapType = "flat" | "sphere";

export interface SpawnPoint {
  x: number;
  z: number;
  y?: number;
  facingAngle: number;
}

export interface StructureBounds {
  x: number; y: number; z: number; radius: number;
}

export interface TerrainResult {
  group: THREE.Group;
  groundMeshes: THREE.Group;
  ceilingMeshes: THREE.Group;
  /** Floating obstacles — used for grapple and body collision, but NOT ground-sampling raycasts. */
  structureMeshes: THREE.Group;
  structureBounds: StructureBounds[];
  markerGroup: THREE.Group;
  mirrorY: number;
  mapType: MapType;
  sphereCenter?: THREE.Vector3;
  sphereRadius?: number;
  spawnPoints: SpawnPoint[];
  groundMaterial: THREE.MeshStandardMaterial;
  ceilingMaterial?: THREE.MeshStandardMaterial;
}

function applyVertexColors(
  geo: THREE.BufferGeometry,
  mode: "floor" | "ceiling" | "sphere",
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const norm = geo.attributes.normal as THREE.BufferAttribute;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();

  if (mode === "sphere") {
    let rMin = Infinity, rMax = -Infinity;
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(pos.getX(i) ** 2 + pos.getY(i) ** 2 + pos.getZ(i) ** 2);
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
    }
    const rRange = rMax - rMin || 1;

    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(pos.getX(i) ** 2 + pos.getY(i) ** 2 + pos.getZ(i) ** 2);
      const t = 1 - (r - rMin) / rRange;

      if (t < 0.3) {
        c.lerpColors(new THREE.Color(0x2d6838), new THREE.Color(0x3d8848), t / 0.3);
      } else if (t < 0.65) {
        c.lerpColors(new THREE.Color(0x786838), new THREE.Color(0xa89850), (t - 0.3) / 0.35);
      } else {
        c.lerpColors(new THREE.Color(0x5a9080), new THREE.Color(0x78b8a0), (t - 0.65) / 0.35);
      }

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
  } else {
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < count; i++) {
      const y = pos.getY(i);
      if (y < minH) minH = y;
      if (y > maxH) maxH = y;
    }
    const range = maxH - minH || 1;

    for (let i = 0; i < count; i++) {
      const y = pos.getY(i);
      const rawT = (y - minH) / range;
      const t = mode === "ceiling" ? 1 - rawT : rawT;
      const steepness = 1 - Math.abs(norm.getY(i));

      if (mode === "ceiling") {
        if (t < 0.35) {
          c.lerpColors(new THREE.Color(0x283848), new THREE.Color(0x355868), t / 0.35);
        } else if (t < 0.7) {
          c.lerpColors(new THREE.Color(0x3a7890), new THREE.Color(0x4898b0), (t - 0.35) / 0.35);
        } else {
          c.lerpColors(new THREE.Color(0x604878), new THREE.Color(0x786898), (t - 0.7) / 0.3);
        }
        if (steepness > 0.25) {
          c.lerp(new THREE.Color(0x1a2030), Math.min(1, (steepness - 0.25) / 0.35) * 0.5);
        }
      } else {
        if (t < 0.3) {
          c.lerpColors(new THREE.Color(0x2d6838), new THREE.Color(0x3d8848), t / 0.3);
        } else if (t < 0.65) {
          c.lerpColors(new THREE.Color(0x786838), new THREE.Color(0xa89850), (t - 0.3) / 0.35);
        } else {
          c.lerpColors(new THREE.Color(0x5a9080), new THREE.Color(0x78b8a0), (t - 0.65) / 0.35);
        }
        if (steepness > 0.25) {
          c.lerp(new THREE.Color(0x384838), Math.min(1, (steepness - 0.25) / 0.35) * 0.45);
        }
      }

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// ─── Shared utilities ────────────────────────────────────────────

function noise2D(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const n00 = hash2(ix, iz);
  const n10 = hash2(ix + 1, iz);
  const n01 = hash2(ix, iz + 1);
  const n11 = hash2(ix + 1, iz + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sz;
}

function hash2(ix: number, iz: number): number {
  let h = ix * 374761393 + iz * 668265263;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 0xffffffff;
}

/** Shared GLSL: smooth value noise + trilinear sample for organic grid warp (injected once per fragment shader). */
const GRID_SHADER_HELPERS = `
varying vec3 vWorldPositionGrid;
float retribesGridHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float retribesGridNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = retribesGridHash(i);
  float b = retribesGridHash(i + vec2(1.0, 0.0));
  float c = retribesGridHash(i + vec2(0.0, 1.0));
  float d = retribesGridHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float retribesGridHash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float retribesGridNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = retribesGridHash3(i);
  float n100 = retribesGridHash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = retribesGridHash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = retribesGridHash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = retribesGridHash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = retribesGridHash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = retribesGridHash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = retribesGridHash3(i + vec3(1.0, 1.0, 1.0));
  float x00 = mix(n000, n100, u.x);
  float x10 = mix(n010, n110, u.x);
  float x01 = mix(n001, n101, u.x);
  float x11 = mix(n011, n111, u.x);
  float y0 = mix(x00, x10, u.y);
  float y1 = mix(x01, x11, u.y);
  return mix(y0, y1, u.z);
}
`;

function attachGroundGridShader(mat: THREE.MeshStandardMaterial, cellMeters: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vWorldPositionGrid;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
vWorldPositionGrid = worldPosition.xyz;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
${GRID_SHADER_HELPERS}`,
    );
    const cell = cellMeters.toFixed(6);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
{
  vec2 xz = vWorldPositionGrid.xz;
  float cell = ${cell};
  vec2 w = xz / cell;
  vec2 warp = (vec2(
    retribesGridNoise2(w * 0.095 + vec2(3.1, 1.7)),
    retribesGridNoise2(w * 0.095 + vec2(19.4, 7.2))
  ) - 0.5) * 0.52;
  vec2 coord = w + warp;
  vec2 f = fract(coord);
  vec2 dw = fwidth(coord);
  float a = min(f.x, 1.0 - f.x);
  float b = min(f.y, 1.0 - f.y);
  float lineDist = min(a, b);
  float lineW = max(dw.x, dw.y) * 1.12 + 0.018;
  float lineMask = 1.0 - smoothstep(0.0, lineW, lineDist);
  float vary = 0.5 + 0.5 * retribesGridNoise2(w * 0.12 + vec2(40.0, 8.0));
  lineMask *= vary;
  vec3 darker = diffuseColor.rgb * 0.52;
  diffuseColor.rgb = mix(diffuseColor.rgb, darker, lineMask * 0.62);
}
`,
    );
  };
}

function attachSphereGridShader(mat: THREE.MeshStandardMaterial, cellMeters: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vWorldPositionGrid;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
vWorldPositionGrid = worldPosition.xyz;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
${GRID_SHADER_HELPERS}`,
    );
    const cell = cellMeters.toFixed(6);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
{
  vec3 wp = vWorldPositionGrid;
  float cell = ${cell};
  vec3 w = wp / cell;
  vec3 warp = (vec3(
    retribesGridNoise3(w * 0.088 + vec3(2.0, 5.0, 1.0)),
    retribesGridNoise3(w * 0.088 + vec3(11.0, 3.0, 7.0)),
    retribesGridNoise3(w * 0.088 + vec3(4.0, 13.0, 9.0))
  ) - 0.5) * 0.42;
  vec3 coord = w + warp;
  vec3 f = fract(coord);
  vec3 dw = fwidth(coord);
  float a = min(f.x, 1.0 - f.x);
  float b = min(f.y, 1.0 - f.y);
  float c = min(f.z, 1.0 - f.z);
  float lineDist = min(min(a, b), c);
  float lineW = max(max(dw.x, dw.y), dw.z) * 1.12 + 0.018;
  float lineMask = 1.0 - smoothstep(0.0, lineW, lineDist);
  float vary = 0.5 + 0.5 * retribesGridNoise3(w * 0.11 + vec3(30.0, 2.0, 18.0));
  lineMask *= vary;
  vec3 darker = diffuseColor.rgb * 0.52;
  diffuseColor.rgb = mix(diffuseColor.rgb, darker, lineMask * 0.58);
}
`,
    );
  };
}

// ═══════════════════════════════════════════════════════════════════
// FLAT MAP
// ═══════════════════════════════════════════════════════════════════

const FLAT_TERRAIN_SIZE = 2000;
const FLAT_SEGMENTS = 500;
const FLAT_HALF = FLAT_TERRAIN_SIZE / 2;

/** Multi-octave procedural noise for natural-feeling terrain across the full map. */
function proceduralBase(x: number, z: number): number {
  let h = 0;

  // Large-scale sweeping hills (wavelength ~300-400m, amplitude ~55-70m)
  h += 70 * (noise2D(x * 0.003 + 0.5, z * 0.003 + 0.5) - 0.5);
  h += 55 * (noise2D(x * 0.004 + 3.7, z * 0.0035 + 1.2) - 0.5);
  h += 40 * (noise2D(x * 0.0025 + 7.1, z * 0.005 + 4.3) - 0.5);

  // Medium-scale rolling terrain (wavelength ~80-120m, amplitude ~12-20m)
  h += 18 * (noise2D(x * 0.012 + 2.3, z * 0.011 + 5.1) - 0.5);
  h += 15 * (noise2D(x * 0.015 + 8.7, z * 0.013 + 3.9) - 0.5);
  h += 12 * (noise2D(x * 0.009 + 1.1, z * 0.014 + 9.2) - 0.5);

  // Small-scale bumps for texture (wavelength ~15-25m, amplitude ~3-5m)
  h += 5 * (noise2D(x * 0.04 + 4.4, z * 0.045 + 6.6) - 0.5);
  h += 3 * (noise2D(x * 0.06 + 0.3, z * 0.055 + 2.8) - 0.5);

  return h;
}

/** Smooth falloff to zero near terrain edges. */
function edgeFalloff(x: number, z: number): number {
  const dx = Math.abs(x) / FLAT_HALF;
  const dz = Math.abs(z) / FLAT_HALF;
  const d = Math.max(dx, dz);
  // Start fading at 80% of the way to the edge, fully zero at 95%
  if (d < 0.8) return 1;
  if (d > 0.95) return 0;
  const t = (d - 0.8) / 0.15;
  return 1 - t * t * (3 - 2 * t); // smoothstep
}

/** Hand-placed landmarks — center cluster (original features). */
function centerLandmarks(x: number, z: number): number {
  let h = 0;

  // Major peaks
  h += 45 * gaussian(x, z, 0, -100, 55);
  h += 38 * gaussian(x, z, 90, 80, 50);
  h += 30 * gaussian(x, z, -120, -40, 45);
  h += 35 * gaussian(x, z, -60, 110, 50);

  // Ridgelines
  h += 28 * ridge(x, z, -40, -30, 120, 20, Math.PI * 0.15);
  h += 22 * ridge(x, z, 60, 20, 100, 18, Math.PI * -0.25);
  h += 18 * ridge(x, z, -100, 60, 80, 15, Math.PI * 0.4);

  // Halfpipe
  h += 20 * ridge(x, z, 130, -60, 90, 14, Math.PI * 0.1);
  h += 20 * ridge(x, z, 155, -55, 90, 14, Math.PI * 0.1);
  h -= 10 * ridge(x, z, 142, -57, 95, 10, Math.PI * 0.1);

  // Bowls
  h -= 18 * gaussian(x, z, 50, -40, 40);
  h -= 14 * gaussian(x, z, -30, 50, 35);

  // Launch ramps
  h += 25 * gaussian(x, z, -30, -70, 18);
  h += 20 * gaussian(x, z, 100, -20, 15);
  h += 15 * gaussian(x, z, 40, 130, 12);
  h += 18 * gaussian(x, z, -80, -120, 14);

  // Small bumps
  h += 6 * gaussian(x, z, 20, -15, 12);
  h += 5 * gaussian(x, z, -50, -10, 10);
  h += 7 * gaussian(x, z, 70, -80, 14);
  h += 4 * gaussian(x, z, -20, 80, 11);
  h += 5 * gaussian(x, z, 110, 40, 13);

  return h;
}

/** Outer landmark clusters spread across the larger map. */
function outerLandmarks(x: number, z: number): number {
  let h = 0;

  // NE mountain range (~500, -500)
  h += 55 * gaussian(x, z, 500, -500, 70);
  h += 40 * gaussian(x, z, 450, -550, 55);
  h += 30 * ridge(x, z, 480, -520, 150, 22, Math.PI * 0.3);

  // SW canyon system (~-500, 400)
  h -= 25 * ridge(x, z, -500, 400, 180, 18, Math.PI * -0.2);
  h += 20 * ridge(x, z, -520, 380, 160, 12, Math.PI * -0.2);
  h += 20 * ridge(x, z, -480, 420, 160, 12, Math.PI * -0.2);
  h += 35 * gaussian(x, z, -550, 350, 45);

  // North ski run — long gentle slope with launch at the end (~0, -600)
  h += 50 * ridge(x, z, 0, -600, 250, 60, Math.PI * 0.0);
  h += 30 * gaussian(x, z, 0, -730, 20);

  // SE plateau (~600, 500)
  h += 40 * gaussian(x, z, 600, 500, 100);
  h += 15 * gaussian(x, z, 650, 520, 30);
  h -= 12 * gaussian(x, z, 580, 480, 25);

  // West twin peaks (~-700, -100)
  h += 48 * gaussian(x, z, -700, -100, 50);
  h += 42 * gaussian(x, z, -650, -50, 45);
  h += 25 * ridge(x, z, -675, -75, 100, 20, Math.PI * 0.6);

  // Far south bowl and ramp (~200, 700)
  h -= 20 * gaussian(x, z, 200, 700, 50);
  h += 35 * gaussian(x, z, 250, 750, 18);
  h += 28 * gaussian(x, z, 150, 680, 22);

  // NW ridge system (~-400, -600)
  h += 35 * ridge(x, z, -400, -600, 200, 25, Math.PI * 0.45);
  h += 25 * ridge(x, z, -350, -550, 120, 18, Math.PI * 0.7);
  h += 20 * gaussian(x, z, -450, -650, 30);

  // East halfpipe (~750, 0)
  h += 22 * ridge(x, z, 750, 20, 120, 16, Math.PI * 0.5);
  h += 22 * ridge(x, z, 770, -10, 120, 16, Math.PI * 0.5);
  h -= 12 * ridge(x, z, 760, 5, 130, 10, Math.PI * 0.5);

  // Deep valleys — Tribes-scale depressions
  h -= 60 * gaussian(x, z, 300, -300, 80);
  h -= 50 * gaussian(x, z, -250, -400, 70);
  h -= 45 * gaussian(x, z, -600, 200, 65);
  h -= 55 * ridge(x, z, 400, 300, 200, 30, Math.PI * 0.35);
  h -= 40 * gaussian(x, z, 100, -500, 55);
  h -= 35 * gaussian(x, z, -350, 600, 60);

  return h;
}

export function getTerrainHeight(x: number, z: number): number {
  const fade = edgeFalloff(x, z);
  const base = proceduralBase(x, z);
  const center = centerLandmarks(x, z);
  const outer = outerLandmarks(x, z);
  return (base + center + outer) * fade;
}

// ─── Ceiling heightmap (distinct from floor) ─────────────────────

/** Different noise seeds for an independent ceiling topology. */
function ceilingProceduralBase(x: number, z: number): number {
  let h = 0;

  // Broad, smooth domes (longer wavelengths than the floor)
  h += 50 * (noise2D(x * 0.002 + 10.3, z * 0.0025 + 8.7) - 0.5);
  h += 40 * (noise2D(x * 0.003 + 15.1, z * 0.002 + 12.4) - 0.5);
  h += 30 * (noise2D(x * 0.0015 + 22.9, z * 0.003 + 19.6) - 0.5);

  // Medium formations — flatter ridges, wider spacing
  h += 14 * (noise2D(x * 0.008 + 30.2, z * 0.009 + 25.8) - 0.5);
  h += 10 * (noise2D(x * 0.011 + 35.4, z * 0.01 + 28.1) - 0.5);

  // Fine stalactite-like detail: sharper, more vertical features
  const detail = noise2D(x * 0.05 + 40.6, z * 0.055 + 38.3);
  h += 8 * Math.pow(Math.max(0, detail - 0.4) / 0.6, 2.0);
  h += 4 * (noise2D(x * 0.07 + 44.1, z * 0.065 + 42.9) - 0.5);

  return h;
}

/** Ceiling-specific landmarks — stalactite clusters, hanging arches, vaults. */
function ceilingLandmarks(x: number, z: number): number {
  let h = 0;

  // Large stalactite clusters (protrude downward = positive height on ceiling)
  h += 50 * gaussian(x, z, -80, 150, 40);
  h += 40 * gaussian(x, z, 200, -100, 50);
  h += 35 * gaussian(x, z, -150, -180, 45);
  h += 30 * gaussian(x, z, 100, 200, 35);

  // Hanging arches
  h += 25 * ridge(x, z, 0, 0, 200, 25, Math.PI * 0.6);
  h += 20 * ridge(x, z, -200, 100, 150, 20, Math.PI * -0.3);

  // Deep vaults (recessed areas = negative = ceiling pulls away)
  h -= 30 * gaussian(x, z, 50, -50, 60);
  h -= 25 * gaussian(x, z, -100, 80, 55);
  h -= 20 * gaussian(x, z, 180, 120, 50);

  return h;
}

function ceilingOuterLandmarks(x: number, z: number): number {
  let h = 0;

  // NW massive stalactite column (~-500, -400)
  h += 60 * gaussian(x, z, -500, -400, 60);
  h += 35 * gaussian(x, z, -450, -450, 40);
  h += 25 * ridge(x, z, -475, -425, 180, 20, Math.PI * 0.7);

  // SE cathedral vault (~400, 500)
  h -= 40 * gaussian(x, z, 400, 500, 90);
  h += 30 * ridge(x, z, 350, 520, 200, 15, Math.PI * 0.2);
  h += 30 * ridge(x, z, 450, 480, 200, 15, Math.PI * -0.15);

  // East hanging formation (~700, -50)
  h += 45 * gaussian(x, z, 700, -50, 55);
  h += 28 * gaussian(x, z, 730, 20, 35);
  h += 20 * ridge(x, z, 715, -15, 120, 18, Math.PI * 0.45);

  // South stalactite forest (~100, 650)
  h += 35 * gaussian(x, z, 100, 650, 25);
  h += 30 * gaussian(x, z, 150, 680, 22);
  h += 28 * gaussian(x, z, 60, 620, 20);
  h += 25 * gaussian(x, z, 130, 710, 18);
  h += 22 * gaussian(x, z, 180, 640, 20);

  // West deep vault (~-650, 100)
  h -= 45 * gaussian(x, z, -650, 100, 80);
  h -= 30 * gaussian(x, z, -600, 50, 60);

  // North bridge formation (~0, -650)
  h += 35 * ridge(x, z, 0, -650, 200, 22, Math.PI * 0.0);
  h -= 20 * gaussian(x, z, 0, -650, 40);

  // Scattered hanging protrusions
  h += 25 * gaussian(x, z, -300, 300, 30);
  h += 22 * gaussian(x, z, 350, -350, 28);
  h += 20 * gaussian(x, z, -200, -600, 25);
  h += 18 * gaussian(x, z, 500, 200, 22);

  return h;
}

export function getCeilingHeight(x: number, z: number): number {
  const fade = edgeFalloff(x, z);
  const base = ceilingProceduralBase(x, z);
  const center = ceilingLandmarks(x, z);
  const outer = ceilingOuterLandmarks(x, z);
  return (base + center + outer) * fade;
}

function gaussian(x: number, z: number, cx: number, cz: number, radius: number): number {
  const dx = x - cx;
  const dz = z - cz;
  return Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius));
}

function ridge(
  x: number, z: number, cx: number, cz: number,
  length: number, width: number, angle: number,
): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dz = z - cz;
  const along = dx * cos + dz * sin;
  const across = -dx * sin + dz * cos;
  return Math.exp(
    -(along * along) / (2 * length * length) -
      (across * across) / (2 * width * width),
  );
}

const FLAT_SPAWN_POINTS: SpawnPoint[] = [
  // Center cluster (original)
  { x: 0, z: -100, facingAngle: Math.PI },
  { x: 90, z: 80, facingAngle: -Math.PI * 0.7 },
  { x: -120, z: -40, facingAngle: Math.PI * 0.3 },
  { x: 130, z: -60, facingAngle: Math.PI * 0.1 },
  // NE mountain range
  { x: 500, z: -500, facingAngle: Math.PI * 0.8 },
  { x: 450, z: -550, facingAngle: Math.PI * -0.3 },
  // SW canyon
  { x: -500, z: 400, facingAngle: Math.PI * 0.2 },
  { x: -550, z: 350, facingAngle: Math.PI * -0.5 },
  // North ski run
  { x: 0, z: -600, facingAngle: Math.PI },
  { x: 0, z: -730, facingAngle: 0 },
  // SE plateau
  { x: 600, z: 500, facingAngle: -Math.PI * 0.6 },
  { x: 650, z: 520, facingAngle: Math.PI * 0.4 },
  // West twin peaks
  { x: -700, z: -100, facingAngle: Math.PI * 0.3 },
  { x: -650, z: -50, facingAngle: -Math.PI * 0.4 },
  // Far south
  { x: 200, z: 700, facingAngle: -Math.PI * 0.5 },
  { x: 250, z: 750, facingAngle: Math.PI },
  // NW ridges
  { x: -400, z: -600, facingAngle: Math.PI * 0.45 },
  { x: -350, z: -550, facingAngle: -Math.PI * 0.2 },
  // East halfpipe
  { x: 750, z: 0, facingAngle: Math.PI * 0.5 },
];

function scatterFlatMarkers(markerGroup: THREE.Group): void {
  const spacing = 20;
  const half = FLAT_TERRAIN_SIZE / 2 - 40;

  // First pass: count instances
  const orbTransforms: { x: number; y: number; z: number; s: number }[] = [];
  const grassTransforms: { x: number; y: number; z: number; ry: number; rz: number }[] = [];
  const flowerTransforms: { x: number; y: number; z: number; colorIdx: number }[] = [];

  for (let gx = -half; gx <= half; gx += spacing) {
    for (let gz = -half; gz <= half; gz += spacing) {
      const density = noise2D(gx * 0.012, gz * 0.012);
      if (density < 0.38) continue;

      const jx = gx + (hash2(gx * 7, gz * 13) - 0.5) * spacing * 0.7;
      const jz = gz + (hash2(gx * 13, gz * 7) - 0.5) * spacing * 0.7;
      const h = getTerrainHeight(jx, jz);

      if (density > 0.72) {
        const s = 0.6 + hash2(gx * 3, gz * 5) * 0.8;
        orbTransforms.push({ x: jx, y: h + 0.8 * s, z: jz, s });
      }

      const patchSeed = hash2(gx * 11, gz * 17);
      const flowerCount = Math.floor(2 + patchSeed * 4);
      for (let f = 0; f < flowerCount; f++) {
        const fa = (f / flowerCount) * Math.PI * 2 + patchSeed * 5;
        const fr = 0.5 + hash2(gx + f * 37, gz + f * 53) * 1.5;
        const fx = jx + Math.cos(fa) * fr;
        const fz = jz + Math.sin(fa) * fr;
        const fh = getTerrainHeight(fx, fz);
        const colorIdx = Math.floor(hash2(gx + f, gz - f) * 6);
        flowerTransforms.push({ x: fx, y: fh + 0.4, z: fz, colorIdx });
      }

      const grassCount = Math.floor(3 + hash2(gx * 19, gz * 23) * 8);
      for (let g = 0; g < grassCount; g++) {
        const ga = hash2(gx + g * 41, gz + g * 59) * Math.PI * 2;
        const gr = hash2(gx + g * 67, gz + g * 71) * 2.0;
        const bx = jx + Math.cos(ga) * gr;
        const bz = jz + Math.sin(ga) * gr;
        const bh = getTerrainHeight(bx, bz);
        grassTransforms.push({
          x: bx, y: bh + 0.4, z: bz,
          ry: hash2(g + gx, g + gz) * Math.PI,
          rz: 0.15 - hash2(gx * g, gz) * 0.3,
        });
      }
    }
  }

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();

  // Orbs — single InstancedMesh
  if (orbTransforms.length > 0) {
    const orbGeo = new THREE.SphereGeometry(0.6, 8, 6);
    const orbMat = new THREE.MeshStandardMaterial({
      color: 0xc0d4dc,
      emissive: 0x5080a0,
      emissiveIntensity: 0.12,
      roughness: 0.35,
      metalness: 0.2,
      transparent: true,
      opacity: 0.75,
    });
    const orbIM = new THREE.InstancedMesh(orbGeo, orbMat, orbTransforms.length);
    for (let i = 0; i < orbTransforms.length; i++) {
      const t = orbTransforms[i];
      _s.setScalar(t.s);
      _m.compose(new THREE.Vector3(t.x, t.y, t.z), _q.identity(), _s);
      orbIM.setMatrixAt(i, _m);
    }
    orbIM.instanceMatrix.needsUpdate = true;
    markerGroup.add(orbIM);
  }

  // Grass blades — single InstancedMesh
  if (grassTransforms.length > 0) {
    const grassGeo = new THREE.PlaneGeometry(0.12, 0.8);
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x3d4a38, roughness: 0.88, metalness: 0.02, side: THREE.DoubleSide,
    });
    const grassIM = new THREE.InstancedMesh(grassGeo, grassMat, grassTransforms.length);
    const _pos = new THREE.Vector3();
    for (let i = 0; i < grassTransforms.length; i++) {
      const t = grassTransforms[i];
      _pos.set(t.x, t.y, t.z);
      _e.set(0, t.ry, t.rz);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _m.compose(_pos, _q, _s);
      grassIM.setMatrixAt(i, _m);
    }
    grassIM.instanceMatrix.needsUpdate = true;
    markerGroup.add(grassIM);
  }

  // Flowers — one InstancedMesh per color
  const flowerColors = [0x3a9848, 0x2890b0, 0x88a030, 0x48a888, 0x5098c0, 0x689040];
  const buckets: typeof flowerTransforms[] = flowerColors.map(() => []);
  for (const f of flowerTransforms) {
    buckets[f.colorIdx % flowerColors.length].push(f);
  }
  const petalGeo = new THREE.CircleGeometry(0.3, 5);
  const _pos = new THREE.Vector3();
  for (let ci = 0; ci < flowerColors.length; ci++) {
    const bucket = buckets[ci];
    if (bucket.length === 0) continue;
    const mat = new THREE.MeshStandardMaterial({
      color: flowerColors[ci], roughness: 0.6, side: THREE.DoubleSide,
    });
    const im = new THREE.InstancedMesh(petalGeo, mat, bucket.length);
    for (let i = 0; i < bucket.length; i++) {
      const f = bucket[i];
      _pos.set(f.x, f.y, f.z);
      _e.set(0.4, hash2(f.x * 3.7, f.z * 5.3) * Math.PI * 2, 0);
      _q.setFromEuler(_e);
      _s.set(1, 1, 1);
      _m.compose(_pos, _q, _s);
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
    markerGroup.add(im);
  }
}

function scatterCeilingMarkers(markerGroup: THREE.Group, mirrorY: number): void {
  const spacing = 25;
  const half = FLAT_TERRAIN_SIZE / 2 - 40;

  const stalactiteTransforms: { x: number; y: number; z: number; h: number; r: number }[] = [];
  const crystalTransforms: { x: number; y: number; z: number; s: number; colorIdx: number }[] = [];

  for (let gx = -half; gx <= half; gx += spacing) {
    for (let gz = -half; gz <= half; gz += spacing) {
      const density = noise2D(gx * 0.01 + 50.0, gz * 0.01 + 50.0);
      if (density < 0.4) continue;

      const jx = gx + (hash2(gx * 11 + 100, gz * 17 + 100) - 0.5) * spacing * 0.6;
      const jz = gz + (hash2(gx * 17 + 100, gz * 11 + 100) - 0.5) * spacing * 0.6;
      const ceilH = getCeilingHeight(jx, jz);
      const surfaceY = mirrorY - ceilH;

      if (density > 0.65) {
        const h = 1.5 + hash2(gx * 5 + 200, gz * 7 + 200) * 4.0;
        const r = 0.15 + hash2(gx * 7 + 200, gz * 5 + 200) * 0.35;
        stalactiteTransforms.push({ x: jx, y: surfaceY - h * 0.5, z: jz, h, r });
      }

      if (density > 0.5) {
        const count = Math.floor(1 + hash2(gx * 23 + 300, gz * 29 + 300) * 3);
        for (let c = 0; c < count; c++) {
          const ca = (c / count) * Math.PI * 2 + hash2(gx + c, gz - c) * 2;
          const cr = 0.3 + hash2(gx + c * 41, gz + c * 53) * 1.2;
          const cx = jx + Math.cos(ca) * cr;
          const cz = jz + Math.sin(ca) * cr;
          const cCeilH = getCeilingHeight(cx, cz);
          const cSurfY = mirrorY - cCeilH;
          const s = 0.3 + hash2(gx + c * 67, gz + c * 71) * 0.6;
          const colorIdx = Math.floor(hash2(gx + c * 83, gz + c * 97) * 4);
          crystalTransforms.push({ x: cx, y: cSurfY - 0.3, z: cz, s, colorIdx });
        }
      }
    }
  }

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();

  // Stalactites — inverted cones hanging from ceiling
  if (stalactiteTransforms.length > 0) {
    const stalGeo = new THREE.ConeGeometry(1, 1, 5);
    // Rotate so the point faces down
    stalGeo.rotateX(Math.PI);
    const stalMat = new THREE.MeshStandardMaterial({
      color: 0x4a4f52, roughness: 0.72, metalness: 0.25,
    });
    const stalIM = new THREE.InstancedMesh(stalGeo, stalMat, stalactiteTransforms.length);
    for (let i = 0; i < stalactiteTransforms.length; i++) {
      const t = stalactiteTransforms[i];
      _p.set(t.x, t.y, t.z);
      _q.identity();
      _s.set(t.r, t.h, t.r);
      _m.compose(_p, _q, _s);
      stalIM.setMatrixAt(i, _m);
    }
    stalIM.instanceMatrix.needsUpdate = true;
    markerGroup.add(stalIM);
  }

  // Ceiling crystals — glowing octahedrons
  const crystalColors = [0x38b8d0, 0x48a8e0, 0x58d0a8, 0x40a0c8];
  const crystalBuckets: typeof crystalTransforms[] = crystalColors.map(() => []);
  for (const c of crystalTransforms) {
    crystalBuckets[c.colorIdx].push(c);
  }
  const crystalGeo = new THREE.OctahedronGeometry(1, 0);
  for (let ci = 0; ci < crystalColors.length; ci++) {
    const bucket = crystalBuckets[ci];
    if (bucket.length === 0) continue;
    const mat = new THREE.MeshStandardMaterial({
      color: crystalColors[ci], roughness: 0.15, metalness: 0.5,
      emissive: crystalColors[ci], emissiveIntensity: 0.14,
    });
    const im = new THREE.InstancedMesh(crystalGeo, mat, bucket.length);
    for (let i = 0; i < bucket.length; i++) {
      const c = bucket[i];
      _p.set(c.x, c.y, c.z);
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(c.x * 3.7, c.z * 5.3) * Math.PI * 2);
      _s.setScalar(c.s);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
    markerGroup.add(im);
  }
}

function createFloatingStructures(mirrorY: number): { group: THREE.Group; bounds: StructureBounds[] } {
  const structGroup = new THREE.Group();
  const bounds: StructureBounds[] = [];
  const midY = mirrorY / 2;
  const floorClearance = 40;
  const ceilClearance = 40;
  const yMin = floorClearance;
  const yMax = mirrorY - ceilClearance;
  const mapHalf = FLAT_TERRAIN_SIZE / 2 * 0.8;
  const minRadius = 60;

  // Bright alien Forerunner palette — saturated but cohesive
  const platformMat = new THREE.MeshStandardMaterial({
    color: 0x20b0d0, roughness: 0.35, metalness: 0.6,
    emissive: 0x0890b0, emissiveIntensity: 0.2,
  });
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xd060e0, roughness: 0.3, metalness: 0.55,
    emissive: 0x9030a0, emissiveIntensity: 0.3,
  });
  const columnMat = new THREE.MeshStandardMaterial({
    color: 0x30d898, roughness: 0.38, metalness: 0.5,
    emissive: 0x10a868, emissiveIntensity: 0.2,
  });

  interface StructDef {
    x: number; y: number; z: number;
    type: "platform" | "ring" | "column";
    seed: number; seed2: number;
  }
  const structs: StructDef[] = [];

  const count = 40;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.399963 + 0.7; // golden angle for even angular spread
    const rRaw = hash2(i * 31, i * 47);
    // sqrt distribution so density is uniform by area
    const radius = minRadius + Math.sqrt(rRaw) * (mapHalf - minRadius);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // full vertical range between clearances
    const y = yMin + hash2(i * 17, i * 29) * (yMax - yMin);
    const seed = hash2(i * 53, i * 67);
    const seed2 = hash2(i * 83, i * 97);

    // hash2 output is biased to [0,0.5) so threshold-based type selection
    // fails for columns. Use index-based cycling instead (still shuffled by
    // golden-angle placement so it doesn't look regular).
    const types: ("platform" | "ring" | "column")[] = ["platform", "ring", "column"];
    const type = types[i % 3];

    structs.push({ x, y, z, type, seed, seed2 });
  }

  const _instColor = new THREE.Color();

  // Platforms — landing surfaces, seed² curve so most are medium but a few are huge
  const platformGeo = new THREE.BoxGeometry(1, 1, 1);
  const platforms = structs.filter(s => s.type === "platform");
  if (platforms.length > 0) {
    const im = new THREE.InstancedMesh(platformGeo, platformMat, platforms.length);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const _e = new THREE.Euler();
    const baseColors = [0x20b0d0, 0x18c8e0, 0x40d0a8, 0x28b8f0];
    for (let i = 0; i < platforms.length; i++) {
      const s = platforms[i];
      const t1 = s.seed * s.seed;   // power curve: most small, few massive
      const t2 = s.seed2 * s.seed2;
      const w = 15 + t1 * 185;      // 15–200m
      const d = 15 + t2 * 185;      // 15–200m
      const h = 2 + (t1 + t2) * 0.5 * 13; // 2–15m, thicker when wider
      _p.set(s.x, s.y, s.z);
      _e.set(0, s.seed * Math.PI * 2, 0);
      _q.setFromEuler(_e);
      _s.set(w, h, d);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
      _instColor.set(baseColors[i % baseColors.length]);
      _instColor.offsetHSL(0, (s.seed2 - 0.5) * 0.08, (s.seed - 0.5) * 0.06);
      im.setColorAt(i, _instColor);
      bounds.push({ x: s.x, y: s.y, z: s.z, radius: Math.max(w, d) * 0.5 + h * 0.5 });
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor!.needsUpdate = true;
    im.receiveShadow = true;
    im.castShadow = true;
    structGroup.add(im);
  }

  // Rings — fly-through / grapple targets
  const ringGeo = new THREE.TorusGeometry(1, 0.15, 8, 24);
  const rings = structs.filter(s => s.type === "ring");
  if (rings.length > 0) {
    const im = new THREE.InstancedMesh(ringGeo, ringMat, rings.length);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const _e = new THREE.Euler();
    const ringColors = [0xd060e0, 0xe048c8, 0xb070f0, 0xf050a0];
    for (let i = 0; i < rings.length; i++) {
      const s = rings[i];
      const t = s.seed * s.seed;
      const scale = 8 + t * 72;  // 8–80m outer radius
      _p.set(s.x, s.y, s.z);
      _e.set(
        Math.PI * 0.5 + (s.seed - 0.5) * 0.6,
        s.seed2 * Math.PI * 2,
        (s.seed2 - 0.5) * 0.5,
      );
      _q.setFromEuler(_e);
      _s.setScalar(scale);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
      _instColor.set(ringColors[i % ringColors.length]);
      _instColor.offsetHSL(0, (s.seed - 0.5) * 0.1, (s.seed2 - 0.5) * 0.08);
      im.setColorAt(i, _instColor);
      bounds.push({ x: s.x, y: s.y, z: s.z, radius: scale * 1.15 });
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor!.needsUpdate = true;
    im.castShadow = true;
    structGroup.add(im);
  }

  // Columns — pillars, some thin spires, some massive towers
  const colGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const columns = structs.filter(s => s.type === "column");
  if (columns.length > 0) {
    const im = new THREE.InstancedMesh(colGeo, columnMat, columns.length);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const colColors = [0x30d898, 0x20e8a0, 0x48f0b8, 0x38c880];
    for (let i = 0; i < columns.length; i++) {
      const s = columns[i];
      const t1 = s.seed * s.seed;
      const t2 = s.seed2 * s.seed2;
      const height = 30 + t1 * 220;  // 30–250m
      const radius = 8 + t2 * 30;    // 8–38m — wide enough to see and land on
      _p.set(s.x, s.y, s.z);
      _q.identity();
      _s.set(radius, height, radius);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
      _instColor.set(colColors[i % colColors.length]);
      _instColor.offsetHSL(0, (s.seed - 0.5) * 0.08, (s.seed2 - 0.5) * 0.06);
      im.setColorAt(i, _instColor);
      bounds.push({ x: s.x, y: s.y, z: s.z, radius: Math.max(radius, height * 0.5) + radius });
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor!.needsUpdate = true;
    im.castShadow = true;
    structGroup.add(im);
  }

  return { group: structGroup, bounds };
}

export function createFlatTerrain(): TerrainResult {
  const group = new THREE.Group();
  const groundMeshes = new THREE.Group();

  const geo = new THREE.PlaneGeometry(FLAT_TERRAIN_SIZE, FLAT_TERRAIN_SIZE, FLAT_SEGMENTS, FLAT_SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, getTerrainHeight(x, z));
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, "floor");

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.68, metalness: 0.05, flatShading: false, vertexColors: true,
  });
  attachGroundGridShader(mat, FLAT_TERRAIN_SIZE / 150);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  groundMeshes.add(mesh);
  group.add(groundMeshes);

  // Ceiling — independent heightmap for distinct topology
  const MIRROR_GAP = 300;
  let maxFloorH = 0;
  const srcPos = geo.attributes.position;
  for (let i = 0; i < srcPos.count; i++) {
    maxFloorH = Math.max(maxFloorH, srcPos.getY(i));
  }

  const ceilGeo = new THREE.PlaneGeometry(FLAT_TERRAIN_SIZE, FLAT_TERRAIN_SIZE, FLAT_SEGMENTS, FLAT_SEGMENTS);
  ceilGeo.rotateX(-Math.PI / 2);
  const ceilPos = ceilGeo.attributes.position;
  let maxCeilH = 0;
  for (let i = 0; i < ceilPos.count; i++) {
    const cx = ceilPos.getX(i);
    const cz = ceilPos.getZ(i);
    const ch = getCeilingHeight(cx, cz);
    ceilPos.setY(i, ch);
    maxCeilH = Math.max(maxCeilH, ch);
  }

  const mirrorY = maxFloorH + maxCeilH + MIRROR_GAP;

  // Place ceiling verts at mirrorY - ceilingHeight (hanging downward)
  for (let i = 0; i < ceilPos.count; i++) {
    ceilPos.setY(i, mirrorY - ceilPos.getY(i));
  }
  ceilGeo.computeVertexNormals();
  // Flip winding so normals face downward (toward player)
  const mirrorIdx = ceilGeo.index;
  if (mirrorIdx) {
    const arr = mirrorIdx.array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i];
      arr[i] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    mirrorIdx.needsUpdate = true;
  }
  ceilGeo.computeVertexNormals();
  applyVertexColors(ceilGeo, "ceiling");

  const mirrorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.62, metalness: 0.06, side: THREE.FrontSide, vertexColors: true,
  });
  attachGroundGridShader(mirrorMat, FLAT_TERRAIN_SIZE / 100);

  const ceilingMeshes = new THREE.Group();
  const mirrorMesh = new THREE.Mesh(ceilGeo, mirrorMat);
  ceilingMeshes.add(mirrorMesh);
  group.add(ceilingMeshes);

  const floatingResult = createFloatingStructures(mirrorY);
  const structureMeshes = floatingResult.group;
  const structureBounds = floatingResult.bounds;
  group.add(structureMeshes);

  const markerGroup = new THREE.Group();
  scatterFlatMarkers(markerGroup);
  scatterCeilingMarkers(markerGroup, mirrorY);
  group.add(markerGroup);

  return {
    group, groundMeshes, ceilingMeshes, structureMeshes, structureBounds, markerGroup, mirrorY, mapType: "flat",
    spawnPoints: FLAT_SPAWN_POINTS, groundMaterial: mat, ceilingMaterial: mirrorMat,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SPHERE MAP
// ═══════════════════════════════════════════════════════════════════

const SPHERE_RADIUS = 300;
const SPHERE_DETAIL = 6; // icosahedron subdivision level
const SPHERE_CENTER = new THREE.Vector3(0, 0, 0);

function sphereNoise(nx: number, ny: number, nz: number): number {
  // Multi-octave value noise on the unit sphere mapped through 3D hash
  let val = 0;
  val += 25 * snoise3(nx * 1.0, ny * 1.0, nz * 1.0);
  val += 12 * snoise3(nx * 2.3 + 5.1, ny * 2.3 + 3.7, nz * 2.3 + 1.2);
  val += 6 * snoise3(nx * 4.7 + 2.0, ny * 4.7 + 7.3, nz * 4.7 + 4.1);
  val += 3 * snoise3(nx * 9.1 + 1.3, ny * 9.1 + 5.9, nz * 9.1 + 8.7);

  // Large-scale bumps (like the flat map's gaussian peaks)
  val += 30 * Math.exp(-((nx - 0.5) ** 2 + (ny - 0.3) ** 2 + (nz + 0.2) ** 2) * 4);
  val += 25 * Math.exp(-((nx + 0.4) ** 2 + (ny + 0.6) ** 2 + (nz - 0.3) ** 2) * 5);
  val += 20 * Math.exp(-((nx - 0.1) ** 2 + (ny + 0.2) ** 2 + (nz - 0.8) ** 2) * 6);
  val += 22 * Math.exp(-((nx + 0.7) ** 2 + (ny - 0.5) ** 2 + (nz + 0.5) ** 2) * 4);
  val += 18 * Math.exp(-((nx - 0.6) ** 2 + (ny - 0.7) ** 2 + (nz - 0.4) ** 2) * 5);

  // Bowls (depressions)
  val -= 15 * Math.exp(-((nx + 0.2) ** 2 + (ny - 0.8) ** 2 + (nz + 0.4) ** 2) * 7);
  val -= 12 * Math.exp(-((nx - 0.3) ** 2 + (ny + 0.5) ** 2 + (nz + 0.7) ** 2) * 6);

  return val;
}

/** Simple 3D value noise via hashing and trilinear interpolation. */
function snoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);

  const h = (a: number, b: number, c: number) => hash3(a, b, c);
  const n000 = h(ix, iy, iz), n100 = h(ix + 1, iy, iz);
  const n010 = h(ix, iy + 1, iz), n110 = h(ix + 1, iy + 1, iz);
  const n001 = h(ix, iy, iz + 1), n101 = h(ix + 1, iy, iz + 1);
  const n011 = h(ix, iy + 1, iz + 1), n111 = h(ix + 1, iy + 1, iz + 1);

  const nx00 = n000 + (n100 - n000) * sx;
  const nx10 = n010 + (n110 - n010) * sx;
  const nx01 = n001 + (n101 - n001) * sx;
  const nx11 = n011 + (n111 - n011) * sx;
  const nxy0 = nx00 + (nx10 - nx00) * sy;
  const nxy1 = nx01 + (nx11 - nx01) * sy;
  return (nxy0 + (nxy1 - nxy0) * sz) * 2 - 1; // -1..1
}

function hash3(ix: number, iy: number, iz: number): number {
  let h = ix * 374761393 + iy * 668265263 + iz * 1440670829;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 0xffffffff;
}

function scatterSphereMarkers(markerGroup: THREE.Group, geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const step = Math.max(1, Math.floor(pos.count / 800));

  const orbData: { x: number; y: number; z: number; s: number }[] = [];
  const flowerData: { x: number; y: number; z: number; nx: number; ny: number; nz: number; colorIdx: number }[] = [];

  for (let i = 0; i < pos.count; i += step) {
    const density = hash3(
      Math.floor(pos.getX(i) * 10),
      Math.floor(pos.getY(i) * 10),
      Math.floor(pos.getZ(i) * 10),
    );
    if (density < 0.4) continue;

    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);

    if (density > 0.75) {
      const s = 0.6 + hash3(i * 3, i * 5, i * 7) * 1.0;
      orbData.push({ x: px + nx * 1.2 * s, y: py + ny * 1.2 * s, z: pz + nz * 1.2 * s, s });
    } else if (density > 0.5) {
      const colorIdx = Math.floor(hash3(i, i * 2, i * 3) * 6);
      flowerData.push({ x: px, y: py, z: pz, nx, ny, nz, colorIdx });
    }
  }

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _yUp = new THREE.Vector3(0, 1, 0);
  const _nrm = new THREE.Vector3();

  if (orbData.length > 0) {
    const orbGeo = new THREE.SphereGeometry(0.6, 8, 6);
    const orbMat = new THREE.MeshStandardMaterial({
      color: 0xc0d4dc,
      emissive: 0x5080a0,
      emissiveIntensity: 0.12,
      roughness: 0.35,
      metalness: 0.2,
      transparent: true,
      opacity: 0.75,
    });
    const orbIM = new THREE.InstancedMesh(orbGeo, orbMat, orbData.length);
    for (let i = 0; i < orbData.length; i++) {
      const d = orbData[i];
      _p.set(d.x, d.y, d.z);
      _s.setScalar(d.s);
      _m.compose(_p, _q.identity(), _s);
      orbIM.setMatrixAt(i, _m);
    }
    orbIM.instanceMatrix.needsUpdate = true;
    markerGroup.add(orbIM);
  }

  const flowerColors = [0x3a9848, 0x2890b0, 0x88a030, 0x48a888, 0x5098c0, 0x689040];
  const buckets: typeof flowerData[] = flowerColors.map(() => []);
  for (const f of flowerData) buckets[f.colorIdx % flowerColors.length].push(f);

  const petalGeo = new THREE.CircleGeometry(0.3, 5);
  for (let ci = 0; ci < flowerColors.length; ci++) {
    const bucket = buckets[ci];
    if (bucket.length === 0) continue;
    const mat = new THREE.MeshStandardMaterial({
      color: flowerColors[ci], roughness: 0.6, side: THREE.DoubleSide,
    });
    const im = new THREE.InstancedMesh(petalGeo, mat, bucket.length);
    for (let i = 0; i < bucket.length; i++) {
      const f = bucket[i];
      _p.set(f.x, f.y, f.z);
      _nrm.set(f.nx, f.ny, f.nz);
      _q.setFromUnitVectors(_yUp, _nrm);
      _p.addScaledVector(_nrm, 0.4);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
    markerGroup.add(im);
  }
}

const SPHERE_SPAWN_POINTS: SpawnPoint[] = [];

function generateSphereSpawns(): void {
  if (SPHERE_SPAWN_POINTS.length > 0) return;

  // Pick 8 interesting points on the sphere surface
  const directions = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0.577, 0.577, 0.577),
    new THREE.Vector3(-0.577, -0.577, 0.577),
  ];

  for (const dir of directions) {
    dir.normalize();
    const surfaceR = SPHERE_RADIUS - sphereNoise(dir.x, dir.y, dir.z);
    // Spawn slightly inside the surface (toward center)
    const pos = dir.clone().multiplyScalar(surfaceR - 5);

    // Facing angle: tangent direction on the sphere surface
    // Pick an arbitrary tangent to the sphere at this point
    const tangent = new THREE.Vector3();
    if (Math.abs(dir.y) < 0.9) {
      tangent.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    } else {
      tangent.crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
    }

    const facingAngle = Math.atan2(tangent.x, tangent.z);
    SPHERE_SPAWN_POINTS.push({ x: pos.x, y: pos.y, z: pos.z, facingAngle });
  }
}

export function createSphereTerrain(): TerrainResult {
  const group = new THREE.Group();
  const groundMeshes = new THREE.Group();
  const ceilingMeshes = new THREE.Group(); // empty for sphere

  const geo = new THREE.IcosahedronGeometry(SPHERE_RADIUS, SPHERE_DETAIL);

  // Displace vertices along normals for terrain features
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = norm.getX(i);
    const ny = norm.getY(i);
    const nz = norm.getZ(i);

    const displacement = sphereNoise(nx, ny, nz);
    pos.setX(i, x - nx * displacement);
    pos.setY(i, y - ny * displacement);
    pos.setZ(i, z - nz * displacement);
  }

  // Flip face winding so normals point inward
  const idx = geo.index;
  if (idx) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i];
      arr[i] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    idx.needsUpdate = true;
  }
  geo.computeVertexNormals();
  applyVertexColors(geo, "sphere");

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.68, metalness: 0.05, flatShading: false, side: THREE.DoubleSide, vertexColors: true,
  });
  attachSphereGridShader(mat, 10);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  groundMeshes.add(mesh);
  group.add(groundMeshes);

  const markerGroup = new THREE.Group();
  scatterSphereMarkers(markerGroup, geo);
  group.add(markerGroup);

  generateSphereSpawns();

  return {
    group,
    groundMeshes,
    ceilingMeshes,
    structureMeshes: new THREE.Group(),
    structureBounds: [],
    markerGroup,
    mirrorY: 0,
    mapType: "sphere",
    sphereCenter: SPHERE_CENTER.clone(),
    sphereRadius: SPHERE_RADIUS,
    spawnPoints: SPHERE_SPAWN_POINTS,
    groundMaterial: mat,
  };
}

// ─── Public API ──────────────────────────────────────────────────

export function createTerrain(mapType: MapType = "flat"): TerrainResult {
  return mapType === "sphere" ? createSphereTerrain() : createFlatTerrain();
}

export function randomSpawn(spawnPoints: SpawnPoint[]): SpawnPoint {
  return spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
}
