export type Role = "pc" | "mobile";
export type RecState = "idle" | "ready" | "recording" | "paused" | "stopped";
export type Msg =
  | { type: "command"; cmd: "play" | "pause" | "stop" | "start" }
  | { type: "status"; state: RecState; elapsed: number }
  | { type: "peers"; count: number };

export type ConnState = "connecting" | "connected" | "disconnected";

/**
 * Connects to the relay WebSocket server (ws-server/) when a URL is given,
 * otherwise falls back to BroadcastChannel for same-browser testing.
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

  if (!url) {
    const bc = new BroadcastChannel(`screencast-${room}`);
    bc.onmessage = (e) => onMessage(e.data as Msg);
    onConn("connected");
    return {
      send: (m: Msg) => bc.postMessage(m),
      close: () => bc.close(),
    };
  }

  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    onConn("connecting");
    try {
      ws = new WebSocket(url);
    } catch {
      onConn("disconnected");
      retry = setTimeout(connect, 2000);
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
      if (!closed) retry = setTimeout(connect, 2000);
    };
  };
  connect();
  return {
    send: (m: Msg) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    },
    close: () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    },
  };
}

export const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
