import * as THREE from "three";
import { InputState } from "./input";
import { tuning } from "./constants";
import type { MapType } from "./terrain";

const RAY_ORIGIN_OFFSET = 500;
const GRAVITY_BLEND_ZONE = 30;

export class PlayerController {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3(0, tuning.playerHeight, 0);
  readonly velocity = new THREE.Vector3();

  grounded = false;
  skiing = false;
  jetting = false;
  energy = 100;

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
  readonly grappleAnchor = new THREE.Vector3();
  grappleRopeLength = 0;
  private grappleWasDown = false;

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

  // Reusable temp vectors to reduce allocations in update()
  private readonly _gravDir = new THREE.Vector3();
  private readonly _upDir = new THREE.Vector3();
  private readonly _tmpVec = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  setTerrain(
    floorGroup: THREE.Group,
    ceilingGroup: THREE.Group,
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
    floorGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) this.floorMeshes.push(child);
    });
    ceilingGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) this.ceilingMeshes.push(child);
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
        // Player is inside the sphere. Offset from surface toward center by playerHeight.
        const towardCenter = new THREE.Vector3()
          .subVectors(this.sphereCenter, hit.point)
          .normalize();
        this.position.copy(hit.point).addScaledVector(towardCenter, tuning.playerHeight);
        this.groundNormal.copy(hit.normal);
      }
      this.grounded = true;
      this.camera.position.copy(this.position);
      return;
    }

    // Flat mode
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

    if (this.mapType === "sphere") {
      // Orient camera so "up" points toward sphere center (away from inner surface)
      const up = this._tmpVec.subVectors(this.sphereCenter, this.position).normalize();
      const fwd = new THREE.Vector3();
      if (Math.abs(up.y) < 0.99) {
        fwd.crossVectors(new THREE.Vector3(0, 1, 0), up).normalize();
      } else {
        fwd.crossVectors(new THREE.Vector3(1, 0, 0), up).normalize();
      }
      const rotQuat = new THREE.Quaternion().setFromAxisAngle(up, facingAngle);
      fwd.applyQuaternion(rotQuat);

      const rightVec = new THREE.Vector3().crossVectors(fwd, up).normalize();
      const correctedFwd = new THREE.Vector3().crossVectors(up, rightVec).normalize();
      const m = new THREE.Matrix4().makeBasis(rightVec, up, correctedFwd.negate());
      this.camera.quaternion.setFromRotationMatrix(m);
    } else {
      this.camera.quaternion.setFromAxisAngle(this.yawAxis, facingAngle);
    }

    this.snapToGround();
  }

  get speed(): number {
    if (this.mapType === "sphere") {
      const radialDir = this._tmpVec.subVectors(this.position, this.sphereCenter);
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
    if (this.mapType === "sphere") {
      this.updateSphere(dt, input);
    } else {
      this.updateFlat(dt, input);
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

    // Inside-sphere: "up" is toward center, "down"/gravity is outward toward the surface
    const towardCenter = new THREE.Vector3().subVectors(this.sphereCenter, this.position).normalize();
    const outward = towardCenter.clone().negate();

    // Mouse look: yaw around the player's "up" (toward center), pitch around local right
    const yawQ = new THREE.Quaternion().setFromAxisAngle(towardCenter, -dx * mouseSensitivity);
    this.quatPitch.setFromAxisAngle(this.pitchAxis, -dy * mouseSensitivity);
    this.camera.quaternion.premultiply(yawQ);
    this.camera.quaternion.multiply(this.quatPitch);
    this.camera.quaternion.normalize();

    // Continuously align camera's local up with towardCenter
    this.applySphereCamera(dt, towardCenter);

    // Movement: forward/right projected onto the tangent plane
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);

    this.forward.copy(camFwd).addScaledVector(towardCenter, -camFwd.dot(towardCenter));
    if (this.forward.lengthSq() > 0.001) this.forward.normalize();

    this.right.copy(camRight).addScaledVector(towardCenter, -camRight.dot(towardCenter));
    if (this.right.lengthSq() > 0.001) this.right.normalize();

    const wishDir = new THREE.Vector3();
    if (input.isDown("KeyW")) wishDir.add(this.forward);
    if (input.isDown("KeyS")) wishDir.sub(this.forward);
    if (input.isDown("KeyD")) wishDir.add(this.right);
    if (input.isDown("KeyA")) wishDir.sub(this.right);
    const hasInput = wishDir.lengthSq() > 0;
    if (hasInput) wishDir.normalize();

    this.skiing = input.isDown("ShiftLeft") || input.isDown("ShiftRight");

    // Jetpack pushes toward center (away from surface, against gravity)
    const wantsJet = input.isMouseDown(2) || input.isDown("Space");
    this.jetting = wantsJet && this.energy > 0;

    if (this.jetting) {
      if (this.grounded) {
        // Cancel velocity toward surface (outward)
        const velOutward = this.velocity.dot(outward);
        if (velOutward > 0) {
          this.velocity.addScaledVector(outward, -velOutward);
        }
      }
      // Thrust toward center
      this.velocity.addScaledVector(towardCenter, jetThrust * dt);
      if (hasInput) {
        this.velocity.addScaledVector(wishDir, jetThrust * jetForwardBias * dt);
      }
      this.energy = Math.max(0, this.energy - jetEnergyDrain * dt);
    } else {
      this.energy = Math.min(100, this.energy + jetEnergyRegen * dt);
    }

    // Gravity: pull outward toward the inner surface
    this.velocity.addScaledVector(outward, gravity * dt);

    // Grounded behaviour
    if (this.grounded && !this.jetting) {
      if (this.skiing) {
        const gravVec = outward.clone().multiplyScalar(gravity);
        const normalComp = this.groundNormal.clone().multiplyScalar(gravVec.dot(this.groundNormal));
        const slopeForce = gravVec.clone().sub(normalComp);
        this.velocity.add(slopeForce.multiplyScalar(dt));

        if (hasInput) {
          this.velocity.addScaledVector(wishDir, skiSteerFactor * walkSpeed * dt);
        }

        const skiF = Math.exp(-skiFriction * dt);
        // Damp only tangential velocity
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

      // Cancel velocity toward surface (outward)
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

    if (grappleJustPressed) {
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.raycaster.set(this.position, camDir);
      this.raycaster.far = grappleRange;
      const hits = this.raycaster.intersectObjects(this.floorMeshes, false);
      this.raycaster.far = Infinity;
      if (hits.length > 0) {
        this.grappleAttached = true;
        this.grappleAnchor.copy(hits[0].point);
        this.grappleRopeLength = this.position.distanceTo(this.grappleAnchor);
      }
    }
    if (!grappleDown) this.grappleAttached = false;

    if (this.grappleAttached) {
      const toAnchor = new THREE.Vector3().subVectors(this.grappleAnchor, this.position);
      const dist = toAnchor.length();
      if (dist > 0.01) {
        const dir = toAnchor.divideScalar(dist);
        this.velocity.addScaledVector(dir, grapplePull * dt);
        if (dist > this.grappleRopeLength) {
          const radialSpeed = this.velocity.dot(dir);
          if (radialSpeed < 0) {
            this.velocity.addScaledVector(dir, -radialSpeed * grappleSwingDamping);
          }
          this.position.addScaledVector(dir, (dist - this.grappleRopeLength) * 0.5);
        }
      }
    }

    // Integrate
    this.position.addScaledVector(this.velocity, dt);

    // Ground collision: player is inside sphere, surface is outward.
    // Player's feet are at distFromCenter + playerHeight (outward from head).
    // Penetrating = feet have gone past the surface (farther from center than surface).
    const hit = this.sampleSurfaceSphere();
    if (hit) {
      const distFromCenter = this.position.distanceTo(this.sphereCenter);
      const surfaceDist = hit.point.distanceTo(this.sphereCenter);
      const feetDist = distFromCenter + playerHeight; // feet are outward from head

      const jetLaunching = this.jetting && this.velocity.dot(towardCenter) > 0;
      const penetrating = feetDist > surfaceDist;
      const snapThreshold = surfaceDist - tuning.groundSnapThreshold;

      // Snapped position: head at surfaceDist - playerHeight from center
      const snappedDist = surfaceDist - playerHeight;

      if (penetrating && !(jetLaunching && feetDist - surfaceDist < 0.5)) {
        const dirFromCenter = new THREE.Vector3().subVectors(this.position, this.sphereCenter).normalize();
        this.position.copy(this.sphereCenter).addScaledVector(dirFromCenter, snappedDist);
        this.groundNormal.copy(hit.normal);

        if (!this.grounded) {
          // Cancel velocity toward surface (outward component)
          const velDotOutward = this.velocity.dot(dirFromCenter);
          if (velDotOutward > 0) {
            this.velocity.addScaledVector(dirFromCenter, -velDotOutward);
          }
        }
        this.grounded = true;
      } else if (!jetLaunching && distFromCenter >= snapThreshold - playerHeight) {
        const dirFromCenter = new THREE.Vector3().subVectors(this.position, this.sphereCenter).normalize();
        this.position.copy(this.sphereCenter).addScaledVector(dirFromCenter, snappedDist);
        this.groundNormal.copy(hit.normal);

        if (!this.grounded) {
          const velDotOutward = this.velocity.dot(dirFromCenter);
          if (velDotOutward > 0) {
            this.velocity.addScaledVector(dirFromCenter, -velDotOutward);
          }
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

  /** Keep the camera's local up aligned with the sphere surface normal. */
  private applySphereCamera(dt: number, targetUp: THREE.Vector3): void {
    const speed = tuning.gravityRotSpeed;
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    const currentUpProj = camUp.clone().addScaledVector(camForward, -camUp.dot(camForward)).normalize();
    const targetUpProj = targetUp.clone().addScaledVector(camForward, -targetUp.dot(camForward));

    if (targetUpProj.lengthSq() > 0.001) {
      targetUpProj.normalize();
      const dot = Math.max(-1, Math.min(1, currentUpProj.dot(targetUpProj)));
      const cross = new THREE.Vector3().crossVectors(currentUpProj, targetUpProj);
      const angleSigned = Math.atan2(cross.dot(camForward), dot);

      // Use higher speed for sphere since the up direction changes continuously
      const correction = angleSigned * Math.min(1, speed * 3 * dt);
      if (Math.abs(correction) > 0.0001) {
        const rollQuat = new THREE.Quaternion().setFromAxisAngle(camForward, correction);
        this.camera.quaternion.premultiply(rollQuat);
        this.camera.quaternion.normalize();
      }
    }
  }

  /** Raycast outward from player to find the inner sphere surface. */
  private sampleSurfaceSphere(): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    if (this.floorMeshes.length === 0) return null;

    // Cast from player position outward (away from center) to hit the inner surface
    const outward = new THREE.Vector3()
      .subVectors(this.position, this.sphereCenter)
      .normalize();

    this.raycaster.set(this.position, outward);
    const hits = this.raycaster.intersectObjects(this.floorMeshes, false);

    if (hits.length > 0) {
      const best = hits[0];
      // Normal should point inward (toward center) for the inverted sphere
      const normal = best.face
        ? best.face.normal.clone().normalize()
        : outward.clone().negate();
      return { point: best.point.clone(), normal };
    }

    // Fallback: try from center toward the player direction
    this.raycaster.set(this.sphereCenter, outward);
    const fallbackHits = this.raycaster.intersectObjects(this.floorMeshes, false);
    if (fallbackHits.length > 0) {
      const best = fallbackHits[0];
      const normal = best.face
        ? best.face.normal.clone().normalize()
        : outward.clone().negate();
      return { point: best.point.clone(), normal };
    }

    return null;
  }

  // ─── FLAT UPDATE (original logic) ───────────────────────────────

  private updateFlat(dt: number, input: InputState): void {
    const {
      gravity, skiFriction, groundFriction, jetThrust, jetEnergyDrain,
      jetEnergyRegen, airControl, playerHeight, walkSpeed, mouseSensitivity,
      groundSnapThreshold, skiSteerFactor, jetForwardBias,
      grappleRange, grapplePull, grappleSwingDamping,
    } = tuning;

    const { dx, dy } = input.consumeMouse();

    // Yaw around camera's local up so it stays correct when inverted
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.quatYaw.setFromAxisAngle(camUp, -dx * mouseSensitivity);
    this.quatPitch.setFromAxisAngle(this.pitchAxis, -dy * mouseSensitivity);
    this.camera.quaternion.premultiply(this.quatYaw);
    this.camera.quaternion.multiply(this.quatPitch);
    this.camera.quaternion.normalize();

    // Gravity direction: blend based on distance from midpoint
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

    const wishDir = new THREE.Vector3();
    if (input.isDown("KeyW")) wishDir.add(this.forward);
    if (input.isDown("KeyS")) wishDir.sub(this.forward);
    if (input.isDown("KeyD")) wishDir.add(this.right);
    if (input.isDown("KeyA")) wishDir.sub(this.right);
    const hasInput = wishDir.lengthSq() > 0;
    if (hasInput) wishDir.normalize();

    this.skiing = input.isDown("ShiftLeft") || input.isDown("ShiftRight");

    const wantsJet = input.isMouseDown(2) || input.isDown("Space");
    this.jetting = wantsJet && this.energy > 0;

    if (this.jetting) {
      if (this.grounded) {
        if (gravSign > 0 && this.velocity.y < 0) this.velocity.y = 0;
        if (gravSign < 0 && this.velocity.y > 0) this.velocity.y = 0;
      }
      this.velocity.y += gravSign * jetThrust * dt;
      if (hasInput) {
        this.velocity.x += wishDir.x * jetThrust * jetForwardBias * dt;
        this.velocity.z += wishDir.z * jetThrust * jetForwardBias * dt;
      }
      this.energy = Math.max(0, this.energy - jetEnergyDrain * dt);
    } else {
      this.energy = Math.min(100, this.energy + jetEnergyRegen * dt);
    }

    this.velocity.y -= gravSign * effectiveGravity * dt;

    if (this.grounded && !this.jetting) {
      if (this.skiing) {
        const gravVec = new THREE.Vector3(0, -gravSign * effectiveGravity, 0);
        const normalComp = this.groundNormal
          .clone()
          .multiplyScalar(gravVec.dot(this.groundNormal));
        const slopeForce = gravVec.clone().sub(normalComp);
        this.velocity.add(slopeForce.multiplyScalar(dt));

        if (hasInput) {
          this.velocity.add(wishDir.clone().multiplyScalar(skiSteerFactor * walkSpeed * dt));
        }

        const skiF = Math.exp(-skiFriction * dt);
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

    if (grappleJustPressed) {
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.raycaster.set(this.position, camDir);
      this.raycaster.far = grappleRange;
      const allMeshes = [...this.floorMeshes, ...this.ceilingMeshes];
      const hits = this.raycaster.intersectObjects(allMeshes, false);
      this.raycaster.far = Infinity;
      if (hits.length > 0) {
        this.grappleAttached = true;
        this.grappleAnchor.copy(hits[0].point);
        this.grappleRopeLength = this.position.distanceTo(this.grappleAnchor);
      }
    }

    if (!grappleDown) this.grappleAttached = false;

    if (this.grappleAttached) {
      const toAnchor = new THREE.Vector3().subVectors(this.grappleAnchor, this.position);
      const dist = toAnchor.length();
      if (dist > 0.01) {
        const dir = toAnchor.divideScalar(dist);
        this.velocity.addScaledVector(dir, grapplePull * dt);
        if (dist > this.grappleRopeLength) {
          const radialSpeed = this.velocity.dot(dir);
          if (radialSpeed < 0) {
            this.velocity.addScaledVector(dir, -radialSpeed * grappleSwingDamping);
          }
          this.position.addScaledVector(dir, (dist - this.grappleRopeLength) * 0.5);
        }
      }
    }

    // Integrate
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

    if (onCeiling) {
      const headY = this.position.y + playerHeight;
      penetrating = headY > surfaceY;
      snapZone = headY >= surfaceY - groundSnapThreshold;
      snappedY = surfaceY - playerHeight;
    } else {
      const feetY = this.position.y - playerHeight;
      penetrating = feetY < surfaceY;
      snapZone = feetY <= surfaceY + groundSnapThreshold;
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

    if (penetrating && penetrationDepth > hardPenThreshold) {
      this.position.y = snappedY;
      this.groundNormal.copy(normal);
      if (!this.grounded) {
        const velDotN = this.velocity.dot(this.groundNormal);
        const velTowardSurface = onCeiling ? velDotN > 0 : velDotN < 0;
        if (velTowardSurface) {
          this.velocity.addScaledVector(this.groundNormal, -velDotN);
        }
      }
      this.grounded = true;
    } else if (!jetLaunching && snapZone) {
      this.position.y = snappedY;
      this.groundNormal.copy(normal);
      if (!this.grounded) {
        const velDotN = this.velocity.dot(this.groundNormal);
        const velTowardSurface = onCeiling ? velDotN > 0 : velDotN < 0;
        if (velTowardSurface) {
          this.velocity.addScaledVector(this.groundNormal, -velDotN);
        }
      }
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    this.camera.position.copy(this.position);
  }

  private computeFlippedQuat(targetUp: THREE.Vector3): THREE.Quaternion {
    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const rightVec = new THREE.Vector3().crossVectors(camForward, targetUp).normalize();
    if (rightVec.lengthSq() < 0.001) {
      rightVec.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      rightVec.y = 0;
      rightVec.normalize();
    }
    const correctedUp = new THREE.Vector3().crossVectors(rightVec, camForward).normalize();
    const m = new THREE.Matrix4().makeBasis(rightVec, correctedUp, camForward.negate());
    return new THREE.Quaternion().setFromRotationMatrix(m);
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

    // ── Hard target up (binary, used by smooth/snap/spring) ──
    const hardTargetUp = new THREE.Vector3(0, this.gravitySign > 0 ? 1 : -1, 0);

    // ── Blended target up (smooth through transition zone) ──
    // gravityBlend goes from -1 (floor) to +1 (ceiling).
    // Map to a Y value: -1 → up=(0,1,0), +1 → up=(0,-1,0), near 0 → near-zero length.
    const blendedUp = new THREE.Vector3(0, -this.gravityBlend, 0);
    const blendedLen = blendedUp.length();

    // ── Velocity gate factor: 0 = full freefall (no correction), 1 = grounded/slow (full correction) ──
    const velGateThreshold = tuning.gravCamVelGate;
    const verticalSpeed = Math.abs(this.velocity.y);
    const velGateFactor = this.grounded
      ? 1.0
      : Math.max(0, 1.0 - verticalSpeed / Math.max(velGateThreshold, 0.01));

    // ── Dead zone factor: 0 near midpoint, 1 when clearly in one gravity regime ──
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
      // Spring toward blended target up. Near the midpoint the target has
      // near-zero length so the spring naturally eases off → free tumble zone.
      if (blendedLen > 0.05) {
        const target = blendedUp.clone().divideScalar(blendedLen);
        this.applySpringRoll(dt, target, speed * blendedLen);
      }
    } else if (mode === "velocity") {
      // Spring toward hard target up, but only when grounded or low vertical speed.
      if (velGateFactor > 0.01) {
        this.applySpringRoll(dt, hardTargetUp, speed * velGateFactor);
      }
    } else if (mode === "damping") {
      // No target seeking — just damp the camera's roll angular velocity.
      this.applyRollDamping(dt);
    } else if (mode === "blend+vel") {
      // Blended target up + velocity gating + dead zone.
      const effectiveStrength = blendedLen * velGateFactor * deadZoneFactor;
      if (blendedLen > 0.05 && effectiveStrength > 0.01) {
        const target = blendedUp.clone().divideScalar(blendedLen);
        this.applySpringRoll(dt, target, speed * effectiveStrength);
      }
    }

    this.prevGravSign = this.gravitySign;
    this.prevGrounded = this.grounded;
  }

  /** Apply a spring-like roll correction toward a target up vector. */
  private applySpringRoll(dt: number, targetUp: THREE.Vector3, strength: number): void {
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // Project both up vectors onto the plane perpendicular to the look direction
    const currentUpProj = camUp.clone().addScaledVector(camForward, -camUp.dot(camForward));
    if (currentUpProj.lengthSq() < 0.0001) return;
    currentUpProj.normalize();

    const targetUpProj = targetUp.clone().addScaledVector(camForward, -targetUp.dot(camForward));
    if (targetUpProj.lengthSq() < 0.001) return;
    targetUpProj.normalize();

    const dot = Math.max(-1, Math.min(1, currentUpProj.dot(targetUpProj)));
    const cross = new THREE.Vector3().crossVectors(currentUpProj, targetUpProj);
    const angleSigned = Math.atan2(cross.dot(camForward), dot);

    const correction = angleSigned * Math.min(1, strength * dt);
    if (Math.abs(correction) > 0.0001) {
      const rollQuat = new THREE.Quaternion().setFromAxisAngle(camForward, correction);
      this.camera.quaternion.premultiply(rollQuat);
      this.camera.quaternion.normalize();
    }
  }

  /** Damp the camera's roll rate without seeking a specific target. */
  private applyRollDamping(dt: number): void {
    const dampStr = tuning.gravCamDamping;
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // Use the closest world axis as a very weak reference to prevent drift
    const worldUp = new THREE.Vector3(0, this.gravitySign > 0 ? 1 : -1, 0);

    const currentUpProj = camUp.clone().addScaledVector(camForward, -camUp.dot(camForward));
    if (currentUpProj.lengthSq() < 0.0001) return;
    currentUpProj.normalize();

    const targetUpProj = worldUp.clone().addScaledVector(camForward, -worldUp.dot(camForward));
    if (targetUpProj.lengthSq() < 0.001) return;
    targetUpProj.normalize();

    const dot = Math.max(-1, Math.min(1, currentUpProj.dot(targetUpProj)));
    const cross = new THREE.Vector3().crossVectors(currentUpProj, targetUpProj);
    const angleSigned = Math.atan2(cross.dot(camForward), dot);

    // Damping: small fraction of the error, feels like drag rather than a spring
    const correction = angleSigned * (1.0 - Math.exp(-dampStr * 0.3 * dt));
    if (Math.abs(correction) > 0.0001) {
      const rollQuat = new THREE.Quaternion().setFromAxisAngle(camForward, correction);
      this.camera.quaternion.premultiply(rollQuat);
      this.camera.quaternion.normalize();
    }
  }

  private sampleSurfaceFlat(
    x: number, z: number, which: "floor" | "ceiling",
  ): { height: number; normal: THREE.Vector3 } {
    const meshes = which === "floor" ? this.floorMeshes : this.ceilingMeshes;
    const dir = which === "floor"
      ? new THREE.Vector3(0, -1, 0)
      : new THREE.Vector3(0, 1, 0);
    const originY = which === "floor"
      ? this.position.y + RAY_ORIGIN_OFFSET
      : this.position.y - RAY_ORIGIN_OFFSET;

    const fallbackNormal = which === "floor"
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, -1, 0);
    const fallback = { height: which === "floor" ? 0 : this.mirrorY, normal: fallbackNormal };

    if (meshes.length === 0) return fallback;

    this.rayOrigin.set(x, originY, z);
    this.raycaster.set(this.rayOrigin, dir);

    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const hit = hits[0];
      const normal = hit.face ? hit.face.normal.clone() : fallbackNormal;
      return { height: hit.point.y, normal };
    }
    return fallback;
  }
}
