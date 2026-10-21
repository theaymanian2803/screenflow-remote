import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Monitor, Circle, Pause, Play, Square, Download, Smartphone } from "lucide-react";
import { openChannel, fmt, type RecState, type ConnState } from "@/lib/control-channel";
import { captureMedia, QUALITY_PRESETS, type RecordingQuality } from "@/lib/recording-media";
import { createPeer, type Signal } from "@/lib/live-preview";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { QRCodeSVG } from "qrcode.react";

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
  const captureRef = useRef<Awaited<ReturnType<typeof captureMedia>> | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const chanRef = useRef<ReturnType<typeof openChannel> | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const [state, setState] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [room, setRoom] = useState("");
  const [wsUrl, setWsUrl] = useState("");
  const [conn, setConn] = useState<ConnState>("disconnected");
  const [peers, setPeers] = useState(0);
  const [origin, setOrigin] = useState("");
  const [sourceRequested, setSourceRequested] = useState(false);
  const [systemAudio, setSystemAudio] = useState(true);
  const [microphoneAudio, setMicrophoneAudio] = useState(false);
  const [quality, setQuality] = useState<RecordingQuality>("high");
  const [picking, setPicking] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [audioWarning, setAudioWarning] = useState("");
  const bitrateRef = useRef(QUALITY_PRESETS.high.videoBitsPerSecond as number);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    setRoom(localStorage.getItem("sc-room") || Math.random().toString(36).slice(2, 8).toUpperCase());
    setWsUrl(localStorage.getItem("sc-ws") ?? "");
    setOrigin(window.location.origin);
    return () => {
      if (recRef.current?.state && recRef.current.state !== "inactive") {
        recRef.current.onstop = null;
        recRef.current.stop();
      }
      captureRef.current?.dispose();
    };
  }, []);

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  useEffect(() => {
    if (!room) return;
    localStorage.setItem("sc-room", room);
    localStorage.setItem("sc-ws", wsUrl);
    const ch = openChannel({
      url: wsUrl, room, role: "pc", onConn: setConn,
      onMessage: (m) => {
        if (m.type === "peers") setPeers(m.count - 1);
        if (m.type === "hello") void offerPreview();
        if (m.type === "signal") void onSignal(m.data);
        if (m.type === "command") {
          const s = stateRef.current;
          if (m.cmd === "request-source") setSourceRequested(true);
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

  function closePeer(notify = true) {
    if (peerRef.current && notify) chanRef.current?.send({ type: "signal", data: { bye: true } });
    peerRef.current?.close();
    peerRef.current = null;
  }
  async function offerPreview() {
    closePeer(false);
    const s = streamRef.current;
    if (!s || !chanRef.current) return;
    const pc = createPeer((sig) => chanRef.current?.send({ type: "signal", data: sig }));
    peerRef.current = pc;
    s.getVideoTracks().forEach((t) => pc.addTrack(t, s));
    await pc.setLocalDescription(await pc.createOffer());
    chanRef.current?.send({ type: "signal", data: { sdp: pc.localDescription!.toJSON() } });
  }
  async function onSignal(d: Signal) {
    const pc = peerRef.current;
    if (!pc) return;
    if (d.sdp?.type === "answer" && !pc.remoteDescription) await pc.setRemoteDescription(d.sdp).catch(() => {});
    if (d.candidate) await pc.addIceCandidate(d.candidate).catch(() => {});
  }
  async function pickSource() {
    if (picking || stateRef.current === "recording" || stateRef.current === "paused") return;
    setPicking(true);
    setCaptureError("");
    setAudioWarning("");
    try {
      const capture = await captureMedia({ quality, systemAudio, microphoneAudio });
      captureRef.current?.dispose();
      captureRef.current = capture;
      const s = capture.stream;
      streamRef.current = s;
      bitrateRef.current = QUALITY_PRESETS[quality].videoBitsPerSecond;
      if (capture.missingSystemAudio) setAudioWarning("System audio wasn’t shared. The recording will include only the other selected audio, if any.");
      if (videoRef.current) videoRef.current.srcObject = s;
      const vt = s.getVideoTracks()[0];
      if (vt) vt.onended = () => {
        if (recRef.current && recRef.current.state !== "inactive") stop();
        else { closePeer(); capture.dispose(); captureRef.current = null; streamRef.current = null; setState("idle"); }
      };
      void offerPreview();
      setState("ready");
      setElapsed(0);
    } catch (error) {
      setCaptureError(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Screen or microphone access wasn’t granted. Choose a source again and allow the selected audio."
        : error instanceof Error ? error.message : "Could not capture the selected screen and audio.");
    } finally { setPicking(false); }
  }
  function resetSource() {
    closePeer();
    captureRef.current?.dispose();
    captureRef.current = null;
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setAudioWarning("");
    setCaptureError("");
    if (stateRef.current === "ready") setState("idle");
  }
  function start() {
    const s = streamRef.current;
    if (!s) return;
    chunks.current = [];
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    const mime = ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    const r = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: bitrateRef.current, audioBitsPerSecond: 128_000 });
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
    closePeer();
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    captureRef.current?.dispose();
    captureRef.current = null;
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
  const settingsLocked = live || state === "paused" || picking;
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
              <button onClick={pickSource} disabled={picking} className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground hover:text-foreground">
                <Monitor className="size-12" />
                <span className="font-medium">{picking ? "Waiting for screen and audio access…" : "Choose a monitor, window or tab"}</span>
              </button>
            )}
            <div className="absolute left-4 top-4 rounded-full bg-background/80 px-3 py-1 font-mono text-sm">
              {live ? "● REC" : state.toUpperCase()} · {fmt(elapsed)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t p-4">
            <button className="ctl" onClick={pickSource} disabled={settingsLocked}><Monitor className="size-4" /> Source</button>
            <button className="ctl ctl-rec" onClick={start} disabled={state !== "ready" || picking}><Circle className="size-4 fill-current" /> Start</button>
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
            <p className="mt-2 text-sm text-muted-foreground">Scan with your phone, or enter this code in the phone remote.</p>
            {origin && room && (
              <div className="mt-3 inline-block rounded-md bg-foreground p-2">
                <QRCodeSVG aria-label="Pairing QR code" value={`${origin}/remote?room=${encodeURIComponent(room)}${wsUrl ? `&ws=${encodeURIComponent(wsUrl)}` : ""}`} size={140} bgColor="transparent" fgColor="currentColor" className="text-background" />
              </div>
            )}
            {sourceRequested && (
              <div role="alert" className="mt-3 flex items-center justify-between gap-2 rounded-md border border-live p-2 text-sm">
                <span>Your phone asked you to pick a screen or window.</span>
                <button className="underline" onClick={() => setSourceRequested(false)}>Dismiss</button>
              </div>
            )}
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className={`size-2 rounded-full ${conn === "connected" ? "bg-ok" : conn === "connecting" ? "bg-warn" : "bg-destructive"}`} />
              {conn} · {wsUrl ? `${Math.max(peers, 0)} remote(s)` : "local mode"}
            </div>
          </div>
          <div className="panel space-y-3 p-5 text-sm">
            <h2 className="text-sm uppercase tracking-widest text-muted-foreground">Recording settings</h2>
            <div className="space-y-2">
              <label htmlFor="recording-quality" className="text-muted-foreground">Recording quality</label>
              <Select value={quality} disabled={settingsLocked} onValueChange={(value) => {
                if (value === "standard" || value === "high" || value === "smooth") { resetSource(); setQuality(value); }
              }}>
                <SelectTrigger id="recording-quality"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card text-card-foreground">
                  {Object.entries(QUALITY_PRESETS).map(([value, preset]) => <SelectItem key={value} value={value}>{preset.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="system-audio">System audio</label>
              <Switch id="system-audio" checked={systemAudio} disabled={settingsLocked} onCheckedChange={(checked) => { resetSource(); setSystemAudio(checked); }} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="microphone-audio">Microphone audio</label>
              <Switch id="microphone-audio" checked={microphoneAudio} disabled={settingsLocked} onCheckedChange={(checked) => { resetSource(); setMicrophoneAudio(checked); }} />
            </div>
            {captureError && <p role="alert" className="text-sm text-destructive">{captureError}</p>}
            {audioWarning && <p role="status" className="text-sm text-warn">{audioWarning}</p>}
          </div>
          <div className="panel space-y-3 p-5 text-sm">
            <label className="block">
              <span className="text-muted-foreground">Relay server URL</span>
              <input defaultValue={wsUrl} key={wsUrl} onBlur={(e) => setWsUrl(e.target.value.trim())} placeholder="wss://your-relay.example.com"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono" />
            </label>
            <p className="text-xs text-muted-foreground">Leave empty to test with a remote tab in this same browser.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
