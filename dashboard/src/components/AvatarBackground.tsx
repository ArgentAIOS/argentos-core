import { useState, useEffect } from "react";
import { EveningFireflies } from "./EveningFireflies";
import { MorningParticles } from "./MorningParticles";
import { StarField } from "./StarField";

export type BackgroundMode = "professional" | "casual" | "tech";

const backgrounds: Record<BackgroundMode, string> = {
  professional: "/backgrounds/morning-workspace.png",
  casual: "/backgrounds/evening-sunset.png",
  tech: "/backgrounds/night-stars.png",
};

// Get current background based on time of day (syncs with avatar outfits)
function getCurrentBackground(): BackgroundMode {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 17) {
    return "professional"; // 5am-5pm
  } else if (hour >= 17 && hour < 22) {
    return "casual"; // 5pm-10pm
  } else {
    return "tech"; // 10pm-5am
  }
}

// Global override for testing
let backgroundOverride: BackgroundMode | null = null;

export function setBackgroundOverride(mode: BackgroundMode | null) {
  backgroundOverride = mode;
  // Trigger a custom event to notify the component
  window.dispatchEvent(new CustomEvent("backgroundOverride", { detail: mode }));
}

export function AvatarBackground() {
  const [currentBg, setCurrentBg] = useState<BackgroundMode>(
    backgroundOverride || getCurrentBackground(),
  );

  // Listen for manual overrides
  useEffect(() => {
    const handleOverride = (e: CustomEvent) => {
      const mode = e.detail as BackgroundMode | null;
      if (mode) {
        console.log("[Background] Manual override:", mode);
        setCurrentBg(mode);
      } else {
        // Reset to automatic
        console.log("[Background] Reset to automatic");
        setCurrentBg(getCurrentBackground());
      }
    };

    window.addEventListener("backgroundOverride" as any, handleOverride as any);
    return () => window.removeEventListener("backgroundOverride" as any, handleOverride as any);
  }, []);

  // Check for time-based background changes every minute (if no override)
  useEffect(() => {
    const checkBackgroundChange = () => {
      if (!backgroundOverride) {
        const newBg = getCurrentBackground();
        if (newBg !== currentBg) {
          console.log("[Background] Auto-switching from", currentBg, "to", newBg);
          setCurrentBg(newBg);
          // Notify App.tsx to also switch the avatar preset
          window.dispatchEvent(new CustomEvent("backgroundAutoSwitch", { detail: newBg }));
        }
      }
    };

    const interval = setInterval(checkBackgroundChange, 60000); // Every minute
    return () => clearInterval(interval);
  }, [currentBg]);

  return (
    <>
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-all duration-1000"
        style={{
          backgroundImage: `url(${backgrounds[currentBg]})`,
          filter: "blur(3px) brightness(0.6)",
          zIndex: 0,
        }}
      />

      {/* Animated effects based on time of day */}
      <div className="absolute inset-0" style={{ zIndex: 1 }}>
        {currentBg === "professional" && <MorningParticles />}
        {currentBg === "casual" && <EveningFireflies />}
        {currentBg === "tech" && <StarField />}
      </div>
    </>
  );
}
