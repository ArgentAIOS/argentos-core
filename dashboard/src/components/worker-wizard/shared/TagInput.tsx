import { X, Plus } from "lucide-react";
import { useState, useRef } from "react";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  label?: string;
  locked?: string[];
  accentColor?: string;
}

export function TagInput({
  tags,
  onChange,
  placeholder = "Add item...",
  label,
  locked = [],
  accentColor = "purple",
}: TagInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const colorMap: Record<string, { bg: string; border: string; text: string; pill: string }> = {
    purple: {
      bg: "bg-purple-600/10",
      border: "border-purple-500/30",
      text: "text-purple-300",
      pill: "bg-purple-600/20 text-purple-300",
    },
    red: {
      bg: "bg-red-600/10",
      border: "border-red-500/30",
      text: "text-red-300",
      pill: "bg-red-600/20 text-red-300",
    },
    cyan: {
      bg: "bg-cyan-600/10",
      border: "border-cyan-500/30",
      text: "text-cyan-300",
      pill: "bg-cyan-600/20 text-cyan-300",
    },
    amber: {
      bg: "bg-amber-600/10",
      border: "border-amber-500/30",
      text: "text-amber-300",
      pill: "bg-amber-600/20 text-amber-300",
    },
  };
  const colors = colorMap[accentColor] || colorMap.purple;
  const lockedSet = new Set(locked);
  // Filter out tags that already appear in locked to avoid duplicates
  const visibleTags = tags.filter((t) => !lockedSet.has(t));

  function addTag() {
    const val = input.trim();
    if (!val || tags.includes(val)) {
      return;
    }
    onChange([...tags, val]);
    setInput("");
    inputRef.current?.focus();
  }

  function removeTag(tag: string) {
    if (locked.includes(tag)) {
      return;
    }
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div>
      {label && <label className="text-white/60 text-xs font-medium block mb-1.5">{label}</label>}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {locked.map((tag) => (
          <span
            key={`locked-${tag}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-white/5 text-white/30 border border-white/5"
            title="Inherited from parent"
          >
            {tag}
          </span>
        ))}
        {visibleTags.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${colors.pill}`}
          >
            {tag}
            <button onClick={() => removeTag(tag)} className="hover:text-white transition-colors">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm placeholder-white/20 focus:border-purple-500/50 focus:outline-none"
        />
        <button
          onClick={addTag}
          disabled={!input.trim()}
          className="px-2 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 rounded-lg text-white/60 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
