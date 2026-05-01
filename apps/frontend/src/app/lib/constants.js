export const HEARTBEAT_STALE_MS = Number(import.meta.env.VITE_HEARTBEAT_STALE_MS || 90000);
export const HEARTBEAT_UNSTABLE_MS = Number(import.meta.env.VITE_HEARTBEAT_UNSTABLE_MS || 180000);
export const REFRESH_INTERVAL_MS = Number(import.meta.env.VITE_DASHBOARD_REFRESH_MS || 5000);
export const PUBLIC_DASHBOARD_URL = String(
  import.meta.env.VITE_PUBLIC_SITE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "") ||
    "https://school-services.netlify.app"
).replace(/\/+$/, "");
export const GUEST_BRAND_ICON = "/icon.png";
export const AUTH_PATH = "/auth";
export const RESET_PASSWORD_PATH = "/auth/reset-password";
export const DASHBOARD_SECTIONS = new Set([
  "overview",
  "devices",
  "files",
  "activity",
  "accounts",
  "profile",
]);
