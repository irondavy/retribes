import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import type { PlayerSnapshot } from "./network";

const INTERP_DELAY_MS = 100;
const STALE_TIMEOUT = 3000;
const JET_EMIT_INTERVAL = 0.02;
const JET_MAX_PARTICLES = 40;

const MODEL_PATH = "models/RobotExpressive.glb";
const MODEL_SCALE = 5.5;
const MODEL_Y_OFFSET = -9.0;

// ─── Shared model cache ──────────────────────────────────────────

let _sharedModelPromise: Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> | null = null;

function loadSharedModel(): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  if (!_sharedModelPromise) {
    const loader = new GLTFLoader();
    _sharedModelPromise = new Promise((resolve, reject) => {
      loader.load(
        MODEL_PATH,
        (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
        undefined,
        reject,
      );
    });
  }
  return _sharedModelPromise;
}

// ─── Snapshot Buffer ─────────────────────────────────────────────

interface TimedSnapshot {
  time: number;
  snap: PlayerSnapshot;
}

// ─── Mini particle pool for remote jet effect ────────────────────

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
}

class MiniParticlePool {
  readonly particles: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  readonly points: THREE.Points;
  private readonly maxCount: number;

  constructor(maxCount: number, color: THREE.Color, size: number) {
    this.maxCount = maxCount;
    this.positions = new Float32Array(maxCount * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, mat);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    if (this.particles.length >= this.maxCount) return;
    this.particles.push({ x, y, z, vx, vy, vz, life });
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.vz *= 0.95;
    }
    let idx = 0;
    for (const p of this.particles) {
      this.positions[idx++] = p.x;
      this.positions[idx++] = p.y;
      this.positions[idx++] = p.z;
    }
    this.geometry.setDrawRange(0, this.particles.length);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// ─── Animation state ─────────────────────────────────────────────

type AnimState = "idle" | "walk" | "run";

// ─── Remote Player ───────────────────────────────────────────────

const _tmpPos = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _moveDir = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

class RemotePlayer {
  readonly group: THREE.Group;
  private fallbackBody: THREE.Mesh | null;

  private model: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentAnim: AnimState = "idle";

  private readonly rope: THREE.Mesh;
  private readonly ropeGeo: THREE.CylinderGeometry;

  private readonly jetPool: MiniParticlePool;
  private jetTimer = 0;

  private buffer: TimedSnapshot[] = [];
  private currentPos = new THREE.Vector3();
  private currentVel = new THREE.Vector3();
  private currentQuat = new THREE.Quaternion();
  private facingQuat = new THREE.Quaternion();

  private skiing = false;
  private jetting = false;
  private grounded = false;
  private grappleAttached = false;
  private readonly grappleAnchor = new THREE.Vector3();

  constructor() {
    this.group = new THREE.Group();

    // Capsule fallback while GLTF loads
    const geo = new THREE.CapsuleGeometry(0.5, 1.4, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.6, metalness: 0.2 });
    this.fallbackBody = new THREE.Mesh(geo, mat);
    this.group.add(this.fallbackBody);

