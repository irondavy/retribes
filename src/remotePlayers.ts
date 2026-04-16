import * as THREE from "three";
import type { PlayerSnapshot } from "./network";

const INTERP_DELAY_MS = 100;
const CAPSULE_RADIUS = 0.5;
const CAPSULE_HEIGHT = 1.4;
const STALE_TIMEOUT = 3000;
const JET_EMIT_INTERVAL = 0.02;
const JET_MAX_PARTICLES = 40;

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

// ─── Remote Player ───────────────────────────────────────────────

const _tmpPos = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

class RemotePlayer {
  readonly group: THREE.Group;
  private readonly body: THREE.Mesh;

  private readonly rope: THREE.Mesh;
  private readonly ropeGeo: THREE.CylinderGeometry;

  private readonly jetPool: MiniParticlePool;
  private jetTimer = 0;

  private buffer: TimedSnapshot[] = [];
  private currentPos = new THREE.Vector3();
  private currentQuat = new THREE.Quaternion();

  private skiing = false;
  private jetting = false;
  private grounded = false;
  private grappleAttached = false;
  private readonly grappleAnchor = new THREE.Vector3();

  constructor() {
    this.group = new THREE.Group();

    // Capsule body
    const geo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.6, metalness: 0.2 });
    this.body = new THREE.Mesh(geo, mat);
    this.group.add(this.body);

    // Grapple rope
    this.ropeGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 4, 1);
    const ropeMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, fog: false });
    this.rope = new THREE.Mesh(this.ropeGeo, ropeMat);
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    this.group.parent?.add(this.rope);

    // Jet particles (added to scene root, not to group, so they stay in world space)
    this.jetPool = new MiniParticlePool(JET_MAX_PARTICLES, new THREE.Color(0x88ddff), 0.4);
  }

  /** Must be called after adding group to scene so rope + particles get scene-parented */
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
    // Keep a reasonable window
    while (this.buffer.length > 10) this.buffer.shift();
  }

  update(dt: number): void {
    this.interpolate();

    this.group.position.copy(this.currentPos);
    this.body.quaternion.copy(this.currentQuat);

    // Grapple rope
    if (this.grappleAttached) {
      const start = this.currentPos;
      const end = this.grappleAnchor;
      const mid = _tmpPos.addVectors(start, end).multiplyScalar(0.5);
      const axis = new THREE.Vector3().subVectors(end, start);
      const len = axis.length();
      this.rope.position.copy(mid);
      this.rope.scale.set(1, len, 1);
      if (len > 0.01) {
        this.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
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

  private interpolate(): void {
    const renderTime = performance.now() - INTERP_DELAY_MS;

    if (this.buffer.length === 0) return;

    // Find the two snapshots bracketing renderTime
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

      _tmpQuat.set(from.snap.quaternion[0], from.snap.quaternion[1], from.snap.quaternion[2], from.snap.quaternion[3]);
      this.currentQuat.set(to.snap.quaternion[0], to.snap.quaternion[1], to.snap.quaternion[2], to.snap.quaternion[3]);
      this.currentQuat.slerp(_tmpQuat, 1 - t);

      this.applyFlags(to.snap);
    } else {
      // Extrapolate from latest
      const latest = this.buffer[this.buffer.length - 1].snap;
      this.currentPos.set(latest.position[0], latest.position[1], latest.position[2]);
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
    (this.body.geometry as THREE.BufferGeometry).dispose();
    (this.body.material as THREE.Material).dispose();
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
