/**
 * LockScreen — Full-screen lock overlay with multi-method unlock
 *
 * Supports: PIN pad, Touch ID (platform WebAuthn), YubiKey (cross-platform WebAuthn)
 * Renders above everything (z-[300]).
 */

import { motion, AnimatePresence } from "framer-motion";
import { Shield, KeyRound, Fingerprint, AlertCircle, Hash } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import type { StoredCredential } from "../hooks/useLockScreen";

type UnlockMode = "webauthn" | "pin";

interface LockScreenProps {
  isLocked: boolean;
  onUnlock: () => Promise<boolean>;
  onUnlockWithPin: (pin: string) => Promise<boolean>;
  error: string | null;
  isAuthenticating: boolean;
  hasPin: boolean;
  hasPlatformKey: boolean;
  hasCrossPlatformKey: boolean;
  credentials: StoredCredential[];
}

function ClockDisplay() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = time.getHours();
  const minutes = time.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;

  const dateStr = time.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="text-center mb-12">
      <div className="text-8xl font-extralight text-white tracking-tight tabular-nums">
        {displayHours}:{minutes}
        <span className="text-4xl ml-2 text-white/40 font-light">{ampm}</span>
      </div>
      <div className="text-lg text-white/40 mt-2 font-light tracking-wide">{dateStr}</div>
    </div>
  );
}

