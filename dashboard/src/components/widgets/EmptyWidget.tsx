import { WidgetContainer } from "./WidgetContainer";

export function EmptyWidget() {
  return (
    <WidgetContainer className="h-full">
      <div className="flex flex-col items-center justify-center h-full text-white/20 text-sm">
        <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
        </svg>
        <span>Empty Widget</span>
        <span className="text-xs mt-1 text-white/10">Configure in Settings</span>
      </div>
    </WidgetContainer>
  );
}
