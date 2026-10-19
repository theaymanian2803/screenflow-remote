import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Monitor, Circle, Pause, Play, Square, Download, Smartphone } from "lucide-react";
import { openChannel, fmt, type RecState, type ConnState } from "@/lib/control-channel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ScreenCast — Desktop Recorder Dashboard" },
      { name: "description", content: "Record any screen or window in your browser, controlled remotely from your phone." },
      { property: "og:title", content: "ScreenCast — Desktop Recorder Dashboard" },
      { property: "og:description", content: "Browser screen recorder with phone remote control." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const chanRef = useRef<ReturnType<typeof openChannel> | null>(null);
  const [state, setState] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [room, setRoom] = useState("");
  const [wsUrl, setWsUrl] = useState("");
  const [conn, setConn] = useState<ConnState>("disconnected");
  const [peers, setPeers] = useState(0);
  const [audio, setAudio] = useState(true);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    setRoom(localStorage.getItem("sc-room") || Math.random().toString(36).slice(2, 8).toUpperCase());
    setWsUrl(localStorage.getItem("sc-ws") ?? "");
  }, []);

  useEffect(() => {
    if (!room) return;
    localStorage.setItem("sc-room", room);
    localStorage.setItem("sc-ws", wsUrl);
    const ch = openChannel({
      url: wsUrl, room, role: "pc", onConn: setConn,
      onMessage: (m) => {
        if (m.type === "peers") setPeers(m.count - 1);
        if (m.type === "command") {
          const s = stateRef.current;
          if (m.cmd === "play") s === "paused" ? resume() : s === "ready" && start();
          if (m.cmd === "pause" && s === "recording") pause();
          if (m.cmd === "stop" && (s === "recording" || s === "paused")) stop();
        }
      },
    });
    chanRef.current = ch;
    return () => ch.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, wsUrl]);

  useEffect(() => {
    chanRef.current?.send({ type: "status", state, elapsed });
  }, [state, elapsed, conn]);

  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  async function pickSource() {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
      const vt = s.getVideoTracks()[0];
      if (vt) vt.onended = () => {
        if (recRef.current?.state !== "inactive") stop();
        else setState("idle");
      };
      setState("ready");
      setElapsed(0);
    } catch { /* cancelled */ }
  }
  function start() {
    const s = streamRef.current;
    if (!s) return;
    chunks.current = [];
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    const mime = ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => setBlobUrl(URL.createObjectURL(new Blob(chunks.current, { type: r.mimeType })));
    r.start(1000);
    recRef.current = r;
    setElapsed(0);
    setState("recording");
  }
  function pause() { recRef.current?.pause(); setState("paused"); }
  function resume() { recRef.current?.resume(); setState("recording"); }
  function stop() {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState("stopped");
  }
  function save() {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `screencast-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    a.click();
  }

  const live = state === "recording";
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`size-3 rounded-full bg-live ${live ? "live-pulse" : "opacity-40"}`} />
          <h1 className="text-2xl font-bold tracking-tight">ScreenCast</h1>
        </div>
        <Link to="/remote" className="ctl text-sm"><Smartphone className="size-4" /> Open remote</Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="panel overflow-hidden">
          <div className="relative aspect-video bg-background">
            <video ref={videoRef} autoPlay muted playsInline className={`size-full object-contain ${state === "stopped" ? "hidden" : ""}`} />
            {state === "stopped" && blobUrl && <video src={blobUrl} controls className="size-full object-contain" />}
            {state === "idle" && (
              <button onClick={pickSource} className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground hover:text-foreground">
                <Monitor className="size-12" />
                <span className="font-medium">Choose a monitor, window or tab</span>
              </button>
            )}
            <div className="absolute left-4 top-4 rounded-full bg-background/80 px-3 py-1 font-mono text-sm">
              {live ? "● REC" : state.toUpperCase()} · {fmt(elapsed)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t p-4">
            <button className="ctl" onClick={pickSource} disabled={live || state === "paused"}><Monitor className="size-4" /> Source</button>
            <button className="ctl ctl-rec" onClick={start} disabled={state !== "ready"}><Circle className="size-4 fill-current" /> Start</button>
            {state === "paused"
              ? <button className="ctl" onClick={resume}><Play className="size-4" /> Resume</button>
              : <button className="ctl" onClick={pause} disabled={!live}><Pause className="size-4" /> Pause</button>}
            <button className="ctl" onClick={stop} disabled={!live && state !== "paused"}><Square className="size-4" /> Stop</button>
            <button className="ctl ml-auto" onClick={save} disabled={!blobUrl}><Download className="size-4" /> Save</button>
          </div>
        </section>

        <aside className="space-y-6">
          <div className="panel p-5">
            <h2 className="mb-1 text-sm uppercase tracking-widest text-muted-foreground">Pair code</h2>
            <div className="font-mono text-4xl font-bold tracking-[0.2em] text-accent">{room}</div>
            <p className="mt-2 text-sm text-muted-foreground">Enter this code in the phone remote.</p>
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className={`size-2 rounded-full ${conn === "connected" ? "bg-ok" : conn === "connecting" ? "bg-warn" : "bg-destructive"}`} />
              {conn} · {wsUrl ? `${Math.max(peers, 0)} remote(s)` : "local mode"}
            </div>
          </div>
          <div className="panel space-y-3 p-5 text-sm">
            <label className="block">
              <span className="text-muted-foreground">Relay server URL</span>
              <input defaultValue={wsUrl} key={wsUrl} onBlur={(e) => setWsUrl(e.target.value.trim())} placeholder="wss://your-relay.example.com"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono" />
            </label>
            <p className="text-xs text-muted-foreground">Leave empty to test with a remote tab in this same browser.</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Capture system audio
            </label>
          </div>
        </aside>
      </div>
    </div>
  );
}
