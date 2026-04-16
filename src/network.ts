import PartySocket from "partysocket";
import type { PlayerController } from "./player";
import type { MapType } from "./constants";

const SEND_HZ = 15;
const SEND_INTERVAL = 1000 / SEND_HZ;

// Binary layout: pos(12) + vel(12) + quat(16) + flags(1) + grappleAnchor(12 if attached)
const BASE_SIZE = 12 + 12 + 16 + 1; // 41 bytes
const GRAPPLE_SIZE = 12;

export interface PlayerSnapshot {
  position: [number, number, number];
  velocity: [number, number, number];
  quaternion: [number, number, number, number];
  skiing: boolean;
  jetting: boolean;
  grounded: boolean;
  grappleAttached: boolean;
  grappleAnchor: [number, number, number];
}

export class NetworkManager {
  private socket: PartySocket;
  private sendTimer = 0;

  onPlayerJoin: ((id: string) => void) | null = null;
  onPlayerLeave: ((id: string) => void) | null = null;
  onPlayerSnapshot: ((id: string, snap: PlayerSnapshot) => void) | null = null;
  onPlayerList: ((ids: string[]) => void) | null = null;

  constructor(mapType: MapType) {
    const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const host = isDev ? "localhost:1999" : "retribes.irondavy.partykit.dev";

    this.socket = new PartySocket({
      host,
      room: "retribes",
      query: { mapType },
    });

    this.socket.binaryType = "arraybuffer";

    this.socket.addEventListener("message", (e) => {
      if (typeof e.data === "string") {
        this.handleJSON(e.data);
      } else if (e.data instanceof ArrayBuffer) {
        this.handleBinary(e.data);
      }
    });
  }

  private handleJSON(raw: string): void {
    let msg: { type: string; id?: string; ids?: string[] };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "player_join":
        if (msg.id) this.onPlayerJoin?.(msg.id);
        break;
      case "player_leave":
        if (msg.id) this.onPlayerLeave?.(msg.id);
        break;
      case "player_list":
        if (msg.ids) this.onPlayerList?.(msg.ids);
        break;
    }
  }

  private handleBinary(buf: ArrayBuffer): void {
    const view = new Uint8Array(buf);
    const idLen = view[0];
    const idBytes = view.slice(1, 1 + idLen);
    const id = new TextDecoder().decode(idBytes);

    const snapBuf = buf.slice(1 + idLen);
    const snap = unpackSnapshot(snapBuf);
    if (snap) this.onPlayerSnapshot?.(id, snap);
  }

  sendSnapshot(player: PlayerController, dt: number): void {
    this.sendTimer += dt * 1000;
    if (this.sendTimer < SEND_INTERVAL) return;
    this.sendTimer -= SEND_INTERVAL;

    if (this.socket.readyState !== WebSocket.OPEN) return;

    const flags =
      (player.skiing ? 1 : 0) |
      (player.jetting ? 2 : 0) |
      (player.grounded ? 4 : 0) |
      (player.grappleAttached ? 8 : 0);

    const size = flags & 8 ? BASE_SIZE + GRAPPLE_SIZE : BASE_SIZE;
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    let o = 0;

    dv.setFloat32(o, player.position.x, true); o += 4;
    dv.setFloat32(o, player.position.y, true); o += 4;
    dv.setFloat32(o, player.position.z, true); o += 4;

    dv.setFloat32(o, player.velocity.x, true); o += 4;
    dv.setFloat32(o, player.velocity.y, true); o += 4;
    dv.setFloat32(o, player.velocity.z, true); o += 4;

    dv.setFloat32(o, player.camera.quaternion.x, true); o += 4;
    dv.setFloat32(o, player.camera.quaternion.y, true); o += 4;
    dv.setFloat32(o, player.camera.quaternion.z, true); o += 4;
    dv.setFloat32(o, player.camera.quaternion.w, true); o += 4;

    dv.setUint8(o, flags); o += 1;

    if (flags & 8) {
      dv.setFloat32(o, player.grappleAnchor.x, true); o += 4;
      dv.setFloat32(o, player.grappleAnchor.y, true); o += 4;
      dv.setFloat32(o, player.grappleAnchor.z, true); o += 4;
    }

    this.socket.send(buf);
  }

  sendMapChange(mapType: MapType): void {
    this.socket.send(JSON.stringify({ type: "map_change", mapType }));
  }

  dispose(): void {
    this.socket.close();
  }
}

function unpackSnapshot(buf: ArrayBuffer): PlayerSnapshot | null {
  if (buf.byteLength < BASE_SIZE) return null;
  const dv = new DataView(buf);
  let o = 0;

  const px = dv.getFloat32(o, true); o += 4;
  const py = dv.getFloat32(o, true); o += 4;
  const pz = dv.getFloat32(o, true); o += 4;

  const vx = dv.getFloat32(o, true); o += 4;
  const vy = dv.getFloat32(o, true); o += 4;
  const vz = dv.getFloat32(o, true); o += 4;

  const qx = dv.getFloat32(o, true); o += 4;
  const qy = dv.getFloat32(o, true); o += 4;
  const qz = dv.getFloat32(o, true); o += 4;
  const qw = dv.getFloat32(o, true); o += 4;

  const flags = dv.getUint8(o); o += 1;

  let gx = 0, gy = 0, gz = 0;
  if ((flags & 8) && buf.byteLength >= BASE_SIZE + GRAPPLE_SIZE) {
    gx = dv.getFloat32(o, true); o += 4;
    gy = dv.getFloat32(o, true); o += 4;
    gz = dv.getFloat32(o, true); o += 4;
  }

  return {
    position: [px, py, pz],
    velocity: [vx, vy, vz],
    quaternion: [qx, qy, qz, qw],
    skiing: !!(flags & 1),
    jetting: !!(flags & 2),
    grounded: !!(flags & 4),
    grappleAttached: !!(flags & 8),
    grappleAnchor: [gx, gy, gz],
  };
}
