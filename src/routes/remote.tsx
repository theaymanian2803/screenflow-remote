import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { openChannel, fmt, type RecState, type ConnState } from "@/lib/control-channel";

export const Route = createFileRoute("/remote")({
  head: () => ({
    meta: [
      { title: "ScreenCast Remote — Phone Controller" },
      { name: "description", content: "Floating phone remote to play, pause and stop your desktop screen recording." },
      { property: "og:title", content: "ScreenCast Remote — Phone Controller" },
      { property: "og:description", content: "Control your desktop recording from your phone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Remote,
});

function Remote() {
  const [room, setRoom] = useState("");
  const [wsUrl, setWsUrl] = useState("");
  const [paired, setPaired] = useState(false);
  const [conn, setConn] = useState<ConnState>("disconnected");
  const [pcState, setPcState] = useState<RecState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pos, setPos] = useState({ x: 20, y: 120 });
  const [open, setOpen] = useState(true);
  const chan = useRef<ReturnType<typeof openChannel> | null>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  useEffect(() => {
    setRoom(localStorage.getItem("sc-room") ?? "");
    setWsUrl(localStorage.getItem("sc-ws") ?? "");
  }, []);

  useEffect(() => {
    if (!paired || !room) return;
    localStorage.setItem("sc-room", room);
    localStorage.setItem("sc-ws", wsUrl);
    const ch = openChannel({
      url: wsUrl, room, role: "mobile", onConn: setConn,
      onMessage: (m) => {
        if (m.type === "status") { setPcState(m.state); setElapsed(m.elapsed); }
        if (m.type === "peers" && m.count < 2) setPcState(null);
      },
    });
    chan.current = ch;
    return () => ch.close();
  }, [paired, room, wsUrl]);

  const send = (cmd: "play" | "pause" | "stop") => {
    chan.current?.send({ type: "command", cmd });
    navigator.vibrate?.(20);
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.moved = true;
    setPos({
      x: Math.min(window.innerWidth - 72, Math.max(0, e.clientX - drag.current.dx)),
      y: Math.min(window.innerHeight - 72, Math.max(0, e.clientY - drag.current.dy)),
    });
  };
  const onUp = () => {
    if (drag.current && !drag.current.moved) setOpen((o) => !o);
    drag.current = null;
  };

  const live = pcState === "recording";
  const dot = conn === "connected" ? (pcState ? "bg-ok" : "bg-warn") : conn === "connecting" ? "bg-warn" : "bg-destructive";

  return (
    <div className="min-h-dvh touch-none select-none p-6">
      <h1 className="text-xl font-bold">ScreenCast Remote</h1>
      {!paired ? (
        <form className="panel mt-6 space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); if (room) setPaired(true); }}>
          <label className="block text-sm">
            <span className="text-muted-foreground">Pair code from your PC</span>
            <input value={room} onChange={(e) => setRoom(e.target.value.toUpperCase())} maxLength={8}
              className="mt-1 w-full rounded-md border bg-background px-3 py-3 text-center font-mono text-2xl tracking-[0.3em]" />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Relay server URL (same as PC)</span>
            <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value.trim())} placeholder="wss://your-relay.example.com"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
          </label>
          <button className="ctl ctl-rec w-full">Connect</button>
          <p className="text-xs text-muted-foreground">Tip: use "Add to Home Screen" to install this remote as an app.</p>
        </form>
      ) : (
        <div className="mt-6 space-y-2 text-sm text-muted-foreground">
          <p>Paired with <span className="font-mono text-accent">{room}</span>. Drag the bubble anywhere; tap it to show or hide controls.</p>
          <button className="underline" onClick={() => setPaired(false)}>Change pairing</button>
        </div>
      )}

      {paired && (
        <div className="fixed z-50 flex items-center gap-2" style={{ left: pos.x, top: pos.y }}>
          <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
            className={`relative flex size-16 cursor-grab flex-col items-center justify-center rounded-full border-2 bg-card shadow-2xl ${live ? "border-live live-pulse" : ""}`}>
            <span className={`absolute right-1 top-1 size-3 rounded-full ${dot}`} />
            <span className="font-mono text-xs">{fmt(elapsed)}</span>
            <span className="text-[9px] uppercase text-muted-foreground">{pcState ?? conn}</span>
          </div>
          {open && (
            <div className="panel flex gap-2 rounded-full p-2 shadow-2xl">
              {live
                ? <button aria-label="Pause" className="ctl p-3" onClick={() => send("pause")}><Pause className="size-5" /></button>
                : <button aria-label="Play" className="ctl ctl-rec p-3" onClick={() => send("play")} disabled={!pcState || pcState === "idle" || pcState === "stopped"}><Play className="size-5" /></button>}
              <button aria-label="Stop" className="ctl p-3" onClick={() => send("stop")} disabled={pcState !== "recording" && pcState !== "paused"}><Square className="size-5" /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
