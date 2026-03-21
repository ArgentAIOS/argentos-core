import { X } from "lucide-react";
import { useState, useEffect } from "react";
import { corsFetch } from "../../lib/corsFetch";
import { WidgetContainer } from "./WidgetContainer";

interface TickerItem {
  label: string;
  value: number;
  change: number;
  isUp: boolean;
  type: "spot" | "ratio" | "stock";
  name?: string;
}

interface TickerData {
  items: TickerItem[];
  timestamp: string;
}

interface SilverPriceWidgetProps {
  size?: "small" | "large";
}

interface MarketStatus {
  name: string;
  region: string;
  isOpen: boolean;
  hours: string;
}

function getActiveMarkets(): MarketStatus[] {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  const isWeekday = day >= 1 && day <= 5; // Monday-Friday
  const isSunToThu = day >= 0 && day <= 4; // Sunday-Thursday

  // COMEX: Mon-Fri 7:30 AM - 12:30 PM CST
  const comexOpen = isWeekday && timeInMinutes >= 7 * 60 + 30 && timeInMinutes < 12 * 60 + 30;

  // London (LME): Mon-Fri 7:00 PM (previous day) - 1:00 PM CST
  // Essentially all day Mon-Fri except 1:00 PM - 7:00 PM
  const lmeOpen = isWeekday && !(timeInMinutes >= 13 * 60 && timeInMinutes < 19 * 60);

  // Tokyo/Osaka: Sun-Thu 6:00 PM - 12:00 AM (midnight) CST
  const tokyoOpen = isSunToThu && timeInMinutes >= 18 * 60;

  // Shanghai: Sun-Thu 7:00 PM - 9:30 PM and 11:30 PM - 1:30 AM CST
  const shanghaiSession1 = isSunToThu && timeInMinutes >= 19 * 60 && timeInMinutes < 21 * 60 + 30;
  const shanghaiSession2 = isSunToThu && timeInMinutes >= 23 * 60 + 30;
  const shanghaiOpen = shanghaiSession1 || shanghaiSession2;

  return [
    {
      name: "COMEX",
      region: "Americas",
      isOpen: comexOpen,
      hours: "7:30 AM - 12:30 PM CST (Mon-Fri)",
    },
    {
      name: "London (LME)",
      region: "Europe",
      isOpen: lmeOpen,
      hours: "7:00 PM - 1:00 PM CST (Mon-Fri)",
    },
    {
      name: "Tokyo/Osaka",
      region: "Asia",
      isOpen: tokyoOpen,
      hours: "6:00 PM - 12:00 AM CST (Sun-Thu)",
    },
    {
      name: "Shanghai (SGE)",
      region: "Asia",
      isOpen: shanghaiOpen,
      hours: "7:00-9:30 PM, 11:30 PM-1:30 AM CST (Sun-Thu)",
    },
  ];
}

