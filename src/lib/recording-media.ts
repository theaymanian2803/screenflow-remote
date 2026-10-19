export const QUALITY_PRESETS = {
  standard: { label: "Standard · 720p / 30 fps", width: 1280, height: 720, frameRate: 30, videoBitsPerSecond: 2_500_000 },
  high: { label: "High · 1080p / 30 fps", width: 1920, height: 1080, frameRate: 30, videoBitsPerSecond: 5_000_000 },
  smooth: { label: "Smooth · 1080p / 60 fps", width: 1920, height: 1080, frameRate: 60, videoBitsPerSecond: 10_000_000 },
} as const;

export type RecordingQuality = keyof typeof QUALITY_PRESETS;
export type RecordingSettings = { quality: RecordingQuality; systemAudio: boolean; microphoneAudio: boolean };

export function displayConstraints(settings: RecordingSettings): DisplayMediaStreamOptions {
  const preset = QUALITY_PRESETS[settings.quality];
  return {
    video: { width: { ideal: preset.width, max: preset.width }, height: { ideal: preset.height, max: preset.height }, frameRate: { ideal: preset.frameRate, max: preset.frameRate } },
    audio: settings.systemAudio,
  };
}

export async function captureMedia(settings: RecordingSettings) {
  let display: MediaStream | undefined;
  let microphone: MediaStream | undefined;
  let context: AudioContext | undefined;
  let output: MediaStream | undefined;
  const dispose = () => {
    const tracks = new Set([...(display?.getTracks() ?? []), ...(microphone?.getTracks() ?? []), ...(output?.getTracks() ?? [])]);
    tracks.forEach((track) => { track.onended = null; track.stop(); });
    if (context && context.state !== "closed") void context.close().catch(() => {});
  };
  try {
    display = await navigator.mediaDevices.getDisplayMedia(displayConstraints(settings));
    if (settings.microphoneAudio) {
      microphone = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true } });
    }
    const audioTracks = [...display.getAudioTracks(), ...(microphone?.getAudioTracks() ?? [])];
    output = new MediaStream(display.getVideoTracks());
    if (audioTracks.length > 1) {
      context = new AudioContext();
      await context.resume();
      const destination = context.createMediaStreamDestination();
      audioTracks.forEach((track) => {
        const source = context?.createMediaStreamSource(new MediaStream([track]));
        source?.connect(destination);
      });
      destination.stream.getAudioTracks().forEach((track) => output?.addTrack(track));
    } else {
      audioTracks.forEach((track) => output?.addTrack(track));
    }
    if (display.getVideoTracks().some((track) => track.readyState === "ended")) {
      throw new Error("Screen sharing ended. Choose a source again.");
    }
    return { stream: output, display, dispose, missingSystemAudio: settings.systemAudio && display.getAudioTracks().length === 0 };
  } catch (error) {
    dispose();
    throw error;
  }
}