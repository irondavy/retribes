import * as THREE from "three";
import { InputState } from "./input";
import { tuning } from "./constants";
import type { MapType } from "./terrain";

const RAY_ORIGIN_OFFSET = 500;
const GRAVITY_BLEND_ZONE = 50;

export class PlayerController {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3(0, tuning.playerHeight, 0);
  readonly velocity = new THREE.Vector3();

  grounded = false;
  skiing = false;
  jetting = false;
  energy = 100;

  /** Absorbed normal velocity on the most recent collision (m/s). Resets each frame. */
  lastImpact = 0;
  /** Set to true on the frame grounded transitions from false→true. */
  justLanded = false;

  private timeSinceGrounded = 0;
  private prevSkiing = false;
  private prevJetting = false;
  private landingRecoveryTimer = 0;
  private smoothedCamY = 0;
  private smoothedCamYInit = false;

  /** +1 = normal (down), -1 = inverted (up toward ceiling). Only used in flat mode. */
  gravitySign = 1;

  /** Midpoint Y between floor and ceiling — gravity flips around this. Flat mode only. */
  mirrorY = 0;

  /** Current map mode — affects gravity, raycasting, and movement. */
  mapType: MapType = "flat";

  /** Sphere map parameters. */
  sphereCenter = new THREE.Vector3();
  sphereRadius = 300;

  /** Grapple state — public so main.ts can draw the rope */
  grappleAttached = false;
  grappleTraveling = false;
  readonly grappleAnchor = new THREE.Vector3();
  readonly grappleHookPos = new THREE.Vector3();
  grappleRopeLength = 0;
  private grappleWasDown = false;
  private readonly grappleDir = new THREE.Vector3();
  private grappleDistTraveled = 0;
  private grappleWasAirborne = false;

  private readonly quatYaw = new THREE.Quaternion();
  private readonly quatPitch = new THREE.Quaternion();
  private readonly yawAxis = new THREE.Vector3(0, 1, 0);
  private readonly pitchAxis = new THREE.Vector3(1, 0, 0);

  private readonly groundNormal = new THREE.Vector3(0, 1, 0);
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  // Gravity camera reorientation state
  private prevGravSign = 1;
  private slerpActive = false;
  private slerpProgress = 0;
  private slerpStartQuat = new THREE.Quaternion();
  private slerpTargetQuat = new THREE.Quaternion();
  private prevGrounded = false;
  private pendingFlip = false;
  /** Continuous blend value: -1 = fully floor gravity, +1 = fully ceiling gravity. */
  private gravityBlend = -1;

  private readonly raycaster = new THREE.Raycaster();
  private readonly rayOrigin = new THREE.Vector3();

  private floorMeshes: THREE.Object3D[] = [];
  private ceilingMeshes: THREE.Object3D[] = [];
  private structureMeshes: THREE.Object3D[] = [];

