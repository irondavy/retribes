import * as THREE from "three";

// ─── Shared types ────────────────────────────────────────────────

export type MapType = "flat" | "sphere";

export interface SpawnPoint {
  x: number;
  z: number;
  y?: number;
  facingAngle: number;
}

export interface TerrainResult {
  group: THREE.Group;
  groundMeshes: THREE.Group;
  ceilingMeshes: THREE.Group;
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
        c.lerpColors(new THREE.Color(0x2a5a1a), new THREE.Color(0x4a8a3b), t / 0.3);
      } else if (t < 0.65) {
        c.lerpColors(new THREE.Color(0x4a8a3b), new THREE.Color(0x8a7a55), (t - 0.3) / 0.35);
      } else {
        c.lerpColors(new THREE.Color(0x8a7a55), new THREE.Color(0xd8d0c8), (t - 0.65) / 0.35);
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
        if (t < 0.5) {
          c.lerpColors(new THREE.Color(0x2a3a4b), new THREE.Color(0x3a6a7b), t / 0.5);
        } else {
          c.lerpColors(new THREE.Color(0x3a6a7b), new THREE.Color(0x6a9aab), (t - 0.5) / 0.5);
        }
        if (steepness > 0.3) {
          c.lerp(new THREE.Color(0x3a4a4a), Math.min(1, (steepness - 0.3) / 0.4) * 0.5);
        }
      } else {
        if (t < 0.3) {
          c.lerpColors(new THREE.Color(0x2a5a1a), new THREE.Color(0x4a8a3b), t / 0.3);
        } else if (t < 0.65) {
          c.lerpColors(new THREE.Color(0x4a8a3b), new THREE.Color(0x8a7a55), (t - 0.3) / 0.35);
        } else {
          c.lerpColors(new THREE.Color(0x8a7a55), new THREE.Color(0xd8d0c8), (t - 0.65) / 0.35);
        }
        if (steepness > 0.25) {
          c.lerp(new THREE.Color(0x6a6560), Math.min(1, (steepness - 0.25) / 0.35) * 0.6);
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

function attachGroundGridShader(mat: THREE.MeshStandardMaterial, cellMeters: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vWorldPositionGrid;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
vWorldPositionGrid = worldPosition.xyz;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vWorldPositionGrid;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
{
  vec2 xz = vWorldPositionGrid.xz;
  float cell = ${cellMeters.toFixed(6)};
  vec2 coord = xz / cell;
  vec2 f = fract(coord);
  vec2 dw = fwidth(coord);
  float a = min(f.x, 1.0 - f.x);
  float b = min(f.y, 1.0 - f.y);
  float lineDist = min(a, b);
  float lineW = max(dw.x, dw.y) * 0.85 + 0.015;
  float lineMask = 1.0 - smoothstep(0.0, lineW, lineDist);
  vec3 darker = diffuseColor.rgb * 0.48;
  diffuseColor.rgb = mix(diffuseColor.rgb, darker, lineMask);
}
`
    );
  };
}

function attachSphereGridShader(mat: THREE.MeshStandardMaterial, cellMeters: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vWorldPositionGrid;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
vWorldPositionGrid = worldPosition.xyz;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vWorldPositionGrid;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
{
  vec3 wp = vWorldPositionGrid;
  float cell = ${cellMeters.toFixed(6)};
  vec3 coord = wp / cell;
  vec3 f = fract(coord);
  vec3 dw = fwidth(coord);
  float a = min(f.x, 1.0 - f.x);
  float b = min(f.y, 1.0 - f.y);
  float c = min(f.z, 1.0 - f.z);
  float lineDist = min(min(a, b), c);
  float lineW = max(max(dw.x, dw.y), dw.z) * 0.85 + 0.015;
  float lineMask = 1.0 - smoothstep(0.0, lineW, lineDist);
  vec3 darker = diffuseColor.rgb * 0.48;
  diffuseColor.rgb = mix(diffuseColor.rgb, darker, lineMask);
}
`
    );
  };
}

