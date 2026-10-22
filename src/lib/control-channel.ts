import type { Signal } from "./live-preview";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type Role = "pc" | "mobile";
export type RecState = "idle" | "ready" | "recording" | "paused" | "stopped";
export type Msg =
  | { type: "command"; cmd: "play" | "pause" | "stop" | "start" | "request-source" }
  | { type: "status"; state: RecState; elapsed: number }
  | { type: "peers"; count: number }
  | { type: "hello" }
  | { type: "signal"; data: Signal }
  | { type: "mouse"; mode: MouseMode; action: MouseAction; x: number; y: number };

export type MouseMode = "os" | "laser";
export type MouseAction = "move" | "click" | "dblclick";

export type ConnState = "connecting" | "connected" | "disconnected";

/**
 * Connects the control channel used for pairing, commands and WebRTC signaling:
 * 1. a relay WebSocket server (ws-server/) when `url` is given,
 * 2. otherwise the app's built-in cloud relay (Realtime broadcast + presence),
 * 3. falling back to BroadcastChannel for same-browser testing when no cloud env is configured.
 */
export function openChannel(opts: {
  url: string;
  room: string;
  role: Role;
  onMessage: (m: Msg) => void;
  onConn: (s: ConnState) => void;
}) {
  const { url, room, role, onMessage, onConn } = opts;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let sendFn: (m: Msg) => void = () => {};

  const scheduleRetry = (connect: () => void) => {
    if (!closed) retry = setTimeout(() => { if (!closed) connect(); }, 2000);
  };

  if (url) {
    let ws: WebSocket | null = null;
    const connect = () => {
      onConn("connecting");
      try {
        ws = new WebSocket(url);
      } catch {
        onConn("disconnected");
        scheduleRetry(connect);
        return;
      }
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: "join", room, role }));
        onConn("connected");
      };
      ws.onmessage = (e) => {
        try {
          onMessage(JSON.parse(e.data));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        onConn("disconnected");
        scheduleRetry(connect);
      };
    };
    connect();
    sendFn = (m) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    };
    return {
      send: (m: Msg) => sendFn(m),
      close: () => {
        closed = true;
        clearTimeout(retry);
        ws?.close();
      },
    };
  }

  if (import.meta.env["VITE_SUPABASE_URL"]) {
    let channel: RealtimeChannel | null = null;
    let sb: SupabaseClient | null = null;
    const connect = async () => {
      onConn("connecting");
      try {
        const mod = await import("@/integrations/supabase/client");
        if (closed) return;
        sb = mod.supabase;
        channel = sb
          .channel(`screencast:${room}`, { config: { broadcast: { self: false, ack: false } } })
          .on("broadcast", { event: "msg" }, ({ payload }) => onMessage(payload as Msg))
          .on("presence", { event: "sync" }, () => {
            if (channel) onMessage({ type: "peers", count: Object.keys(channel.presenceState()).length });
          });
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            void channel?.track({ role });
            onConn("connected");
          } else if (!closed && (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")) {
            onConn("disconnected");
            scheduleRetry(() => void connect());
          }
        });
        sendFn = (m) => {
          void channel?.send({ type: "broadcast", event: "msg", payload: m });
        };
      } catch {
        onConn("disconnected");
        scheduleRetry(() => void connect());
      }
    };
    void connect();
    return {
      send: (m: Msg) => sendFn(m),
      close: () => {
        closed = true;
        clearTimeout(retry);
        if (sb && channel) void sb.removeChannel(channel);
      },
    };
  }

  const bc = new BroadcastChannel(`screencast-${room}`);
  bc.onmessage = (e) => onMessage(e.data as Msg);
  onConn("connected");
  return {
    send: (m: Msg) => bc.postMessage(m),
    close: () => bc.close(),
  };
}

export const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