  // Pre-allocated temporaries — never allocate in per-frame methods
  private readonly _gravDir = new THREE.Vector3();
  private readonly _upDir = new THREE.Vector3();
  private readonly _tv0 = new THREE.Vector3();
  private readonly _tv1 = new THREE.Vector3();
  private readonly _tv2 = new THREE.Vector3();
  private readonly _tv3 = new THREE.Vector3();
  private readonly _tv4 = new THREE.Vector3();
  private readonly _tv5 = new THREE.Vector3();
  private readonly _tv6 = new THREE.Vector3();
  private readonly _tv7 = new THREE.Vector3();
  private readonly _tv8 = new THREE.Vector3();
  private readonly _tq0 = new THREE.Quaternion();
  private readonly _tq1 = new THREE.Quaternion();
  private readonly _tm0 = new THREE.Matrix4();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  setTerrain(
    floorGroup: THREE.Group,
    ceilingGroup: THREE.Group,
    structureGroup: THREE.Group,
    mirrorY: number,
    mapType: MapType = "flat",
    sphereCenter?: THREE.Vector3,
    sphereRadius?: number,
  ): void {
    this.mirrorY = mirrorY;
    this.mapType = mapType;
    if (sphereCenter) this.sphereCenter.copy(sphereCenter);
    if (sphereRadius !== undefined) this.sphereRadius = sphereRadius;

    this.floorMeshes = [];
    this.ceilingMeshes = [];
    this.structureMeshes = [];
    floorGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) this.floorMeshes.push(child);
    });
    ceilingGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) this.ceilingMeshes.push(child);
    });
    structureGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) this.structureMeshes.push(child);
    });
  }

  /**
   * Get the "down" direction at the player's current position.
   * Sphere: outward from center (toward the inner surface).
   * Flat: standard Y-axis gravity with sign flip.
   */
  private getGravityDir(): THREE.Vector3 {
    if (this.mapType === "sphere") {
      // Gravity pulls outward, toward the inner surface of the sphere
      return this._gravDir
        .subVectors(this.position, this.sphereCenter)
        .normalize();
    }
    return this._gravDir.set(0, -this.gravitySign, 0);
  }

  /** Get the "up" direction (opposite gravity). Sphere: toward center. */
  private getUpDir(): THREE.Vector3 {
    return this._upDir.copy(this.getGravityDir()).negate();
  }

  snapToGround(): void {
    if (this.mapType === "sphere") {
      const hit = this.sampleSurfaceSphere();
      if (hit) {
        const towardCenter = this._tv0.subVectors(this.sphereCenter, hit.point).normalize();
        this.position.copy(hit.point).addScaledVector(towardCenter, tuning.playerHeight);
        this.groundNormal.copy(hit.normal);
      }
      this.grounded = true;
      this.camera.position.copy(this.position);
      return;
    }

    if (this.gravitySign >= 0) {
      const { height } = this.sampleSurfaceFlat(this.position.x, this.position.z, "floor");
      this.position.y = height + tuning.playerHeight;
    } else {
      const { height } = this.sampleSurfaceFlat(this.position.x, this.position.z, "ceiling");
      this.position.y = height - tuning.playerHeight;
    }
    this.grounded = true;
    this.camera.position.copy(this.position);
  }

  spawn(x: number, z: number, facingAngle: number, y?: number): void {
    if (this.mapType === "sphere" && y !== undefined) {
      this.position.set(x, y, z);
    } else {
      this.position.set(x, 0, z);
    }
    this.velocity.set(0, 0, 0);
    this.energy = 100;
    this.grounded = false;
    this.gravitySign = 1;
    this.grappleAttached = false;
    this.grappleTraveling = false;

    if (this.mapType === "sphere") {
      const up = this._tv0.subVectors(this.sphereCenter, this.position).normalize();
      const fwd = this._tv1;
      if (Math.abs(up.y) < 0.99) {
        fwd.set(0, 1, 0).cross(up).normalize();
      } else {
        fwd.set(1, 0, 0).cross(up).normalize();
      }
      this._tq0.setFromAxisAngle(up, facingAngle);
      fwd.applyQuaternion(this._tq0);

      const rightVec = this._tv2.crossVectors(fwd, up).normalize();
      const correctedFwd = this._tv3.crossVectors(up, rightVec).normalize();
      this._tm0.makeBasis(rightVec, up, correctedFwd.negate());
      this.camera.quaternion.setFromRotationMatrix(this._tm0);
    } else {
      this.camera.quaternion.setFromAxisAngle(this.yawAxis, facingAngle);
    }

    this.snapToGround();
  }

  get speed(): number {
    if (this.mapType === "sphere") {
      const radialDir = this._tv0.subVectors(this.position, this.sphereCenter);
      if (radialDir.lengthSq() < 0.001) return this.velocity.length();
      radialDir.normalize();
      const radialSpeed = this.velocity.dot(radialDir);
      const tanSq = this.velocity.lengthSq() - radialSpeed * radialSpeed;
      return Math.sqrt(Math.max(0, tanSq));
    }
    return Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);
  }

  get altitude(): number {
    if (this.mapType === "sphere") {
      // How far "above" (toward center from) the surface. Surface is at ~sphereRadius from center.
      // Player at distance D from center. Surface at S. Altitude = S - D - playerHeight.
      return this.sphereRadius - this.position.distanceTo(this.sphereCenter) - tuning.playerHeight;
    }
    return this.position.y - tuning.playerHeight;
  }

  update(dt: number, input: InputState): void {
    this.lastImpact = 0;
    const wasGrounded = this.grounded;
    const wasSkiing = this.prevSkiing;
    const wasGrappled = this.grappleAttached;

    if (this.mapType === "sphere") {
      this.updateSphere(dt, input);
    } else {
      this.updateFlat(dt, input);
    }

    this.postUpdate(dt, input, wasGrounded, wasSkiing, wasGrappled);
  }

  private postUpdate(
    dt: number, input: InputState,
    wasGrounded: boolean, wasSkiing: boolean, wasGrappled: boolean,
  ): void {
    // --- justLanded detection ---
    this.justLanded = this.grounded && !wasGrounded;

    // --- Coyote time ---
    if (this.grounded) {
      this.timeSinceGrounded = 0;
    } else {
      this.timeSinceGrounded += dt * 1000; // track in ms
    }

    // --- Ski entry boost ---
    if (this.skiing && !wasSkiing && this.grounded && tuning.skiEntryBoost > 0) {
      const spd = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      if (spd > 1) {
        const scale = tuning.skiEntryBoost / spd;
        this.velocity.x += this.velocity.x * scale;
        this.velocity.z += this.velocity.z * scale;
      } else if (this.forward.lengthSq() > 0.001) {
        this.velocity.x += this.forward.x * tuning.skiEntryBoost;
        this.velocity.z += this.forward.z * tuning.skiEntryBoost;
      }
    }
    this.prevSkiing = this.skiing;
    this.prevJetting = this.jetting;

    // --- Grapple release boost ---
    if (wasGrappled && !this.grappleAttached && tuning.grappleReleaseBoost > 0) {
      const spd = this.velocity.length();
      if (spd > 0.1) {
        this.velocity.addScaledVector(
          this._tv0.copy(this.velocity).divideScalar(spd),
          tuning.grappleReleaseBoost,
        );
      }
    }

    // --- Landing recovery ---
    if (this.justLanded && tuning.landingRecoveryTime > 0 && this.lastImpact > tuning.impactThreshold) {
      this.landingRecoveryTimer = tuning.landingRecoveryTime;
    }
    if (this.landingRecoveryTimer > 0) {
      this.landingRecoveryTimer -= dt;
      const dampen = 0.3;
      this.velocity.x *= dampen + (1 - dampen) * (1 - this.landingRecoveryTimer / tuning.landingRecoveryTime);
      this.velocity.z *= dampen + (1 - dampen) * (1 - this.landingRecoveryTimer / tuning.landingRecoveryTime);
    }

    // --- Camera roll on strafe ---
    if (tuning.strafeRollAngle > 0) {
      let strafeInput = 0;
      if (input.isDown("KeyD")) strafeInput += 1;
      if (input.isDown("KeyA")) strafeInput -= 1;
      const targetRoll = -strafeInput * tuning.strafeRollAngle * Math.PI / 180 *
        Math.min(1, this.speed / 30);
      const camFwd = this._tv0.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const currentUp = this._tv1.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const currentRoll = Math.atan2(
        currentUp.dot(this._tv2.crossVectors(camFwd, new THREE.Vector3(0, 1, 0)).normalize()),
        currentUp.dot(new THREE.Vector3(0, 1, 0)),
      );
      const rollDiff = targetRoll - currentRoll;
      if (Math.abs(rollDiff) > 0.001) {
        const correction = rollDiff * Math.min(1, 8 * dt);
        this._tq0.setFromAxisAngle(camFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion), correction);
        this.camera.quaternion.premultiply(this._tq0);
        this.camera.quaternion.normalize();
      }
    }

    // --- Slope camera tilt ---
    if (tuning.slopeTiltIntensity > 0 && this.grounded && this.skiing) {
      const slopeAngle = Math.acos(Math.min(1, Math.abs(this.groundNormal.y)));
      const tiltTarget = slopeAngle * tuning.slopeTiltIntensity;
      const moveDot = this.velocity.x * this.groundNormal.x + this.velocity.z * this.groundNormal.z;
      const sign = moveDot > 0 ? -1 : 1;
      const camRight = this._tv0.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const correction = sign * tiltTarget * Math.min(1, 4 * dt);
      if (Math.abs(correction) > 0.0001) {
        this._tq0.setFromAxisAngle(camRight, correction);
        this.camera.quaternion.premultiply(this._tq0);
        this.camera.quaternion.normalize();
      }
    }

    // --- Ski camera vertical smoothing ---
    if (tuning.skiCamSmoothing > 0 && this.grounded && this.skiing) {
      if (!this.smoothedCamYInit) {
        this.smoothedCamY = this.camera.position.y;
        this.smoothedCamYInit = true;
      }
      const alpha = Math.pow(tuning.skiCamSmoothing, dt * 60);
      this.smoothedCamY = alpha * this.smoothedCamY + (1 - alpha) * this.camera.position.y;
      this.camera.position.y = this.smoothedCamY;
    } else {
      this.smoothedCamYInit = false;
    }
  }

  // ─── SPHERE UPDATE ──────────────────────────────────────────────

  private updateSphere(dt: number, input: InputState): void {
    const {
      gravity, skiFriction, groundFriction, jetThrust, jetEnergyDrain,
      jetEnergyRegen, airControl, playerHeight, walkSpeed, mouseSensitivity,
      skiSteerFactor, jetForwardBias, grappleRange, grapplePull, grappleSwingDamping,
    } = tuning;

    const { dx, dy } = input.consumeMouse();

    const towardCenter = this._tv0.subVectors(this.sphereCenter, this.position).normalize();
    const outward = this._tv1.copy(towardCenter).negate();

    this._tq0.setFromAxisAngle(towardCenter, -dx * mouseSensitivity);
    this.quatPitch.setFromAxisAngle(this.pitchAxis, -dy * mouseSensitivity);
    this.camera.quaternion.premultiply(this._tq0);
    this.camera.quaternion.multiply(this.quatPitch);
    this.camera.quaternion.normalize();

    this.applySphereCamera(dt, towardCenter);

    const camFwd = this._tv2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const camRight = this._tv3.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    this.forward.copy(camFwd).addScaledVector(towardCenter, -camFwd.dot(towardCenter));
    if (this.forward.lengthSq() > 0.001) this.forward.normalize();

    this.right.copy(camRight).addScaledVector(towardCenter, -camRight.dot(towardCenter));
    if (this.right.lengthSq() > 0.001) this.right.normalize();

    const wishDir = this._tv4.set(0, 0, 0);
    if (input.isDown("KeyW")) wishDir.add(this.forward);
    if (input.isDown("KeyS")) wishDir.sub(this.forward);
    if (input.isDown("KeyD")) wishDir.add(this.right);
    if (input.isDown("KeyA")) wishDir.sub(this.right);
    const hasInput = wishDir.lengthSq() > 0;
    if (hasInput) wishDir.normalize();

    this.skiing = input.isDown("ShiftLeft") || input.isDown("ShiftRight");

    const wantsJet = input.isMouseDown(2) || input.isDown("Space");
    this.jetting = wantsJet && this.energy >= 1;

    if (this.jetting) {
      this.energy = Math.max(0, this.energy - jetEnergyDrain * dt);
      if (this.energy <= 0) { this.energy = 0; this.jetting = false; }
    }
    if (this.jetting) {
      const coyoteGrounded = this.grounded || this.timeSinceGrounded < tuning.coyoteTime;
      if (coyoteGrounded) {
        const velOutward = this.velocity.dot(outward);
        if (velOutward > 0) {
          this.velocity.addScaledVector(outward, -velOutward);
        }
      }
      let thrust = jetThrust;
      if (tuning.enableJetKick && !this.prevJetting) {
        thrust *= 2.5;
      }
      this.velocity.addScaledVector(towardCenter, thrust * dt);
      if (hasInput) {
        this.velocity.addScaledVector(wishDir, thrust * jetForwardBias * dt);
      }
    } else {
      this.energy = Math.min(100, this.energy + jetEnergyRegen * dt);
    }

    this.velocity.addScaledVector(outward, gravity * dt);

    if (this.grounded && !this.jetting) {
      if (this.skiing) {
        const gravVec = this._tv5.copy(outward).multiplyScalar(gravity);
        const normalDot = gravVec.dot(this.groundNormal);
        const slopeForce = this._tv6.copy(gravVec).addScaledVector(this.groundNormal, -normalDot);
        this.velocity.addScaledVector(slopeForce, dt);

        if (hasInput) {
          this.velocity.addScaledVector(wishDir, skiSteerFactor * walkSpeed * dt);
        }

        let effectiveSF = skiFriction;
        if (tuning.enableSlopeFriction) {
          const tangVel = this._tv7.copy(this.velocity).addScaledVector(outward, -this.velocity.dot(outward));
          const tLen = tangVel.length();
          if (tLen > 0.1) {
            const slopeDir = this._tv8.copy(slopeForce).normalize();
            const slopeAlign = tangVel.dot(slopeDir) / tLen;
            effectiveSF *= 1 - slopeAlign * 0.6;
          }
        }
        const skiF = Math.exp(-effectiveSF * dt);
        const radialSpeed = this.velocity.dot(outward);
        this.velocity.addScaledVector(outward, -radialSpeed);
        this.velocity.multiplyScalar(skiF);
        this.velocity.addScaledVector(outward, radialSpeed);
      } else {
        if (hasInput) {
          const radialSpeed = this.velocity.dot(outward);
          this.velocity.copy(wishDir).multiplyScalar(walkSpeed);
          this.velocity.addScaledVector(outward, radialSpeed);
        } else {
          const friction = Math.exp(-groundFriction * 60 * dt);
          const radialSpeed = this.velocity.dot(outward);
          this.velocity.addScaledVector(outward, -radialSpeed);
          this.velocity.multiplyScalar(friction);
          this.velocity.addScaledVector(outward, radialSpeed);
        }
      }

      const velOutward = this.velocity.dot(outward);
      if (velOutward > 0) {
        this.velocity.addScaledVector(outward, -velOutward);
      }
    } else if (!this.grounded && !this.jetting) {
      if (hasInput) {
        this.velocity.addScaledVector(wishDir, airControl * walkSpeed * dt * 60);
      }
    }

    // Grapple
    const grappleDown = input.isMouseDown(0);
    const grappleJustPressed = grappleDown && !this.grappleWasDown;
    this.grappleWasDown = grappleDown;

    if (grappleJustPressed && !this.grappleAttached && !this.grappleTraveling) {
      this.grappleTraveling = true;
      this.grappleHookPos.copy(this.position);
      this.grappleDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.grappleDistTraveled = 0;
    }
    if (!grappleDown) {
      this.grappleAttached = false;
      this.grappleTraveling = false;
    }

    this.updateGrappleProjectile(dt, this.floorMeshes, grappleRange, grapplePull, grappleSwingDamping);

    this.position.addScaledVector(this.velocity, dt);

    // Ground collision
    const hit = this.sampleSurfaceSphere();
    if (hit) {
      const distFromCenter = this.position.distanceTo(this.sphereCenter);
      const surfaceDist = hit.point.distanceTo(this.sphereCenter);
      const feetDist = distFromCenter + playerHeight;

      const jetLaunching = this.jetting && this.velocity.dot(towardCenter) > 0;
      const penetrating = feetDist > surfaceDist;
      const snapThreshold = surfaceDist - tuning.groundSnapThreshold;
      const snappedDist = surfaceDist - playerHeight;

      const needsSnap = penetrating && !(jetLaunching && feetDist - surfaceDist < 0.5);
      const needsGroundSnap = !needsSnap && !jetLaunching && distFromCenter >= snapThreshold - playerHeight;

      if (needsSnap || needsGroundSnap) {
        const dirFromCenter = this._tv5.subVectors(this.position, this.sphereCenter).normalize();
        this.position.copy(this.sphereCenter).addScaledVector(dirFromCenter, snappedDist);
        this.groundNormal.copy(hit.normal);

        if (!this.grounded) {
          const velDotOutward = this.velocity.dot(dirFromCenter);
          if (velDotOutward > 0) {
            this.lastImpact = Math.max(this.lastImpact, velDotOutward);
            this.velocity.addScaledVector(dirFromCenter, -velDotOutward);
          }
          this.applyLandingAngle(this._tv6.copy(dirFromCenter).negate());
        }
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    } else {
      this.grounded = false;
    }

    this.camera.position.copy(this.position);
  }

  private applySphereCamera(dt: number, targetUp: THREE.Vector3): void {
    const speed = tuning.gravityRotSpeed;
    const camUp = this._tv5.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const camForward = this._tv6.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    const currentUpProj = this._tv7.copy(camUp).addScaledVector(camForward, -camUp.dot(camForward));
    if (currentUpProj.lengthSq() < 0.0001) return;
    currentUpProj.normalize();

    // Reuse _tv5 (camUp no longer needed) for targetUpProj
    const targetUpProj = this._tv5.copy(targetUp).addScaledVector(camForward, -targetUp.dot(camForward));

    if (targetUpProj.lengthSq() > 0.001) {
      targetUpProj.normalize();
      const dot = Math.max(-1, Math.min(1, currentUpProj.dot(targetUpProj)));
      const cross = this._upDir.crossVectors(currentUpProj, targetUpProj);
      const angleSigned = Math.atan2(cross.dot(camForward), dot);

      const correction = angleSigned * Math.min(1, speed * 3 * dt);
      if (Math.abs(correction) > 0.0001) {
        this._tq0.setFromAxisAngle(camForward, correction);
        this.camera.quaternion.premultiply(this._tq0);
        this.camera.quaternion.normalize();
      }
    }
  }

  // Reusable return value for sampleSurfaceSphere — avoids allocation per call
  private readonly _sphereHitPoint = new THREE.Vector3();
  private readonly _sphereHitNormal = new THREE.Vector3();
  private readonly _sphereHitResult = { point: this._sphereHitPoint, normal: this._sphereHitNormal };

  private sampleSurfaceSphere(): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    if (this.floorMeshes.length === 0) return null;

    const outward = this._gravDir.subVectors(this.position, this.sphereCenter).normalize();

    this.raycaster.set(this.position, outward);
    const hits = this.raycaster.intersectObjects(this.floorMeshes, false);

    if (hits.length > 0) {
      const best = hits[0];
      this._sphereHitPoint.copy(best.point);
      if (best.face) {
        this._sphereHitNormal.copy(best.face.normal).normalize();
      } else {
        this._sphereHitNormal.copy(outward).negate();
      }
      return this._sphereHitResult;
    }

    this.raycaster.set(this.sphereCenter, outward);
    const fallbackHits = this.raycaster.intersectObjects(this.floorMeshes, false);
    if (fallbackHits.length > 0) {
      const best = fallbackHits[0];
      this._sphereHitPoint.copy(best.point);
      if (best.face) {
        this._sphereHitNormal.copy(best.face.normal).normalize();
      } else {
        this._sphereHitNormal.copy(outward).negate();
      }
      return this._sphereHitResult;
    }

    return null;
  }

  // ─── FLAT UPDATE (original logic) ───────────────────────────────

  // Pre-allocated mesh list for flat grapple raycasting
  private readonly _allMeshes: THREE.Object3D[] = [];

  private updateFlat(dt: number, input: InputState): void {
    const {
      gravity, skiFriction, groundFriction, jetThrust, jetEnergyDrain,
      jetEnergyRegen, airControl, playerHeight, walkSpeed, mouseSensitivity,
      groundSnapThreshold, skiSteerFactor, jetForwardBias,
      grappleRange, grapplePull, grappleSwingDamping,
    } = tuning;

    const { dx, dy } = input.consumeMouse();

    const camUp = this._tv0.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.quatYaw.setFromAxisAngle(camUp, -dx * mouseSensitivity);
    this.quatPitch.setFromAxisAngle(this.pitchAxis, -dy * mouseSensitivity);
    this.camera.quaternion.premultiply(this.quatYaw);
    this.camera.quaternion.multiply(this.quatPitch);
    this.camera.quaternion.normalize();

    const midpoint = this.mirrorY / 2;
    const distFromMid = this.position.y - midpoint;
    const rawBlend = distFromMid / GRAVITY_BLEND_ZONE;
    const blend = Math.max(-1, Math.min(1, rawBlend));
    const gravSign = blend <= 0 ? 1 : -1;
    const gravStrength = Math.abs(blend);
    const effectiveGravity = gravity * gravStrength;

    this.gravitySign = gravSign;
    this.gravityBlend = blend;

    this.applyGravityCamera(dt);

    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.forward.y = 0;
    if (this.forward.lengthSq() > 0.001) this.forward.normalize();

    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.right.y = 0;
    if (this.right.lengthSq() > 0.001) this.right.normalize();

    const wishDir = this._tv1.set(0, 0, 0);
    if (input.isDown("KeyW")) wishDir.add(this.forward);
    if (input.isDown("KeyS")) wishDir.sub(this.forward);
    if (input.isDown("KeyD")) wishDir.add(this.right);
    if (input.isDown("KeyA")) wishDir.sub(this.right);
    const hasInput = wishDir.lengthSq() > 0;
    if (hasInput) wishDir.normalize();

    this.skiing = input.isDown("ShiftLeft") || input.isDown("ShiftRight");

    const wantsJet = input.isMouseDown(2) || input.isDown("Space");
    this.jetting = wantsJet && this.energy >= 1;

    if (this.jetting) {
      this.energy = Math.max(0, this.energy - jetEnergyDrain * dt);
      if (this.energy <= 0) { this.energy = 0; this.jetting = false; }
    }
    if (this.jetting) {
      const coyoteGrounded = this.grounded || this.timeSinceGrounded < tuning.coyoteTime;
      if (coyoteGrounded) {
        if (gravSign > 0 && this.velocity.y < 0) this.velocity.y = 0;
        if (gravSign < 0 && this.velocity.y > 0) this.velocity.y = 0;
      }

      // Variable jet thrust: kick on first frame, sustain after
      let thrust = jetThrust;
      if (tuning.enableJetKick && !this.prevJetting) {
        thrust *= 2.5;
      }
      this.velocity.y += gravSign * thrust * dt;
      if (hasInput) {
        this.velocity.x += wishDir.x * thrust * jetForwardBias * dt;
        this.velocity.z += wishDir.z * thrust * jetForwardBias * dt;
      }
    } else {
      this.energy = Math.min(100, this.energy + jetEnergyRegen * dt);
    }

    this.velocity.y -= gravSign * effectiveGravity * dt;

    if (this.grounded && !this.jetting) {
      if (this.skiing) {
        const gravVec = this._tv2.set(0, -gravSign * effectiveGravity, 0);
        const normalDot = gravVec.dot(this.groundNormal);
        const slopeForce = this._tv3.copy(gravVec).addScaledVector(this.groundNormal, -normalDot);
        this.velocity.addScaledVector(slopeForce, dt);

        if (hasInput) {
          this.velocity.addScaledVector(wishDir, skiSteerFactor * walkSpeed * dt);
        }

        let effectiveFriction = skiFriction;
        if (tuning.enableSlopeFriction) {
          const hSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
          if (hSpeed > 0.1) {
            const slopeAlignX = slopeForce.x / hSpeed * (this.velocity.x / hSpeed);
            const slopeAlignZ = slopeForce.z / hSpeed * (this.velocity.z / hSpeed);
            const slopeAlign = slopeAlignX + slopeAlignZ; // -1=uphill, +1=downhill
            effectiveFriction *= 1 - slopeAlign * 0.6; // downhill: 40% friction, uphill: 160%
          }
        }
        const skiF = Math.exp(-effectiveFriction * dt);
        this.velocity.x *= skiF;
        this.velocity.z *= skiF;
      } else {
        if (hasInput) {
          this.velocity.x = wishDir.x * walkSpeed;
          this.velocity.z = wishDir.z * walkSpeed;
        } else {
          const friction = Math.exp(-groundFriction * 60 * dt);
          this.velocity.x *= friction;
          this.velocity.z *= friction;
        }
      }

      if (gravSign > 0 && this.velocity.y < 0) this.velocity.y = 0;
      if (gravSign < 0 && this.velocity.y > 0) this.velocity.y = 0;
    } else if (!this.grounded && !this.jetting) {
      if (hasInput) {
        this.velocity.x += wishDir.x * airControl * walkSpeed * dt * 60;
        this.velocity.z += wishDir.z * airControl * walkSpeed * dt * 60;
      }
    }

    // Grapple
    const grappleDown = input.isMouseDown(0);
    const grappleJustPressed = grappleDown && !this.grappleWasDown;
    this.grappleWasDown = grappleDown;

    if (grappleJustPressed && !this.grappleAttached && !this.grappleTraveling) {
      this.grappleTraveling = true;
      this.grappleHookPos.copy(this.position);
      this.grappleDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.grappleDistTraveled = 0;
    }

    if (!grappleDown) {
      this.grappleAttached = false;
      this.grappleTraveling = false;
    }

    this._allMeshes.length = 0;
    for (let i = 0; i < this.floorMeshes.length; i++) this._allMeshes.push(this.floorMeshes[i]);
    for (let i = 0; i < this.ceilingMeshes.length; i++) this._allMeshes.push(this.ceilingMeshes[i]);
    for (let i = 0; i < this.structureMeshes.length; i++) this._allMeshes.push(this.structureMeshes[i]);
    this.updateGrappleProjectile(dt, this._allMeshes, grappleRange, grapplePull, grappleSwingDamping);

    this.position.addScaledVector(this.velocity, dt);

    // Ground / ceiling collision
    const onCeiling = gravSign < 0;
    const surface = onCeiling ? "ceiling" : "floor";
    const { height: surfaceY, normal } = this.sampleSurfaceFlat(
      this.position.x, this.position.z, surface,
    );

    let penetrating: boolean;
    let snapZone: boolean;
    let snappedY: number;

    // Terrain stickiness: extend snap range when skiing at speed
    let effectiveSnap = groundSnapThreshold;
    if (tuning.skiGroundAdherence > 0 && this.skiing && this.grounded) {
      const hSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      const speedFactor = Math.min(1, hSpeed / 60);
      effectiveSnap += tuning.skiGroundAdherence * speedFactor;
    }

    if (onCeiling) {
      const headY = this.position.y + playerHeight;
      penetrating = headY > surfaceY;
      snapZone = headY >= surfaceY - effectiveSnap;
      snappedY = surfaceY - playerHeight;
    } else {
      const feetY = this.position.y - playerHeight;
      penetrating = feetY < surfaceY;
      snapZone = feetY <= surfaceY + effectiveSnap;
      snappedY = surfaceY + playerHeight;
    }

    const jetLaunching = this.jetting && (
      (gravSign > 0 && this.velocity.y > 0) ||
      (gravSign < 0 && this.velocity.y < 0)
    );

    const penetrationDepth = onCeiling
      ? (this.position.y + playerHeight) - surfaceY
      : surfaceY - (this.position.y - playerHeight);

    const hardPenThreshold = jetLaunching ? 0.5 : 0;

    const needsSnap = penetrating && penetrationDepth > hardPenThreshold;
    const needsGroundSnap = !needsSnap && !jetLaunching && snapZone;

    if (needsSnap || needsGroundSnap) {
      this.position.y = snappedY;
      this.groundNormal.copy(normal);
      if (!this.grounded) {
        const velDotN = this.velocity.dot(this.groundNormal);
        const velTowardSurface = onCeiling ? velDotN > 0 : velDotN < 0;
        if (velTowardSurface) {
          this.lastImpact = Math.max(this.lastImpact, Math.abs(velDotN));
          this.velocity.addScaledVector(this.groundNormal, -velDotN);
        }
        this.applyLandingAngle(this._tv4.set(0, -gravSign, 0));
      }
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // Structure collision — push out of floating obstacles
    if (this.structureMeshes.length > 0) {
      this.resolveStructureCollision(playerHeight);

      // Ground check against structures: if not already grounded by terrain,
      // cast a short ray downward (toward gravity) to detect standing on a structure.
      if (!this.grounded) {
        const downDir = this._tv3.set(0, -gravSign, 0);
        const savedFar = this.raycaster.far;
        this.raycaster.set(this.position, downDir);
        this.raycaster.far = playerHeight + groundSnapThreshold;
        const hits = this.raycaster.intersectObjects(this.structureMeshes, false);
        if (hits.length > 0) {
          const hit = hits[0];
          if (hit.distance <= playerHeight + groundSnapThreshold) {
            const snappedY = hit.point.y + gravSign * playerHeight;
            this.position.y = snappedY;
            this.groundNormal.set(0, gravSign, 0);
            if (hit.face) this.groundNormal.copy(hit.face.normal);
            const velDotN = this.velocity.dot(this.groundNormal);
            const velTowardSurface = onCeiling ? velDotN > 0 : velDotN < 0;
            if (velTowardSurface) {
              this.lastImpact = Math.max(this.lastImpact, Math.abs(velDotN));
              this.velocity.addScaledVector(this.groundNormal, -velDotN);
            }
            this.grounded = true;
          }
        }
        this.raycaster.far = savedFar;
      }
    }

    this.camera.position.copy(this.position);
  }

  private applyLandingAngle(gravDir: THREE.Vector3): void {
    if (!tuning.enableLandingAngle) return;
    const speed = this.velocity.length();
    if (speed < 2) return;

    // Slope's downhill direction: gravity projected onto surface plane
    const normalDot = gravDir.dot(this.groundNormal);
    const downhill = this._tv0.copy(gravDir).addScaledVector(this.groundNormal, -normalDot);
    const downhillLen = downhill.length();
    if (downhillLen < 0.01) return; // flat surface
    downhill.divideScalar(downhillLen);

    // How aligned is velocity with the downhill direction?
    const velDir = this._tv1.copy(this.velocity).divideScalar(speed);
    const alignment = velDir.dot(downhill); // -1 = against slope, +1 = with slope

    if (alignment > 0.1) {
      const factor = 1 + alignment * downhillLen * 2 * tuning.landingAngleBoost;
      this.velocity.multiplyScalar(factor);
    } else if (alignment < -0.1) {
      const factor = 1 + alignment * downhillLen * 2 * tuning.landingAnglePenalty;
      this.velocity.multiplyScalar(Math.max(0.3, factor));
    }
  }

  private resolveStructureCollision(playerHeight: number): void {
    const probeRadius = playerHeight;
    const savedFar = this.raycaster.far;
    const dirs = [
      this._tv4.set(1, 0, 0), this._tv5.set(-1, 0, 0),
      this._tv6.set(0, 1, 0), this._tv7.set(0, -1, 0),
      this._tv0.set(0, 0, 1), this._tv1.set(0, 0, -1),
    ];
    for (const dir of dirs) {
      this.raycaster.set(this.position, dir);
      this.raycaster.far = probeRadius;
      const hits = this.raycaster.intersectObjects(this.structureMeshes, false);
      if (hits.length > 0) {
        const hit = hits[0];
        const pushDist = probeRadius - hit.distance;
        if (pushDist > 0) {
          this.position.addScaledVector(dir, -pushDist);
          const hitNormal = hit.face
            ? this._tv2.copy(hit.face.normal)
            : this._tv2.copy(dir).negate();
          const velDotN = this.velocity.dot(hitNormal);
          if (velDotN < 0) {
            this.lastImpact = Math.max(this.lastImpact, Math.abs(velDotN));
            this.velocity.addScaledVector(hitNormal, -velDotN);
          }
        }
      }
    }
    this.raycaster.far = savedFar;
  }

  private updateGrappleProjectile(
    dt: number, meshes: THREE.Object3D[],
    range: number, pull: number, swingDamping: number,
  ): void {
    if (this.grappleTraveling) {
      const step = tuning.grappleSpeed * dt;
      this.raycaster.set(this.grappleHookPos, this.grappleDir);
      this.raycaster.far = step;
      const hits = this.raycaster.intersectObjects(meshes, false);
      this.raycaster.far = Infinity;

      if (hits.length > 0) {
        this.grappleHookPos.copy(hits[0].point);
        this.grappleAnchor.copy(hits[0].point);
        this.grappleTraveling = false;
        this.grappleAttached = true;
        this.grappleWasAirborne = !this.grounded;
        this.grappleRopeLength = this.position.distanceTo(this.grappleAnchor);

        // Connect boost: initial impulse toward anchor + upward bias in pendulum mode
        if (tuning.grappleConnectBoost > 0 && this.grappleRopeLength > 1) {
          const toAnchor = this._tv5.subVectors(this.grappleAnchor, this.position).normalize();
          this.velocity.addScaledVector(toAnchor, tuning.grappleConnectBoost);
          if (tuning.grappleMode === "pendulum" && tuning.grappleConnectUpBias > 0) {
            if (this.mapType === "sphere") {
              const upDir = this._tv6.subVectors(this.sphereCenter, this.position).normalize();
              this.velocity.addScaledVector(upDir, tuning.grappleConnectUpBias);
            } else {
              this.velocity.y += this.gravitySign * tuning.grappleConnectUpBias;
            }
          }
        }
      } else {
        this.grappleHookPos.addScaledVector(this.grappleDir, step);
        this.grappleDistTraveled += step;
        if (this.grappleDistTraveled >= range) {
          this.grappleTraveling = false;
        }
      }
    }

    if (this.grappleAttached) {
      if (tuning.grappleMode === "pendulum") {
        this.updateGrapplePendulum(dt);
      } else {
        this.updateGrappleWinch(dt, pull, swingDamping);
      }
    }
  }

  /** Original winch mode: constant pull force + rope length constraint with damping. */
  private updateGrappleWinch(dt: number, pull: number, swingDamping: number): void {
    const toAnchor = this._tv5.subVectors(this.grappleAnchor, this.position);
    const dist = toAnchor.length();
    if (dist < 0.01) return;
    toAnchor.divideScalar(dist);
    this.velocity.addScaledVector(toAnchor, pull * dt);
    if (dist > this.grappleRopeLength) {
      const radialSpeed = this.velocity.dot(toAnchor);
      if (radialSpeed < 0) {
        this.velocity.addScaledVector(toAnchor, -radialSpeed * swingDamping);
      }
      this.position.addScaledVector(toAnchor, (dist - this.grappleRopeLength) * 0.5);
    }
  }

  /** Pendulum mode: shortening rope, full tangential momentum preservation, auto-detach. */
  private updateGrapplePendulum(dt: number): void {
    const toAnchor = this._tv5.subVectors(this.grappleAnchor, this.position);
    const dist = toAnchor.length();
    if (dist < 0.01) return;
    const toAnchorDir = this._tv6.copy(toAnchor).divideScalar(dist);

    // Auto-detach when close to anchor
    if (dist <= tuning.grappleAutoDetachRadius) {
      this.grappleAttached = false;
      return;
    }

    // Track if player has been airborne during this grapple
    if (!this.grounded) this.grappleWasAirborne = true;

    // Ground-cancel: only after player has been airborne and lands again
    if (this.grounded && this.grappleWasAirborne) {
      this.grappleAttached = false;
      return;
    }

    // Context-sensitive reel-in: fast when moving toward anchor, pauses when swinging away
    const radialVel = this.velocity.dot(toAnchorDir);
    const reelFactor = radialVel > 0 ? 1.5 : 0.3;
    this.grappleRopeLength = Math.max(
      tuning.grappleAutoDetachRadius,
      this.grappleRopeLength - tuning.grappleReelSpeed * reelFactor * dt,
    );

    // Rope length constraint: if beyond rope length, strip outward radial velocity
    // and snap position back — preserving ALL tangential momentum (no damping).
    if (dist > this.grappleRopeLength) {
      if (radialVel < 0) {
        this.velocity.addScaledVector(toAnchorDir, -radialVel);
      }
      this.position.copy(this.grappleAnchor).addScaledVector(toAnchorDir, -this.grappleRopeLength);
    }

    // Look-direction steering: bias tangential velocity toward where the player is looking
    const camFwd = this._tv7.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const fwdDotRope = camFwd.dot(toAnchorDir);
    camFwd.addScaledVector(toAnchorDir, -fwdDotRope);
    if (camFwd.lengthSq() > 0.001) {
      camFwd.normalize();
      this.velocity.addScaledVector(camFwd, 8 * dt);
    }
  }

  private computeFlippedQuat(targetUp: THREE.Vector3): THREE.Quaternion {
    const camForward = this._tv5.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const rightVec = this._tv6.crossVectors(camForward, targetUp).normalize();
    if (rightVec.lengthSq() < 0.001) {
      rightVec.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      rightVec.y = 0;
      rightVec.normalize();
    }
    const correctedUp = this._tv7.crossVectors(rightVec, camForward).normalize();
    this._tm0.makeBasis(rightVec, correctedUp, camForward.negate());
    return this._tq1.setFromRotationMatrix(this._tm0);
  }

  private applyGravityCamera(dt: number): void {
    const mode = tuning.gravityCamera;
    const gravFlipped = this.gravitySign !== this.prevGravSign;
    if (gravFlipped) this.pendingFlip = true;

    if (mode === "none") {
      this.prevGravSign = this.gravitySign;
      this.prevGrounded = this.grounded;
      this.pendingFlip = false;
      return;
    }

    const speed = tuning.gravityRotSpeed;

    const hardTargetUp = this._tv3.set(0, this.gravitySign > 0 ? 1 : -1, 0);
    const blendedUp = this._tv4.set(0, -this.gravityBlend, 0);
    const blendedLen = Math.abs(this.gravityBlend);

    const velGateThreshold = tuning.gravCamVelGate;
    const verticalSpeed = Math.abs(this.velocity.y);
    const velGateFactor = this.grounded
      ? 1.0
      : Math.max(0, 1.0 - verticalSpeed / Math.max(velGateThreshold, 0.01));

    const deadZone = tuning.gravCamDeadZone;
    const midpoint = this.mirrorY / 2;
    const distFromMid = Math.abs(this.position.y - midpoint);
    const deadZoneFactor = Math.min(1, Math.max(0, (distFromMid - deadZone * 0.3) / (deadZone * 0.7)));

    if (mode === "smooth") {
      if (gravFlipped) {
        this.slerpActive = true;
        this.slerpProgress = 0;
        this.slerpStartQuat.copy(this.camera.quaternion);
        this.slerpTargetQuat.copy(this.computeFlippedQuat(hardTargetUp));
      }
      if (this.slerpActive) {
        this.slerpProgress += speed * dt;
        if (this.slerpProgress >= 1) {
          this.slerpProgress = 1;
          this.slerpActive = false;
        }
        const t = this.slerpProgress * this.slerpProgress * (3 - 2 * this.slerpProgress);
        this.camera.quaternion.slerpQuaternions(this.slerpStartQuat, this.slerpTargetQuat, t);
      }
    } else if (mode === "snap") {
      const justLanded = this.grounded && !this.prevGrounded;
      if (justLanded && this.pendingFlip) {
        this.camera.quaternion.copy(this.computeFlippedQuat(hardTargetUp));
        this.pendingFlip = false;
      }
    } else if (mode === "spring") {
      this.applySpringRoll(dt, hardTargetUp, speed);
    } else if (mode === "blend") {
      if (blendedLen > 0.05) {
        const target = this._tv4.divideScalar(blendedLen);
        this.applySpringRoll(dt, target, speed * blendedLen);
      }
    } else if (mode === "velocity") {
      if (velGateFactor > 0.01) {
        this.applySpringRoll(dt, hardTargetUp, speed * velGateFactor);
      }
    } else if (mode === "damping") {
      this.applyRollDamping(dt);
    } else if (mode === "blend+vel") {
      const effectiveStrength = blendedLen * velGateFactor * deadZoneFactor;
      if (blendedLen > 0.05 && effectiveStrength > 0.01) {
        const target = this._tv4.divideScalar(blendedLen);
        this.applySpringRoll(dt, target, speed * effectiveStrength);
      }
    }

    this.prevGravSign = this.gravitySign;
    this.prevGrounded = this.grounded;
  }

  private applySpringRoll(dt: number, targetUp: THREE.Vector3, strength: number): void {
    const camUp = this._tv5.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const camForward = this._tv6.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    const currentUpProj = this._tv7.copy(camUp).addScaledVector(camForward, -camUp.dot(camForward));
    if (currentUpProj.lengthSq() < 0.0001) return;
    currentUpProj.normalize();

    // Reuse _tv5 (camUp done)
    const targetUpProj = this._tv5.copy(targetUp).addScaledVector(camForward, -targetUp.dot(camForward));
    if (targetUpProj.lengthSq() < 0.001) return;
    targetUpProj.normalize();

    const dot = Math.max(-1, Math.min(1, currentUpProj.dot(targetUpProj)));
    const cross = this._upDir.crossVectors(currentUpProj, targetUpProj);
    const angleSigned = Math.atan2(cross.dot(camForward), dot);

    const correction = angleSigned * Math.min(1, strength * dt);
    if (Math.abs(correction) > 0.0001) {
      this._tq0.setFromAxisAngle(camForward, correction);
      this.camera.quaternion.premultiply(this._tq0);
      this.camera.quaternion.normalize();
    }
  }

  private applyRollDamping(dt: number): void {
    const dampStr = tuning.gravCamDamping;
    const camUp = this._tv5.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const camForward = this._tv6.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    const worldUp = this._tv7.set(0, this.gravitySign > 0 ? 1 : -1, 0);

    const currentUpProj = this._tv5.copy(camUp).addScaledVector(camForward, -camUp.dot(camForward));
    if (currentUpProj.lengthSq() < 0.0001) return;
    currentUpProj.normalize();

    // Reuse _tv7 (worldUp value captured above, now project it)
    const targetUpProj = this._tv7.addScaledVector(camForward, -this._tv7.dot(camForward));
    if (targetUpProj.lengthSq() < 0.001) return;
    targetUpProj.normalize();

    const dot = Math.max(-1, Math.min(1, currentUpProj.dot(targetUpProj)));
    const cross = this._upDir.crossVectors(currentUpProj, targetUpProj);
    const angleSigned = Math.atan2(cross.dot(camForward), dot);

    const correction = angleSigned * (1.0 - Math.exp(-dampStr * 0.3 * dt));
    if (Math.abs(correction) > 0.0001) {
      this._tq0.setFromAxisAngle(camForward, correction);
      this.camera.quaternion.premultiply(this._tq0);
      this.camera.quaternion.normalize();
    }
  }

  // Pre-allocated for sampleSurfaceFlat return values
  private readonly _flatDir = new THREE.Vector3();
  private readonly _flatHitNormal = new THREE.Vector3();
  private readonly _flatFallbackNormal = new THREE.Vector3();
  private readonly _flatHitResult = { height: 0, normal: this._flatHitNormal };
  private readonly _flatFallback = { height: 0, normal: this._flatFallbackNormal };

  private sampleSurfaceFlat(
    x: number, z: number, which: "floor" | "ceiling",
  ): { height: number; normal: THREE.Vector3 } {
    const meshes = which === "floor" ? this.floorMeshes : this.ceilingMeshes;
    const isFloor = which === "floor";
    this._flatDir.set(0, isFloor ? -1 : 1, 0);
    const originY = isFloor
      ? this.position.y + RAY_ORIGIN_OFFSET
      : this.position.y - RAY_ORIGIN_OFFSET;

    this._flatFallbackNormal.set(0, isFloor ? 1 : -1, 0);
    this._flatFallback.height = isFloor ? 0 : this.mirrorY;

    if (meshes.length === 0) return this._flatFallback;

    this.rayOrigin.set(x, originY, z);
    this.raycaster.set(this.rayOrigin, this._flatDir);

    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const hit = hits[0];
      this._flatHitNormal.copy(hit.face ? hit.face.normal : this._flatFallbackNormal);
      this._flatHitResult.height = hit.point.y;
      return this._flatHitResult;
    }
    return this._flatFallback;
  }
}
