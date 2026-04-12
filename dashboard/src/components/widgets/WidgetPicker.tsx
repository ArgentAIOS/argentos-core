/**
 * WidgetPicker — Modal overlay for adding widgets to the grid.
 *
 * Shows available widgets from the registry. Click to add to the grid.
 */

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { widgetRegistry, type WidgetType } from "./widgetRegistry";

interface WidgetPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (type: WidgetType) => void;
  customWidgets?: Array<{ id: string; name: string; icon: string; description?: string }>;
}

export function WidgetPicker({ isOpen, onClose, onAdd, customWidgets = [] }: WidgetPickerProps) {
  const builtins = Object.entries(widgetRegistry).filter(([id]) => id !== "empty");

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

          {/* Panel */}
          <motion.div
            className="relative w-[500px] max-h-[70vh] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
              <div>
                <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Add Widget</h2>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Click a widget to add it to your dashboard
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
              >
                <X className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
              </button>
            </div>

            {/* Widget grid */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Built-in widgets */}
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))] mb-3">
                Built-in
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {builtins.map(([id, def]) => (
                  <button
                    key={id}
                    onClick={() => {
                      onAdd(id as WidgetType);
                      onClose();
                    }}
                    className="flex items-center gap-3 p-3 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/40 hover:bg-[hsl(var(--primary))]/5 transition-all text-left"
                  >
                    <span className="text-xl">{def.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-[hsl(var(--foreground))]">
                        {def.name}
                      </div>
                      <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        {def.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Custom widgets */}
              {customWidgets.length > 0 && (
                <>
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))] mb-3">
                    Custom
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {customWidgets.map((cw) => (
                      <button
                        key={cw.id}
                        onClick={() => {
                          onAdd(`custom:${cw.id}` as WidgetType);
                          onClose();
                        }}
                        className="flex items-center gap-3 p-3 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/40 hover:bg-[hsl(var(--primary))]/5 transition-all text-left"
                      >
                        <span className="text-xl">{cw.icon}</span>
                        <div>
                          <div className="text-sm font-medium text-[hsl(var(--foreground))]">
                            {cw.name}
                          </div>
                          {cw.description && (
                            <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                              {cw.description}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
