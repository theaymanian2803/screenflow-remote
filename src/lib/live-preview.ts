// WebRTC helpers for streaming the PC capture preview to the phone remote.
// Signaling travels over the existing control channel (relay or BroadcastChannel).
export type Signal = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; bye?: true };

const ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function createPeer(send: (s: Signal) => void) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  pc.onicecandidate = (e) => { if (e.candidate) send({ candidate: e.candidate.toJSON() }); };
  return pc;
}
