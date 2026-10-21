import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { openChannel, fmt, type RecState, type ConnState } from "@/lib/control-channel";
import { createPeer, type Signal } from "@/lib/live-preview";
import { PreviewHelp } from "@/components/PreviewHelp";

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pending = useRef<RTCIceCandidateInit[]>([]);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const qRoom = q.get("room");
    setRoom((qRoom ?? localStorage.getItem("sc-room") ?? "").toUpperCase());
    setWsUrl(q.get("ws") ?? localStorage.getItem("sc-ws") ?? "");
    if (qRoom) { setPaired(true); window.history.replaceState(null, "", "/remote"); }
  }, []);

  useEffect(() => {
    if (!paired || !room) return;
    localStorage.setItem("sc-room", room);
    localStorage.setItem("sc-ws", wsUrl);
    const closePeer = () => {
      peerRef.current?.close(); peerRef.current = null; pending.current = [];
      if (videoRef.current) videoRef.current.srcObject = null;
      setHasVideo(false);
    };
    const onSignal = async (d: Signal) => {
      if (d.bye) return closePeer();
      if (d.sdp?.type === "offer") {
        closePeer();
        const pc = createPeer((s) => chan.current?.send({ type: "signal", data: s }));
        peerRef.current = pc;
        pc.ontrack = (e) => {
          if (videoRef.current) videoRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
          setHasVideo(true);
        };
        await pc.setRemoteDescription(d.sdp);
        for (const c of pending.current) await pc.addIceCandidate(c).catch(() => {});
        pending.current = [];
        await pc.setLocalDescription(await pc.createAnswer());
        chan.current?.send({ type: "signal", data: { sdp: pc.localDescription!.toJSON() } });
      }
      if (d.candidate) {
        const pc = peerRef.current;
        if (pc?.remoteDescription) await pc.addIceCandidate(d.candidate).catch(() => {});
        else pending.current.push(d.candidate);
      }
    };
    const ch = openChannel({
      url: wsUrl, room, role: "mobile",
      onConn: (s) => { setConn(s); if (s === "connected") setTimeout(() => chan.current?.send({ type: "hello" }), 0); },
      onMessage: (m) => {
        if (m.type === "status") { setPcState(m.state); setElapsed(m.elapsed); }
        if (m.type === "peers" && m.count < 2) { setPcState(null); closePeer(); }
        if (m.type === "signal") void onSignal(m.data);
      },
    });
    chan.current = ch;
    return () => { ch.close(); closePeer(); };
  }, [paired, room, wsUrl]);

  const send = (cmd: "play" | "pause" | "stop" | "request-source") => {
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
            <span className="text-muted-foreground">Relay server URL (optional)</span>
            <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value.trim())} placeholder="wss://your-own-relay.example.com"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" />
            <span className="mt-1 block text-xs text-muted-foreground">Leave empty to use the app's built-in relay.</span>
          </label>
          <button className="ctl ctl-rec w-full">Connect</button>
          <p className="text-xs text-muted-foreground">Tip: use "Add to Home Screen" to install this remote as an app.</p>
        </form>
      ) : (
        <div className="mt-6 space-y-2 text-sm text-muted-foreground">
          <p>Paired with <span className="font-mono text-accent">{room}</span>. Drag the bubble anywhere; tap it to show or hide controls.</p>
          <div className="flex gap-4">
            <button className="underline" onClick={() => setPaired(false)}>Change pairing</button>
            <button className="underline" disabled={conn !== "connected"} onClick={() => send("request-source")}>Ask PC to pick a screen</button>
          </div>
        </div>
      )}
      {paired && (
        <div className="panel relative mt-4 aspect-video overflow-hidden bg-background">
          <video ref={videoRef} autoPlay muted playsInline className="size-full object-contain" />
          {!hasVideo && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
              Live preview appears here once a screen or window is chosen on the computer.
            </div>
          )}
        </div>
      )}
      {paired && <PreviewHelp context={{ conn, pcState, hasVideo, relayMode: wsUrl ? "relay" : "cloud" }} />}

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
