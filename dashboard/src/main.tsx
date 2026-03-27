import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "./lib/ThemeProvider";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
  });
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<p className="text-red-400 p-4">Something went wrong.</p>}>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </Sentry.ErrorBoundary>,
);
