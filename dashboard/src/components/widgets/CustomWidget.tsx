import { useState, useEffect, useMemo } from "react";
import { buildSandboxSrcDoc } from "../../utils/sandboxSrcDoc";
import { WidgetContainer } from "./WidgetContainer";

interface CustomWidgetProps {
  widgetId: string;
}

export function CustomWidget({ widgetId }: CustomWidgetProps) {
  const [widget, setWidget] = useState<{ name: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const widgetSrcDoc = useMemo(
    () => buildSandboxSrcDoc(widget?.code, widget?.name || "Widget"),
    [widget?.code, widget?.name],
  );

  useEffect(() => {
    fetch(`/api/widgets/${widgetId}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Widget not found");
        return res.json();
      })
      .then((data) => setWidget(data.widget))
      .catch((err) => setError(err.message));
  }, [widgetId]);

  if (error) {
    return (
      <WidgetContainer title="Widget Error">
        <div className="text-red-400 text-xs">{error}</div>
      </WidgetContainer>
    );
  }

  if (!widget) {
    return (
      <WidgetContainer title="Loading...">
        <div className="text-white/30 text-xs">Loading widget...</div>
      </WidgetContainer>
    );
  }

  return (
    <WidgetContainer title={widget.name}>
      <iframe
        srcDoc={widgetSrcDoc}
        sandbox="allow-scripts"
        className="w-full h-full border-0"
        style={{ minHeight: "140px" }}
        title={widget.name}
      />
    </WidgetContainer>
  );
}