    // Grapple rope
    this.ropeGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 4, 1);
    const ropeMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, fog: false });
    this.rope = new THREE.Mesh(this.ropeGeo, ropeMat);
    this.rope.frustumCulled = false;
    this.rope.visible = false;

    // Jet particles
    this.jetPool = new MiniParticlePool(JET_MAX_PARTICLES, new THREE.Color(0x88ddff), 0.4);

    this.loadModel();
  }

  private async loadModel(): Promise<void> {
    try {
      const { scene: srcScene, animations } = await loadSharedModel();
      this.model = cloneSkeleton(srcScene) as THREE.Group;
      this.model.scale.setScalar(MODEL_SCALE);
      this.model.position.y = MODEL_Y_OFFSET;
      this.model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
        }
      });

      this.mixer = new THREE.AnimationMixer(this.model);
      for (const clip of animations) {
        const action = this.mixer.clipAction(clip);
        this.actions.set(clip.name, action);
      }

      // Start idle
      const idle = this.actions.get("Idle");
      if (idle) {
        idle.play();
        this.currentAnim = "idle";
      }

      this.group.add(this.model);

      // Remove fallback capsule
      if (this.fallbackBody) {
        this.group.remove(this.fallbackBody);
        (this.fallbackBody.geometry as THREE.BufferGeometry).dispose();
        (this.fallbackBody.material as THREE.Material).dispose();
        this.fallbackBody = null;
      }
    } catch {
      // Keep fallback capsule if model fails to load
    }
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.group);
    scene.add(this.rope);
    scene.add(this.jetPool.points);
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.group);
    scene.remove(this.rope);
    scene.remove(this.jetPool.points);
  }

  pushSnapshot(snap: PlayerSnapshot): void {
    const now = performance.now();
    this.buffer.push({ time: now, snap });
    while (this.buffer.length > 10) this.buffer.shift();
  }

  update(dt: number): void {
    this.interpolate();

    this.group.position.copy(this.currentPos);

    // Orient the group to face movement direction (horizontal)
    const hSpeed = Math.sqrt(this.currentVel.x ** 2 + this.currentVel.z ** 2);
    if (hSpeed > 1) {
      _moveDir.set(this.currentVel.x, 0, this.currentVel.z).normalize();
      const angle = Math.atan2(_moveDir.x, _moveDir.z);
      this.facingQuat.setFromAxisAngle(_UP, angle);
    }
    this.group.quaternion.slerp(this.facingQuat, Math.min(1, 10 * dt));

    // Lean the model for skiing / jetting
    if (this.model) {
      let tiltX = 0;
      if (this.skiing && this.grounded && hSpeed > 5) {
        tiltX = -0.25;
      } else if (this.jetting) {
        tiltX = 0.15;
      }
      const currentTilt = this.model.rotation.x;
      this.model.rotation.x += (tiltX - currentTilt) * Math.min(1, 8 * dt);
    }

    // Update animation state
    this.updateAnimation(dt, hSpeed);

    // Grapple rope
    if (this.grappleAttached) {
      const start = this.currentPos;
      const end = this.grappleAnchor;
      const mid = _tmpPos.addVectors(start, end).multiplyScalar(0.5);
      const axis = _moveDir.subVectors(end, start);
      const len = axis.length();
      this.rope.position.copy(mid);
      this.rope.scale.set(1, len, 1);
      if (len > 0.01) {
        this.rope.quaternion.setFromUnitVectors(_UP, axis.normalize());
      }
      this.rope.visible = true;
    } else {
      this.rope.visible = false;
    }

    // Jet particles
    if (this.jetting) {
      this.jetTimer += dt;
      while (this.jetTimer >= JET_EMIT_INTERVAL) {
        this.jetTimer -= JET_EMIT_INTERVAL;
        this.jetPool.emit(
          this.currentPos.x + (Math.random() - 0.5) * 0.5,
          this.currentPos.y - 1.2,
          this.currentPos.z + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 2,
          -(2 + Math.random() * 4),
          (Math.random() - 0.5) * 2,
          0.25 + Math.random() * 0.2,
        );
      }
    } else {
      this.jetTimer = 0;
    }
    this.jetPool.update(dt);
  }

  private updateAnimation(dt: number, hSpeed: number): void {
    if (!this.mixer) return;

    let target: AnimState;
    if (!this.grounded) {
      // Airborne: use run if fast, idle if hovering
      target = hSpeed > 3 ? "run" : "idle";
    } else if (hSpeed > 8) {
      target = "run";
    } else if (hSpeed > 1.5) {
      target = "walk";
    } else {
      target = "idle";
    }

    if (target !== this.currentAnim) {
      this.crossfadeTo(target, 0.2);
      this.currentAnim = target;
    }

    // Scale run/walk playback speed to match actual movement speed
    const runAction = this.actions.get("Running");
    if (runAction && this.currentAnim === "run") {
      runAction.timeScale = Math.max(0.5, Math.min(2.5, hSpeed / 12));
    }
    const walkAction = this.actions.get("Walking");
    if (walkAction && this.currentAnim === "walk") {
      walkAction.timeScale = Math.max(0.5, Math.min(1.5, hSpeed / 5));
    }

    this.mixer.update(dt);
  }

  private static animClipName(state: AnimState): string {
    if (state === "idle") return "Idle";
    if (state === "walk") return "Walking";
    return "Running";
  }

  private crossfadeTo(name: string, duration: number): void {
    const clipName = RemotePlayer.animClipName(name as AnimState);
    const next = this.actions.get(clipName);
    if (!next) return;

    const currentClipName = RemotePlayer.animClipName(this.currentAnim);
    const prev = this.actions.get(currentClipName);

    next.reset().setEffectiveWeight(1).play();
    if (prev && prev !== next) {
      prev.crossFadeTo(next, duration, true);
    }
  }

  private interpolate(): void {
    const renderTime = performance.now() - INTERP_DELAY_MS;

    if (this.buffer.length === 0) return;

    let from: TimedSnapshot | null = null;
    let to: TimedSnapshot | null = null;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].time <= renderTime && this.buffer[i + 1].time >= renderTime) {
        from = this.buffer[i];
        to = this.buffer[i + 1];
        break;
      }
    }

    if (from && to) {
      const range = to.time - from.time;
      const t = range > 0 ? (renderTime - from.time) / range : 1;

      this.currentPos.set(
        from.snap.position[0] + (to.snap.position[0] - from.snap.position[0]) * t,
        from.snap.position[1] + (to.snap.position[1] - from.snap.position[1]) * t,
        from.snap.position[2] + (to.snap.position[2] - from.snap.position[2]) * t,
      );

      this.currentVel.set(
        from.snap.velocity[0] + (to.snap.velocity[0] - from.snap.velocity[0]) * t,
        from.snap.velocity[1] + (to.snap.velocity[1] - from.snap.velocity[1]) * t,
        from.snap.velocity[2] + (to.snap.velocity[2] - from.snap.velocity[2]) * t,
      );

      _tmpQuat.set(from.snap.quaternion[0], from.snap.quaternion[1], from.snap.quaternion[2], from.snap.quaternion[3]);
      this.currentQuat.set(to.snap.quaternion[0], to.snap.quaternion[1], to.snap.quaternion[2], to.snap.quaternion[3]);
      this.currentQuat.slerp(_tmpQuat, 1 - t);

      this.applyFlags(to.snap);
    } else {
      const latest = this.buffer[this.buffer.length - 1].snap;
      this.currentPos.set(latest.position[0], latest.position[1], latest.position[2]);
      this.currentVel.set(latest.velocity[0], latest.velocity[1], latest.velocity[2]);
      this.currentQuat.set(latest.quaternion[0], latest.quaternion[1], latest.quaternion[2], latest.quaternion[3]);
      this.applyFlags(latest);
    }
  }

  private applyFlags(snap: PlayerSnapshot): void {
    this.skiing = snap.skiing;
    this.jetting = snap.jetting;
    this.grounded = snap.grounded;
    this.grappleAttached = snap.grappleAttached;
    if (snap.grappleAttached) {
      this.grappleAnchor.set(snap.grappleAnchor[0], snap.grappleAnchor[1], snap.grappleAnchor[2]);
    }
  }

  get isStale(): boolean {
    if (this.buffer.length === 0) return true;
    return performance.now() - this.buffer[this.buffer.length - 1].time > STALE_TIMEOUT;
  }

  dispose(): void {
    if (this.fallbackBody) {
      (this.fallbackBody.geometry as THREE.BufferGeometry).dispose();
      (this.fallbackBody.material as THREE.Material).dispose();
    }
    if (this.mixer) this.mixer.stopAllAction();
    if (this.model) {
      this.model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else if (mesh.material) {
            mesh.material.dispose();
          }
        }
      });
    }
    this.ropeGeo.dispose();
    (this.rope.material as THREE.Material).dispose();
    this.jetPool.dispose();
  }
}

// ─── Manager ─────────────────────────────────────────────────────

export class RemotePlayerManager {
  private readonly players = new Map<string, RemotePlayer>();
  private scene: THREE.Scene | null = null;

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  addPlayer(id: string): void {
    if (this.players.has(id) || !this.scene) return;
    const rp = new RemotePlayer();
    rp.addToScene(this.scene);
    this.players.set(id, rp);
  }

  removePlayer(id: string): void {
    const rp = this.players.get(id);
    if (!rp || !this.scene) return;
    rp.removeFromScene(this.scene);
    rp.dispose();
    this.players.delete(id);
  }

  updateSnapshot(id: string, snap: PlayerSnapshot): void {
    // Auto-add if we somehow missed the join
    if (!this.players.has(id)) this.addPlayer(id);
    this.players.get(id)!.pushSnapshot(snap);
  }

  update(dt: number): void {
    const stale: string[] = [];
    for (const [id, rp] of this.players) {
      rp.update(dt);
      if (rp.isStale) stale.push(id);
    }
    for (const id of stale) this.removePlayer(id);
  }

  removeAll(): void {
    for (const id of [...this.players.keys()]) {
      this.removePlayer(id);
    }
  }

  get playerCount(): number {
    return this.players.size;
  }
}
