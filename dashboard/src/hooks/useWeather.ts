import { useState, useEffect, useCallback } from "react";
import { fetchLocalApi } from "../utils/localApiFetch";

const STORAGE_KEY = "argent-weather-cache";
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
const API_TIMEOUT_MS = 10_000;

interface WeatherData {
  temp: number;
  condition: string;
  icon: "sun" | "cloud" | "rain" | "snow" | "storm";
}

export interface DetailedWeatherData {
  current: {
    temp: number;
    feelsLike: number;
    condition: string;
    humidity: number;
    wind: number;
    icon: string;
  };
  hourly: Array<{
    time: string;
    temp: number;
    condition: string;
    icon: string;
  }>;
  daily: Array<{
    day: string;
    high: number;
    low: number;
    condition: string;
    icon: string;
  }>;
  cachedAt: number;
}

// Load cached weather from localStorage
function loadCachedWeather(): DetailedWeatherData | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      // Check if cache is still valid
      if (Date.now() - data.cachedAt < CACHE_DURATION) {
        // Only log once when cache is first loaded, not on every render
        return data;
      }
    }
  } catch (e) {
    console.error("[Weather] Failed to load cache:", e);
  }
  return null;
}

// Save weather to localStorage
function cacheWeather(data: DetailedWeatherData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("[Weather] Failed to cache:", e);
  }
}

const getIcon = (desc: string) => {
  const d = desc.toLowerCase();
  if (d.includes("rain") || d.includes("drizzle")) return "rain";
  if (d.includes("snow")) return "snow";
  if (d.includes("thunder") || d.includes("storm")) return "storm";
  if (d.includes("cloud") || d.includes("overcast")) return "cloud";
  return "sun";
};

export function useWeather(refreshInterval = 900000, enabled = true) {
  // 15 min default
  const [weather, setWeather] = useState<string | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [detailedWeather, setDetailedWeather] = useState<DetailedWeatherData | null>(
    loadCachedWeather,
  );
  const [loading, setLoading] = useState(!loadCachedWeather());

  const fetchWeather = useCallback(async (force = false) => {
    // Check cache first unless forcing refresh
    if (!force) {
      const cached = loadCachedWeather();
      if (cached) {
        setDetailedWeather(cached);
        setWeatherData({
          temp: cached.current.temp,
          condition: cached.current.condition,
          icon: cached.current.icon as any,
        });
        setWeather(`${cached.current.temp}°F ${cached.current.condition}`);
        setLoading(false);
        return cached;
      }
    }

    console.log("[Weather] Fetching fresh data...");
    setLoading(true);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
      const response = await fetchLocalApi("/api/weather/detailed", {
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        throw new Error(`Weather API failed with status ${response.status}`);
      }

      const apiData = await response.json();
      const detailed: DetailedWeatherData = {
        current: {
          temp: Number.parseInt(String(apiData?.current?.temp ?? "72"), 10),
          feelsLike: Number.parseInt(String(apiData?.current?.feelsLike ?? "72"), 10),
          condition: String(apiData?.current?.condition ?? "Clear"),
          humidity: Number.parseInt(String(apiData?.current?.humidity ?? "50"), 10),
          wind: Number.parseInt(String(apiData?.current?.wind ?? "5"), 10),
          icon: getIcon(String(apiData?.current?.icon ?? apiData?.current?.condition ?? "sun")),
        },
        hourly: Array.isArray(apiData?.hourly)
          ? apiData.hourly.slice(0, 8).map((h: any) => ({
              time: String(h?.time ?? ""),
              temp: Number.parseInt(String(h?.temp ?? "72"), 10),
              condition: String(h?.condition ?? ""),
              icon: getIcon(String(h?.icon ?? h?.condition ?? "")),
            }))
          : [],
        daily: Array.isArray(apiData?.daily)
          ? apiData.daily.slice(0, 7).map((d: any) => ({
              day: String(d?.day ?? ""),
              high: Number.parseInt(String(d?.high ?? "74"), 10),
              low: Number.parseInt(String(d?.low ?? "66"), 10),
              condition: String(d?.condition ?? ""),
              icon: getIcon(String(d?.icon ?? d?.condition ?? "")),
            }))
          : [],
        cachedAt: Date.now(),
      };

      // Cache it
      cacheWeather(detailed);
      setDetailedWeather(detailed);
      setWeatherData({
        temp: detailed.current.temp,
        condition: detailed.current.condition,
        icon: detailed.current.icon as any,
      });
      setWeather(`${detailed.current.temp}°F ${detailed.current.condition}`);
      console.log("[Weather] Fresh data cached");
      return detailed;
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("[Weather] Error:", err);
      }
      // Keep last known weather on error
    } finally {
      setLoading(false);
    }
    return null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    fetchWeather();
    const interval = setInterval(() => fetchWeather(true), refreshInterval);
    return () => clearInterval(interval);
  }, [enabled, fetchWeather, refreshInterval]);

  return { weather, weatherData, detailedWeather, loading, refresh: () => fetchWeather(true) };
}
