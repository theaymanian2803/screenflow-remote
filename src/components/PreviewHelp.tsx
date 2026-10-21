import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { diagnosePreview } from "@/lib/diagnose.functions";

type Ctx = { conn: string; pcState: string | null; hasVideo: boolean; relayMode: "relay" | "cloud" };

export function PreviewHelp({ context }: { context: Ctx }) {
  const run = useServerFn(diagnosePreview);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setAnswer(""); setError("");
    try {
      const r = await run({ data: { problem, context: { ...context, userAgent: navigator.userAgent } } });
      if ("answer" in r && r.answer) setAnswer(r.answer);
      else setError(("error" in r && r.error) || "Something went wrong.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  if (!open) return (
    <button className="ctl mt-4 w-full text-sm" onClick={() => setOpen(true)}>
      <Sparkles className="size-4" /> Preview not working? Get AI help
    </button>
  );

  return (
    <form onSubmit={submit} className="panel mt-4 space-y-3 p-4 text-sm touch-auto select-text">
      <label className="block">
        <span className="text-muted-foreground">Describe what's happening with the preview</span>
        <textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={3} maxLength={1500}
          placeholder="e.g. Buttons work but the preview stays black"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2" />
      </label>
      <button className="ctl ctl-rec w-full" disabled={busy || problem.trim().length < 5}>
        {busy ? "Thinking…" : "Diagnose"}
      </button>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {answer && <div className="whitespace-pre-wrap rounded-md border bg-background p-3">{answer}</div>}
    </form>
  );
}
