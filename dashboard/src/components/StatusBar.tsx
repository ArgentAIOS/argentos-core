import { motion } from "framer-motion";
import {
  Sun,
  Moon,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Mail,
  Calendar,
  Wifi,
  WifiOff,
  ClipboardList,
  Settings,
  Sunrise,
  Sunset,
  Stars,
  Boxes,
  Users2,
  Shield,
  Lock,
  UserPlus,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  saveConfig,
  loadConfig,
  loadTimePresets,
  getPresetForCurrentTime,
} from "../lib/avatarConfig";
import { buildPresetConfig } from "../lib/avatarPresets";
import { setBackgroundOverride, type BackgroundMode } from "./AvatarBackground";
import { applyCustomization, resetCustomizationParams } from "./Live2DAvatar";
import { ZoomControls } from "./ZoomControls";

interface StatusBarProps {
  alertCount?: number;
  nextEvent?: string;
  weather?: string;
  connected?: boolean;
  onWeatherClick?: () => void;
  onCalendarClick?: () => void;
  onAlertsClick?: () => void;
  onActivityClick?: () => void;
  onSettingsClick?: () => void;
  onLockClick?: () => void;
  canLock?: boolean;
  onAppsClick?: () => void;
  onWorkforceClick?: (focus?: "all" | "due-now" | "blocked") => void;
  onNewWorkerClick?: () => void;
  workforceDueCount?: number;
  workforceBlockedCount?: number;
  onZoomChange?: (preset: "face" | "portrait" | "full" | "custom", customScale?: number) => void;
  currentZoom?: string;
  currentBackground?: BackgroundMode | "auto";
  pollingEnabled?: boolean;
}

