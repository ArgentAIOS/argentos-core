/**
 * Helpers for authenticated Dashboard API calls from the gateway.
 */

/** Build headers for Dashboard API requests, injecting bearer token when available. */
export function dashboardApiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = process.env.DASHBOARD_API_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
