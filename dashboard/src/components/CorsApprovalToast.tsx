import { motion, AnimatePresence } from "framer-motion";
import { Shield, X } from "lucide-react";

interface CorsApprovalToastProps {
  domain: string | null;
  onApprove: () => void;
  onDeny: () => void;
}

export function CorsApprovalToast({ domain, onApprove, onDeny }: CorsApprovalToastProps) {
  return (
    <AnimatePresence>
      {domain && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] w-[420px] max-w-[90vw]"
        >
          <div className="bg-[#1a1a2e]/95 backdrop-blur-md border border-yellow-500/40 rounded-xl p-4 shadow-2xl shadow-yellow-500/10">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Shield className="w-4 h-4 text-yellow-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-medium text-sm mb-1">CORS Approval Needed</div>
                <p className="text-white/60 text-xs leading-relaxed mb-3">
                  A widget wants to fetch data from{" "}
                  <span className="text-yellow-300 font-mono">{domain}</span>. Allow this domain
                  through the CORS proxy?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={onApprove}
                    className="px-4 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs font-medium rounded-lg transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={onDeny}
                    className="px-4 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 text-xs font-medium rounded-lg transition-colors"
                  >
                    Deny
                  </button>
                </div>
              </div>
              <button
                onClick={onDeny}
                className="text-white/20 hover:text-white/50 transition-colors flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
