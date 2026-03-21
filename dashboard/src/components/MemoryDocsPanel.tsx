import { BookOpen } from "lucide-react";

export function MemoryDocsPanel() {
  return (
    <div className="mt-2 rounded-lg border border-cyan-400/20 bg-cyan-500/5 p-3">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-cyan-300" />
        <div className="text-xs font-semibold uppercase tracking-wide text-cyan-200/90">
          Memory Docs
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/65">
        Use the Memory Inspector in Developer settings for live diagnostics and lane health. MemU
        LLM should use a chat-capable model; embeddings should use an embedding-only model. The main
        config panel now also exposes Memory V3 health, internal vault bootstrap, and AOS readiness
        checks.
      </p>
      <div className="mt-3 space-y-1 text-[11px] leading-relaxed text-white/55">
        <div>
          <span className="text-cyan-200/90 font-medium">Vault:</span> markdown files on disk,
          optionally opened in Obsidian.
        </div>
        <div>
          <span className="text-cyan-200/90 font-medium">Knowledge library:</span> Argent&apos;s
          indexed retrieval layer where ingested notes are stored for recall.
        </div>
        <div>
          <span className="text-cyan-200/90 font-medium">Cognee graph:</span> supplemental
          relationship retrieval, not the source of truth. If it fails, MemU continues normally.
        </div>
      </div>
    </div>
  );
}
