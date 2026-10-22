// Relay WebSocket server for ScreenCast Remote.
// Run: cd ws-server && npm install && npm start   (listens on PORT or 8787)
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT || 8787);
const wss = new WebSocketServer({ port });
const rooms = new Map(); // room -> Set<ws>

const broadcastPeers = (room) => {
  const set = rooms.get(room);
  if (!set) return;
  const msg = JSON.stringify({ type: "peers", count: set.size });
  for (const c of set) c.send(msg);
};

wss.on("connection", (ws) => {
  ws.room = null;
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "join" && typeof m.room === "string") {
      ws.room = m.room.slice(0, 32);
      ws.role = m.role;
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
      rooms.get(ws.room).add(ws);
      broadcastPeers(ws.room);
      return;
    }
    if (!ws.room || !["command", "status", "hello", "signal", "mouse"].includes(m.type)) return;
    for (const c of rooms.get(ws.room) ?? []) {
      if (c !== ws && c.readyState === 1) c.send(JSON.stringify(m));
    }
  });
  ws.on("close", () => {
    const set = rooms.get(ws.room);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) rooms.delete(ws.room);
    else broadcastPeers(ws.room);
  });
});

console.log(`ScreenCast relay listening on ws://0.0.0.0:${port}`);
