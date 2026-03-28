/**
 * useLockScreen — Multi-method lock screen for the dashboard
 *
 * Supports three independent unlock methods:
 *   1. PIN code (6-digit, SHA-256 hashed in localStorage)
 *   2. Touch ID (platform WebAuthn — Apple keyboard fingerprint sensor)
 *   3. YubiKey (cross-platform WebAuthn — external security key)
 *
 * Any single method can unlock the dashboard.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchLocalApi } from "../utils/localApiFetch";

const STORAGE_KEY = "argent-lockscreen-credentials";
const LOCK_SETTINGS_KEY = "argent-lockscreen-settings";
const PIN_STORAGE_KEY = "argent-lockscreen-pin"; // SHA-256 hash

export interface StoredCredential {
  id: string; // base64url credential ID
  rawId: string; // base64url raw ID
  registeredAt: string;
  label?: string;
  type: "cross-platform" | "platform"; // YubiKey vs Touch ID
}

interface LockSettings {
  enabled: boolean;
  autoLockMinutes: number; // 0 = no auto-lock
  lockOnStartup: boolean;
}

const DEFAULT_SETTINGS: LockSettings = {
  enabled: false,
  autoLockMinutes: 0,
  lockOnStartup: false,
};

// Base64url helpers
function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return bufferToBase64url(hashBuffer);
}

function loadCredentials(): StoredCredential[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredCredential[];
    // Migrate old credentials without type field
    return parsed.map((c) => ({ ...c, type: c.type || "cross-platform" }));
  } catch {
    return [];
  }
}

function saveCredentials(creds: StoredCredential[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

function loadSettings(): LockSettings {
  try {
    const raw = localStorage.getItem(LOCK_SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: LockSettings) {
  localStorage.setItem(LOCK_SETTINGS_KEY, JSON.stringify(settings));
}

function loadPinHash(): string | null {
  return localStorage.getItem(PIN_STORAGE_KEY);
}

export function useLockScreen() {
  const [isLocked, setIsLocked] = useState(false);
  const [credentials, setCredentials] = useState<StoredCredential[]>(loadCredentials);
  const [settings, setSettings] = useState<LockSettings>(loadSettings);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [hasPin, setHasPin] = useState(() => loadPinHash() !== null);
  const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());

  const hasCredentials = credentials.length > 0;
  const canLock = hasCredentials || hasPin;
  const hasPlatformKey = credentials.some((c) => c.type === "platform");
  const hasCrossPlatformKey = credentials.some((c) => c.type === "cross-platform");

  const SESSION_UNLOCK_KEY = "argent-lockscreen-session-unlocked";

  // Mark session as unlocked (survives refresh, clears on new tab/window)
  const markSessionUnlocked = useCallback(() => {
    sessionStorage.setItem(SESSION_UNLOCK_KEY, "1");
  }, []);

  // Lock on startup if configured — skip if already unlocked this session
  useEffect(() => {
    // Already unlocked in this browser session (refresh)? Stay unlocked.
    if (sessionStorage.getItem(SESSION_UNLOCK_KEY)) return;

    // Check for admin emergency unlock file
    fetchLocalApi("/api/lockscreen/emergency-unlock", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data.unlocked) {
          markSessionUnlocked();
          return;
        }
        if (settings.enabled && settings.lockOnStartup && canLock) {
          setIsLocked(true);
        }
      })
      .catch(() => {
        if (settings.enabled && settings.lockOnStartup && canLock) {
          setIsLocked(true);
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-lock timer
  const resetAutoLock = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
    if (settings.enabled && settings.autoLockMinutes > 0 && canLock && !isLocked) {
      autoLockTimerRef.current = setTimeout(
        () => {
          setIsLocked(true);
        },
        settings.autoLockMinutes * 60 * 1000,
      );
    }
  }, [settings.enabled, settings.autoLockMinutes, canLock, isLocked]);

  // Track activity for auto-lock
  useEffect(() => {
    if (!settings.enabled || settings.autoLockMinutes <= 0 || !canLock) return;

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    const handler = () => resetAutoLock();

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetAutoLock(); // Start initial timer

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    };
  }, [resetAutoLock, settings.enabled, settings.autoLockMinutes, canLock]);

  // Enable lock screen when first auth method is configured
  const enableIfFirst = useCallback(
    (currentCreds: StoredCredential[]) => {
      if (currentCreds.length === 0 && !hasPin) {
        const newSettings = { ...settings, enabled: true };
        setSettings(newSettings);
        saveSettings(newSettings);
      }
    },
    [settings, hasPin],
  );

  // Register a new YubiKey (cross-platform)
  const registerKey = useCallback(
    async (label?: string) => {
      setError(null);

      if (!window.PublicKeyCredential) {
        setError("WebAuthn is not supported in this browser");
        return false;
      }

      try {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = crypto.getRandomValues(new Uint8Array(16));

        const credential = (await navigator.credentials.create({
          publicKey: {
            rp: {
              name: "ArgentOS Dashboard",
              id: window.location.hostname,
            },
            user: {
              id: userId,
              name: "dashboard-user",
              displayName: "Dashboard User",
            },
            challenge,
            pubKeyCredParams: [
              { type: "public-key", alg: -7 }, // ES256
              { type: "public-key", alg: -257 }, // RS256
            ],
            authenticatorSelection: {
              authenticatorAttachment: "cross-platform",
              userVerification: "discouraged",
            },
            timeout: 60000,
            attestation: "none",
          },
        })) as PublicKeyCredential;

        if (!credential) {
          setError("Registration cancelled");
          return false;
        }

        const stored: StoredCredential = {
          id: bufferToBase64url(credential.rawId),
          rawId: bufferToBase64url(credential.rawId),
          registeredAt: new Date().toISOString(),
          label:
            label || `YubiKey ${credentials.filter((c) => c.type === "cross-platform").length + 1}`,
          type: "cross-platform",
        };

        enableIfFirst(credentials);
        const updated = [...credentials, stored];
        setCredentials(updated);
        saveCredentials(updated);

        return true;
      } catch (err: any) {
        if (err.name === "NotAllowedError") {
          setError("Registration was cancelled or timed out");
        } else {
          setError(err.message || "Registration failed");
        }
        return false;
      }
    },
    [credentials, enableIfFirst],
  );

  // Register a platform key (Touch ID)
  const registerPlatformKey = useCallback(
    async (label?: string) => {
      setError(null);

      if (!window.PublicKeyCredential) {
        setError("WebAuthn is not supported in this browser");
        return false;
      }

      try {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!available) {
          setError("Touch ID / platform authenticator not available on this device");
          return false;
        }

        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = crypto.getRandomValues(new Uint8Array(16));

        const credential = (await navigator.credentials.create({
          publicKey: {
            rp: {
              name: "ArgentOS Dashboard",
              id: window.location.hostname,
            },
            user: {
              id: userId,
              name: "dashboard-user",
              displayName: "Dashboard User",
            },
            challenge,
            pubKeyCredParams: [
              { type: "public-key", alg: -7 },
              { type: "public-key", alg: -257 },
            ],
            authenticatorSelection: {
              authenticatorAttachment: "platform",
              userVerification: "required",
            },
            timeout: 60000,
            attestation: "none",
          },
        })) as PublicKeyCredential;

        if (!credential) {
          setError("Registration cancelled");
          return false;
        }

        const stored: StoredCredential = {
          id: bufferToBase64url(credential.rawId),
          rawId: bufferToBase64url(credential.rawId),
          registeredAt: new Date().toISOString(),
          label: label || `Touch ID ${credentials.filter((c) => c.type === "platform").length + 1}`,
          type: "platform",
        };

        enableIfFirst(credentials);
        const updated = [...credentials, stored];
        setCredentials(updated);
        saveCredentials(updated);

        return true;
      } catch (err: any) {
        if (err.name === "NotAllowedError") {
          setError("Registration was cancelled or timed out");
        } else {
          setError(err.message || "Registration failed");
        }
        return false;
      }
    },
    [credentials, enableIfFirst],
  );

  // Authenticate with WebAuthn (Touch ID or YubiKey — includes all credentials)
  const unlock = useCallback(async () => {
    setError(null);
    setIsAuthenticating(true);

    if (credentials.length === 0) {
      setError("No security keys registered");
      setIsAuthenticating(false);
      return false;
    }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));

      const allowCredentials = credentials.map((cred) => ({
        type: "public-key" as const,
        id: base64urlToBuffer(cred.rawId),
        transports:
          cred.type === "platform"
            ? (["internal"] as AuthenticatorTransport[])
            : (["usb", "nfc", "ble"] as AuthenticatorTransport[]),
      }));

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials,
          userVerification: "discouraged",
          timeout: 60000,
        },
      });

      if (assertion) {
        setIsLocked(false);
        markSessionUnlocked();
        setIsAuthenticating(false);
        resetAutoLock();
        return true;
      }

      setError("Authentication failed");
      setIsAuthenticating(false);
      return false;
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Authentication cancelled or timed out");
      } else {
        setError(err.message || "Authentication failed");
      }
      setIsAuthenticating(false);
      return false;
    }
  }, [credentials, resetAutoLock]);

  // PIN methods
  const setPin = useCallback(
    async (pin: string) => {
      const hash = await hashPin(pin);
      localStorage.setItem(PIN_STORAGE_KEY, hash);
      setHasPin(true);
      // Enable lock screen if this is the first auth method
      if (credentials.length === 0) {
        const newSettings = { ...settings, enabled: true };
        setSettings(newSettings);
        saveSettings(newSettings);
      }
    },
    [credentials, settings],
  );

  const clearPin = useCallback(() => {
    localStorage.removeItem(PIN_STORAGE_KEY);
    setHasPin(false);
    // Disable if no other auth methods
    if (credentials.length === 0) {
      setIsLocked(false);
      const newSettings = { ...settings, enabled: false };
      setSettings(newSettings);
      saveSettings(newSettings);
    }
  }, [credentials, settings]);

  const unlockWithPin = useCallback(
    async (pin: string): Promise<boolean> => {
      setError(null);
      const storedHash = loadPinHash();
      if (!storedHash) {
        setError("No PIN configured");
        return false;
      }
      const inputHash = await hashPin(pin);
      if (inputHash === storedHash) {
        setIsLocked(false);
        markSessionUnlocked();
        resetAutoLock();
        return true;
      }
      setError("Incorrect PIN");
      return false;
    },
    [resetAutoLock],
  );

  // Lock the dashboard
  const lock = useCallback(() => {
    if (canLock) {
      sessionStorage.removeItem(SESSION_UNLOCK_KEY);
      setIsLocked(true);
      setError(null);
    }
  }, [canLock]);

  // Remove a registered key
  const removeKey = useCallback(
    (credId: string) => {
      const updated = credentials.filter((c) => c.id !== credId);
      setCredentials(updated);
      saveCredentials(updated);
      if (updated.length === 0 && !hasPin) {
        setIsLocked(false);
        const newSettings = { ...settings, enabled: false };
        setSettings(newSettings);
        saveSettings(newSettings);
      }
    },
    [credentials, settings, hasPin],
  );

  // Update settings
  const updateSettings = useCallback(
    (patch: Partial<LockSettings>) => {
      const updated = { ...settings, ...patch };
      setSettings(updated);
      saveSettings(updated);
    },
    [settings],
  );

  return {
    isLocked,
    lock,
    unlock,
    registerKey,
    registerPlatformKey,
    removeKey,
    credentials,
    hasCredentials: canLock, // true if any auth method configured
    hasPlatformKey,
    hasCrossPlatformKey,
    settings,
    updateSettings,
    error,
    isAuthenticating,
    // PIN
    hasPin,
    setPin,
    clearPin,
    unlockWithPin,
  };
}
