import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Wind,
  Droplets,
  RefreshCw,
} from "lucide-react";
import { type DetailedWeatherData } from "../hooks/useWeather";

interface WeatherModalProps {
  isOpen: boolean;
  onClose: () => void;
  location?: string;
  weather: DetailedWeatherData | null;
  loading: boolean;
  onRefresh: () => void;
}

const iconMap: Record<string, typeof Sun> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

export function WeatherModal({
  isOpen,
  onClose,
  location = "Austin, TX",
  weather,
  loading,
  onRefresh,
}: WeatherModalProps) {
  const Icon = weather?.current ? iconMap[weather.current.icon] || Sun : Sun;

  // Show how old the cache is
  const cacheAge = weather?.cachedAt ? Math.round((Date.now() - weather.cachedAt) / 60000) : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-gray-900 rounded-2xl p-6 w-[500px] max-w-[90vw] max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-white font-semibold text-lg">{location} Weather</h3>
                {cacheAge !== null && (
                  <span className="text-white/40 text-xs">
                    Updated {cacheAge === 0 ? "just now" : `${cacheAge}m ago`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onRefresh}
                  disabled={loading}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 disabled:opacity-50"
                  title="Refresh weather"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {loading && !weather && (
              <div className="text-center py-8 text-white/50">Loading weather...</div>
            )}

            {weather && !loading && (
              <>
                {/* Current Weather */}
                <div className="bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-2xl p-6 mb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-5xl font-light text-white mb-1">
                        {weather.current.temp}°F
                      </div>
                      <div className="text-white/70">{weather.current.condition}</div>
                      <div className="text-white/50 text-sm mt-1">
                        Feels like {weather.current.feelsLike}°F
                      </div>
                    </div>
                    <Icon className="w-20 h-20 text-white/70" />
                  </div>
                  <div className="flex gap-6 mt-4 pt-4 border-t border-white/10">
                    <div className="flex items-center gap-2 text-white/60 text-sm">
                      <Droplets className="w-4 h-4" />
                      <span>{weather.current.humidity}%</span>
                    </div>
                    <div className="flex items-center gap-2 text-white/60 text-sm">
                      <Wind className="w-4 h-4" />
                      <span>{weather.current.wind} mph</span>
                    </div>
                  </div>
                </div>

                {/* Hourly Forecast */}
                <div className="mb-6">
                  <h4 className="text-white/70 text-sm font-medium mb-3">Today's Forecast</h4>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {weather.hourly.map((hour, i) => {
                      const HourIcon = iconMap[hour.icon] || Sun;
                      return (
                        <div
                          key={i}
                          className="flex-shrink-0 bg-white/5 rounded-xl p-3 text-center min-w-[60px]"
                        >
                          <div className="text-white/50 text-xs">{hour.time}</div>
                          <HourIcon className="w-5 h-5 mx-auto my-2 text-white/70" />
                          <div className="text-white text-sm">{hour.temp}°</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 7-Day Forecast */}
                <div>
                  <h4 className="text-white/70 text-sm font-medium mb-3">7-Day Forecast</h4>
                  <div className="space-y-2">
                    {weather.daily.map((day, i) => {
                      const DayIcon = iconMap[day.icon] || Sun;
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3"
                        >
                          <div className="w-16 text-white/70 text-sm">{day.day}</div>
                          <DayIcon className="w-5 h-5 text-white/60" />
                          <div className="flex gap-3 text-sm">
                            <span className="text-white">{day.high}°</span>
                            <span className="text-white/40">{day.low}°</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
