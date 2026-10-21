import { createServerFn } from "@tanstack/react-start";

type Input = {
  problem: string;
  context: { conn: string; pcState: string | null; hasVideo: boolean; relayMode: "relay" | "cloud"; userAgent: string };
};

const SYSTEM = `You troubleshoot a browser screen recorder whose phone remote shows a live preview of the computer screen.
How it works: the computer shares a screen with getDisplayMedia; the phone and computer exchange WebRTC offers/answers over a relay. When the "Relay server URL (optional)" field is empty both sides use the app's built-in cloud relay ("cloud" mode); a custom WebSocket server can be entered there ("relay" mode). "local" mode (BroadcastChannel) only ever worked between tabs of the same browser. Video then flows peer-to-peer using only a public STUN server (no TURN). Only video is previewed, no audio.
Real UI labels (use only these): computer dashboard has a "Source" button to choose a screen/window, "Start", "Pause", "Stop", "Save", a "Pair code", and a "Relay server URL (optional)" field (empty = built-in relay). Phone remote has "Pair code from your PC", "Relay server URL (optional)", "Connect", "Change pairing" and "Ask PC to pick a screen". Diagnostics: conn = phone's link to the relay; pcState = computer recorder state (null = computer not seen); hasVideo = preview received.
Given the user's description and the live diagnostics, list the 2-4 most likely causes (most likely first) and concrete fix steps a non-technical person can follow. Be concise, use short markdown bullets, plain words, no preamble, don't quote raw diagnostic field names.`;

export const diagnosePreview = createServerFn({ method: "POST" })
  .inputValidator((d: Input) => {
    const problem = String(d?.problem ?? "").trim().slice(0, 1500);
    if (problem.length < 5) throw new Error("Please describe the problem in a few words.");
    return { problem, context: d.context };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { error: "AI help isn't configured yet." };
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { streamText } = await import("ai");
    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    let failure: unknown;
    const result = streamText({
      model: provider.responses("openai/gpt-6-astra"),
      system: SYSTEM,
      messages: [{ role: "user", content: `Problem: ${data.problem}\n\nDiagnostics: ${JSON.stringify(data.context)}` }],
      maxRetries: 0,
      onError: ({ error }) => { failure = error; },
      providerOptions: {
        openai: { store: false, forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
      },
    });
    try {
      const text = await result.text;
      if (failure) throw failure;
      if (!text.trim()) return { error: "The AI couldn't produce an answer for this. Try describing the problem differently later." };
      return { answer: text };
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      console.error("diagnosePreview failed", status, e);
      if (status === 429) return { error: "Too many requests right now. Please wait a minute and try again." };
      if (status === 402) return { error: "AI credits have run out. The app owner needs to add credits." };
      if (status === 403) return { error: "AI help is currently blocked for this app." };
      return { error: "AI help is unavailable right now. Please try again later." };
    }
  });
