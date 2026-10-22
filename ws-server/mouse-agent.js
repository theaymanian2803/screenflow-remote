// Desktop mouse helper for ScreenCast.
// Browsers cannot move the real OS cursor, so this tiny local program does it.
// Run on the PC being recorded:  cd ws-server && npm install && npm run mouse
// Then paste the printed access code into the dashboard's "Phone mouse control" panel.
import { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";

let nut;
try {
  nut = await import("@nut-tree-fork/nut-js");
} catch {
  console.error("Could not load @nut-tree-fork/nut-js. Run `npm install` in ws-server/ first.");
  process.exit(1);
}
const { mouse, screen, Point, Button } = nut;
mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 100000;

const port = Number(process.env.MOUSE_PORT || 8788);
const token = process.env.MOUSE_TOKEN || randomBytes(4).toString("hex").toUpperCase();
// Bind to localhost only: only browsers on this PC can reach it, and they must know the code.
const wss = new WebSocketServer({ port, host: "127.0.0.1" });

wss.on("connection", (ws) => {
  let authed = false;
  ws.on("message", async (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!authed) {
      authed = m.type === "auth" && m.token === token;
      ws.send(JSON.stringify({ type: authed ? "ok" : "denied" }));
      if (!authed) ws.close();
      return;
    }
    const x = Number(m.x), y = Number(m.y);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
    try {
      const [w, h] = [await screen.width(), await screen.height()];
      await mouse.setPosition(new Point(Math.round(x * (w - 1)), Math.round(y * (h - 1))));
      if (m.action === "click") await mouse.leftClick();
      if (m.action === "dblclick") await mouse.doubleClick(Button.LEFT);
    } catch (e) {
      console.error("Mouse action failed:", e?.message ?? e);
    }
  });
});

console.log(`ScreenCast mouse helper on ws://localhost:${port}`);
console.log(`Access code: ${token}`);