function KeyAnimation({
  isAuthenticating,
  hasPlatformKey,
}: {
  isAuthenticating: boolean;
  hasPlatformKey: boolean;
}) {
  const Icon = hasPlatformKey ? Fingerprint : KeyRound;

  return (
    <div className="relative flex items-center justify-center mb-8">
      {/* Outer glow ring */}
      <motion.div
        className="absolute w-28 h-28 rounded-full"
        style={{
          background: isAuthenticating
            ? "radial-gradient(circle, rgba(168,85,247,0.3) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)",
        }}
        animate={
          isAuthenticating
            ? { scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }
            : { scale: [1, 1.05, 1], opacity: [0.3, 0.5, 0.3] }
        }
        transition={{ duration: isAuthenticating ? 1 : 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Inner ring */}
      <motion.div
        className="absolute w-20 h-20 rounded-full border border-purple-500/30"
        animate={
          isAuthenticating
            ? {
                borderColor: [
                  "rgba(168,85,247,0.3)",
                  "rgba(168,85,247,0.8)",
                  "rgba(168,85,247,0.3)",
                ],
              }
            : {}
        }
        transition={{ duration: 1, repeat: Infinity }}
      />

      {/* Key icon */}
      <motion.div
        className="relative z-10 w-16 h-16 rounded-full bg-gray-800/80 border border-white/10 flex items-center justify-center"
        animate={isAuthenticating ? { scale: [1, 0.95, 1] } : {}}
        transition={{ duration: 0.5, repeat: Infinity }}
      >
        {isAuthenticating ? (
          <Fingerprint className="w-8 h-8 text-purple-400" />
        ) : (
          <Icon className="w-8 h-8 text-purple-400/70" />
        )}
      </motion.div>
    </div>
  );
}

const PIN_LENGTH = 6;

function PinInput({ onSubmit, error }: { onSubmit: (pin: string) => void; error: string | null }) {
  const [digits, setDigits] = useState<string[]>([]);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevError = useRef(error);

  // Focus the hidden input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  // Shake on new error
  useEffect(() => {
    if (error && error !== prevError.current) {
      setShake(true);
      setDigits([]);
      const timer = setTimeout(() => setShake(false), 500);
      prevError.current = error;
      return () => clearTimeout(timer);
    }
    prevError.current = error;
  }, [error]);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (digits.length === PIN_LENGTH) {
      onSubmit(digits.join(""));
    }
  }, [digits, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Backspace") {
        setDigits((prev) => prev.slice(0, -1));
      } else if (/^\d$/.test(e.key) && digits.length < PIN_LENGTH) {
        setDigits((prev) => [...prev, e.key]);
      }
    },
    [digits.length],
  );

  return (
    <div className="flex flex-col items-center">
      {/* Hidden input to capture keyboard */}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className="sr-only"
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => inputRef.current?.focus(), 100)}
        value=""
        readOnly
      />

      {/* Dot display */}
      <motion.div
        className="flex gap-3 mb-6"
        animate={shake ? { x: [-12, 12, -8, 8, -4, 4, 0] } : {}}
        transition={{ duration: 0.4 }}
        onClick={() => inputRef.current?.focus()}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <motion.div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-colors duration-150 ${
              i < digits.length
                ? "bg-purple-400 border-purple-400"
                : "bg-transparent border-white/20"
            }`}
            animate={i === digits.length - 1 && digits.length > 0 ? { scale: [1, 1.3, 1] } : {}}
            transition={{ duration: 0.15 }}
          />
        ))}
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-red-400/80 text-sm mb-4"
        >
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </motion.div>
      )}

      <p className="text-white/30 text-xs">Enter your 6-digit PIN</p>
    </div>
  );
}

export function LockScreen({
  isLocked,
  onUnlock,
  onUnlockWithPin,
  error,
  isAuthenticating,
  hasPin,
  hasPlatformKey,
  hasCrossPlatformKey,
  credentials,
}: LockScreenProps) {
  const hasWebAuthn = credentials.length > 0;

  // Determine default mode
  const getDefaultMode = useCallback((): UnlockMode => {
    if (hasPlatformKey || hasCrossPlatformKey) return "webauthn";
    if (hasPin) return "pin";
    return "webauthn";
  }, [hasPlatformKey, hasCrossPlatformKey, hasPin]);

  const [mode, setMode] = useState<UnlockMode>(getDefaultMode);
  const [unlockAttempted, setUnlockAttempted] = useState(false);

  // Reset mode when lock state changes
  useEffect(() => {
    if (isLocked) {
      setMode(getDefaultMode());
      setUnlockAttempted(false);
    }
  }, [isLocked, getDefaultMode]);

  const handleWebAuthnUnlock = useCallback(async () => {
    setUnlockAttempted(true);
    await onUnlock();
  }, [onUnlock]);

  const handlePinSubmit = useCallback(
    async (pin: string) => {
      setUnlockAttempted(true);
      await onUnlockWithPin(pin);
    },
    [onUnlockWithPin],
  );

  // Auto-prompt WebAuthn on interaction (only in webauthn mode)
  useEffect(() => {
    if (!isLocked || isAuthenticating || mode !== "webauthn") return;

    const handleInteraction = () => {
      if (!isAuthenticating) {
        handleWebAuthnUnlock();
      }
    };

    const timer = setTimeout(() => {
      window.addEventListener("keydown", handleInteraction);
      window.addEventListener("mousedown", handleInteraction);
    }, 500);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleInteraction);
      window.removeEventListener("mousedown", handleInteraction);
    };
  }, [isLocked, isAuthenticating, handleWebAuthnUnlock, mode]);

  return (
    <AnimatePresence>
      {isLocked && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[300] flex flex-col items-center justify-center select-none"
          style={{
            background:
              "linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 30%, #0d0d1a 60%, #0a1628 100%)",
          }}
        >
          {/* Subtle grid background */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(168,85,247,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(168,85,247,0.3) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />

          {/* Content */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="relative z-10 flex flex-col items-center"
          >
            {/* Clock */}
            <ClockDisplay />

            {/* Lock icon + branding */}
            <div className="flex items-center gap-2 mb-8">
              <Shield className="w-5 h-5 text-purple-500/60" />
              <span className="text-sm text-white/30 font-medium tracking-widest uppercase">
                ArgentOS Locked
              </span>
            </div>

            {/* Unlock area */}
            <AnimatePresence mode="wait">
              {mode === "webauthn" ? (
                <motion.div
                  key="webauthn"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col items-center"
                >
                  <KeyAnimation
                    isAuthenticating={isAuthenticating}
                    hasPlatformKey={hasPlatformKey}
                  />

                  <motion.div
                    className="text-center"
                    animate={isAuthenticating ? { opacity: [0.5, 1, 0.5] } : { opacity: 1 }}
                    transition={isAuthenticating ? { duration: 1.5, repeat: Infinity } : {}}
                  >
                    {isAuthenticating ? (
                      <p className="text-white/60 text-sm">
                        {hasPlatformKey ? "Verify with Touch ID..." : "Waiting for security key..."}
                      </p>
                    ) : unlockAttempted && error ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex items-center gap-2 text-red-400/80 text-sm">
                          <AlertCircle className="w-4 h-4" />
                          <span>{error}</span>
                        </div>
                        <button
                          onClick={handleWebAuthnUnlock}
                          className="mt-2 px-6 py-2 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded-lg text-purple-300 text-sm transition-colors"
                        >
                          Try Again
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <p className="text-white/40 text-sm">
                          {hasPlatformKey
                            ? "Use Touch ID or click anywhere to unlock"
                            : "Touch your security key or click anywhere to unlock"}
                        </p>
                        <button
                          onClick={handleWebAuthnUnlock}
                          className="px-8 py-2.5 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 hover:border-purple-500/50 rounded-xl text-purple-300 text-sm font-medium transition-all hover:shadow-lg hover:shadow-purple-500/10"
                        >
                          Unlock
                        </button>
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              ) : (
                <motion.div
                  key="pin"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col items-center"
                >
                  {/* PIN icon */}
                  <div className="relative flex items-center justify-center mb-8">
                    <motion.div
                      className="absolute w-28 h-28 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)",
                      }}
                      animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.5, 0.3] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <div className="relative z-10 w-16 h-16 rounded-full bg-gray-800/80 border border-white/10 flex items-center justify-center">
                      <Hash className="w-8 h-8 text-purple-400/70" />
                    </div>
                  </div>

                  <PinInput onSubmit={handlePinSubmit} error={unlockAttempted ? error : null} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Mode switch links */}
            <div className="mt-6 flex items-center gap-4">
              {mode === "webauthn" && hasPin && (
                <button
                  onClick={() => setMode("pin")}
                  className="text-white/25 hover:text-white/50 text-xs transition-colors"
                >
                  Use PIN instead
                </button>
              )}
              {mode === "pin" && hasWebAuthn && (
                <button
                  onClick={() => setMode("webauthn")}
                  className="text-white/25 hover:text-white/50 text-xs transition-colors"
                >
                  {hasPlatformKey ? "Use Touch ID instead" : "Use security key instead"}
                </button>
              )}
            </div>
          </motion.div>

          {/* Bottom branding */}
          <div className="absolute bottom-8 text-center">
            <p className="text-white/10 text-xs tracking-widest uppercase">ArgentOS</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
