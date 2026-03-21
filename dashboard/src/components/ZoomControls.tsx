import { ZoomIn } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface ZoomControlsProps {
  onZoomChange: (preset: "face" | "portrait" | "full" | "custom", customScale?: number) => void;
  currentZoom: string;
}

export function ZoomControls({ onZoomChange, currentZoom }: ZoomControlsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customScale, setCustomScale] = useState(100);
  const [buttonPos, setButtonPos] = useState({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Update button position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setButtonPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <>
      {/* Zoom button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 rounded-lg transition-colors ${
          isOpen ? "bg-white/20" : "bg-white/5 hover:bg-white/10"
        }`}
        title="Zoom controls"
      >
        <ZoomIn className="w-4 h-4 text-white/50" />
      </button>

      {/* Dropdown - rendered via portal at document root */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed bg-gray-800/95 backdrop-blur border border-white/10 rounded-lg p-3 shadow-xl z-[9999] min-w-[200px]"
            style={{
              top: `${buttonPos.top}px`,
              right: `${buttonPos.right}px`,
            }}
          >
            <div className="text-white/70 text-xs font-semibold uppercase tracking-wide mb-3">
              Zoom Preset
            </div>

            {/* Preset buttons */}
            <div className="space-y-2 mb-3">
              <button
                onClick={() => {
                  onZoomChange("face");
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  currentZoom === "face"
                    ? "bg-purple-600/30 text-purple-300 border border-purple-500/50"
                    : "bg-white/5 hover:bg-white/10 text-white/70"
                }`}
              >
                📷 Face Close-up
              </button>
              <button
                onClick={() => {
                  onZoomChange("portrait");
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  currentZoom === "portrait"
                    ? "bg-purple-600/30 text-purple-300 border border-purple-500/50"
                    : "bg-white/5 hover:bg-white/10 text-white/70"
                }`}
              >
                👤 Portrait
              </button>
              <button
                onClick={() => {
                  onZoomChange("full");
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  currentZoom === "full"
                    ? "bg-purple-600/30 text-purple-300 border border-purple-500/50"
                    : "bg-white/5 hover:bg-white/10 text-white/70"
                }`}
              >
                🧍 Full Body
              </button>
            </div>

            {/* Custom zoom slider */}
            <div className="border-t border-white/10 pt-3">
              <div className="text-white/50 text-xs mb-2">Custom: {customScale}%</div>
              <input
                type="range"
                min="50"
                max="200"
                value={customScale}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setCustomScale(val);
                  onZoomChange("custom", val);
                }}
                className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #a855f7 0%, #a855f7 ${(customScale - 50) / 1.5}%, rgba(255,255,255,0.1) ${(customScale - 50) / 1.5}%, rgba(255,255,255,0.1) 100%)`,
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
