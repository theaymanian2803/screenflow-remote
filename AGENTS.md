<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep capture presets, media acquisition, audio mixing, and resource cleanup in the browser-only `src/lib/recording-media.ts` helper so capture behavior can be tested independently of the recorder UI.
- Signaling defaults to the built-in cloud relay (Realtime broadcast + presence channel per pair code) whenever the relay URL field is empty; `ws-server/` is optional and BroadcastChannel is only a no-cloud fallback — QR pairing and live preview must work with zero server setup.
- Real OS mouse control lives in the optional local helper `ws-server/mouse-agent.js` (localhost-only, access-code auth) because browsers cannot drive the OS cursor; the PC dashboard forwards phone "mouse" messages to it, and pointer (laser) mode is drawn in-browser only.
