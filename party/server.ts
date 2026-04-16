import type * as Party from "partykit/server";

export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const mapType = url.searchParams.get("mapType") ?? "flat";
    connection.setState({ mapType });

    // Tell the new client about everyone already on the same map
    const peers: string[] = [];
    for (const conn of this.room.getConnections()) {
      if (conn.id !== connection.id && conn.state?.mapType === mapType) {
        peers.push(conn.id);
      }
    }
    connection.send(JSON.stringify({ type: "player_list", ids: peers }));

    // Tell same-map peers about the new player
    const joinMsg = JSON.stringify({ type: "player_join", id: connection.id });
    for (const conn of this.room.getConnections()) {
      if (conn.id !== connection.id && conn.state?.mapType === mapType) {
        conn.send(joinMsg);
      }
    }
  }

  onMessage(message: string | ArrayBufferLike, sender: Party.Connection) {
    if (typeof message === "string") {
      let data: { type: string; mapType?: string };
      try {
        data = JSON.parse(message);
      } catch {
        return;
      }

      if (data.type === "map_change" && data.mapType) {
        const oldMap = sender.state?.mapType ?? "flat";
        const newMap = data.mapType;
        sender.setState({ mapType: newMap });

        // Leave old map peers
        const leaveMsg = JSON.stringify({ type: "player_leave", id: sender.id });
        for (const conn of this.room.getConnections()) {
          if (conn.id !== sender.id && conn.state?.mapType === oldMap) {
            conn.send(leaveMsg);
          }
        }

        // Join new map peers
        const joinMsg = JSON.stringify({ type: "player_join", id: sender.id });
        const peers: string[] = [];
        for (const conn of this.room.getConnections()) {
          if (conn.id !== sender.id && conn.state?.mapType === newMap) {
            conn.send(joinMsg);
            peers.push(conn.id);
          }
        }
        sender.send(JSON.stringify({ type: "player_list", ids: peers }));
      }
      return;
    }

    // Binary snapshot: prepend sender ID then relay to same-map peers
    const senderMap = sender.state?.mapType ?? "flat";
    const idBytes = new TextEncoder().encode(sender.id);
    const idLen = idBytes.length;

    // Format: [1 byte id length][id bytes][snapshot bytes]
    const buf = new ArrayBuffer(1 + idLen + message.byteLength);
    const view = new Uint8Array(buf);
    view[0] = idLen;
    view.set(idBytes, 1);
    view.set(new Uint8Array(message), 1 + idLen);

    for (const conn of this.room.getConnections()) {
      if (conn.id !== sender.id && conn.state?.mapType === senderMap) {
        conn.send(buf);
      }
    }
  }

  onClose(connection: Party.Connection) {
    const mapType = connection.state?.mapType ?? "flat";
    const leaveMsg = JSON.stringify({ type: "player_leave", id: connection.id });
    for (const conn of this.room.getConnections()) {
      if (conn.state?.mapType === mapType) {
        conn.send(leaveMsg);
      }
    }
  }
}

Server satisfies Party.Worker;