// ═══════════════════════════════════════════════════════════════════
// FLAT MAP
// ═══════════════════════════════════════════════════════════════════

const FLAT_TERRAIN_SIZE = 600;
const FLAT_SEGMENTS = 250;

export function getTerrainHeight(x: number, z: number): number {
  let h = 0;

  h += 45 * gaussian(x, z, 0, -100, 55);
  h += 38 * gaussian(x, z, 90, 80, 50);
  h += 30 * gaussian(x, z, -120, -40, 45);
  h += 35 * gaussian(x, z, -60, 110, 50);

  h += 28 * ridge(x, z, -40, -30, 120, 20, Math.PI * 0.15);
  h += 22 * ridge(x, z, 60, 20, 100, 18, Math.PI * -0.25);
  h += 18 * ridge(x, z, -100, 60, 80, 15, Math.PI * 0.4);

  h += 20 * ridge(x, z, 130, -60, 90, 14, Math.PI * 0.1);
  h += 20 * ridge(x, z, 155, -55, 90, 14, Math.PI * 0.1);
  h -= 10 * ridge(x, z, 142, -57, 95, 10, Math.PI * 0.1);

  h -= 18 * gaussian(x, z, 50, -40, 40);
  h -= 14 * gaussian(x, z, -30, 50, 35);

  h += 25 * gaussian(x, z, -30, -70, 18);
  h += 20 * gaussian(x, z, 100, -20, 15);
  h += 15 * gaussian(x, z, 40, 130, 12);
  h += 18 * gaussian(x, z, -80, -120, 14);

  h += 6 * gaussian(x, z, 20, -15, 12);
  h += 5 * gaussian(x, z, -50, -10, 10);
  h += 7 * gaussian(x, z, 70, -80, 14);
  h += 4 * gaussian(x, z, -20, 80, 11);
  h += 5 * gaussian(x, z, 110, 40, 13);

  h += 3.0 * Math.sin(x * 0.018) * Math.cos(z * 0.022);
  h += 2.0 * Math.sin(x * 0.035 + 1.0) * Math.sin(z * 0.03 + 0.5);
  h += 1.5 * Math.cos(x * 0.05 + 2.0) * Math.sin(z * 0.045 + 1.0);

  return h;
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
  { x: 0, z: -80, facingAngle: Math.PI },
  { x: 90, z: 60, facingAngle: -Math.PI * 0.7 },
  { x: -120, z: -40, facingAngle: Math.PI * 0.3 },
  { x: -40, z: -30, facingAngle: Math.PI * 0.15 },
  { x: 130, z: -60, facingAngle: Math.PI * 0.1 },
  { x: -30, z: -70, facingAngle: Math.PI * 0.5 },
  { x: -60, z: 110, facingAngle: -Math.PI * 0.3 },
  { x: 60, z: 20, facingAngle: -Math.PI * 0.25 },
];