export function SilverPriceWidget({ size = "small" }: SilverPriceWidgetProps) {
  const [data, setData] = useState<TickerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMarketModal, setShowMarketModal] = useState(false);

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const response = await corsFetch("https://api.silverintel.report/api/prices/ticker");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (!result?.items) throw new Error("Invalid response: missing items");
        setData(result);
        setLoading(false);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.error("Failed to fetch ticker prices:", err);
        }
        setLoading(false);
      }
    };

    fetchPrices();
    // Refresh every 30 seconds
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !data) {
    return (
      <WidgetContainer className="h-full">
        <div className="flex items-center justify-center h-full">
          <div className="text-white/40 text-sm">Loading...</div>
        </div>
      </WidgetContainer>
    );
  }

  // Extract data by type
  const silver = data.items.find((i) => i.label === "XAG/USD");
  const gold = data.items.find((i) => i.label === "XAU/USD");
  const platinum = data.items.find((i) => i.label === "XPT/USD");
  const palladium = data.items.find((i) => i.label === "XPD/USD");
  const ratio = data.items.find((i) => i.label === "AU:AG");

  if (!silver) {
    return (
      <WidgetContainer className="h-full">
        <div className="flex items-center justify-center h-full">
          <div className="text-white/40 text-sm">No data available</div>
        </div>
      </WidgetContainer>
    );
  }

  if (size === "large") {
    // Large version for position 7 (bubble position)
    const bid = silver.value * 0.9997; // Approximate bid (0.03% spread)
    const ask = silver.value * 1.0003; // Approximate ask

    const markets = getActiveMarkets();

    // Only show LIVE indicator during COMEX hours (7:30 AM - 12:30 PM CST, Mon-Fri)
    const now = new Date();
    const day = now.getDay();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const timeInMinutes = hours * 60 + minutes;
    const isWeekday = day >= 1 && day <= 5;
    const isCOMEXOpen = isWeekday && timeInMinutes >= 7 * 60 + 30 && timeInMinutes < 12 * 60 + 30;

    const primaryMarket = isCOMEXOpen ? markets.find((m) => m.name === "COMEX") : null;

    return (
      <WidgetContainer className="h-full">
        <div
          className="flex flex-col h-full pt-1 px-3 pb-3 justify-between rounded-xl"
          style={{ background: "rgba(10, 10, 10, 0.3)" }}
        >
          {/* Hero Section - Silver */}
          <div className="relative">
            {/* Market Status - Clickable */}
            <button
              onClick={() => setShowMarketModal(true)}
              className="absolute top-0 right-0 flex items-center gap-1.5 hover:bg-white/10 px-2 py-1 rounded-md transition-colors cursor-pointer"
            >
              {primaryMarket ? (
                <>
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-white/60 text-xs font-medium tracking-wider">
                    {primaryMarket.name}
                  </span>
                </>
              ) : (
                <span className="text-white/40 text-xs font-medium tracking-wider">
                  AFTER HOURS
                </span>
              )}
            </button>

            {/* Main Silver Price */}
            <div
              className="text-white font-bold mb-0.5"
              style={{ fontSize: "3rem", lineHeight: "1", letterSpacing: "-0.02em" }}
            >
              ${silver.value.toFixed(2)}
            </div>

            {/* Bid/Ask */}
            <div className="flex items-center gap-4 mb-1 text-white/60 text-sm">
              <div>
                <span className="text-white/40">BID</span> ${bid.toFixed(2)}
              </div>
              <div>
                <span className="text-white/40">ASK</span> ${ask.toFixed(2)}
              </div>
            </div>

            <div className="h-px bg-gradient-to-r from-amber-400/20 to-transparent mb-1"></div>

            {/* Metal Label & Change */}
            <div className="text-white/40 text-xs font-medium tracking-wider mb-0.5">SILVER</div>
            <div
              className={`flex items-center gap-1.5 text-base font-medium ${
                silver.isUp ? "text-green-400" : "text-red-400"
              }`}
            >
              <span>{silver.isUp ? "▲" : "▼"}</span>
              <span>{Math.abs(silver.change).toFixed(2)}% TODAY</span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-white/10 my-1.5"></div>

          {/* Bottom Grid - Gold, Ratio, Platinum, Palladium */}
          <div className="grid grid-cols-2 gap-3">
            {/* Gold */}
            {gold && (
              <div>
                <div
                  className="text-amber-300 font-bold mb-0.5"
                  style={{ fontSize: "1.5rem", lineHeight: "1" }}
                >
                  $
                  {gold.value.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="text-white/40 text-[10px] font-medium tracking-wider mb-0.5">
                  GOLD
                </div>
                <div
                  className={`text-xs font-medium ${gold.isUp ? "text-green-400" : "text-red-400"}`}
                >
                  {gold.isUp ? "▲" : "▼"} {Math.abs(gold.change).toFixed(2)}%
                </div>
              </div>
            )}

            {/* Gold:Silver Ratio */}
            {ratio && (
              <div>
                <div
                  className="text-white font-bold mb-0.5"
                  style={{ fontSize: "1.5rem", lineHeight: "1" }}
                >
                  {ratio.value.toFixed(1)}:1
                </div>
                <div className="text-white/40 text-[10px] font-medium tracking-wider mb-0.5">
                  RATIO
                </div>
                <div
                  className={`text-xs font-medium ${
                    ratio.isUp ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {ratio.isUp ? "▲" : "▼"} {Math.abs(ratio.change).toFixed(2)}
                </div>
              </div>
            )}

            {/* Platinum */}
            {platinum && (
              <div>
                <div
                  className="text-white/90 font-bold mb-0.5"
                  style={{ fontSize: "1.25rem", lineHeight: "1" }}
                >
                  $
                  {platinum.value.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="text-white/40 text-[10px] font-medium tracking-wider mb-0.5">
                  PLATINUM
                </div>
                <div
                  className={`text-xs font-medium ${
                    platinum.isUp ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {platinum.isUp ? "▲" : "▼"} {Math.abs(platinum.change).toFixed(2)}%
                </div>
              </div>
            )}

            {/* Palladium */}
            {palladium && (
              <div>
                <div
                  className="text-white/90 font-bold mb-0.5"
                  style={{ fontSize: "1.25rem", lineHeight: "1" }}
                >
                  $
                  {palladium.value.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="text-white/40 text-[10px] font-medium tracking-wider mb-0.5">
                  PALLADIUM
                </div>
                <div
                  className={`text-xs font-medium ${
                    palladium.isUp ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {palladium.isUp ? "▲" : "▼"} {Math.abs(palladium.change).toFixed(2)}%
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Market Hours Modal */}
        {showMarketModal && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]"
            onClick={() => setShowMarketModal(false)}
          >
            <div
              className="bg-gray-900 rounded-2xl p-6 w-[500px] max-w-[90vw] border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold text-lg">Global Trading Hours</h3>
                <button
                  onClick={() => setShowMarketModal(false)}
                  className="p-1 rounded-lg hover:bg-white/10 text-white/50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                {markets.map((market) => (
                  <div
                    key={market.name}
                    className={`p-3 rounded-lg border ${
                      market.isOpen
                        ? "bg-green-500/10 border-green-500/30"
                        : "bg-white/5 border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            market.isOpen ? "bg-green-500 animate-pulse" : "bg-white/20"
                          }`}
                        ></div>
                        <span className="text-white font-medium text-sm">{market.name}</span>
                        <span className="text-white/40 text-xs">({market.region})</span>
                      </div>
                      {market.isOpen && (
                        <span className="text-green-400 text-xs font-medium">LIVE</span>
                      )}
                    </div>
                    <div className="text-white/50 text-xs ml-4">{market.hours}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 text-white/40 text-xs text-center">
                All times shown in Central Time (CST)
              </div>
            </div>
          </div>
        )}
      </WidgetContainer>
    );
  }

  // Small version for positions 1-6
  return (
    <WidgetContainer className="h-full">
      <div className="flex flex-col h-full p-3 justify-center">
        {/* Icon & Title */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🪙</span>
          <span className="text-white/70 text-xs font-medium">Silver</span>
        </div>

        {/* Spot Price */}
        <div className="mb-2">
          <div className="text-white/40 text-[10px] mb-0.5">SPOT</div>
          <div className="flex items-baseline gap-1">
            <span className="text-white text-xl font-bold tabular-nums">
              ${silver.value.toFixed(2)}
            </span>
          </div>
          <div
            className={`flex items-center gap-1 mt-1 ${
              silver.isUp ? "text-green-400" : "text-red-400"
            }`}
          >
            <span className="text-[10px] font-medium">
              {silver.isUp ? "+" : ""}
              {silver.change.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Ratio */}
        {ratio && (
          <div className="pt-2 border-t border-white/10">
            <div className="text-white/40 text-[10px] mb-0.5">Au/Ag Ratio</div>
            <div className="text-amber-400 text-sm font-bold tabular-nums">
              {ratio.value.toFixed(2)}:1
            </div>
          </div>
        )}
      </div>
    </WidgetContainer>
  );
}
