import type { ReactNode } from "react";

interface WidgetContainerProps {
  title?: string;
  children: ReactNode;
  compact?: boolean;
  className?: string;
}

export function WidgetContainer({
  title,
  children,
  compact = false,
  className = "",
}: WidgetContainerProps) {
  return (
    <div
      className={`bg-white/5 backdrop-blur rounded-lg border border-white/10 overflow-hidden ${className}`}
    >
      {title && (
        <div className="px-3 py-2 border-b border-white/10 bg-white/5">
          <h3 className="text-white/70 text-xs font-semibold uppercase tracking-wide">{title}</h3>
        </div>
      )}
      <div className={compact ? "p-2" : "p-3"}>{children}</div>
    </div>
  );
}
