import { afterEach, describe, expect, it, vi } from "vitest";
import { captureMedia, displayConstraints, QUALITY_PRESETS } from "@/lib/recording-media";

class Track {
  onended = null;
  readyState = "live";
  stop = vi.fn(() => { this.readyState = "ended"; });
  constructor(public kind: string) {}
}
class Stream {
  constructor(private tracks: Track[] = []) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  addTrack(track: Track) { this.tracks.push(track); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("Recording settings", () => {
  it.each([
    ["standard", 1280, 720, 30, 2_500_000],
    ["high", 1920, 1080, 30, 5_000_000],
    ["smooth", 1920, 1080, 60, 10_000_000],
  ] as const)("applies %s capture quality and bitrate", (quality, width, height, frameRate, bitrate) => {
    expect(displayConstraints({ quality, systemAudio: true, microphoneAudio: false }).video).toEqual({
      width: { ideal: width, max: width }, height: { ideal: height, max: height }, frameRate: { ideal: frameRate, max: frameRate },
    });
    expect(QUALITY_PRESETS[quality].videoBitsPerSecond).toBe(bitrate);
  });
  it.each([true, false])("requests system audio only when enabled (%s)", (systemAudio) => {
    expect(displayConstraints({ quality: "high", systemAudio, microphoneAudio: false }).audio).toBe(systemAudio);
  });
  it.each([[false, false, 0], [true, false, 1], [false, true, 1], [true, true, 1]] as const)(
    "captures system=%s microphone=%s with %s output audio tracks", async (systemAudio, microphoneAudio, audioCount) => {
      const screen = new Track("video");
      const system = new Track("audio");
      const mic = new Track("audio");
      const getDisplayMedia = vi.fn().mockResolvedValue(new Stream([screen, ...(systemAudio ? [system] : [])]));
      const getUserMedia = vi.fn().mockResolvedValue(new Stream([mic]));
      const connect = vi.fn();
      const close = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("MediaStream", Stream);
      vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia, getUserMedia } });
      vi.stubGlobal("AudioContext", class {
        state = "running";
        resume = vi.fn().mockResolvedValue(undefined);
        close = close;
        createMediaStreamSource = vi.fn(() => ({ connect }));
        createMediaStreamDestination = vi.fn(() => ({ stream: new Stream([new Track("audio")]) }));
      });
      const capture = await captureMedia({ quality: "high", systemAudio, microphoneAudio });
      expect(getUserMedia).toHaveBeenCalledTimes(microphoneAudio ? 1 : 0);
      expect(capture.stream.getAudioTracks()).toHaveLength(audioCount);
      expect(connect).toHaveBeenCalledTimes(systemAudio && microphoneAudio ? 2 : 0);
      capture.dispose();
      expect(screen.stop).toHaveBeenCalled();
      if (microphoneAudio) expect(mic.stop).toHaveBeenCalled();
      if (systemAudio) expect(system.stop).toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(systemAudio && microphoneAudio ? 1 : 0);
    },
  );
  it("stops screen capture if microphone permission is denied", async () => {
    const track = new Track("video");
    vi.stubGlobal("navigator", { mediaDevices: {
      getDisplayMedia: vi.fn().mockResolvedValue(new Stream([track])),
      getUserMedia: vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")),
    } });
    await expect(captureMedia({ quality: "high", systemAudio: false, microphoneAudio: true })).rejects.toThrow("Permission denied");
    expect(track.stop).toHaveBeenCalled();
  });
  it("reports when the selected source supplies no system audio", async () => {
    vi.stubGlobal("MediaStream", Stream);
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(new Stream([new Track("video")])) } });
    const capture = await captureMedia({ quality: "high", systemAudio: true, microphoneAudio: false });
    expect(capture.missingSystemAudio).toBe(true);
    capture.dispose();
  });
});