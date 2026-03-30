import { WidgetContainer } from "./WidgetContainer";

// Core stub: Org Chart is a Business feature and is not shipped in public Core.
export function OrgChartWidget() {
  return (
    <WidgetContainer title="Org Chart" className="h-full">
      <div className="text-sm text-white/70">
        Org Chart is available in ArgentOS Business and is not included in public Core.
      </div>
    </WidgetContainer>
  );
}
