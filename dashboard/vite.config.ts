import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Load .env manually for non-VITE_ vars (Vite only auto-loads VITE_* prefixed)
function loadDotenv(): Record<string, string> {
  try {
    const content = readFileSync(resolve(__dirname, ".env"), "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return vars;
  } catch {
    return {};
  }
}

const dotenv = loadDotenv();
const dashboardApiToken = process.env.DASHBOARD_API_TOKEN || dotenv.DASHBOARD_API_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "live2d-mime",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith(".moc3")) {
            res.setHeader("Content-Type", "application/octet-stream");
          }
          next();
        });
      },
    },
    {
      name: "api-null-origin-cors",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/api")) {
            return next();
          }
          if (req.headers.origin !== "null") {
            return next();
          }
          res.setHeader("Access-Control-Allow-Origin", "null");
          res.setHeader("Access-Control-Allow-Credentials", "true");
          res.setHeader("Vary", "Origin, Access-Control-Request-Headers");
          res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
          const requestHeaders = req.headers["access-control-request-headers"];
          if (typeof requestHeaders === "string" && requestHeaders.length > 0) {
            res.setHeader("Access-Control-Allow-Headers", requestHeaders);
          }
          if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 8080,
    host: true,
    // TODO(operator): decide between allowedHosts: true (current) vs explicit allowlist
    //   ['localhost', '127.0.0.1', /\.local$/] for tighter dev-server DNS-rebind protection.
    allowedHosts: true,
    cors: {
      origin: true,
      credentials: true,
    },
    proxy: {
      "/api": {
        target: "http://localhost:9242",
        changeOrigin: true,
        configure: (proxy) => {
          if (dashboardApiToken) {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("Authorization", `Bearer ${dashboardApiToken}`);
            });
          }
        },
      },
      "/live2d-assets": {
        target: "http://localhost:9242",
        changeOrigin: true,
      },
    },
  },
});
