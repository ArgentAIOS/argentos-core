import { useState, useEffect } from "react";
import { WidgetContainer } from "./WidgetContainer";

export function ClockWidget() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const hours = time.getHours();
  const minutes = time.getMinutes();
  const seconds = time.getSeconds();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;

  const weekday = time.toLocaleDateString("en-US", { weekday: "long" });
  const date = time.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <WidgetContainer className="h-full">
      <div className="flex flex-col items-center justify-center h-full">
        {/* Time */}
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold text-white tabular-nums">
            {displayHours.toString().padStart(2, "0")}:{minutes.toString().padStart(2, "0")}
          </span>
          <span className="text-lg text-white/40 font-medium">{ampm}</span>
        </div>
        {/* Seconds */}
        <div className="text-white/30 text-sm tabular-nums mt-1">
          {seconds.toString().padStart(2, "0")}
        </div>
        {/* Date */}
        <div className="mt-3 text-center">
          <div className="text-white/70 text-sm font-medium">{weekday}</div>
          <div className="text-white/50 text-xs mt-0.5">{date}</div>
        </div>
      </div>
    </WidgetContainer>
  );
}
