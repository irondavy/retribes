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
      topColor: { value: new THREE.Color(0x0a1a4a) },
      horizonColor: { value: new THREE.Color(0x87ceeb) },
      bottomColor: { value: new THREE.Color(0x886644) },
      exponent: { value: 0.4 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform float exponent;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos).y;
        if (h >= 0.0) {
          gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, exponent)), 1.0);
        } else {
          gl_FragColor = vec4(mix(horizonColor, bottomColor, pow(-h, 1.5)), 1.0);
        }
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

const FLAT_GROUND_COLOR = 0x4a7a3b;
const FLAT_CEILING_COLOR = 0x3a5a6b;
const SPHERE_GROUND_COLOR = 0x4a7a3b;

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

    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, tuning.hemisphereLightIntensity);
    scene.add(this.hemiLight);

    this.jetPool = new ParticlePool(150, new THREE.Color(0x88ddff), 0.5, THREE.AdditiveBlending, 0.7);
    scene.add(this.jetPool.points);

    this.skiPool = new ParticlePool(100, new THREE.Color(0xccbb99), 0.9, THREE.NormalBlending, 0.45);
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
      this.scene.background = new THREE.Color(0x87ceeb);
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
      this.ambientLight.intensity = 0.15;
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
    if (tuning.enableFovScaling) {
      const target = Math.min(120, 90 + player.speed * tuning.fovScaleAmount);
      this.currentFov += (target - this.currentFov) * Math.min(1, 5 * dt);
    } else {
      this.currentFov += (90 - this.currentFov) * Math.min(1, 5 * dt);
    }
    if (Math.abs(this.camera.fov - this.currentFov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    // Impact feedback — screen shake + FOV punch
    const impactForce = player.lastImpact;
    if (impactForce > tuning.impactThreshold) {
      const normalized = Math.min(1, (impactForce - tuning.impactThreshold) / 30);
      this._impactIntensity = normalized;
      this.impactTimer = 0.35;
      this.impactFovKick = normalized * 8 * tuning.impactFovPunch;
    }
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

      const fovKick = this.impactFovKick * t;
      this.camera.fov = this.currentFov - fovKick;
      this.camera.updateProjectionMatrix();
    } else {
      this._impactIntensity = 0;
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
