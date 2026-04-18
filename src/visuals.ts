import * as THREE from "three";
import { tuning } from "./constants";
import type { PlayerController } from "./player";

// ─── Sky Dome ────────────────────────────────────────────────────

function createSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3a5880) },
      horizonColor: { value: new THREE.Color(0x7ec0d8) },
      bottomColor: { value: new THREE.Color(0x4a7898) },
      exponent: { value: 0.26 },
    },
    vertexShader: `
      varying vec3 vRayDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 center = modelMatrix[3].xyz;
        vRayDir = normalize(wp.xyz - center);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform float exponent;
      varying vec3 vRayDir;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float starCellField(vec2 sc, float rare, float disk) {
        vec2 ci = floor(sc);
        float cellRnd = hash12(ci);
        vec2 starPos = vec2(hash12(ci + 17.7), hash12(ci + 83.3));
        vec2 delta = fract(sc) - starPos;
        delta = fract(delta + 0.5) - 0.5;
        float dist = length(delta);
        float br = 0.75 + hash12(ci + 41.2) * 0.95;
        float cellFw = length(vec2(fwidth(sc.x), fwidth(sc.y)));
        float aa = max(max(cellFw * 2.25, fwidth(dist) * 1.5), 0.00035);
        float falloff = 1.0 - smoothstep(disk - aa, disk + aa, dist);
        float border = max(aa * 0.28, 0.0006);
        float gate = smoothstep(rare - border, rare + border, cellRnd);
        return gate * falloff * br;
      }

      float whiteStarsTriplanar(vec3 rd, float scale, float rare, float disk) {
        vec3 w = abs(rd);
        float n = w.x + w.y + w.z;
        w /= n;
        return
          w.x * starCellField(vec2(rd.y, rd.z) * scale, rare, disk) +
          w.y * starCellField(vec2(rd.x, rd.z) * scale, rare, disk) +
          w.z * starCellField(vec2(rd.x, rd.y) * scale, rare, disk);
      }

      void main() {
        vec3 rd = normalize(vRayDir);
        float h = rd.y;
        vec3 skyColor;
        if (h >= 0.0) {
          skyColor = mix(horizonColor, topColor, pow(h, exponent));
        } else {
          skyColor = mix(horizonColor, bottomColor, pow(-h, 1.5));
        }
        float lum = dot(skyColor, vec3(0.2126, 0.7152, 0.0722));
        skyColor = clamp(mix(vec3(lum), skyColor, 1.14), 0.0, 1.0);

        float s = whiteStarsTriplanar(rd, 95.0, 0.987, 0.14);
        s += whiteStarsTriplanar(rd, 152.0, 0.992, 0.09);
        skyColor += vec3(s * 0.58);

        gl_FragColor = vec4(skyColor, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return mesh;
}

// ─── Particle Pool ───────────────────────────────────────────────

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
}

class ParticlePool {
  readonly particles: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  readonly points: THREE.Points;
  private readonly maxCount: number;

  constructor(maxCount: number, color: THREE.Color, size: number, blending: THREE.Blending, opacity: number) {
    this.maxCount = maxCount;
    this.positions = new Float32Array(maxCount * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity,
      depthWrite: false,
      sizeAttenuation: true,
      blending,
    });

    this.points = new THREE.Points(this.geometry, mat);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    if (this.particles.length >= this.maxCount) return;
    this.particles.push({ x, y, z, vx, vy, vz, life });
  }

  update(dt: number): void {
    const arr = this.particles;
    let i = 0;
    while (i < arr.length) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.vz *= 0.97;
      i++;
    }

    let idx = 0;
    for (let j = 0; j < arr.length; j++) {
      const p = arr[j];
      this.positions[idx++] = p.x;
      this.positions[idx++] = p.y;
      this.positions[idx++] = p.z;
    }
    this.geometry.setDrawRange(0, arr.length);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ─── Visual System ───────────────────────────────────────────────

const FLAT_GROUND_COLOR = 0x4a8848;
const FLAT_CEILING_COLOR = 0x3a6888;
const SPHERE_GROUND_COLOR = 0x4a8848;

export class VisualSystem {
  readonly skyDome: THREE.Mesh;
  readonly hemiLight: THREE.HemisphereLight;
  private readonly jetPool: ParticlePool;
  private readonly skiPool: ParticlePool;

  private groundMat: THREE.MeshStandardMaterial | null = null;
  private ceilingMat: THREE.MeshStandardMaterial | null = null;

  private prevToneMapping = true;
  private prevSkyGradient = true;
  private prevVertexColors = true;
  private prevHemiLight = true;
  private currentFov = 90;
  private jetTimer = 0;
  private skiTimer = 0;

  private _impactIntensity = 0;
  private impactTimer = 0;
  private readonly impactOffset = new THREE.Vector3();
  private impactFovKick = 0;

  private landingSquashTimer = 0;
  private landingSquashAmount = 0;
  private prevSpeed = 0;
  private landingDipTimer = 0;
  private landingDipAmount = 0;

  /** Current impact flash strength (0–1), decaying. Used by HUD vignette. */
  get impactFlash(): number {
    return this.impactTimer > 0 ? this._impactIntensity * (this.impactTimer / 0.35) : 0;
  }

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly ambientLight: THREE.AmbientLight,
  ) {
    this.skyDome = createSkyDome();
    scene.add(this.skyDome);

    this.hemiLight = new THREE.HemisphereLight(0x88c8e8, 0x5a8a62, tuning.hemisphereLightIntensity);
    scene.add(this.hemiLight);

    this.jetPool = new ParticlePool(150, new THREE.Color(0x58c8ff), 0.52, THREE.AdditiveBlending, 0.62);
    scene.add(this.jetPool.points);

    this.skiPool = new ParticlePool(100, new THREE.Color(0xb0c878), 0.8, THREE.NormalBlending, 0.48);
    scene.add(this.skiPool.points);

    this.applyToneMapping();
    this.applySkyGradient();
    this.applyHemiLight();
  }

  setTerrainMaterials(
    groundMat: THREE.MeshStandardMaterial,
    ceilingMat?: THREE.MeshStandardMaterial,
  ): void {
    this.groundMat = groundMat;
    this.ceilingMat = ceilingMat ?? null;
    this.applyVertexColors();
  }

  // ── Toggle applicators ──────────────────────────────────────

  private applyToneMapping(): void {
    if (tuning.enableToneMapping) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = tuning.toneMappingExposure;
    } else {
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1.0;
    }
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = (obj as THREE.Mesh).material;
        if (m && !Array.isArray(m)) m.needsUpdate = true;
      }
    });
    this.prevToneMapping = tuning.enableToneMapping;
  }

  private applySkyGradient(): void {
    if (tuning.enableSkyGradient) {
      this.skyDome.visible = true;
      this.scene.background = null;
    } else {
      this.skyDome.visible = false;
      this.scene.background = new THREE.Color(0x6e98b0);
    }
    this.prevSkyGradient = tuning.enableSkyGradient;
  }

  private applyVertexColors(): void {
    if (this.groundMat) {
      this.groundMat.vertexColors = tuning.enableVertexColors;
      this.groundMat.color.setHex(tuning.enableVertexColors ? 0xffffff : FLAT_GROUND_COLOR);
      if (!tuning.enableVertexColors && this.groundMat.side === THREE.DoubleSide) {
        this.groundMat.color.setHex(SPHERE_GROUND_COLOR);
      }
      this.groundMat.needsUpdate = true;
    }
    if (this.ceilingMat) {
      this.ceilingMat.vertexColors = tuning.enableVertexColors;
      this.ceilingMat.color.setHex(tuning.enableVertexColors ? 0xffffff : FLAT_CEILING_COLOR);
      this.ceilingMat.needsUpdate = true;
    }
    this.prevVertexColors = tuning.enableVertexColors;
  }

  private applyHemiLight(): void {
    if (tuning.enableHemisphereLight) {
      this.hemiLight.visible = true;
      this.hemiLight.intensity = tuning.hemisphereLightIntensity;
      this.ambientLight.intensity = 0.28;
    } else {
      this.hemiLight.visible = false;
      this.ambientLight.intensity = 0.4;
    }
    this.prevHemiLight = tuning.enableHemisphereLight;
  }

  // ── Per-frame update ────────────────────────────────────────

  update(dt: number, player: PlayerController): void {
    // Detect toggle changes
    if (tuning.enableToneMapping !== this.prevToneMapping) {
      this.applyToneMapping();
    } else if (tuning.enableToneMapping) {
      this.renderer.toneMappingExposure = tuning.toneMappingExposure;
    }

    if (tuning.enableSkyGradient !== this.prevSkyGradient) this.applySkyGradient();
    if (tuning.enableVertexColors !== this.prevVertexColors) this.applyVertexColors();

    if (tuning.enableHemisphereLight !== this.prevHemiLight) {
      this.applyHemiLight();
    } else if (tuning.enableHemisphereLight) {
      this.hemiLight.intensity = tuning.hemisphereLightIntensity;
    }

    // Fog + camera clip
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = tuning.fogNear;
      fog.far = tuning.fogFar;
    }
    if (this.camera.far !== tuning.cameraFar) {
      this.camera.far = tuning.cameraFar;
      this.camera.updateProjectionMatrix();
    }

    // FOV scaling
    let fovTarget = 90;
    if (tuning.enableFovScaling) {
      fovTarget = Math.min(120, 90 + player.speed * tuning.fovScaleAmount);
    }
    let fovLerpRate = 5;
    if (tuning.enableFovRateScaling) {
      const accelerating = player.speed > this.prevSpeed + 0.5;
      fovLerpRate = accelerating ? 10 : 2;
    }
    this.currentFov += (fovTarget - this.currentFov) * Math.min(1, fovLerpRate * dt);
    this.prevSpeed = player.speed;

    // Landing squash FOV
    if (player.justLanded && tuning.landingSquashFov > 0) {
      this.landingSquashTimer = 0.15;
      this.landingSquashAmount = Math.min(6, player.lastImpact * 0.15) * tuning.landingSquashFov;
    }
    let squashFov = 0;
    if (this.landingSquashTimer > 0) {
      this.landingSquashTimer -= dt;
      const t = Math.max(0, this.landingSquashTimer / 0.15);
      squashFov = this.landingSquashAmount * Math.sin(t * Math.PI);
    }

    // Impact feedback — screen shake + FOV punch
    const impactForce = player.lastImpact;
    if (impactForce > tuning.impactThreshold) {
      const normalized = Math.min(1, (impactForce - tuning.impactThreshold) / 30);
      this._impactIntensity = normalized;
      this.impactTimer = 0.35;
      this.impactFovKick = normalized * 8 * tuning.impactFovPunch;
    }
    let fovKick = 0;
    if (this.impactTimer > 0) {
      this.impactTimer -= dt;
      const t = Math.max(0, this.impactTimer / 0.35);
      const shakeAmp = this._impactIntensity * t * 0.4 * tuning.impactShakeIntensity;
      this.impactOffset.set(
        (Math.random() - 0.5) * 2 * shakeAmp,
        (Math.random() - 0.5) * 2 * shakeAmp,
        (Math.random() - 0.5) * 1 * shakeAmp,
      );
      this.camera.position.add(this.impactOffset);
      fovKick = this.impactFovKick * t;
    } else {
      this._impactIntensity = 0;
    }

    const finalFov = this.currentFov + squashFov - fovKick;
    if (Math.abs(this.camera.fov - finalFov) > 0.01) {
      this.camera.fov = finalFov;
      this.camera.updateProjectionMatrix();
    }

    // Landing camera dip
    if (player.justLanded && tuning.landingCameraDip > 0) {
      this.landingDipTimer = 0.2;
      this.landingDipAmount = Math.min(1.5, player.lastImpact * 0.05) * tuning.landingCameraDip;
    }
    if (this.landingDipTimer > 0) {
      this.landingDipTimer -= dt;
      const t = Math.max(0, this.landingDipTimer / 0.2);
      const dip = this.landingDipAmount * Math.sin(t * Math.PI);
      this.camera.position.y -= dip;
    }

    // Sky dome follows camera
    if (this.skyDome.visible) {
      this.skyDome.position.copy(this.camera.position);
    }

    // ── Jet particles ──
    if (tuning.enableJetParticles && player.jetting) {
      this.jetTimer += dt;
      while (this.jetTimer >= 0.015) {
        this.jetTimer -= 0.015;
        const gs = player.gravitySign;
        const down = gs > 0 ? -1 : 1;
        this.jetPool.emit(
          player.position.x + (Math.random() - 0.5) * 0.6,
          player.position.y + down * 1.2,
          player.position.z + (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 3,
          down * (3 + Math.random() * 5),
          (Math.random() - 0.5) * 3,
          0.3 + Math.random() * 0.25,
        );
      }
    } else {
      this.jetTimer = 0;
    }
    this.jetPool.points.visible = tuning.enableJetParticles;
    this.jetPool.update(dt);

    // ── Ski dust ──
    if (tuning.enableSkiParticles && player.skiing && player.grounded && player.speed > 5) {
      this.skiTimer += dt;
      while (this.skiTimer >= 0.025) {
        this.skiTimer -= 0.025;
        const gs = player.gravitySign;
        const feet = gs > 0 ? -1.5 : 1.5;
        this.skiPool.emit(
          player.position.x + (Math.random() - 0.5) * 0.8,
          player.position.y + feet,
          player.position.z + (Math.random() - 0.5) * 0.8,
          -player.velocity.x * 0.12 + (Math.random() - 0.5) * 2,
          gs * (0.5 + Math.random() * 1.5),
          -player.velocity.z * 0.12 + (Math.random() - 0.5) * 2,
          0.4 + Math.random() * 0.4,
        );
      }
    } else {
      this.skiTimer = 0;
    }
    this.skiPool.points.visible = tuning.enableSkiParticles;
    this.skiPool.update(dt);
  }
}