export function StatusBar({
  alertCount = 0,
  nextEvent,
  weather,
  connected = false,
  onWeatherClick,
  onCalendarClick,
  onAlertsClick,
  onActivityClick,
  onSettingsClick,
  onLockClick,
  canLock = false,
  onAppsClick,
  onWorkforceClick,
  onNewWorkerClick,
  workforceDueCount = 0,
  workforceBlockedCount = 0,
  onZoomChange,
  currentZoom = "full",
  currentBackground = "auto",
  pollingEnabled = true,
}: StatusBarProps) {
  const [time, setTime] = useState(new Date());
  const [score, setScore] = useState<{
    score: number;
    target: number;
    verified: number;
    failed: number;
  } | null>(null);
  const scoreInFlightRef = useRef(false);
  const scoreAbortRef = useRef<AbortController | null>(null);
  const heartbeatStaleKeyRef = useRef<string | null>(null);
  const heartbeatRunnerKeyRef = useRef<string | null>(null);
  const criticalServicesKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch accountability score every 30s
  const fetchScore = useCallback(async () => {
    if (scoreInFlightRef.current) {
      return;
    }
    scoreInFlightRef.current = true;
    const controller = new AbortController();
    scoreAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch("/api/score", { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        setScore({
          score: data.today?.score ?? 0,
          target: data.today?.target ?? 100,
          verified: data.today?.verifiedCount ?? 0,
          failed: data.today?.failedCount ?? 0,
        });
        const stale =
          data?.heartbeat?.accountability?.stale === true || data?.heartbeat?.stale === true;
        const lastCycleAt =
          typeof data?.heartbeat?.accountability?.lastCycleAt === "string"
            ? data.heartbeat.accountability.lastCycleAt
            : typeof data?.heartbeat?.lastCycleAt === "string"
              ? data.heartbeat.lastCycleAt
              : null;
        const staleKey = `${stale ? "stale" : "fresh"}:${lastCycleAt ?? "none"}`;
        if (staleKey !== heartbeatStaleKeyRef.current) {
          heartbeatStaleKeyRef.current = staleKey;
          if (stale) {
            window.dispatchEvent(
              new CustomEvent("heartbeat-stale", {
                detail: {
                  lastCycleAt,
                  staleHours:
                    typeof data?.heartbeat?.accountability?.staleHours === "number"
                      ? data.heartbeat.accountability.staleHours
                      : typeof data?.heartbeat?.staleHours === "number"
                        ? data.heartbeat.staleHours
                        : null,
                  staleThresholdHours:
                    typeof data?.heartbeat?.accountability?.staleThresholdHours === "number"
                      ? data.heartbeat.accountability.staleThresholdHours
                      : typeof data?.heartbeat?.staleThresholdHours === "number"
                        ? data.heartbeat.staleThresholdHours
                        : 24,
                },
              }),
            );
          }
        }

        const runnerState =
          typeof data?.heartbeat?.runner?.state === "string" ? data.heartbeat.runner.state : null;
        const runnerLastRunAt =
          typeof data?.heartbeat?.runner?.lastRunAt === "string"
            ? data.heartbeat.runner.lastRunAt
            : null;
        const runnerKey = `${runnerState ?? "unknown"}:${runnerLastRunAt ?? "none"}`;
        if (runnerKey !== heartbeatRunnerKeyRef.current) {
          heartbeatRunnerKeyRef.current = runnerKey;
          if (runnerState === "stale" || runnerState === "unknown") {
            window.dispatchEvent(
              new CustomEvent("heartbeat-runner-inactive", {
                detail: {
                  state: runnerState,
                  lastRunAt: runnerLastRunAt,
                  ageHours:
                    typeof data?.heartbeat?.runner?.ageMs === "number"
                      ? Math.floor(data.heartbeat.runner.ageMs / (60 * 60 * 1000))
                      : null,
                  staleThresholdHours:
                    typeof data?.heartbeat?.runner?.staleThresholdHours === "number"
                      ? data.heartbeat.runner.staleThresholdHours
                      : null,
                },
              }),
            );
          }
        }
      }

      // Check critical backing services (Postgres/Redis) so outages surface in UI alerts.
      const healthRes = await fetch("/api/health", { signal: controller.signal });
      if (healthRes.ok) {
        const health = await healthRes.json();
        const down = Array.isArray(health?.criticalServicesDown)
          ? health.criticalServicesDown
              .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
              .filter(Boolean)
              .sort()
          : [];
        const key = down.length > 0 ? down.join(",") : "none";
        const prevKey = criticalServicesKeyRef.current;
        if (key !== prevKey) {
          criticalServicesKeyRef.current = key;
          if (down.length > 0) {
            window.dispatchEvent(
              new CustomEvent("critical-service-down", {
                detail: {
                  services: down,
                  timestamp: typeof health?.timestamp === "string" ? health.timestamp : null,
                },
              }),
            );
          } else if (prevKey && prevKey !== "none") {
            window.dispatchEvent(
              new CustomEvent("critical-service-recovered", {
                detail: {
                  previous: prevKey.split(","),
                  timestamp: typeof health?.timestamp === "string" ? health.timestamp : null,
                },
              }),
            );
          }
        }
      }
    } catch {
      // Silently fail — score display is non-critical
    } finally {
      clearTimeout(timeout);
      if (scoreAbortRef.current === controller) {
        scoreAbortRef.current = null;
      }
      scoreInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!pollingEnabled) {
      scoreAbortRef.current?.abort();
      scoreAbortRef.current = null;
      scoreInFlightRef.current = false;
      return;
    }
    fetchScore();
    const interval = setInterval(fetchScore, 30_000);
    // Also refresh immediately when feedback is given
    const onScoreUpdate = () => fetchScore();
    window.addEventListener("score-updated", onScoreUpdate);
    return () => {
      clearInterval(interval);
      window.removeEventListener("score-updated", onScoreUpdate);
      scoreAbortRef.current?.abort();
      scoreAbortRef.current = null;
      scoreInFlightRef.current = false;
    };
  }, [fetchScore, pollingEnabled]);

  const formattedTime = time.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const formattedDate = time.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="glass-panel rounded-2xl px-4 py-3 flex flex-col gap-3 lg:px-6 xl:flex-row xl:items-center xl:justify-between">
      {/* Time & Date */}
      <div className="flex items-center gap-4 min-w-0 sm:gap-6">
        <div>
          <div className="text-white text-2xl font-light">{formattedTime}</div>
          <div className="text-white/50 text-sm">{formattedDate}</div>
        </div>

        {/* Weather */}
        {weather && (
          <motion.button
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={onWeatherClick}
            className="flex items-center gap-2 text-white/70 hover:text-white/90 transition-colors cursor-pointer"
          >
            {(() => {
              const hour = time.getHours();
              const isNight = hour < 6 || hour >= 19;
              const condition = weather.toLowerCase();

              if (condition.includes("rain") || condition.includes("drizzle")) {
                return <CloudRain className="w-5 h-5 text-blue-400" />;
              } else if (condition.includes("snow")) {
                return <CloudSnow className="w-5 h-5 text-blue-200" />;
              } else if (condition.includes("thunder") || condition.includes("storm")) {
                return <CloudLightning className="w-5 h-5 text-yellow-400" />;
              } else if (condition.includes("cloud") || condition.includes("overcast")) {
                return <Cloud className="w-5 h-5 text-gray-400" />;
              } else if (isNight) {
                return <Moon className="w-5 h-5 text-blue-300" />;
              } else {
                return <Sun className="w-5 h-5 text-yellow-400" />;
              }
            })()}
            <span className="text-sm">{weather}</span>
          </motion.button>
        )}
      </div>

      {/* Quick Stats */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap xl:justify-end">
        {/* Calendar (far left) */}
        {nextEvent && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={onCalendarClick}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
            title={nextEvent}
          >
            <Calendar className="w-4 h-4 text-orange-400" />
            <span className="text-sm text-white/70 max-w-[180px] truncate sm:max-w-[300px]">
              {nextEvent}
            </span>
          </motion.button>
        )}

        {/* Background & Outfit switcher (temporary preview buttons) */}
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
          <button
            onClick={() => {
              setBackgroundOverride("professional");
              const tp = loadTimePresets();
              const res = loadConfig()?.resolution;
              const cfg = buildPresetConfig(tp.morning, res);
              resetCustomizationParams();
              applyCustomization(cfg.parameters);
              saveConfig(cfg);
            }}
            className={`p-1 rounded transition-all ${
              currentBackground === "professional"
                ? "bg-yellow-500/20 shadow-[0_0_10px_rgba(234,179,8,0.5)]"
                : "hover:bg-white/10"
            }`}
            title="Morning"
          >
            <Sunrise
              className={`w-3 h-3 ${
                currentBackground === "professional" ? "text-yellow-300" : "text-yellow-400"
              }`}
            />
          </button>
          <button
            onClick={() => {
              setBackgroundOverride("casual");
              const tp = loadTimePresets();
              const res = loadConfig()?.resolution;
              const cfg = buildPresetConfig(tp.evening, res);
              resetCustomizationParams();
              applyCustomization(cfg.parameters);
              saveConfig(cfg);
            }}
            className={`p-1 rounded transition-all ${
              currentBackground === "casual"
                ? "bg-orange-500/20 shadow-[0_0_10px_rgba(249,115,22,0.5)]"
                : "hover:bg-white/10"
            }`}
            title="Evening"
          >
            <Sunset
              className={`w-3 h-3 ${
                currentBackground === "casual" ? "text-orange-300" : "text-orange-400"
              }`}
            />
          </button>
          <button
            onClick={() => {
              setBackgroundOverride("tech");
              const tp = loadTimePresets();
              const res = loadConfig()?.resolution;
              const cfg = buildPresetConfig(tp.night, res);
              resetCustomizationParams();
              applyCustomization(cfg.parameters);
              saveConfig(cfg);
            }}
            className={`p-1 rounded transition-all ${
              currentBackground === "tech"
                ? "bg-purple-500/20 shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                : "hover:bg-white/10"
            }`}
            title="Night"
          >
            <Stars
              className={`w-3 h-3 ${
                currentBackground === "tech" ? "text-purple-300" : "text-purple-400"
              }`}
            />
          </button>
          <button
            onClick={() => {
              setBackgroundOverride(null);
              const presetId = getPresetForCurrentTime();
              const res = loadConfig()?.resolution;
              const cfg = buildPresetConfig(presetId, res);
              resetCustomizationParams();
              applyCustomization(cfg.parameters);
              saveConfig(cfg);
            }}
            className={`p-1 rounded transition-all ml-1 border-l border-white/10 ${
              currentBackground === "auto"
                ? "bg-blue-500/20 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                : "hover:bg-white/10"
            }`}
            title="Auto (time-based background + outfit)"
          >
            <span
              className={`text-[10px] ${
                currentBackground === "auto" ? "text-blue-300" : "text-white/50"
              }`}
            >
              AUTO
            </span>
          </button>
        </div>

        {/* Zoom controls */}
        {onZoomChange && <ZoomControls onZoomChange={onZoomChange} currentZoom={currentZoom} />}

        {/* Accountability Score */}
        {score !== null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${
              score.score < 0
                ? "bg-red-500/10 border-red-500/20"
                : score.score >= score.target
                  ? "bg-emerald-500/10 border-emerald-500/20"
                  : "bg-white/5 border-white/10"
            }`}
            title={`Accountability: ${score.score}/${score.target} | Verified: ${score.verified} | Failed: ${score.failed}`}
          >
            <Shield
              className={`w-3.5 h-3.5 ${
                score.score < 0
                  ? "text-red-400"
                  : score.score >= score.target
                    ? "text-emerald-400"
                    : "text-white/40"
              }`}
            />
            <span
              className={`text-sm font-mono font-medium ${
                score.score < 0 ? "text-red-400" : "text-emerald-400"
              }`}
            >
              {score.score >= 0 ? "+" : ""}
              {score.score}
            </span>
            <span className="text-white/20 text-sm">/</span>
            <span
              className={`text-sm font-mono ${score.failed > 0 ? "text-red-400" : "text-white/30"}`}
            >
              {score.failed > 0 ? `-${score.failed}` : "0"}
            </span>
          </motion.div>
        )}

        {/* Alerts */}
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={onAlertsClick}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
            alertCount > 0 ? "bg-pink-500/10 hover:bg-pink-500/20" : "bg-white/5 hover:bg-white/10"
          }`}
          title="Alerts"
        >
          <Mail className={`w-4 h-4 ${alertCount > 0 ? "text-pink-400" : "text-white/40"}`} />
          {alertCount > 0 && (
            <span className="text-sm text-pink-400 font-medium">{alertCount}</span>
          )}
        </motion.button>

        {/* App Forge */}
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={onAppsClick}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
          title="App Forge"
        >
          <Boxes className="w-4 h-4 text-white/50" />
        </motion.button>

        {/* Workforce */}
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={() => {
            const focus =
              workforceBlockedCount > 0 ? "blocked" : workforceDueCount > 0 ? "due-now" : "all";
            onWorkforceClick?.(focus);
          }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-cyan-500/20 transition-colors cursor-pointer"
          title="Workforce"
        >
          <div className="relative">
            <Users2 className="w-4 h-4 text-cyan-300/80" />
            {(workforceDueCount > 0 || workforceBlockedCount > 0) && (
              <span
                className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-semibold leading-4 text-center ${
                  workforceBlockedCount > 0 ? "bg-red-500 text-white" : "bg-cyan-500 text-white"
                }`}
              >
                {workforceBlockedCount > 0
                  ? `!${Math.min(99, workforceBlockedCount)}`
                  : Math.min(99, workforceDueCount)}
              </span>
            )}
          </div>
          <span className="text-xs font-medium text-cyan-100/90">Workforce</span>
        </motion.button>

        {/* New Worker */}
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={onNewWorkerClick}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/20 transition-colors cursor-pointer"
          title="New Worker"
        >
          <UserPlus className="w-4 h-4 text-purple-300" />
          <span className="text-xs font-medium text-purple-200">+ Worker</span>
        </motion.button>

        {/* Activity Log */}
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={onActivityClick}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
          title="Activity Log"
        >
          <ClipboardList className="w-4 h-4 text-white/50" />
        </motion.button>

        {/* Lock */}
        {canLock && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={onLockClick}
            className="p-2 rounded-lg bg-white/5 hover:bg-purple-500/20 transition-colors cursor-pointer"
            title="Lock Dashboard (⌘L)"
          >
            <Lock className="w-4 h-4 text-white/50" />
          </motion.button>
        )}

        {/* Settings */}
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={onSettingsClick}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
          title="Settings"
        >
          <Settings className="w-4 h-4 text-white/50" />
        </motion.button>

        {/* Connection status - just icon */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`p-2 rounded-lg ${connected ? "bg-green-500/10" : "bg-red-500/10"}`}
          title={connected ? "Connected" : "Offline"}
        >
          {connected ? (
            <Wifi className="w-4 h-4 text-green-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-400" />
          )}
        </motion.div>
      </div>
    </div>
  );
}
