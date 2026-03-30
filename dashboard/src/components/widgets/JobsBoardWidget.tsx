import { WidgetContainer } from "./WidgetContainer";

// Core stub: Jobs Board is a Business feature and is not shipped in public Core.
export function JobsBoardWidget() {
  return (
    <WidgetContainer title="Jobs Board" className="h-full">
      <div className="text-sm text-white/70">
        Jobs Board is available in ArgentOS Business and is not included in public Core.
      </div>
    </WidgetContainer>
  );
}
