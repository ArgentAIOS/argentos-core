import { TrendingUp, TrendingDown, Minus, Newspaper } from "lucide-react";
import { useState, useEffect } from "react";
import { WidgetContainer } from "./WidgetContainer";

interface NewsArticle {
  title: string;
  summary: string;
  source: string;
  published_at: string;
  category: string;
  sentiment: "bullish" | "neutral" | "bearish";
  importance: number;
  tickers_mentioned: string[];
  image_url?: string;
  slug: string;
  url?: string;
}

const SILVERINTEL_BASE = "https://silverintel.report/news";

interface StockNewsWidgetProps {
  size?: "small" | "large";
}

export function StockNewsWidget({ size = "small" }: StockNewsWidgetProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const response = await fetch("/api/news?limit=5");
        const data = await response.json();
        setArticles(data);
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch news:", err);
        setLoading(false);
      }
    };

    fetchNews();
    // Refresh every 5 minutes
    const interval = setInterval(fetchNews, 300000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <WidgetContainer className="h-full">
        <div className="flex items-center justify-center h-full">
          <div className="text-white/40 text-sm">Loading news...</div>
        </div>
      </WidgetContainer>
    );
  }

  const getSentimentIcon = (sentiment: string) => {
    if (sentiment === "bullish") return <TrendingUp className="w-3 h-3 text-green-400" />;
    if (sentiment === "bearish") return <TrendingDown className="w-3 h-3 text-red-400" />;
    return <Minus className="w-3 h-3 text-white/40" />;
  };

  const getSentimentColor = (sentiment: string) => {
    if (sentiment === "bullish") return "text-green-400";
    if (sentiment === "bearish") return "text-red-400";
    return "text-white/60";
  };

  if (size === "large") {
    // Large version - full news feed
    return (
      <WidgetContainer className="h-full">
        <div className="flex flex-col h-full p-3 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <Newspaper className="w-4 h-4 text-white/70" />
            <div>
              <div className="text-white/90 font-semibold text-xs">Market News</div>
              <div className="text-white/40 text-[10px]">Silver Intel Report</div>
            </div>
          </div>

          {/* News List */}
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {articles.map((article, idx) => {
              const articleUrl = article.slug
                ? `${SILVERINTEL_BASE}/${article.slug}`
                : article.url || "#";

              return (
                <a
                  key={idx}
                  href={articleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-white/5 rounded-lg p-2 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-colors"
                >
                  {/* Title & Sentiment */}
                  <div className="flex items-start gap-2 mb-1">
                    {getSentimentIcon(article.sentiment)}
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium line-clamp-2 group-hover:text-blue-400">
                        {article.title}
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="text-white/60 text-[10px] line-clamp-2 mb-1.5">
                    {article.summary}
                  </div>

                  {/* Meta */}
                  <div className="flex items-center justify-between text-[9px]">
                    <div className="flex items-center gap-2">
                      <span className="text-white/40">{article.source}</span>
                      {article.tickers_mentioned?.length > 0 && (
                        <>
                          <span className="text-white/20">•</span>
                          <span className="text-blue-400">
                            {article.tickers_mentioned.slice(0, 2).join(", ")}
                          </span>
                        </>
                      )}
                    </div>
                    <span className={getSentimentColor(article.sentiment)}>
                      {article.sentiment}
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </WidgetContainer>
    );
  }

  // Small version - show top 3 articles with links
  const topArticles = articles.slice(0, 3);

  if (topArticles.length === 0) {
    return (
      <WidgetContainer className="h-full">
        <div className="flex items-center justify-center h-full">
          <div className="text-white/40 text-sm">No news</div>
        </div>
      </WidgetContainer>
    );
  }

  const getArticleUrl = (article: NewsArticle) => {
    if (article.slug) {
      return `${SILVERINTEL_BASE}/${article.slug}`;
    }
    return article.url || "#";
  };

  return (
    <WidgetContainer className="h-full">
      <div className="flex flex-col h-full p-3">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <Newspaper className="w-3.5 h-3.5 text-white/70" />
          <span className="text-white/70 text-xs font-medium">Latest News</span>
        </div>

        {/* Articles List */}
        <div className="flex-1 space-y-2 overflow-hidden">
          {topArticles.map((article, idx) => (
            <a
              key={idx}
              href={getArticleUrl(article)}
              target="_blank"
              rel="noopener noreferrer"
              className="block group"
            >
              <div className="flex items-start gap-1.5">
                {getSentimentIcon(article.sentiment)}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-[11px] font-medium line-clamp-2 leading-tight group-hover:text-blue-400 transition-colors">
                    {article.title}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-white/40 text-[9px]">{article.source}</span>
                    <span className={`text-[9px] ${getSentimentColor(article.sentiment)}`}>
                      {article.sentiment}
                    </span>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-white/10 mt-auto">
          <a
            href={SILVERINTEL_BASE}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/40 text-[10px] hover:text-blue-400 transition-colors"
          >
            View all on Silver Intel Report →
          </a>
        </div>
      </div>
    </WidgetContainer>
  );
}