function scatterFlatMarkers(group: THREE.Group): void {
  const orbGeo = new THREE.SphereGeometry(0.6, 10, 8);
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0xddeeff, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.7,
  });

  const petalGeo = new THREE.CircleGeometry(0.25, 5);
  const flowerColors = [0xe84393, 0xfd79a8, 0xffeaa7, 0xdfe6e9, 0xa29bfe, 0xff7675];
  const flowerMats = flowerColors.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide }),
  );

  const grassGeo = new THREE.PlaneGeometry(0.12, 0.8);
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x2d8a4e, roughness: 0.8, side: THREE.DoubleSide,
  });

  const spacing = 12;
  const half = FLAT_TERRAIN_SIZE / 2 - 20;

  for (let gx = -half; gx <= half; gx += spacing) {
    for (let gz = -half; gz <= half; gz += spacing) {
      const density = noise2D(gx * 0.012, gz * 0.012);
      if (density < 0.38) continue;

      const jx = gx + (hash2(gx * 7, gz * 13) - 0.5) * spacing * 0.7;
      const jz = gz + (hash2(gx * 13, gz * 7) - 0.5) * spacing * 0.7;
      const h = getTerrainHeight(jx, jz);

      if (density > 0.72) {
        const orb = new THREE.Mesh(orbGeo, orbMat);
        const orbScale = 0.6 + hash2(gx * 3, gz * 5) * 0.8;
        orb.scale.setScalar(orbScale);
        orb.position.set(jx, h + 0.8 * orbScale, jz);
        group.add(orb);
      }

      const patchSeed = hash2(gx * 11, gz * 17);
      const flowerCount = Math.floor(2 + patchSeed * 6);
      for (let f = 0; f < flowerCount; f++) {
        const fa = (f / flowerCount) * Math.PI * 2 + patchSeed * 5;
        const fr = 0.5 + hash2(gx + f * 37, gz + f * 53) * 1.5;
        const fx = jx + Math.cos(fa) * fr;
        const fz = jz + Math.sin(fa) * fr;
        const fh = getTerrainHeight(fx, fz);

        const mat = flowerMats[Math.floor(hash2(gx + f, gz - f) * flowerMats.length)];
        const petalCount = 4 + Math.floor(hash2(f * 3, gx + gz) * 3);
        const stem = new THREE.Group();
        stem.position.set(fx, fh, fz);

        for (let p = 0; p < petalCount; p++) {
          const petal = new THREE.Mesh(petalGeo, mat);
          const angle = (p / petalCount) * Math.PI * 2;
          const tilt = 0.3 + hash2(p + gx, f + gz) * 0.4;
          petal.position.set(
            Math.cos(angle) * 0.15,
            0.5 + hash2(gx * f, gz * p) * 0.3,
            Math.sin(angle) * 0.15,
          );
          petal.rotation.set(tilt, angle, 0);
          stem.add(petal);
        }

        const center = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 6, 4),
          new THREE.MeshStandardMaterial({ color: 0xfdcb6e, roughness: 0.5 }),
        );
        center.position.y = 0.55 + hash2(gx * f, gz * f) * 0.2;
        stem.add(center);
        group.add(stem);
      }

      const grassCount = Math.floor(3 + hash2(gx * 19, gz * 23) * 8);
      for (let g = 0; g < grassCount; g++) {
        const ga = hash2(gx + g * 41, gz + g * 59) * Math.PI * 2;
        const gr = hash2(gx + g * 67, gz + g * 71) * 2.0;
        const bx = jx + Math.cos(ga) * gr;
        const bz = jz + Math.sin(ga) * gr;
        const bh = getTerrainHeight(bx, bz);

        const blade = new THREE.Mesh(grassGeo, grassMat);
        blade.position.set(bx, bh + 0.4, bz);
        blade.rotation.set(0, hash2(g + gx, g + gz) * Math.PI, 0.15 - hash2(gx * g, gz) * 0.3);
        group.add(blade);
      }
    }
  }
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
    color: 0xffffff, roughness: 0.85, flatShading: false, vertexColors: true,
  });
  attachGroundGridShader(mat, FLAT_TERRAIN_SIZE / 60);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  groundMeshes.add(mesh);
  group.add(groundMeshes);

  // Mirror ceiling
  const MIRROR_GAP = 120;
  let maxHeight = 0;
  const srcPos = geo.attributes.position;
  for (let i = 0; i < srcPos.count; i++) {
    maxHeight = Math.max(maxHeight, srcPos.getY(i));
  }
  const mirrorY = maxHeight * 2 + MIRROR_GAP;

  const mirrorGeo = geo.clone();
  const mirrorPos = mirrorGeo.attributes.position;
  for (let i = 0; i < mirrorPos.count; i++) {
    mirrorPos.setY(i, mirrorY - mirrorPos.getY(i));
  }
  mirrorGeo.computeVertexNormals();
  const mirrorIdx = mirrorGeo.index;
  if (mirrorIdx) {
    const arr = mirrorIdx.array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i];
      arr[i] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    mirrorIdx.needsUpdate = true;
  }
  mirrorGeo.computeVertexNormals();
  applyVertexColors(mirrorGeo, "ceiling");

  const mirrorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.7, side: THREE.FrontSide, vertexColors: true,
  });
  attachGroundGridShader(mirrorMat, FLAT_TERRAIN_SIZE / 60);

  const ceilingMeshes = new THREE.Group();
  const mirrorMesh = new THREE.Mesh(mirrorGeo, mirrorMat);
  ceilingMeshes.add(mirrorMesh);
  group.add(ceilingMeshes);

  scatterFlatMarkers(group);

  return {
    group, groundMeshes, ceilingMeshes, mirrorY, mapType: "flat",
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

function scatterSphereMarkers(group: THREE.Group, geo: THREE.BufferGeometry, radius: number): void {
  const orbGeo = new THREE.SphereGeometry(0.6, 10, 8);
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0xddeeff, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.7,
  });

  const petalGeo = new THREE.CircleGeometry(0.25, 5);
  const flowerColors = [0xe84393, 0xfd79a8, 0xffeaa7, 0xdfe6e9, 0xa29bfe, 0xff7675];
  const flowerMats = flowerColors.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide }),
  );

  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const step = Math.max(1, Math.floor(pos.count / 800));

  for (let i = 0; i < pos.count; i += step) {
    const density = hash3(
      Math.floor(pos.getX(i) * 10),
      Math.floor(pos.getY(i) * 10),
      Math.floor(pos.getZ(i) * 10),
    );
    if (density < 0.4) continue;

    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const nx = norm.getX(i);
    const ny = norm.getY(i);
    const nz = norm.getZ(i);

    // Orbs float slightly inward from the surface (toward center)
    if (density > 0.75) {
      const orb = new THREE.Mesh(orbGeo, orbMat);
      const scale = 0.6 + hash3(i * 3, i * 5, i * 7) * 1.0;
      orb.scale.setScalar(scale);
      // Normal points inward (toward center) for inverted sphere
      orb.position.set(
        px + nx * 1.2 * scale,
        py + ny * 1.2 * scale,
        pz + nz * 1.2 * scale,
      );
      group.add(orb);
    }

    // Flower patches on the surface
    if (density > 0.5 && density <= 0.75) {
      const mat = flowerMats[Math.floor(hash3(i, i * 2, i * 3) * flowerMats.length)];
      const petalCount = 4 + Math.floor(hash3(i * 3, i, i * 2) * 3);
      const stem = new THREE.Group();
      stem.position.set(px, py, pz);

      // Orient stem so its Y axis points inward along the normal
      const up = new THREE.Vector3(nx, ny, nz);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      stem.quaternion.copy(quat);

      for (let p = 0; p < petalCount; p++) {
        const petal = new THREE.Mesh(petalGeo, mat);
        const angle = (p / petalCount) * Math.PI * 2;
        const tilt = 0.3 + hash3(p, i, p + i) * 0.4;
        petal.position.set(Math.cos(angle) * 0.15, 0.5, Math.sin(angle) * 0.15);
        petal.rotation.set(tilt, angle, 0);
        stem.add(petal);
      }

      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 4),
        new THREE.MeshStandardMaterial({ color: 0xfdcb6e, roughness: 0.5 }),
      );
      center.position.y = 0.55;
      stem.add(center);
      group.add(stem);
    }
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
    color: 0xffffff, roughness: 0.85, flatShading: false, side: THREE.DoubleSide, vertexColors: true,
  });
  attachSphereGridShader(mat, 10);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  groundMeshes.add(mesh);
  group.add(groundMeshes);

  scatterSphereMarkers(group, geo, SPHERE_RADIUS);

  generateSphereSpawns();

  return {
    group,
    groundMeshes,
    ceilingMeshes,
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
