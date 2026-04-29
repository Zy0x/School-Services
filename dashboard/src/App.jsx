import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";

const HEARTBEAT_STALE_MS = Number(import.meta.env.VITE_HEARTBEAT_STALE_MS || 20000);
const REFRESH_INTERVAL_MS = Number(import.meta.env.VITE_DASHBOARD_REFRESH_MS || 5000);
const LOG_LIMIT = 120;
const JOB_LIMIT = 80;
const DEFAULT_SUPABASE_URL = "https://fgimyyicixazygairmsa.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnaW15eWljaXhhenlnYWlybXNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxODg1MjIsImV4cCI6MjA5Mjc2NDUyMn0.uZ0Cm_NxxcSXKaYE21wtob6xtY445S0I0y-v5i10NRo";
const PUBLIC_DASHBOARD_URL = String(
  import.meta.env.VITE_PUBLIC_SITE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "") ||
    "https://school-services.netlify.app"
).replace(/\/+$/, "");
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(
  /\/+$/,
  ""
);
const SUPABASE_ANON_KEY = String(
  import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY
);
const PAYPAL_URL = "https://paypal.me/theamagenta";
const TRAKTEER_URL = "https://trakteer.id/zy0x";
const GITHUB_PROFILE_URL = "https://github.com/Zy0x";
const GUEST_BRAND_ICON = "/icon.png";
const DASHBOARD_SECTIONS = new Set(["overview", "devices", "files", "activity", "accounts", "profile"]);

function parseAppRoute(pathname = "") {
  const path = String(pathname || "").replace(/\/+$/, "") || "/dashboard";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "dashboard") {
    return { section: "overview", deviceId: "" };
  }

  const section = DASHBOARD_SECTIONS.has(parts[1]) ? parts[1] : "overview";
  return {
    section,
    deviceId: section === "devices" ? decodeURIComponent(parts[2] || "") : "",
  };
}

function buildRoutePath(section = "overview", params = {}) {
  const safeSection = DASHBOARD_SECTIONS.has(section) ? section : "overview";
  if (safeSection === "devices" && params.deviceId) {
    return `/dashboard/devices/${encodeURIComponent(params.deviceId)}`;
  }
  return `/dashboard/${safeSection}`;
}

function getAllowedDashboardSections(role) {
  const sections = new Set(["overview", "devices", "activity", "profile"]);
  if (role === "super_admin") {
    sections.add("files");
    sections.add("accounts");
  }
  if (role === "operator") {
    sections.add("accounts");
  }
  return sections;
}

function getRouteCopy(section, role) {
  const fallback = {
    title: "Dashboard",
    subtitle: "Pantau status perangkat, layanan, dan aktivitas akun sesuai hak akses Anda.",
    kicker: "School Services",
  };
  const copies = {
    overview: {
      title: "Ringkasan Operasional",
      subtitle:
        role === "super_admin"
          ? "Pantau kesehatan fleet, akun, transfer data, dan layanan penting dari satu tempat."
          : role === "operator"
            ? "Kelola perangkat dan akun user di lingkungan Anda dengan batas akses yang aman."
            : "Lihat status device lokal, layanan yang tersedia, dan akses publik yang aktif.",
      kicker: role === "super_admin" ? "SuperAdmin Console" : role === "operator" ? "Operator Console" : "User Console",
    },
    devices: {
      title: "Perangkat & Layanan",
      subtitle: "Buka detail device, ubah alias pribadi, dan jalankan kontrol layanan sesuai role akun.",
      kicker: "Device Center",
    },
    files: {
      title: "File Remote",
      subtitle: "Akses file remote khusus SuperAdmin untuk preview, upload, dan download terkontrol.",
      kicker: "SuperAdmin Only",
    },
    activity: {
      title: "Aktivitas Sistem",
      subtitle: "Tinjau log operasional dan status job terbaru dengan filter yang mudah dibaca.",
      kicker: "Monitoring",
    },
    accounts: {
      title: role === "operator" ? "Akun Lingkungan" : "Akun & Lingkungan",
      subtitle:
        role === "operator"
          ? "Kelola referral, user, dan approval yang berada dalam lingkungan operator Anda."
          : "Atur policy approval, operator environment, akun user, dan akses perangkat.",
      kicker: "Access Control",
    },
    profile: {
      title: "Profil Akun",
      subtitle: "Periksa identitas akun, role, sesi aktif, dan pengaturan password Anda.",
      kicker: "Account",
    },
  };
  return copies[section] || fallback;
}

function buildGuestPath(deviceId) {
  return `/guest/${encodeURIComponent(String(deviceId || "").trim())}`;
}

function buildGuestUrl(deviceId) {
  return `${PUBLIC_DASHBOARD_URL}${buildGuestPath(deviceId)}`;
}

function buildDashboardUrl(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = String(value || "").trim();
    if (normalized) {
      search.set(key, normalized);
    }
  }
  const suffix = search.toString();
  return `${PUBLIC_DASHBOARD_URL}/${suffix ? `?${suffix}` : ""}`;
}

function getFunctionUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

function isInvalidSessionError(error) {
  const message = String(error?.message || error || "");
  return /invalid admin session|missing authorization header|jwt|unauthorized/i.test(message);
}

function isSamePasswordError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || error || "").trim().toLowerCase();
  return (
    code === "same_password" ||
    /same password|different password|password.*same|different from the one currently used/i.test(message)
  );
}

function formatEdgeFunctionError(error) {
  const message = String(error?.message || error || "Unknown error");
  if (/email rate limit exceeded/i.test(message)) {
    return "Terlalu banyak permintaan reset password. Coba lagi beberapa menit lagi.";
  }
  if (/invalid login credentials/i.test(message)) {
    return "Email atau password belum sesuai. Periksa kembali lalu coba masuk lagi.";
  }
  if (isInvalidSessionError(message)) {
    return "Sesi login telah berakhir. Silakan masuk lagi.";
  }
  if (/missing authorization header/i.test(message)) {
    return "Sesi Anda tidak lagi valid. Silakan masuk kembali.";
  }
  if (/failed to fetch|networkerror/i.test(message)) {
    return "Koneksi ke layanan sedang bermasalah. Periksa internet Anda lalu coba lagi.";
  }
  return message || "Permintaan belum berhasil diproses. Silakan coba lagi.";
}

function formatSignInError(error) {
  const message = String(error?.message || error || "");
  if (/invalid login credentials/i.test(message)) {
    return "Email atau password belum sesuai. Coba lagi atau gunakan fitur lupa password.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Email akun belum terverifikasi. Periksa inbox Anda lalu coba masuk kembali.";
  }
  if (/too many requests|rate limit/i.test(message)) {
    return "Terlalu banyak percobaan masuk. Tunggu sebentar lalu coba kembali.";
  }
  return formatEdgeFunctionError(message);
}

function formatPasswordUpdateError(error) {
  if (isInvalidSessionError(error)) {
    return "Sesi login telah berakhir. Silakan masuk lagi.";
  }
  if (isSamePasswordError(error)) {
    return "Password baru tidak boleh sama dengan password yang lama.";
  }
  return String(error?.message || error || "Gagal memperbarui password.");
}

function clearStoredAuthArtifacts() {
  if (typeof window === "undefined") {
    return;
  }

  const storages = [window.localStorage, window.sessionStorage];
  for (const storage of storages) {
    if (!storage) {
      continue;
    }
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key) {
        continue;
      }
      if (/^sb-.*(auth-token|code-verifier)/i.test(key)) {
        storage.removeItem(key);
      }
    }
  }
}

async function invokeEdgeFunction(name, body, session = null) {
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
  };

  const response = await fetch(getFunctionUrl(name), {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(
      payload?.error ||
        payload?.message ||
        `Edge Function returned HTTP ${response.status}.`
    );
  }

  return payload;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function getJobStatusDetail(job) {
  if (job?.status === "running" && job?.result?.pendingUpload) {
    return "Local archive is ready. Waiting for internet connection to upload.";
  }

  if (job?.status === "completed" && Array.isArray(job?.result?.parts) && job.result.parts.length > 1) {
    return `Archive is ready in ${job.result.parts.length} parts. Download all parts to reconstruct the full backup.`;
  }

  if (job?.status === "completed" && job?.artifact_bucket && job?.artifact_object_key) {
    return "Artifact uploaded and ready to download.";
  }

  return "";
}

function formatRelativeTime(value, now = Date.now()) {
  if (!value) {
    return "never";
  }

  const deltaMs = new Date(value).getTime() - now;
  if (Number.isNaN(deltaMs)) {
    return "-";
  }

  const absoluteMs = Math.abs(deltaMs);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absoluteMs < 60000) {
    return rtf.format(Math.round(deltaMs / 1000), "second");
  }

  if (absoluteMs < 3600000) {
    return rtf.format(Math.round(deltaMs / 60000), "minute");
  }

  if (absoluteMs < 86400000) {
    return rtf.format(Math.round(deltaMs / 3600000), "hour");
  }

  return rtf.format(Math.round(deltaMs / 86400000), "day");
}

function getFileKindLabel(item) {
  if (!item) {
    return "-";
  }
  if (item.type === "directory") {
    return "Folder";
  }
  const extension = String(item.name || "").split(".").pop();
  if (!extension || extension === item.name) {
    return "File";
  }
  return `${extension.toUpperCase()} file`;
}

function getItemGlyph(item) {
  if (!item) {
    return "ITEM";
  }
  if (item.type === "directory") {
    return "DIR";
  }
  const extension = String(item.name || "").toLowerCase().split(".").pop();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    return "IMG";
  }
  if (["zip", "rar", "7z"].includes(extension)) {
    return "ZIP";
  }
  if (["pdf"].includes(extension)) {
    return "PDF";
  }
  if (["txt", "md", "log", "json", "env", "ini", "sql"].includes(extension)) {
    return "TXT";
  }
  return "FILE";
}

function buildBreadcrumbs(targetPath) {
  const value = String(targetPath || "").trim();
  if (!value) {
    return [];
  }

  const normalized = value.replace(/\//g, "\\");
  const match = normalized.match(/^([A-Za-z]:\\)(.*)$/);
  if (!match) {
    return [{ label: normalized, path: normalized }];
  }

  const root = match[1];
  const rest = match[2];
  const parts = rest.split("\\").filter(Boolean);
  const crumbs = [{ label: root.replace(/\\$/, ""), path: root }];
  let cursor = root;

  for (const part of parts) {
    cursor = cursor.endsWith("\\") ? `${cursor}${part}` : `${cursor}\\${part}`;
    crumbs.push({ label: part, path: cursor });
  }

  return crumbs;
}

function isFresh(timestamp) {
  if (!timestamp) {
    return false;
  }
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) && Date.now() - parsed <= HEARTBEAT_STALE_MS;
}

function deriveDeviceStatus(deviceRecord) {
  if (!deviceRecord) {
    return "offline";
  }
  if (deviceRecord.status === "blocked") {
    return "blocked";
  }
  return isFresh(deviceRecord.last_seen) ? "online" : "offline";
}

function deriveServiceStatus(row, deviceStatus) {
  if (deviceStatus === "offline") {
    return "offline";
  }
  if (deviceStatus === "blocked") {
    return "blocked";
  }
  return row.status || "unknown";
}

function getPublicUrlLabel(service) {
  if (!service?.public_url) {
    return "Public URL";
  }

  if (service.serviceStatus === "offline") {
    return "Last known URL";
  }

  if (service.serviceStatus === "waiting_retry" || service.serviceStatus === "starting") {
    return "Reconnecting URL";
  }

  return "Public URL";
}

function statusTone(status) {
  if (status === "pending_setup") {
    return "warn";
  }
  if (
    [
      "running",
      "completed",
      "online",
      "ready",
      "super_admin",
      "approved",
      "available",
      "connected",
    ].includes(status)
  ) {
    return "good";
  }
  if (
    [
      "waiting_retry",
      "starting",
      "partial",
      "pending",
      "running_job",
      "reconnecting",
      "stopped",
      "idle",
      "degraded",
    ].includes(status)
  ) {
    return "warn";
  }
  if (
    [
      "error",
      "failed",
      "blocked",
      "offline",
      "missing",
      "cancelled",
      "expired",
      "disabled",
      "rejected",
      "unavailable",
    ].includes(status)
  ) {
    return "bad";
  }
  return "neutral";
}

function StatusChip({ status, label }) {
  return (
    <span className={`status-chip tone-${statusTone(status)}`}>
      {label || String(status || "unknown").replace(/_/g, " ")}
    </span>
  );
}

function InfoHint({ text }) {
  return (
    <span className="info-hint" tabIndex={0} aria-label={text}>
      i
      <span className="info-hint-bubble">{text}</span>
    </span>
  );
}

function ActionButton({
  children,
  busy = false,
  className = "secondary-button",
  disabled = false,
  ...props
}) {
  return (
    <button type="button" className={`${className} action-button`} disabled={disabled || busy} {...props}>
      {busy ? <span className="button-spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function NavIcon({ section }) {
  const paths = {
    overview: "M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-5H4v5Zm10 0h6v-8h-6v8Z",
    devices: "M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v8A2.5 2.5 0 0 1 16.5 17H14v2h2.5a1 1 0 1 1 0 2h-9a1 1 0 1 1 0-2H10v-2H7.5A2.5 2.5 0 0 1 5 14.5v-8Zm2.5-.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-9Z",
    files: "M4 6.5A2.5 2.5 0 0 1 6.5 4h4.2l2 2H17.5A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-9Z",
    activity: "M5 12h3l2-6 4 12 2-6h3a1 1 0 1 0 0-2h-4.4l-.6 1.8L10 0 6.6 10H5a1 1 0 1 0 0 2Z",
    accounts: "M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 18.5C3 15.5 5.5 13 8.5 13s5.5 2.5 5.5 5.5V20H3v-1.5Zm12.5.2c0-1.7-.6-3.3-1.7-4.5.5-.1 1.1-.2 1.7-.2A4.5 4.5 0 0 1 20 18.5V20h-4.5v-1.3Z",
    profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z",
  };

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[section] || paths.overview} />
    </svg>
  );
}

function getDashboardNavItems({ isSuperAdmin, isOperator, deviceCount, pendingAccounts, runningJobs }) {
  return [
    { id: "overview", label: "Ringkasan", helper: "Status utama", badge: deviceCount },
    { id: "devices", label: "Perangkat", helper: "Alias, service, link", badge: deviceCount },
    ...(isSuperAdmin ? [{ id: "files", label: "File Remote", helper: "Akses khusus", badge: runningJobs }] : []),
    { id: "activity", label: "Aktivitas", helper: "Log dan job", badge: runningJobs },
    ...((isSuperAdmin || isOperator)
      ? [{ id: "accounts", label: "Akun", helper: "User dan referral", badge: pendingAccounts }]
      : []),
    { id: "profile", label: "Profil", helper: "Akun dan password" },
  ];
}

function SidebarNav({ profile, activeSection, items, onNavigate, onTransferHistory }) {
  return (
    <aside className="app-sidebar" aria-label="Navigasi dashboard">
      <div className="app-sidebar-brand">
        <img src={GUEST_BRAND_ICON} alt="" aria-hidden="true" />
        <div>
          <strong>School Services</strong>
          <span>{profile.role.replace(/_/g, " ")}</span>
        </div>
      </div>
      <nav className="app-nav-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`app-nav-item ${activeSection === item.id ? "app-nav-item-active" : ""}`}
            aria-current={activeSection === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <NavIcon section={item.id} />
            <span className="app-nav-copy">
              <strong>{item.label}</strong>
              <small>{item.helper}</small>
            </span>
            {Number(item.badge || 0) > 0 ? <span className="app-nav-badge">{item.badge}</span> : null}
          </button>
        ))}
      </nav>
      {profile.role === "super_admin" ? (
        <button type="button" className="app-sidebar-cta" onClick={onTransferHistory}>
          <span>Riwayat Transfer</span>
          <small>Lihat upload dan download terbaru</small>
        </button>
      ) : null}
    </aside>
  );
}

function MobileNav({ activeSection, items, onNavigate }) {
  return (
    <nav className="mobile-nav" aria-label="Navigasi mobile">
      {items.slice(0, 5).map((item) => (
        <button
          key={item.id}
          type="button"
          className={`mobile-nav-item ${activeSection === item.id ? "mobile-nav-item-active" : ""}`}
          aria-current={activeSection === item.id ? "page" : undefined}
          onClick={() => onNavigate(item.id)}
        >
          <NavIcon section={item.id} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function RouteHeader({ route, profile, channelState, loading, authLoading, onRefresh, onSignOut }) {
  const copy = getRouteCopy(route.section, profile.role);
  return (
    <header className="app-route-header">
      <div>
        <div className="route-kicker">{copy.kicker}</div>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </div>
      <div className="topbar-actions">
        <StatusChip status={channelState || "connecting"} label={channelState || "connecting"} />
        <ActionButton className="secondary-button" busy={loading} onClick={onRefresh}>
          Refresh
        </ActionButton>
        <ActionButton className="secondary-button" busy={authLoading} onClick={onSignOut}>
          Log Out
        </ActionButton>
      </div>
    </header>
  );
}

function DashboardStats({ devices, fileJobs, accounts, now }) {
  const onlineDevices = devices.filter((device) => device.deviceStatus !== "offline").length;
  const runningServices = devices.reduce((total, device) => total + device.runningCount, 0);
  const issueCount = devices.reduce((total, device) => total + device.issueCount, 0);
  const runningJobs = fileJobs.filter((job) => ["pending", "running"].includes(job.status)).length;
  const pendingAccounts = accounts.filter((account) => account.status === "pending").length;

  return (
    <section className="dashboard-stats-grid" aria-label="Ringkasan dashboard">
      {[
        ["Device aktif", `${onlineDevices}/${devices.length}`, "Perangkat yang masih mengirim heartbeat."],
        ["Service running", runningServices, "Total service lokal yang sedang berjalan."],
        ["Perlu perhatian", issueCount, "Service atau device yang offline, error, atau path belum lengkap."],
        ["Transfer berjalan", runningJobs, "Job upload/download yang masih diproses."],
        ["Akun pending", pendingAccounts, "Akun yang menunggu approval."],
      ].map(([label, value, helper]) => (
        <article key={label} className="dashboard-stat-card">
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{helper}</small>
        </article>
      ))}
      <article className="dashboard-stat-card">
        <span>Update data</span>
        <strong>{formatRelativeTime(new Date(now).toISOString(), now)}</strong>
        <small>Dashboard refresh otomatis tanpa mengganti halaman.</small>
      </article>
    </section>
  );
}

function DeviceGrid({ devices, selectedDeviceId, onOpen, now }) {
  return (
    <section className="device-grid" aria-label="Daftar perangkat">
      {devices.map((device) => (
        <button
          key={device.deviceId}
          type="button"
          className={`device-grid-card ${selectedDeviceId === device.deviceId ? "device-grid-card-active" : ""}`}
          onClick={() => onOpen(device.deviceId)}
        >
          <span className="device-grid-top">
            <strong>{device.deviceName}</strong>
            <StatusChip status={device.deviceStatus} />
          </span>
          <span className="mono">{device.deviceId}</span>
          <span className="device-grid-meta">
            {device.runningCount} service running · {device.issueCount} perlu perhatian ·{" "}
            {formatRelativeTime(device.deviceRecord?.last_seen, now)}
          </span>
        </button>
      ))}
    </section>
  );
}

function SupportIcon({ kind }) {
  if (kind === "github") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.21.68-.47v-1.66c-2.77.6-3.35-1.17-3.35-1.17-.45-1.13-1.1-1.43-1.1-1.43-.9-.61.07-.6.07-.6 1 .07 1.52 1 1.52 1 .88 1.51 2.3 1.07 2.87.82.09-.63.35-1.07.63-1.31-2.21-.25-4.54-1.11-4.54-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.28.1-2.66 0 0 .84-.27 2.75 1.03a9.45 9.45 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.41.1 2.66.64.7 1.03 1.6 1.03 2.69 0 3.84-2.33 4.69-4.56 4.94.36.31.68.92.68 1.85v2.74c0 .26.18.57.69.47A10 10 0 0 0 12 2Z"
        />
      </svg>
    );
  }
  if (kind === "paypal") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M7.22 20.48H3.8a.78.78 0 0 1-.77-.9L5.7 3.14A1.33 1.33 0 0 1 7 2h6.17c2.21 0 3.87.47 4.93 1.4.92.82 1.35 2.01 1.35 3.55 0 1.66-.49 3.02-1.45 4.04-.97 1.02-2.37 1.65-4.17 1.87-.14.02-.26.11-.29.25l-.13.72-.93 5.83a1 1 0 0 1-.98.82H8.86l.48-3.03a.78.78 0 0 1 .77-.66h1.26c2.79 0 4.97-1.14 5.61-4.44.02-.1.03-.2.04-.29-.61.29-1.34.47-2.21.57-.84.1-1.68.15-2.52.15H9.66a.78.78 0 0 0-.77.66l-1.67 10.44Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.01 2c2.48 0 4.46.62 5.93 1.87 1.48 1.25 2.22 2.95 2.22 5.1 0 1.95-.58 3.44-1.74 4.48-1.16 1.04-2.75 1.55-4.79 1.55h-.88l-.4 2.48h-2.8l1.94-12.32h3.95c1.77 0 2.66.7 2.66 2.1 0 .95-.31 1.73-.93 2.32-.62.59-1.47.89-2.55.89h-1.26l-.23 1.43h.62c2.84 0 4.26-1.18 4.26-3.53 0-1-.33-1.74-1-2.22-.67-.48-1.62-.72-2.87-.72h-4.9L6.35 22h5.52l.65-4.05h1.08c2.93 0 5.22-.76 6.88-2.28 1.66-1.52 2.49-3.7 2.49-6.54 0-2.39-.95-4.31-2.86-5.75C18.21 1.46 15.53.74 12.01.74V2Z"
      />
    </svg>
  );
}

async function copyTextToClipboard(text) {
  if (!text) {
    throw new Error("Tidak ada tautan yang bisa disalin.");
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "readonly");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function buildWhatsAppShareUrl(url, label = "Link publik") {
  const text = `${label}\n${url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function getGuestStatusModel(device, service) {
  const deviceStatus = device?.deviceStatus || "offline";
  const serviceStatus =
    deviceStatus === "blocked"
      ? "blocked"
      : deviceStatus === "pending_setup"
        ? "pending_setup"
      : deviceStatus === "offline"
        ? "offline"
        : service?.status || "unknown";
  const desiredState = service?.desired_state || "unknown";
  const hasPublicUrl = Boolean(service?.public_url);
  const ready =
    deviceStatus === "online" &&
    serviceStatus === "running" &&
    desiredState !== "stopped" &&
    hasPublicUrl;

  if (deviceStatus === "blocked") {
    return {
      overallStatus: "blocked",
      headline: "Akses perangkat dibatasi",
      description:
        "Perangkat terdeteksi tetapi aksesnya sedang dibatasi. Hubungi pengelola sistem untuk mengaktifkan kembali layanan publik.",
      publicStatus: "disabled",
      publicLabel: "Akses publik dibatasi",
      runtimeLabel: "Perangkat diblokir",
      runtimeChipLabel: "blocked",
      ready,
    };
  }

  if (deviceStatus === "pending_setup") {
    return {
      overallStatus: "pending_setup",
      headline: "Menunggu perangkat pertama kali terhubung",
      description:
        "Shortcut sudah siap. Buka aplikasi School Services di komputer ini dan tunggu sampai agent mendaftarkan perangkat serta layanan E-Rapor.",
      publicStatus: "disabled",
      publicLabel: "URL publik belum tersedia",
      runtimeLabel: "Menunggu agent",
      runtimeChipLabel: "setup awal",
      ready: false,
    };
  }

  if (deviceStatus === "offline") {
    return {
      overallStatus: "offline",
      headline: "Perangkat belum terhubung",
      description:
        "Sistem belum menerima heartbeat terbaru dari perangkat. Pastikan aplikasi School Services berjalan dan koneksi jaringan perangkat stabil.",
      publicStatus: hasPublicUrl ? "unavailable" : "disabled",
      publicLabel: hasPublicUrl ? "URL terakhir tersimpan" : "URL publik belum tersedia",
      runtimeLabel: "Agent belum terhubung",
      runtimeChipLabel: "offline",
      ready,
    };
  }

  if (ready) {
    return {
      overallStatus: "ready",
      headline: "E-Rapor siap digunakan",
      description:
        "Perangkat terhubung, layanan E-Rapor sedang berjalan, dan tautan publik siap dibuka dari browser mana pun yang memiliki izin akses.",
      publicStatus: "ready",
      publicLabel: "URL publik aktif",
      runtimeLabel: "Layanan running",
      runtimeChipLabel: "running",
      ready,
    };
  }

  if (serviceStatus === "starting") {
    return {
      overallStatus: "starting",
      headline: "E-Rapor sedang disiapkan",
      description:
        "Permintaan start sudah diterima. Agent sedang menyiapkan proses lokal dan menunggu layanan siap menerima koneksi.",
      publicStatus: hasPublicUrl ? "reconnecting" : "starting",
      publicLabel: hasPublicUrl ? "URL lama masih tersimpan" : "Menunggu URL publik",
      runtimeLabel: "Sedang memulai layanan",
      runtimeChipLabel: "starting",
      ready,
    };
  }

  if (serviceStatus === "waiting_retry") {
    return {
      overallStatus: "reconnecting",
      headline: "Tautan publik sedang dipulihkan",
      description:
        "Layanan lokal sudah merespons, tetapi koneksi publik masih melakukan pemulihan. Halaman ini akan menampilkan status terbaru secara berkala.",
      publicStatus: "waiting_retry",
      publicLabel: "Tunnel sedang retry",
      runtimeLabel: "Layanan lokal tersedia",
      runtimeChipLabel: "waiting retry",
      ready,
    };
  }

  if (serviceStatus === "running" && !hasPublicUrl) {
    return {
      overallStatus: "degraded",
      headline: "Layanan aktif, tautan publik belum siap",
      description:
        "Proses utama E-Rapor sudah berjalan di perangkat, tetapi publikasi tautan akses masih menunggu sinkronisasi.",
      publicStatus: "starting",
      publicLabel: "Menunggu URL publik",
      runtimeLabel: "Service running",
      runtimeChipLabel: "running",
      ready,
    };
  }

  if (serviceStatus === "error") {
    return {
      overallStatus: "error",
      headline: "Layanan memerlukan perhatian",
      description:
        "Sistem mendeteksi gangguan pada layanan atau koneksi publik. Periksa ringkasan error di bawah untuk langkah tindak lanjut.",
      publicStatus: hasPublicUrl ? "unavailable" : "disabled",
      publicLabel: hasPublicUrl ? "URL publik belum stabil" : "URL publik belum tersedia",
      runtimeLabel: "Layanan mengalami error",
      runtimeChipLabel: "error",
      ready,
    };
  }

  if (desiredState === "stopped" || serviceStatus === "stopped") {
    return {
      overallStatus: "stopped",
      headline: "Layanan belum dijalankan",
      description:
        "Perangkat sudah online, tetapi layanan E-Rapor belum aktif. Tekan Start Service untuk menyalakan layanan dari halaman ini.",
      publicStatus: hasPublicUrl ? "unavailable" : "disabled",
      publicLabel: hasPublicUrl ? "URL lama tersimpan" : "Belum ada URL publik",
      runtimeLabel: "Layanan berhenti",
      runtimeChipLabel: "stopped",
      ready,
    };
  }

  return {
    overallStatus: serviceStatus,
    headline: "Status layanan sedang diperiksa",
    description:
      "Halaman ini memantau heartbeat perangkat, kesiapan layanan, dan status tautan publik untuk membantu pengguna mengetahui kondisi akses terbaru.",
    publicStatus: hasPublicUrl ? "available" : "disabled",
    publicLabel: hasPublicUrl ? "URL publik tersedia" : "Belum ada URL publik",
    runtimeLabel: "Menunggu pembaruan status",
    runtimeChipLabel: serviceStatus,
    ready,
  };
}

function PublicLinkActions({
  url,
  label = "Link publik",
  compact = false,
  onActionComplete = null,
}) {
  const [feedback, setFeedback] = useState("");
  const disabled = !url;

  async function handleCopy() {
    if (!url) {
      return;
    }

    try {
      await copyTextToClipboard(url);
      setFeedback("Tautan berhasil disalin.");
      if (typeof onActionComplete === "function") {
        onActionComplete("");
      }
    } catch (error) {
      const message = error?.message || "Gagal menyalin tautan.";
      setFeedback("");
      if (typeof onActionComplete === "function") {
        onActionComplete(message);
      }
    }
  }

  function handleWhatsAppShare() {
    if (!url) {
      return;
    }

    window.open(buildWhatsAppShareUrl(url, label), "_blank", "noopener,noreferrer");
    setFeedback("Tautan siap dibagikan lewat WhatsApp.");
    if (typeof onActionComplete === "function") {
      onActionComplete("");
    }
  }

  return (
    <div className={`link-action-stack ${compact ? "link-action-stack-compact" : ""}`}>
      <div className="panel-actions public-link-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={handleCopy}
        >
          Salin link
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={handleWhatsAppShare}
        >
          Bagikan WA
        </button>
      </div>
      {feedback ? <div className="micro-feedback">{feedback}</div> : null}
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-copy">
        <strong>School Services v2.0.0</strong>
        <p>
          Monitor layanan sekolah dan akses publik E-Rapor dalam satu panel yang rapi,
          responsif, dan mudah dipahami oleh tim operasional maupun pengguna umum.
        </p>
      </div>
      <div className="support-cluster">
        <div className="support-cluster-copy">
          <span className="section-eyebrow">Buy Me a Coffee</span>
          <strong>Dukung pengembangan School Services</strong>
        </div>
        <div className="site-footer-actions">
        <a
          className="secondary-button footer-link-button support-link-button"
          href={GITHUB_PROFILE_URL}
          target="_blank"
          rel="noreferrer"
        >
          <SupportIcon kind="github" />
          Support GitHub
        </a>
        <a
          className="secondary-button footer-link-button support-link-button"
          href={PAYPAL_URL}
          target="_blank"
          rel="noreferrer"
        >
          <SupportIcon kind="paypal" />
          PayPal
        </a>
        <a
          className="secondary-button footer-link-button support-link-button"
          href={TRAKTEER_URL}
          target="_blank"
          rel="noreferrer"
        >
          <SupportIcon kind="trakteer" />
          Trakteer
        </a>
        </div>
      </div>
    </footer>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled = false,
  visible = null,
  onToggleVisibility = null,
}) {
  const [localVisible, setLocalVisible] = useState(false);
  const controlled = typeof visible === "boolean";
  const isVisible = controlled ? visible : localVisible;

  function toggleVisibility() {
    if (typeof onToggleVisibility === "function") {
      onToggleVisibility();
      return;
    }
    setLocalVisible((current) => !current);
  }

  return (
    <label className="password-field">
      {label ? <span>{label}</span> : null}
      <div className="password-input-shell">
        <input
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={isVisible ? "Sembunyikan password" : "Lihat password"}
          aria-pressed={isVisible}
          onClick={toggleVisibility}
          disabled={disabled}
        >
          {isVisible ? "Sembunyikan" : "Lihat"}
        </button>
      </div>
    </label>
  );
}

function LoginScreen({
  mode,
  email,
  password,
  displayName,
  role,
  registrationMode,
  referralCode,
  setEmail,
  setPassword,
  setDisplayName,
  setRole,
  setRegistrationMode,
  setReferralCode,
  setMode,
  onSubmit,
  onForgotPassword,
  error,
  info,
  loading,
}) {
  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-eyebrow">School Services Access</div>
        <h1>Kelola akses perangkat dan layanan sekolah</h1>
        <p>
          Masuk untuk memantau status layanan, mengelola akses perangkat sesuai peran,
          dan membuka E-Rapor dengan kontrol yang sesuai kebutuhan operasional Anda.
        </p>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              autoComplete="username"
            />
          </label>
          {mode === "register" ? (
            <>
              <label>
                <span>Display name</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Nama pengguna"
                />
              </label>
              <label>
                <span>Peran akun</span>
                <select value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="operator">Operator</option>
                  <option value="user">User</option>
                </select>
              </label>
              {role === "user" ? (
                <>
                  <label>
                    <span>Jalur pendaftaran</span>
                    <select
                      value={registrationMode}
                      onChange={(event) => setRegistrationMode(event.target.value)}
                    >
                      <option value="referral_code">Gabung ke lingkungan operator</option>
                      <option value="direct_superadmin">Daftar langsung ke SuperAdmin</option>
                    </select>
                  </label>
                  {registrationMode === "referral_code" ? (
                    <label>
                      <span>Kode lingkungan operator</span>
                      <input
                        type="text"
                        value={referralCode}
                        onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
                        placeholder="Contoh: ABCD123456"
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          <PasswordField
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === "register" ? "Buat password akun" : "Password super admin"}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            disabled={loading}
          />
          {error ? <div className="error-banner">{error}</div> : null}
          {info ? <div className="explorer-warning">{info}</div> : null}
          <button className="primary-button login-button" disabled={loading} type="submit">
            {loading
              ? mode === "register"
                ? "Memproses pendaftaran..."
                : "Masuk..."
              : mode === "register"
                ? "Ajukan akses"
                : "Masuk"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setMode(mode === "register" ? "login" : "register")}
          >
            {mode === "register" ? "Kembali ke login" : "Belum punya akun?"}
          </button>
          {mode === "login" ? (
            <button
              type="button"
              className="secondary-button"
              onClick={onForgotPassword}
              disabled={loading || !email}
            >
              Lupa password
            </button>
          ) : null}
        </form>
      </div>
    </main>
  );
}

function AccountStatusScreen({ profile, onSignOut }) {
  const label =
    !profile
      ? "Profil akun belum ditemukan. Silakan masuk ulang atau hubungi pengelola sistem."
      : profile?.status === "pending"
      ? "Akses akun Anda masih diproses. Silakan pantau kembali halaman ini setelah jadwal persetujuan berjalan."
      : profile?.status === "rejected"
        ? "Permintaan akun Anda belum dapat disetujui. Hubungi pengelola lingkungan atau SuperAdmin untuk tindak lanjut."
        : "Akun Anda sedang dinonaktifkan. Hubungi pengelola sistem bila perlu aktivasi ulang.";

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-eyebrow">Account Access</div>
        <h1>{profile?.display_name || profile?.email || "Account"}</h1>
        <p>{label}</p>
        {profile?.approval_due_at ? (
          <div className="explorer-warning">
            Estimasi persetujuan otomatis: {formatRelativeTime(profile.approval_due_at)}
          </div>
        ) : null}
        <div className="panel-actions" style={{ marginTop: 16 }}>
          <StatusChip status={profile?.status || "unknown"} />
          {profile?.role ? <StatusChip status={profile.role} /> : null}
        </div>
        <div className="panel-actions" style={{ marginTop: 20 }}>
          <ActionButton className="secondary-button" onClick={onSignOut}>
            Log Out
          </ActionButton>
        </div>
      </div>
    </main>
  );
}

function ProfilePanel({ profile, session, onSignOut }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNextPasswords, setShowNextPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submitPasswordChange() {
    const trimmedCurrentPassword = currentPassword.trim();
    const trimmedPassword = nextPassword.trim();

    if (!trimmedCurrentPassword) {
      setError("Password saat ini wajib diisi.");
      setInfo("");
      return;
    }

    if (trimmedPassword.length < 8) {
      setError("Password baru minimal 8 karakter.");
      setInfo("");
      return;
    }

    if (trimmedCurrentPassword === trimmedPassword) {
      setError("Password baru tidak boleh sama dengan password saat ini.");
      setInfo("");
      return;
    }

    if (trimmedPassword !== confirmPassword.trim()) {
      setError("Konfirmasi password tidak cocok.");
      setInfo("");
      return;
    }

    try {
      setBusy(true);
      setError("");
      setInfo("");
      const { error: updateError } = await supabase.auth.updateUser({
        password: trimmedPassword,
        currentPassword: trimmedCurrentPassword,
      });
      if (updateError) {
        throw updateError;
      }
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setInfo("Password berhasil diperbarui.");
    } catch (updateError) {
      if (isInvalidSessionError(updateError)) {
        setError("Sesi login telah berakhir. Silakan masuk lagi.");
        onSignOut();
        return;
      }
      setError(formatPasswordUpdateError(updateError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-stack">
      <article className="service-panel">
        <div className="panel-heading-row">
          <h3>Profil Akun</h3>
          <div className="service-status-group">
            <StatusChip status={profile?.status || "unknown"} />
            {profile?.role ? <StatusChip status={profile.role} /> : null}
          </div>
        </div>
        <div className="service-detail-grid">
          <div>
            <span>Nama</span>
            <strong>{profile?.display_name || "-"}</strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{profile?.email || session?.user?.email || "-"}</strong>
          </div>
          <div>
            <span>User ID</span>
            <strong className="mono">{session?.user?.id || "-"}</strong>
          </div>
        </div>
      </article>

      <article className="service-panel">
        <div className="panel-heading-row">
          <h3>Ganti Password</h3>
        </div>
        <div className="service-detail-grid">
          <PasswordField
            label="Password saat ini"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="Masukkan password saat ini"
            autoComplete="current-password"
            disabled={busy}
          />
          <PasswordField
            label="Password baru"
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
            placeholder="Minimal 8 karakter"
            autoComplete="new-password"
            disabled={busy}
            visible={showNextPasswords}
            onToggleVisibility={() => setShowNextPasswords((current) => !current)}
          />
          <PasswordField
            label="Konfirmasi password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Ulangi password baru"
            autoComplete="new-password"
            disabled={busy}
            visible={showNextPasswords}
            onToggleVisibility={() => setShowNextPasswords((current) => !current)}
          />
          <div>
            <span>Aksi akun</span>
            <div className="panel-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy || !currentPassword || !nextPassword || !confirmPassword}
                onClick={submitPasswordChange}
              >
                {busy ? "Menyimpan..." : "Simpan password"}
              </button>
              <button type="button" className="secondary-button" disabled={busy} onClick={onSignOut}>
                Logout bersih
              </button>
            </div>
          </div>
        </div>
        {error ? <div className="job-error">{error}</div> : null}
        {info ? <div className="service-note">{info}</div> : null}
      </article>
    </section>
  );
}

function GuestConsole({ deviceId }) {
  const [state, setState] = useState({ device: null, service: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [commandModal, setCommandModal] = useState({
    open: false,
    action: "",
    title: "",
    message: "",
  });

  async function loadGuest(options = {}) {
    const silent = Boolean(options.silent);
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const { data, error: invokeError } = await supabase.functions.invoke("guest-access", {
        body: { action: "status", deviceId },
      });
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.ok) {
        throw new Error(data?.error || "Guest access failed.");
      }
      setState({ device: data.device, service: data.service });
      setError("");
    } catch (nextError) {
      setError(formatEdgeFunctionError(nextError));
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadGuest();
    const refreshId = window.setInterval(() => loadGuest({ silent: true }), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(refreshId);
  }, [deviceId]);

  useEffect(() => {
    const channel = supabase
      .channel(`guest-console:${deviceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices", filter: `device_id=eq.${deviceId}` },
        () => loadGuest({ silent: true })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "services", filter: `device_id=eq.${deviceId}` },
        () => loadGuest({ silent: true })
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId]);

  async function sendCommand(action) {
    try {
      setBusy(true);
      setCommandModal({
        open: true,
        action,
        title: action === "start" ? "Menyalakan layanan E-Rapor" : "Menghentikan layanan E-Rapor",
        message:
          action === "start"
            ? "Permintaan sedang dikirim ke perangkat. Status halaman akan diperbarui otomatis setelah agent merespons."
            : "Perintah stop sedang dikirim. Tunggu beberapa saat sampai status layanan berubah.",
      });
      const { data, error: invokeError } = await supabase.functions.invoke("guest-access", {
        body: { action, deviceId },
      });
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.ok) {
        throw new Error(data?.error || "Guest command failed.");
      }
      await loadGuest({ silent: true });
      setCommandModal((current) => ({
        ...current,
        message:
          action === "start"
            ? "Permintaan start sudah diterima. Jika koneksi perangkat aktif, badge status akan segera berubah menjadi siap."
            : "Permintaan stop sudah diterima. Halaman akan menampilkan status terbaru begitu agent selesai memproses.",
      }));
      window.setTimeout(() => {
        setCommandModal((current) => ({ ...current, open: false }));
      }, 1200);
    } catch (nextError) {
      setError(formatEdgeFunctionError(nextError));
      setCommandModal((current) => ({
        ...current,
        open: true,
        message: formatEdgeFunctionError(nextError),
      }));
    } finally {
      setBusy(false);
    }
  }

  const service = state.service;
  const guestStatus = getGuestStatusModel(state.device, service);
  const canOpenService = guestStatus.ready;
  const isRunning = service?.status === "running" && service?.desired_state !== "stopped";
  const loginUrl = buildDashboardUrl({
    mode: "login",
    linkDeviceId: deviceId,
    guestDeviceId: deviceId,
  });
  const registerUrl = buildDashboardUrl({
    mode: "register",
    linkDeviceId: deviceId,
    guestDeviceId: deviceId,
  });

  return (
    <main className="console-shell guest-console-shell">
      <header className="guest-nav">
        <div className="guest-brand">
          <img className="guest-brand-mark guest-brand-image" src={GUEST_BRAND_ICON} alt="School Services" />
          <div>
            <div className="section-eyebrow">School Services</div>
            <strong>Guest Access Monitor</strong>
          </div>
        </div>
        <div className="guest-nav-actions">
          <a className="secondary-button footer-link-button" href={loginUrl}>
            Login
          </a>
          <a className="primary-button footer-link-button" href={registerUrl}>
            Register
          </a>
        </div>
      </header>

      <section className="guest-hero">
        <div className="guest-hero-copy">
          <div className="section-eyebrow">Guest Device Monitor</div>
          <h1>{state.device?.deviceName || deviceId}</h1>
          <p>{guestStatus.description}</p>
          <div className="guest-hero-badges">
            <StatusChip
              status={state.device?.deviceStatus || "offline"}
              label={
                state.device?.deviceStatus === "pending_setup"
                  ? "Perangkat setup awal"
                  : `Perangkat ${state.device?.deviceStatus || "offline"}`
              }
            />
            <StatusChip
              status={guestStatus.overallStatus === "pending_setup" ? "pending_setup" : service?.status || "offline"}
              label={
                guestStatus.overallStatus === "pending_setup"
                  ? "Layanan menunggu"
                  : `Layanan ${service?.status || "offline"}`
              }
            />
            <StatusChip
              status={guestStatus.publicStatus}
              label={guestStatus.publicLabel}
            />
          </div>
        </div>
        <div className="guest-hero-actions">
          <StatusChip status={guestStatus.overallStatus} label={guestStatus.headline} />
          <button
            type="button"
            className={`secondary-button ${refreshing ? "button-busy" : ""}`}
            onClick={() => loadGuest({ silent: true })}
            disabled={refreshing}
          >
            {refreshing ? "Menyegarkan..." : "Refresh"}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace guest-workspace" style={{ marginTop: 18 }}>
        {loading ? (
          <div className="empty-state">Loading guest device status...</div>
        ) : (
          <>
            <section className="guest-status-grid">
              <article className="metric-card guest-status-card">
                <span>Koneksi perangkat</span>
                <strong>
                  {state.device?.deviceStatus === "online"
                    ? "Terhubung"
                    : state.device?.deviceStatus === "pending_setup"
                      ? "Setup awal"
                      : state.device?.deviceStatus || "offline"}
                </strong>
                <StatusChip
                  status={state.device?.deviceStatus || "offline"}
                  label={state.device?.deviceStatus === "online" ? "online" : undefined}
                />
              </article>
              <article className="metric-card guest-status-card">
                <span>Status service</span>
                <strong>{guestStatus.runtimeLabel}</strong>
                <StatusChip
                  status={guestStatus.overallStatus === "pending_setup" ? "pending_setup" : service?.status || "offline"}
                  label={guestStatus.runtimeChipLabel}
                />
              </article>
              <article className="metric-card guest-status-card">
                <span>Publikasi link</span>
                <strong>{guestStatus.publicLabel}</strong>
                <StatusChip status={guestStatus.publicStatus} />
              </article>
              <article className="metric-card guest-status-card">
                <span>Kesiapan akses</span>
                <strong>{guestStatus.headline}</strong>
                <StatusChip status={guestStatus.overallStatus} />
              </article>
            </section>

            <article className="service-panel guest-service-panel">
              <div className="service-card-header">
                <div>
                  <strong>E-Rapor</strong>
                  <div className="mono">{state.device?.deviceId}</div>
                </div>
                <div className="service-status-group">
                  <StatusChip
                    status={state.device?.deviceStatus || "offline"}
                    label={state.device?.deviceStatus === "online" ? "device online" : undefined}
                  />
                  <StatusChip
                    status={guestStatus.overallStatus === "pending_setup" ? "pending_setup" : service?.status || "offline"}
                    label={guestStatus.runtimeChipLabel}
                  />
                  <StatusChip status={guestStatus.publicStatus} label={guestStatus.publicLabel} />
                </div>
              </div>

              <div className="guest-callout">
                <div>
                  <div className="section-eyebrow">Status utama</div>
                  <strong>{guestStatus.headline}</strong>
                </div>
                <p>{guestStatus.description}</p>
              </div>

              <div className="service-detail-grid guest-detail-grid">
                <div>
                  <span>Public URL</span>
                  <strong className="service-link mono">
                    {service?.public_url ? (
                      <a href={service.public_url} target="_blank" rel="noreferrer">
                        {service.public_url}
                      </a>
                    ) : (
                      "belum tersedia"
                    )}
                  </strong>
                </div>
                <div>
                  <span>Status target</span>
                  <strong>{service?.desired_state === "running" ? "Dijaga tetap running" : service?.desired_state || "-"}</strong>
                </div>
                <div>
                  <span>Ping service</span>
                  <strong>{formatRelativeTime(service?.last_ping)}</strong>
                </div>
                <div>
                  <span>Heartbeat agent</span>
                  <strong>{formatRelativeTime(state.device?.lastSeen)}</strong>
                </div>
                <div>
                  <span>Kesiapan direktori</span>
                  <strong>{service?.location_status || "unknown"}</strong>
                </div>
                <div>
                  <span>Lokasi layanan</span>
                  <strong className="mono">{service?.resolved_path || "-"}</strong>
                </div>
              </div>

              {service?.location_details?.message ? (
                <div className="service-note">{service.location_details.message}</div>
              ) : null}
              {service?.last_error ? <div className="job-error">{service.last_error}</div> : null}

              <div className="guest-cta-row">
                <div className="panel-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy}
                    onClick={() => sendCommand("start")}
                  >
                    {busy ? "Memproses..." : "Start Service"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !isRunning}
                    onClick={() => sendCommand("stop")}
                  >
                    Stop Service
                  </button>
                  <a
                    className={`primary-button footer-link-button ${canOpenService ? "" : "button-disabled-link"}`}
                    href={canOpenService ? service.public_url : undefined}
                    target="_blank"
                    rel="noreferrer"
                    aria-disabled={!canOpenService}
                    onClick={(event) => {
                      if (!canOpenService) {
                        event.preventDefault();
                      }
                    }}
                  >
                    Buka E-Rapor
                  </a>
                </div>
                <PublicLinkActions
                  url={service?.public_url || ""}
                  label={`Akses publik E-Rapor untuk ${state.device?.deviceName || deviceId}`}
                  onActionComplete={setError}
                />
              </div>
            </article>
          </>
        )}
      </section>
      <SiteFooter />
      {commandModal.open ? (
        <div className="guest-modal-backdrop" role="status" aria-live="polite">
          <div className="guest-modal-card">
            <div className="guest-modal-spinner" />
            <strong>{commandModal.title}</strong>
            <p>{commandModal.message}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function PasswordResetScreen() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function bootstrapRecovery() {
      const search = typeof window !== "undefined" ? window.location.search : "";
      const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
      const searchParams = new URLSearchParams(search);
      const params = new URLSearchParams(hash);
      const code = searchParams.get("code");
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      let recoveryError = null;

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        recoveryError = error;
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        recoveryError = error;
      } else {
        setError("Tautan verifikasi reset password tidak valid atau sudah kedaluwarsa.");
        setInfo("");
        return;
      }

      if (recoveryError) {
        setError("Tautan verifikasi reset password tidak valid atau sudah kedaluwarsa.");
        setInfo("");
        return;
      }

      if (typeof window !== "undefined") {
        window.history.replaceState({}, document.title, "/reset-password");
      }
      setReady(true);
      setError("");
      setInfo("Verifikasi email berhasil. Silakan buat password baru untuk akun Anda.");
    }

    bootstrapRecovery();
  }, []);

  async function submit() {
    const trimmedPassword = password.trim();

    if (trimmedPassword.length < 8) {
      setError("Password baru minimal 8 karakter.");
      setInfo("");
      return;
    }

    if (trimmedPassword !== confirmPassword.trim()) {
      setError("Konfirmasi password tidak cocok.");
      setInfo("");
      return;
    }

    try {
      setBusy(true);
      setError("");
      setInfo("");
      const { error } = await supabase.auth.updateUser({ password: trimmedPassword });
      if (error) {
        throw error;
      }
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      clearStoredAuthArtifacts();
      setPassword("");
      setConfirmPassword("");
      setInfo("Password baru berhasil disimpan. Anda akan diarahkan ke halaman login.");
      window.setTimeout(() => {
        if (typeof window !== "undefined") {
          window.location.href = `${PUBLIC_DASHBOARD_URL}/?mode=login`;
        }
      }, 1200);
    } catch (error) {
      setError(formatPasswordUpdateError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-eyebrow">Lupa Password</div>
        <h1>Buat password baru</h1>
        <p>
          Buka halaman ini dari tautan verifikasi yang dikirim ke email Anda, lalu masukkan password baru untuk
          menyelesaikan pemulihan akun dashboard.
        </p>
        <div className="login-form">
          <PasswordField
            label="Password baru"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Minimal 8 karakter"
            autoComplete="new-password"
            disabled={busy}
            visible={showPasswords}
            onToggleVisibility={() => setShowPasswords((current) => !current)}
          />
          <PasswordField
            label="Konfirmasi password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Ulangi password baru"
            autoComplete="new-password"
            disabled={busy}
            visible={showPasswords}
            onToggleVisibility={() => setShowPasswords((current) => !current)}
          />
          {error ? <div className="error-banner">{error}</div> : null}
          {info ? <div className="explorer-warning">{info}</div> : null}
          <button
            type="button"
            className="primary-button"
            disabled={busy || !password || !confirmPassword || !ready}
            onClick={submit}
          >
            {busy ? "Menyimpan..." : "Simpan password baru"}
          </button>
        </div>
      </div>
    </main>
  );
}

function DeviceList({ devices, selectedDeviceId, onSelect, now }) {
  return (
    <div className="device-list">
      {devices.map((device) => (
        <button
          key={device.deviceId}
          type="button"
          className={`device-list-item ${
            device.deviceId === selectedDeviceId ? "device-list-item-active" : ""
          }`}
          onClick={() => onSelect(device.deviceId)}
        >
          <div className="device-list-title">
            <strong>{device.deviceName}</strong>
            <StatusChip status={device.deviceStatus} />
          </div>
          {device.deviceAlias ? <div className="device-list-meta">Alias personal</div> : null}
          <div className="device-list-meta mono">{device.deviceId}</div>
          <div className="device-list-foot">
            <span>{device.runningCount} aktif</span>
            <span>{device.fileJobCount} transfer</span>
            <span>{formatRelativeTime(device.deviceRecord?.last_seen, now)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function RootGrid({ roots, onOpen }) {
  if (roots.length === 0) {
    return <div className="empty-state">Belum ada root path yang dilaporkan agent.</div>;
  }

  return (
    <div className="root-grid">
      {roots.map((root) => (
        <button
          key={`${root.device_id}:${root.root_key}`}
          type="button"
          className="root-card"
          onClick={() => onOpen(root.path)}
        >
          <div className="root-card-top">
            <strong>{root.label}</strong>
            <StatusChip
              status={root.metadata?.locationStatus || root.root_type}
              label={root.root_type.replace(/_/g, " ")}
            />
          </div>
          <div className="root-card-path mono">{root.path}</div>
          {root.metadata?.message ? <div className="root-card-note">{root.metadata.message}</div> : null}
        </button>
      ))}
    </div>
  );
}

function FileTable({
  currentPath,
  items,
  warnings,
  focusedPath,
  selectedPaths,
  onToggle,
  onOpen,
  onPreview,
  onOpenParent,
}) {
  if (!items || items.length === 0) {
    return (
      <div className="empty-state">
        Folder ini kosong atau belum berhasil dimuat.
      </div>
    );
  }

  const breadcrumbs = buildBreadcrumbs(currentPath);
  const folderCount = items.filter((item) => item.type === "directory").length;
  const fileCount = items.filter((item) => item.type === "file").length;

  return (
    <div className="explorer-shell">
      <div className="explorer-toolbar">
        <div className="explorer-breadcrumbs">
          <button type="button" className="utility-button" onClick={onOpenParent}>
            Up
          </button>
          {breadcrumbs.map((crumb) => (
            <button
              key={crumb.path}
              type="button"
              className={`breadcrumb-chip ${
                crumb.path === currentPath ? "breadcrumb-chip-active" : ""
              }`}
              onClick={() => onOpen(crumb.path)}
            >
              {crumb.label}
            </button>
          ))}
        </div>
        <div className="explorer-summary">
          <span>{folderCount} folders</span>
          <span>{fileCount} files</span>
          {warnings?.length ? <span>{warnings.length} skipped</span> : null}
        </div>
      </div>

      {warnings?.length ? (
        <div className="explorer-warning">
          Beberapa item tidak bisa dibaca karena sedang dikunci atau tidak dapat
          diakses. Explorer tetap menampilkan item lain yang berhasil dimuat.
        </div>
      ) : null}

      <div className="file-table-scroll">
        <div className="file-table">
          <div className="file-table-head">
            <span>Name</span>
            <span>Type</span>
            <span>Size</span>
            <span>Modified</span>
            <span>Action</span>
          </div>
          {items.map((item) => {
            const selected = selectedPaths.includes(item.path);
            const isFocused = focusedPath && focusedPath === item.path;
            return (
              <div
                key={item.path}
                className={`file-row ${selected ? "file-row-selected" : ""} ${
                  isFocused ? "file-row-focused" : ""
                }`}
                onDoubleClick={() =>
                  item.type === "directory" ? onOpen(item.path) : onPreview(item)
                }
              >
                <div className="file-name-cell">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(item)}
                  />
                  <button
                    type="button"
                    className={`file-glyph file-glyph-${item.type}`}
                    onClick={() =>
                      item.type === "directory" ? onOpen(item.path) : onPreview(item)
                    }
                  >
                    {getItemGlyph(item)}
                  </button>
                  <div className="file-name-content">
                    <button
                      type="button"
                      className="file-link"
                      onClick={() =>
                        item.type === "directory" ? onOpen(item.path) : onPreview(item)
                      }
                    >
                      {item.name}
                    </button>
                    <div className="file-subpath mono">{item.path}</div>
                  </div>
                </div>
                <span>{getFileKindLabel(item)}</span>
                <span>{item.type === "directory" ? "-" : formatBytes(item.size)}</span>
                <span>{formatDate(item.modifiedAt)}</span>
                <button
                  type="button"
                  className={`utility-button ${item.type === "directory" ? "open-folder-button" : ""}`}
                  onClick={() =>
                    item.type === "directory" ? onOpen(item.path) : onPreview(item)
                  }
                >
                  {item.type === "directory" ? "Open folder" : "Preview"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function JobList({ jobs, onDownload, onPromote, onCancel }) {
  if (jobs.length === 0) {
    return <div className="empty-state">Belum ada file job untuk device ini.</div>;
  }

  return (
    <div className="job-stack">
      {jobs.map((job) => (
        <article key={job.id} className={`job-card tone-${statusTone(job.status)}`}>
          <div className="job-card-top">
            <div>
              <strong>{job.job_type.replace(/_/g, " ")}</strong>
              <div className="mono">#{job.id}</div>
            </div>
            <StatusChip status={job.status} />
          </div>
          <div className="job-card-path mono">{job.source_path || job.destination_path || "-"}</div>
          {job.result?.fileName ? (
            <div className="job-card-path mono">{job.result.fileName}</div>
          ) : null}
          <div className="job-card-meta">
            <span>{formatDate(job.created_at)}</span>
            <span>{job.progress_total ? `${job.progress_current}/${job.progress_total}` : "progress n/a"}</span>
            <span>{job.delivery_mode}</span>
            {Array.isArray(job.result?.parts) && job.result.parts.length > 1 ? (
              <span>{job.result.parts.length} parts</span>
            ) : null}
            {job.result?.size ? <span>{formatBytes(job.result.size)}</span> : null}
          </div>
          {getJobStatusDetail(job) ? (
            <div className="explorer-warning">{getJobStatusDetail(job)}</div>
          ) : null}
          {job.error ? <div className="job-error">{job.error}</div> : null}
          <div className="job-actions">
            {job.status === "completed" && job.artifact_bucket && job.artifact_object_key ? (
              <button type="button" className="primary-button" onClick={() => onDownload(job)}>
                {Array.isArray(job.result?.parts) && job.result.parts.length > 1
                  ? "Download parts"
                  : "Download"}
              </button>
            ) : null}
            {job.status === "completed" &&
            job.delivery_mode === "temp" &&
            job.artifact_bucket &&
            !Array.isArray(job.result?.parts) ? (
              <button type="button" className="secondary-button" onClick={() => onPromote(job)}>
                Make persistent
              </button>
            ) : null}
            {["pending", "running"].includes(job.status) ? (
              <button type="button" className="secondary-button" onClick={() => onCancel(job)}>
                Cancel
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function DeviceAliasModal({
  device,
  value,
  onChange,
  onClose,
  onSave,
  busy,
}) {
  if (!device) {
    return null;
  }

  return (
    <div className="guest-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="device-alias-title">
      <div className="guest-modal-card dashboard-modal-card">
        <strong id="device-alias-title">Ubah nama tampilan device</strong>
        <p>
          Alias hanya berlaku untuk akun Anda. Nama asli device tetap tersimpan sebagai{" "}
          <span className="mono">{device.deviceRecord?.device_name || device.deviceId}</span>.
        </p>
        <label className="modal-field">
          <span>Alias device</span>
          <input
            value={value}
            maxLength={80}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Contoh: Server TU, Laptop Operator, PC Lab"
            autoFocus
          />
        </label>
        <div className="guest-modal-actions">
          <ActionButton className="secondary-button" disabled={busy} onClick={onClose}>
            Batal
          </ActionButton>
          <ActionButton className="primary-button" busy={busy} onClick={onSave}>
            Simpan alias
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function TransferHistoryModal({
  open,
  loading,
  history,
  onClose,
  onDownload,
}) {
  if (!open) {
    return null;
  }

  const jobs = history?.jobs || [];
  const audits = history?.auditLogs || [];

  return (
    <div className="guest-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="transfer-history-title">
      <div className="guest-modal-card transfer-modal-card">
        <div className="panel-heading-row">
          <div>
            <strong id="transfer-history-title">Riwayat Transfer Data</strong>
            <p>Data yang berhasil diambil dari device atau dikirim kembali lewat kontrol SuperAdmin.</p>
          </div>
          <ActionButton className="secondary-button" onClick={onClose}>
            Tutup
          </ActionButton>
        </div>
        {loading ? (
          <div className="empty-state compact-empty">Memuat riwayat transfer...</div>
        ) : !jobs.length && !audits.length ? (
          <div className="empty-state compact-empty">Belum ada riwayat transfer untuk cakupan ini.</div>
        ) : (
          <div className="transfer-history-grid">
            <section>
              <h4>File jobs</h4>
              <div className="job-stack">
                {jobs.map((job) => (
                  <article key={job.id} className={`job-card tone-${statusTone(job.status)}`}>
                    <div className="job-card-top">
                      <div>
                        <strong>{String(job.job_type || "transfer").replace(/_/g, " ")}</strong>
                        <div className="mono">Job #{job.id} · {job.device_id}</div>
                      </div>
                      <StatusChip status={job.status} />
                    </div>
                    <div className="job-card-meta">
                      <span>{formatDate(job.created_at)}</span>
                      <span>{job.delivery_mode || "temp"}</span>
                      <span>{formatBytes(Number(job.artifact_size || job.result?.size || 0))}</span>
                    </div>
                    <div className="root-card-note">
                      {job.source_path || job.destination_path || job.result?.fileName || "Detail path tidak tersedia."}
                    </div>
                    {job.artifact_bucket && job.artifact_object_key ? (
                      <div className="job-actions">
                        <ActionButton className="primary-button" onClick={() => onDownload(job)}>
                          Download artifact
                        </ActionButton>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
            <section>
              <h4>Audit</h4>
              <div className="job-stack">
                {audits.map((audit) => (
                  <article key={audit.id} className="job-card">
                    <div className="job-card-top">
                      <div>
                        <strong>{String(audit.action || "activity").replace(/_/g, " ")}</strong>
                        <div className="mono">{audit.device_id} · {audit.job_id ? `Job #${audit.job_id}` : "system"}</div>
                      </div>
                    </div>
                    <div className="job-card-meta">
                      <span>{formatDate(audit.created_at)}</span>
                      <span>{audit.target_path || "target tidak tersedia"}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const currentPathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const currentSearch = typeof window !== "undefined" ? window.location.search : "";
  const currentHash = typeof window !== "undefined" ? window.location.hash : "";
  const guestDeviceId =
    typeof window !== "undefined"
      ? decodeURIComponent(currentPathname.match(/^\/guest\/([^/]+)$/)?.[1] || "")
      : "";
  const resetPasswordMode =
    currentPathname === "/reset-password" ||
    /(^|[&#])type=recovery(?:[&#]|$)/.test(currentHash);
  const currentParams =
    typeof window !== "undefined" ? new URLSearchParams(currentSearch) : new URLSearchParams();
  const requestedAuthMode =
    typeof window !== "undefined" ? currentParams.get("mode") : "";
  const requestedGuestLinkDeviceId =
    typeof window !== "undefined" ? currentParams.get("linkDeviceId") || "" : "";
  const requestedGuestReturnDeviceId =
    typeof window !== "undefined"
      ? currentParams.get("guestDeviceId") || requestedGuestLinkDeviceId
      : "";
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState(
    requestedAuthMode === "register" ? "register" : "login"
  );
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [registerRole, setRegisterRole] = useState("operator");
  const [registerMode, setRegisterMode] = useState("referral_code");
  const [registerReferralCode, setRegisterReferralCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [dashboardInfo, setDashboardInfo] = useState("");
  const [pendingGuestLinkDeviceId, setPendingGuestLinkDeviceId] = useState(
    requestedGuestLinkDeviceId
  );
  const [guestReturnDeviceId, setGuestReturnDeviceId] = useState(
    requestedGuestReturnDeviceId
  );
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [authPolicy, setAuthPolicy] = useState({
    operatorAutoApproveHours: 24,
    environmentUserAutoApproveHours: 8,
    standaloneUserApprovalMode: "manual",
    standaloneUserAutoApproveHours: 24,
    maintenanceIntervalMinutes: 15,
    passwordResetRedirectUrl: `${PUBLIC_DASHBOARD_URL}/reset-password`,
  });
  const [services, setServices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [fileJobs, setFileJobs] = useState([]);
  const [roots, setRoots] = useState([]);
  const [deviceAliases, setDeviceAliases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("all");
  const [appRoute, setAppRoute] = useState(() =>
    typeof window === "undefined" ? { section: "overview", deviceId: "" } : parseAppRoute(window.location.pathname)
  );
  const [now, setNow] = useState(Date.now());
  const [busyAction, setBusyAction] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [directoryJobId, setDirectoryJobId] = useState(null);
  const [directoryResult, setDirectoryResult] = useState(null);
  const [previewJobId, setPreviewJobId] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [channelState, setChannelState] = useState("connecting");
  const [logLevelFilter, setLogLevelFilter] = useState("all");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createRole, setCreateRole] = useState("operator");
  const [createAssignedDeviceId, setCreateAssignedDeviceId] = useState("");
  const [createApproveImmediately, setCreateApproveImmediately] = useState(true);
  const [aliasModalDeviceId, setAliasModalDeviceId] = useState("");
  const [aliasDraft, setAliasDraft] = useState("");
  const [transferHistoryOpen, setTransferHistoryOpen] = useState(false);
  const [transferHistoryLoading, setTransferHistoryLoading] = useState(false);
  const [transferHistory, setTransferHistory] = useState({ jobs: [], auditLogs: [] });
  const fileInputRef = useRef(null);

  function resetAuthenticatedState() {
    setSession(null);
    setProfile(null);
    setProfileLoading(false);
    setAccounts([]);
    setEnvironments([]);
    setServices([]);
    setLogs([]);
    setFileJobs([]);
    setRoots([]);
    setDeviceAliases([]);
    setLoading(true);
    setError("");
    setDashboardInfo("");
    setSelectedDeviceId("all");
    setAppRoute({ section: "overview", deviceId: "" });
    setBusyAction("");
    setCurrentPath("");
    setDirectoryJobId(null);
    setDirectoryResult(null);
    setPreviewJobId(null);
    setPreviewResult(null);
    setSelectedPaths([]);
    setChannelState("connecting");
    setLogLevelFilter("all");
    setCreateEmail("");
    setCreatePassword("");
    setCreateDisplayName("");
    setCreateRole("operator");
    setCreateAssignedDeviceId("");
    setCreateApproveImmediately(true);
    setAliasModalDeviceId("");
    setAliasDraft("");
    setTransferHistoryOpen(false);
    setTransferHistoryLoading(false);
    setTransferHistory({ jobs: [], auditLogs: [] });
  }

  function clearGuestLinkRequest() {
    setPendingGuestLinkDeviceId("");
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.delete("linkDeviceId");
    params.delete("mode");
    if (guestReturnDeviceId) {
      params.set("guestDeviceId", guestReturnDeviceId);
    }
    const nextSearch = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash || ""}`
    );
  }

  const selectedTab = appRoute.section;

  function navigateRoute(section, params = {}, options = {}) {
    const nextRoute = {
      section: DASHBOARD_SECTIONS.has(section) ? section : "overview",
      deviceId: section === "devices" ? String(params.deviceId || "").trim() : "",
    };
    setAppRoute(nextRoute);
    if (nextRoute.deviceId) {
      setSelectedDeviceId(nextRoute.deviceId);
    } else if (nextRoute.section === "devices" && params.selectAll) {
      setSelectedDeviceId("all");
    }

    if (typeof window === "undefined") {
      return;
    }

    const nextPath = buildRoutePath(nextRoute.section, { deviceId: nextRoute.deviceId });
    const routeSearchParams = new URLSearchParams(window.location.search);
    routeSearchParams.delete("mode");
    routeSearchParams.delete("linkDeviceId");
    const nextSearch = routeSearchParams.toString();
    const nextUrl = `${nextPath}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash || ""}`;
    if (window.location.pathname !== nextPath) {
      window.history[options.replace ? "replaceState" : "pushState"](null, "", nextUrl);
    }
  }

  function setSelectedTab(section) {
    navigateRoute(section);
  }

  useEffect(() => {
    if (guestDeviceId) {
      setAuthLoading(false);
      return undefined;
    }

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session || null);
        setAuthLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        resetAuthenticatedState();
      } else {
        setSession(nextSession || null);
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setAuthError("");
      }
      setAuthInfo("");
      setAuthLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [guestDeviceId]);

  useEffect(() => {
    if (typeof window === "undefined" || guestDeviceId) {
      return undefined;
    }

    const handlePopState = () => {
      const nextRoute = parseAppRoute(window.location.pathname);
      setAppRoute(nextRoute);
      if (nextRoute.section === "devices" && nextRoute.deviceId) {
        setSelectedDeviceId(nextRoute.deviceId);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [guestDeviceId]);

  useEffect(() => {
    if (!session || guestDeviceId) {
      setProfile(null);
      return;
    }

    let active = true;
    setProfileLoading(true);
    invokeEdgeFunction("account-access", { action: "sessionProfile" }, session)
      .then((data) => {
        if (!active) {
          return;
        }
        setProfile(data.profile || null);
        setAuthError("");
        setProfileLoading(false);
      })
      .catch((profileError) => {
        if (!active) {
          return;
        }
        if (isInvalidSessionError(profileError)) {
          setAuthError(formatEdgeFunctionError(profileError));
          setProfile(null);
          setProfileLoading(false);
          setSession(null);
          supabase.auth.signOut().catch(() => {});
          clearStoredAuthArtifacts();
          return;
        }
        setAuthError(formatEdgeFunctionError(profileError));
        setProfile(null);
        setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, guestDeviceId]);

  useEffect(() => {
    if (registerRole !== "user") {
      setRegisterMode("referral_code");
      setRegisterReferralCode("");
    }
  }, [registerRole]);

  useEffect(() => {
    if (profile?.role === "operator") {
      setCreateRole("user");
      setCreateApproveImmediately(false);
    }
  }, [profile]);

  useEffect(() => {
    if (!pendingGuestLinkDeviceId || !profile || profile.status !== "approved") {
      return;
    }
    if (!["user", "operator"].includes(profile.role)) {
      setDashboardInfo("Penautan dari Guest Mode tersedia untuk akun User atau Operator. Akses role Anda tetap mengikuti cakupan dashboard.");
      clearGuestLinkRequest();
    }
  }, [pendingGuestLinkDeviceId, profile]);

  async function loadAll(background = false) {
    if (!session || guestDeviceId) {
      return;
    }

    if (!background) {
      setLoading(true);
    }

    try {
      const dashboard = await invokeAdmin("listDashboard");
      startTransition(() => {
        setServices(dashboard.services || []);
        setLogs(dashboard.logs || []);
        setFileJobs(dashboard.fileJobs || []);
        setRoots(dashboard.roots || []);
        setAccounts(dashboard.accounts || []);
        setEnvironments(dashboard.environments || []);
        setDeviceAliases(dashboard.deviceAliases || []);
        if (dashboard.authPolicy) {
          setAuthPolicy((current) => ({ ...current, ...dashboard.authPolicy }));
        }
      });
      setChannelState("ready");
      setError("");
    } catch (loadError) {
      setChannelState("error");
      setError(formatEdgeFunctionError(loadError));
    }

    if (!background) {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!session || !profile || guestDeviceId) {
      return undefined;
    }

    loadAll();
    const refreshId = window.setInterval(() => {
      loadAll(true);
      setNow(Date.now());
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshId);
    };
  }, [session, profile, guestDeviceId]);

  useEffect(() => {
    if (appRoute.section === "devices" && appRoute.deviceId) {
      return;
    }
    if (selectedDeviceId !== "all" && !services.some((row) => row.device_id === selectedDeviceId)) {
      setSelectedDeviceId("all");
    }
  }, [services, selectedDeviceId, appRoute]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    const allowedSections = getAllowedDashboardSections(profile.role);
    if (!allowedSections.has(selectedTab)) {
      setDashboardInfo("Halaman tersebut tidak tersedia untuk role akun ini.");
      navigateRoute("overview", {}, { replace: true });
      return;
    }
    if (
      typeof window !== "undefined" &&
      (window.location.pathname === "/dashboard" || !window.location.pathname.startsWith("/dashboard"))
    ) {
      navigateRoute("overview", {}, { replace: true });
    }
  }, [profile, selectedTab]);

  useEffect(() => {
    if (appRoute.section === "devices" && appRoute.deviceId && appRoute.deviceId !== selectedDeviceId) {
      setSelectedDeviceId(appRoute.deviceId);
    }
  }, [appRoute, selectedDeviceId]);

  const deviceEntries = useMemo(() => {
    const grouped = new Map();
    const aliasMap = new Map(
      deviceAliases.map((entry) => [String(entry.device_id || ""), String(entry.alias || "").trim()])
    );
    for (const row of services) {
      const deviceRecord = Array.isArray(row.devices) ? row.devices[0] : row.devices;
      const deviceStatus = deriveDeviceStatus(deviceRecord);
      const serviceStatus = deriveServiceStatus(row, deviceStatus);
      const rawDeviceName = deviceRecord?.device_name || row.device_id;
      const deviceAlias = aliasMap.get(String(row.device_id)) || "";

      if (!grouped.has(row.device_id)) {
        grouped.set(row.device_id, {
          deviceId: row.device_id,
          deviceName: deviceAlias || rawDeviceName,
          deviceAlias,
          rawDeviceName,
          deviceStatus,
          deviceRecord,
          services: [],
        });
      }

      grouped.get(row.device_id).services.push({
        ...row,
        serviceStatus,
      });
    }

    return Array.from(grouped.values()).map((entry) => ({
      ...entry,
      runningCount: entry.services.filter((service) => service.serviceStatus === "running").length,
      fileJobCount: fileJobs.filter(
        (job) =>
          job.device_id === entry.deviceId &&
          ["pending", "running"].includes(job.status)
      ).length,
      issueCount: entry.services.filter(
        (service) =>
          ["error", "offline", "blocked", "missing", "partial"].includes(service.serviceStatus) ||
          ["missing", "partial"].includes(service.location_status)
      ).length,
    }));
  }, [services, fileJobs, deviceAliases]);

  const selectedDevice =
    appRoute.section === "devices" && appRoute.deviceId
      ? deviceEntries.find((entry) => entry.deviceId === appRoute.deviceId) || null
      : selectedDeviceId === "all"
      ? deviceEntries[0] || null
      : deviceEntries.find((entry) => entry.deviceId === selectedDeviceId) || null;
  const aliasModalDevice =
    deviceEntries.find((entry) => entry.deviceId === aliasModalDeviceId) || null;
  const selectedGuestUrl = selectedDevice ? buildGuestUrl(selectedDevice.deviceId) : "";

  useEffect(() => {
    if (createRole !== "user") {
      if (createAssignedDeviceId) {
        setCreateAssignedDeviceId("");
      }
      return;
    }

    const availableDeviceIds = deviceEntries.map((entry) => entry.deviceId).filter(Boolean);
    if (!availableDeviceIds.length) {
      if (createAssignedDeviceId) {
        setCreateAssignedDeviceId("");
      }
      return;
    }

    if (createAssignedDeviceId && availableDeviceIds.includes(createAssignedDeviceId)) {
      return;
    }

    const preferredDeviceId =
      (selectedDevice?.deviceId && availableDeviceIds.includes(selectedDevice.deviceId)
        ? selectedDevice.deviceId
        : availableDeviceIds[0]) || "";

    if (preferredDeviceId !== createAssignedDeviceId) {
      setCreateAssignedDeviceId(preferredDeviceId);
    }
  }, [createRole, createAssignedDeviceId, deviceEntries, selectedDevice]);

  const visibleServices = useMemo(() => {
    if (!selectedDevice) {
      return [];
    }

    if (profile?.role === "user") {
      return selectedDevice.services.filter((service) => service.service_name === "rapor");
    }

    return selectedDevice.services;
  }, [selectedDevice, profile]);

  const selectedDeviceJobs = useMemo(
    () =>
      selectedDevice
        ? fileJobs.filter((job) => job.device_id === selectedDevice.deviceId)
        : [],
    [fileJobs, selectedDevice]
  );

  const selectedDeviceRoots = useMemo(
    () =>
      selectedDevice
        ? roots.filter((root) => root.device_id === selectedDevice.deviceId)
        : [],
    [roots, selectedDevice]
  );

  useEffect(() => {
    if (!directoryJobId) {
      return;
    }

    const job = fileJobs.find((entry) => entry.id === directoryJobId);
    if (!job) {
      return;
    }

    if (job.status === "completed" && job.result) {
      setDirectoryResult(job.result);
      if (job.result.path) {
        setCurrentPath(job.result.path);
      }
      setSelectedPaths([]);
      setDirectoryJobId(null);
    } else if (job.status === "failed") {
      setError(job.error || "Directory listing failed.");
      setDirectoryJobId(null);
    }
  }, [directoryJobId, fileJobs]);

  useEffect(() => {
    if (!previewJobId) {
      return;
    }

    const job = fileJobs.find((entry) => entry.id === previewJobId);
    if (!job) {
      return;
    }

    if (job.status === "completed" && job.result) {
      setPreviewResult(job.result);
      setPreviewJobId(null);
    } else if (job.status === "failed") {
      setError(job.error || "Preview failed.");
      setPreviewJobId(null);
    }
  }, [previewJobId, fileJobs]);

  async function invokeAdmin(action, payload = {}) {
    const { data, error: invokeError } = await supabase.functions.invoke("admin-ops", {
      body: { action, ...payload },
    });

    if (invokeError) {
      throw invokeError;
    }

    if (!data?.ok) {
      throw new Error(data?.error || "Admin operation failed.");
    }

    return data;
  }

  async function createJobFallback(jobType, payload = {}) {
    const { data, error: insertError } = await supabase
      .from("file_jobs")
      .insert({
        device_id: selectedDevice.deviceId,
        requested_by: session.user.id,
        job_type: jobType,
        delivery_mode: payload.deliveryMode || "temp",
        source_path: payload.sourcePath || null,
        destination_path: payload.destinationPath || null,
        selection: payload.selection || [],
        options: payload.options || {},
        status: "pending",
      })
      .select("*")
      .single();

    if (insertError) {
      throw insertError;
    }

    return { job: data };
  }

  async function signIn() {
    setAuthLoading(true);
    setAuthError("");
    setAuthInfo("");
    if (authMode === "register") {
      try {
        await invokeEdgeFunction("account-access", {
          action: "register",
          email: loginEmail,
          password: loginPassword,
          displayName: registerDisplayName,
          role: registerRole,
          registrationMode: registerRole === "user" ? registerMode : "open_operator_signup",
          referralCode: registerRole === "user" ? registerReferralCode : "",
        });
        setAuthInfo(
          "Pendaftaran berhasil diterima. Masuk dengan akun yang sama untuk memantau status persetujuan."
        );
        setAuthMode("login");
      } catch (registerError) {
        setAuthError(formatEdgeFunctionError(registerError));
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });

      if (signInError) {
        setAuthError(formatSignInError(signInError));
      }
    }

    setAuthLoading(false);
  }

  async function sendForgotPassword() {
    try {
      setAuthLoading(true);
      setAuthError("");
      setAuthInfo("");
      const redirectTo = `${PUBLIC_DASHBOARD_URL}/reset-password`;
      await invokeEdgeFunction("account-access", {
        action: "forgotPassword",
        email: loginEmail,
        redirectTo,
      });

      setAuthInfo("Tautan untuk mengganti password sudah dikirim ke email Anda. Buka email tersebut, verifikasi tautan, lalu buat password baru.");
    } catch (forgotError) {
      setAuthError(formatEdgeFunctionError(forgotError));
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    const returnDeviceId = String(guestReturnDeviceId || pendingGuestLinkDeviceId || "").trim();
    setAuthLoading(true);
    setAuthError("");
    setAuthInfo("");
    setDashboardInfo("");
    resetAuthenticatedState();
    try {
      const globalResult = await supabase.auth.signOut({ scope: "global" });
      if (globalResult.error) {
        await supabase.auth.signOut({ scope: "local" });
      }
    } catch (_error) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    } finally {
      clearStoredAuthArtifacts();
      setAuthLoading(false);
      if (returnDeviceId && typeof window !== "undefined") {
        window.location.href = buildGuestPath(returnDeviceId);
      }
    }
  }

  async function queueCommand(deviceId, serviceName, action) {
    setBusyAction(`${deviceId}:${serviceName || "device"}:${action}`);
    setError("");
    try {
      await invokeAdmin("queueCommand", {
        deviceId,
        serviceName,
        commandAction: action,
      });
      loadAll(true);
    } catch (commandError) {
      setError(formatEdgeFunctionError(commandError));
    } finally {
      setBusyAction("");
    }
  }

  async function updateDeviceStatus(deviceId, status) {
    setBusyAction(`${deviceId}:${status}`);
    setError("");
    try {
      await invokeAdmin("updateDeviceStatus", { deviceId, status });
      loadAll(true);
    } catch (statusError) {
      setError(formatEdgeFunctionError(statusError));
    } finally {
      setBusyAction("");
    }
  }

  async function createFileJob(jobType, payload = {}) {
    if (!selectedDevice) {
      return null;
    }

    setBusyAction(`job:${jobType}`);
    setError("");
    try {
      let data;
      try {
        data = await invokeAdmin("createJob", {
          deviceId: selectedDevice.deviceId,
          jobType,
          ...payload,
        });
      } catch (functionError) {
        data = await createJobFallback(jobType, payload);
      }
      setBusyAction("");
      loadAll(true);
      return data.job;
    } catch (jobError) {
      setBusyAction("");
      setError(formatEdgeFunctionError(jobError));
      return null;
    }
  }

  async function copyGuestLink(deviceId) {
    try {
      setBusyAction(`guest:${deviceId}`);
      const data = await invokeAdmin("syncGuestLink", { deviceId });
      await copyTextToClipboard(data.guestUrl);
      setError("");
      loadAll(true);
    } catch (copyError) {
      setError(formatEdgeFunctionError(copyError));
    } finally {
      setBusyAction("");
    }
  }

  async function handleAccountAction(action, payload = {}) {
    try {
      setBusyAction(`account:${action}`);
      await invokeAdmin(action, payload);
      await loadAll(true);
    } catch (accountError) {
      setError(formatEdgeFunctionError(accountError));
    } finally {
      setBusyAction("");
    }
  }

  async function confirmGuestDeviceLink() {
    const deviceId = String(pendingGuestLinkDeviceId || "").trim();
    if (!deviceId) {
      return;
    }

    try {
      setBusyAction(`guest-link:${deviceId}`);
      setError("");
      setDashboardInfo("");
      await invokeAdmin("linkGuestDevice", { deviceId });
      setSelectedDeviceId(deviceId);
      clearGuestLinkRequest();
      await loadAll(true);
      setDashboardInfo("Device lokal berhasil ditautkan ke akun ini.");
    } catch (linkError) {
      setError(formatEdgeFunctionError(linkError));
    } finally {
      setBusyAction("");
    }
  }

  function openAliasModal(device) {
    setAliasModalDeviceId(device.deviceId);
    setAliasDraft(device.deviceAlias || "");
  }

  async function saveDeviceAlias() {
    if (!aliasModalDevice) {
      return;
    }

    try {
      setBusyAction(`alias:${aliasModalDevice.deviceId}`);
      setError("");
      await invokeAdmin("updateDeviceAlias", {
        deviceId: aliasModalDevice.deviceId,
        alias: aliasDraft,
      });
      setAliasModalDeviceId("");
      setAliasDraft("");
      await loadAll(true);
    } catch (aliasError) {
      setError(formatEdgeFunctionError(aliasError));
    } finally {
      setBusyAction("");
    }
  }

  async function openTransferHistory() {
    if (profile?.role !== "super_admin") {
      return;
    }

    try {
      setTransferHistoryOpen(true);
      setTransferHistoryLoading(true);
      setError("");
      const data = await invokeAdmin("listTransferHistory", {
        deviceId: selectedDeviceId === "all" ? "" : selectedDeviceId,
      });
      setTransferHistory({
        jobs: data.jobs || [],
        auditLogs: data.auditLogs || [],
      });
    } catch (historyError) {
      setError(formatEdgeFunctionError(historyError));
      setTransferHistory({ jobs: [], auditLogs: [] });
    } finally {
      setTransferHistoryLoading(false);
    }
  }

  function dismissGuestDeviceLink() {
    setDashboardInfo("Penautan device lokal dilewati. Anda tetap dapat menggunakan dashboard sesuai akses akun.");
    clearGuestLinkRequest();
  }

  async function handleDeleteAccount(account) {
    if (!account?.user_id) {
      return;
    }

    const confirmed = window.confirm(
      `Hapus akun ${account.display_name || account.email} (${account.role}) secara permanen?`
    );
    if (!confirmed) {
      return;
    }

    await handleAccountAction("deleteAccount", { userId: account.user_id });
  }

  async function createManagedAccount() {
    if (!createEmail || !createPassword) {
      setError("Email dan password account wajib diisi.");
      return;
    }

    await handleAccountAction("createAccount", {
      email: createEmail,
      password: createPassword,
      displayName: createDisplayName,
      role: createRole,
      approveImmediately: createApproveImmediately,
      environmentId: createRole === "user" ? environments[0]?.id || profile?.primary_environment_id || "" : "",
      deviceId: createRole === "user" ? createAssignedDeviceId : "",
    });

    setCreateEmail("");
    setCreatePassword("");
    setCreateDisplayName("");
    setCreateRole("operator");
    setCreateAssignedDeviceId("");
    setCreateApproveImmediately(true);
  }

  async function openPath(nextPath) {
    setCurrentPath(nextPath);
    const job = await createFileJob("list_directory", { sourcePath: nextPath });
    if (job) {
      setDirectoryJobId(job.id);
      setDirectoryResult(null);
      setSelectedTab("files");
    }
  }

  async function openParentPath() {
    if (!currentPath) {
      return;
    }

    const breadcrumbs = buildBreadcrumbs(currentPath);
    if (breadcrumbs.length <= 1) {
      await openPath(currentPath);
      return;
    }

    await openPath(breadcrumbs[breadcrumbs.length - 2].path);
  }

  async function refreshRoots() {
    await createFileJob("discover_roots");
  }

  async function previewItem(item) {
    const job = await createFileJob("preview_file", { sourcePath: item.path });
    if (job) {
      setPreviewJobId(job.id);
      setPreviewResult(null);
    }
  }

  function toggleSelection(item) {
    setSelectedPaths((current) =>
      current.includes(item.path)
        ? current.filter((value) => value !== item.path)
        : [...current, item.path]
    );
  }

  async function queueDownloadSelection() {
    if (!selectedPaths.length) {
      return;
    }

    if (selectedPaths.length === 1 && directoryResult?.items?.find((item) => item.path === selectedPaths[0] && item.type === "file")) {
      await createFileJob("download_file", {
        sourcePath: selectedPaths[0],
        deliveryMode: "temp",
      });
      return;
    }

    await createFileJob("archive_paths", {
      sourcePath: currentPath,
      selection: selectedPaths,
      deliveryMode: "temp",
    });
  }

  async function handleArtifactDownload(job) {
    async function signArtifact(part, fallbackName) {
      try {
        const data = await invokeAdmin("signArtifact", {
          bucket: part.bucket,
          objectKey: part.objectKey,
          downloadFileName: fallbackName,
        });
        return data.signedUrl;
      } catch (_functionError) {
        const { data, error: signError } = await supabase.storage
          .from(part.bucket)
          .createSignedUrl(part.objectKey, 60 * 15, {
            download: fallbackName,
          });
        if (signError) {
          throw signError;
        }
        return data.signedUrl;
      }
    }

    function triggerBrowserDownload(url) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }

    try {
      setBusyAction(`download:${job.id}`);

      const parts =
        Array.isArray(job.result?.parts) && job.result.parts.length > 0
          ? job.result.parts
          : [
              {
                bucket: job.artifact_bucket,
                objectKey: job.artifact_object_key,
                fileName: job.result?.fileName || job.artifact_object_key.split("/").pop(),
              },
            ];

      for (const part of parts) {
        const downloadFileName = part.fileName || part.objectKey.split("/").pop();
        const signedUrl = await signArtifact(part, downloadFileName);
        triggerBrowserDownload(signedUrl);
        if (parts.length > 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
      }
    } catch (downloadError) {
      setError(formatEdgeFunctionError(downloadError));
    } finally {
      setBusyAction("");
    }
  }

  async function promoteArchive(job) {
    try {
      setBusyAction(`promote:${job.id}`);
      await invokeAdmin("promoteArchive", { jobId: job.id });
      loadAll(true);
    } catch (promoteError) {
      setError(formatEdgeFunctionError(promoteError));
    } finally {
      setBusyAction("");
    }
  }

  async function cancelJob(job) {
    try {
      setBusyAction(`cancel:${job.id}`);
      try {
        await invokeAdmin("cancelJob", { jobId: job.id });
      } catch (_functionError) {
        const { error: updateError } = await supabase
          .from("file_jobs")
          .update({
            status: "cancelled",
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        if (updateError) {
          throw updateError;
        }
      }
      loadAll(true);
    } catch (cancelError) {
      setError(formatEdgeFunctionError(cancelError));
    } finally {
      setBusyAction("");
    }
  }

  async function triggerUpload(file) {
    if (!selectedDevice || !currentPath || !file) {
      return;
    }

    try {
      setBusyAction(`upload:${file.name}`);
      const objectKey = `${selectedDevice.deviceId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("admin-upload-staging")
        .upload(objectKey, file, {
          upsert: true,
          contentType: file.type || "application/octet-stream",
        });

      if (uploadError) {
        throw uploadError;
      }

      await createFileJob("upload_place", {
        destinationPath: currentPath,
        options: {
          stagingBucket: "admin-upload-staging",
          stagingObjectKey: objectKey,
          originalFileName: file.name,
        },
      });
    } catch (uploadError) {
      setError(formatEdgeFunctionError(uploadError));
    } finally {
      setBusyAction("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  if (guestDeviceId) {
    return <GuestConsole deviceId={guestDeviceId} />;
  }

  if (resetPasswordMode) {
    return <PasswordResetScreen />;
  }

  if (authLoading && !session) {
    return (
      <LoginScreen
        mode="login"
        email=""
        password=""
        displayName=""
        role="operator"
        registrationMode="referral_code"
        referralCode=""
        setEmail={() => {}}
        setPassword={() => {}}
        setDisplayName={() => {}}
        setRole={() => {}}
        setRegistrationMode={() => {}}
        setReferralCode={() => {}}
        setMode={() => {}}
        onSubmit={() => {}}
        onForgotPassword={() => {}}
        error=""
        info=""
        loading
      />
    );
  }

  if (!session) {
    return (
      <LoginScreen
        mode={authMode}
        email={loginEmail}
        password={loginPassword}
        displayName={registerDisplayName}
        role={registerRole}
        registrationMode={registerMode}
        referralCode={registerReferralCode}
        setEmail={setLoginEmail}
        setPassword={setLoginPassword}
        setDisplayName={setRegisterDisplayName}
        setRole={setRegisterRole}
        setRegistrationMode={setRegisterMode}
        setReferralCode={setRegisterReferralCode}
        setMode={setAuthMode}
        onSubmit={signIn}
        onForgotPassword={sendForgotPassword}
        error={authError}
        info={authInfo}
        loading={authLoading}
      />
    );
  }

  if (profileLoading) {
    return <div className="empty-state">Loading account profile...</div>;
  }

  if (!profile) {
    return <AccountStatusScreen profile={{ status: "pending", email: session.user.email }} onSignOut={signOut} />;
  }

  if (profile.status !== "approved") {
    return <AccountStatusScreen profile={profile} onSignOut={signOut} />;
  }

  const isSuperAdmin = profile.role === "super_admin";
  const isOperator = profile.role === "operator";
  const isUser = profile.role === "user";
  const showGuestLinkPrompt =
    (isUser || isOperator) && Boolean(pendingGuestLinkDeviceId) && profile.status === "approved";
  const linkingGuestDevice = busyAction === `guest-link:${pendingGuestLinkDeviceId}`;
  const activeRunningJobs = fileJobs.filter((job) => ["pending", "running"].includes(job.status)).length;
  const pendingAccountCount = accounts.filter((account) => account.status === "pending").length;
  const dashboardNavItems = getDashboardNavItems({
    isSuperAdmin,
    isOperator,
    deviceCount: deviceEntries.length,
    pendingAccounts: pendingAccountCount,
    runningJobs: activeRunningJobs,
  });

  function openDeviceRoute(deviceId) {
    navigateRoute("devices", { deviceId });
  }

  return (
    <main className={`console-shell app-shell-page role-${profile.role}`}>
      <div className="app-shell">
        <SidebarNav
          profile={profile}
          activeSection={selectedTab}
          items={dashboardNavItems}
          onNavigate={navigateRoute}
          onTransferHistory={openTransferHistory}
        />
        <section className="app-content">
          <RouteHeader
            route={appRoute}
            profile={profile}
            channelState={channelState}
            loading={loading}
            authLoading={authLoading}
            onRefresh={() => loadAll()}
            onSignOut={signOut}
          />

      {error ? <div className="error-banner">{error}</div> : null}
      {dashboardInfo ? <div className="service-note">{dashboardInfo}</div> : null}
      {showGuestLinkPrompt ? (
        <div className="guest-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="guest-link-title">
          <div className="guest-modal-card">
            <strong id="guest-link-title">Tautkan device lokal ke akun ini?</strong>
            <p>
              Device <span className="mono">{pendingGuestLinkDeviceId}</span> akan dimasukkan ke akses akun User ini.
              Setelah tertaut, dashboard akan menampilkan layanan lokal sesuai batas hak akses User.
            </p>
            <div className="guest-modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={linkingGuestDevice}
                onClick={dismissGuestDeviceLink}
              >
                Lewati
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={linkingGuestDevice}
                onClick={confirmGuestDeviceLink}
              >
                {linkingGuestDevice ? "Menautkan..." : "Tautkan device"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <DeviceAliasModal
        device={aliasModalDevice}
        value={aliasDraft}
        onChange={setAliasDraft}
        onClose={() => {
          setAliasModalDeviceId("");
          setAliasDraft("");
        }}
        onSave={saveDeviceAlias}
        busy={busyAction === `alias:${aliasModalDevice?.deviceId}`}
      />
      <TransferHistoryModal
        open={transferHistoryOpen}
        loading={transferHistoryLoading}
        history={transferHistory}
        onClose={() => setTransferHistoryOpen(false)}
        onDownload={handleArtifactDownload}
      />

      <div className="console-grid dashboard-workspace-grid">
        <aside className="sidebar fleet-sidebar">
          <div className="sidebar-header">
            <h2>Fleet</h2>
            <button type="button" className="utility-button" onClick={() => navigateRoute("devices", { selectAll: true })}>
              All
            </button>
          </div>
          <DeviceList
            devices={deviceEntries}
            selectedDeviceId={selectedDeviceId}
            onSelect={openDeviceRoute}
            now={now}
          />
        </aside>

        <section className="workspace">
          {["overview", "devices"].includes(selectedTab) ? (
            <>
              <DashboardStats devices={deviceEntries} fileJobs={fileJobs} accounts={accounts} now={now} />
              {selectedTab === "devices" ? (
                deviceEntries.length ? (
                  <DeviceGrid
                    devices={deviceEntries}
                    selectedDeviceId={selectedDevice?.deviceId || selectedDeviceId}
                    onOpen={openDeviceRoute}
                    now={now}
                  />
                ) : (
                  <div className="empty-state">Belum ada device yang aktif untuk akun ini.</div>
                )
              ) : null}
            </>
          ) : null}
          {selectedTab === "profile" ? (
            <ProfilePanel profile={profile} session={session} onSignOut={signOut} />
          ) : selectedDevice ||
            selectedTab === "activity" ||
            selectedTab === "devices" ||
            (selectedTab === "files" && isSuperAdmin) ||
            (selectedTab === "accounts" && (isSuperAdmin || isOperator)) ? (
            <>
              {["overview", "devices"].includes(selectedTab) && selectedDevice ? (
                <section className="panel-stack">
                  <article className="device-panel">
                    <div className="device-panel-top">
                      <div>
                        <h2>{selectedDevice.deviceName}</h2>
                        <div className="mono">{selectedDevice.deviceId}</div>
                        {selectedDevice.deviceAlias ? (
                          <div className="root-card-note">Nama asli: {selectedDevice.rawDeviceName}</div>
                        ) : null}
                      </div>
                      <div className="service-status-group">
                        <StatusChip status={selectedDevice.deviceStatus} />
                        <ActionButton className="secondary-button" onClick={() => openAliasModal(selectedDevice)}>
                          Edit alias
                        </ActionButton>
                      </div>
                    </div>
                    <div className="metric-grid">
                      <div className="metric-card">
                        <span>Heartbeat <InfoHint text="Waktu terakhir agent device mengirim tanda aktif ke dashboard." /></span>
                        <strong>{formatRelativeTime(selectedDevice.deviceRecord?.last_seen, now)}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Service aktif <InfoHint text="Jumlah layanan lokal yang sedang berjalan dan siap dipantau." /></span>
                        <strong>{selectedDevice.runningCount}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Transfer berjalan <InfoHint text="Jumlah pekerjaan transfer file yang masih pending atau running." /></span>
                        <strong>{selectedDevice.fileJobCount}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Perlu perhatian <InfoHint text="Jumlah service yang offline, error, blocked, atau path lokalnya belum lengkap." /></span>
                        <strong>{selectedDevice.issueCount}</strong>
                      </div>
                    </div>
                  </article>

                  <article className="service-panel">
                    <div className="panel-heading-row">
                      <h3>Kontrol layanan <InfoHint text="Start/Stop mengatur service lokal. Stop agent menghentikan koneksi agent sampai service dijalankan lagi dari perangkat." /></h3>
                      <div className="panel-actions">
                        {isSuperAdmin || isOperator ? (
                          <ActionButton
                            className="secondary-button"
                            busy={busyAction === `${selectedDevice.deviceId}:device:kill`}
                            disabled={busyAction !== "" && busyAction !== `${selectedDevice.deviceId}:device:kill`}
                            onClick={() => queueCommand(selectedDevice.deviceId, null, "kill")}
                          >
                            Stop agent
                          </ActionButton>
                        ) : null}
                        {isSuperAdmin ? (
                          <>
                            <ActionButton
                              className={selectedDevice.deviceStatus === "blocked" ? "primary-button" : "danger-button"}
                              busy={busyAction === `${selectedDevice.deviceId}:${selectedDevice.deviceStatus === "blocked" ? "active" : "blocked"}`}
                              disabled={busyAction !== "" && busyAction !== `${selectedDevice.deviceId}:${selectedDevice.deviceStatus === "blocked" ? "active" : "blocked"}`}
                              onClick={() =>
                                updateDeviceStatus(
                                  selectedDevice.deviceId,
                                  selectedDevice.deviceStatus === "blocked" ? "active" : "blocked"
                                )
                              }
                            >
                              {selectedDevice.deviceStatus === "blocked" ? "Unblock device" : "Block device"}
                            </ActionButton>
                            <ActionButton className="secondary-button" busy={transferHistoryLoading} onClick={openTransferHistory}>
                              Riwayat transfer
                            </ActionButton>
                          </>
                        ) : null}
                        <ActionButton
                          className="secondary-button"
                          busy={busyAction === `guest:${selectedDevice.deviceId}`}
                          disabled={busyAction !== "" && busyAction !== `guest:${selectedDevice.deviceId}`}
                          onClick={() => copyGuestLink(selectedDevice.deviceId)}
                        >
                          Salin link Guest
                        </ActionButton>
                      </div>
                    </div>

                    {isSuperAdmin || isOperator || isUser ? (
                      <div className="metric-card guest-monitor-card">
                        <span>Link monitor publik <InfoHint text="Link ini membuka halaman Guest khusus device ini untuk melihat status dan link E-Rapor." /></span>
                        <strong className="service-link mono">
                          <a href={selectedGuestUrl} target="_blank" rel="noreferrer">
                            {selectedGuestUrl}
                          </a>
                        </strong>
                        <PublicLinkActions
                          url={selectedGuestUrl}
                          label={`Guest monitor untuk ${selectedDevice.deviceName}`}
                          compact
                          onActionComplete={setError}
                        />
                      </div>
                    ) : null}

                    <div className="service-stack">
                      {visibleServices.map((service) => {
                        const runningNow =
                          service.serviceStatus === "running" &&
                          service.desired_state !== "stopped";
                        return (
                        <article key={service.id} className={`service-card tone-${statusTone(service.serviceStatus)}`}>
                          <div className="service-card-header">
                            <div>
                              <strong>{service.service_name}</strong>
                              <div className="mono">localhost:{service.port}</div>
                            </div>
                            <div className="service-status-group">
                              <StatusChip status={service.serviceStatus} />
                              <StatusChip status={service.location_status || "unknown"} label={`path ${service.location_status || "unknown"}`} />
                            </div>
                          </div>
                          <div className="service-detail-grid">
                            <div>
                              <span>{getPublicUrlLabel(service)} <InfoHint text="Tautan publik yang dibuat agent agar layanan lokal dapat dibuka dari luar jaringan lokal." /></span>
                              <strong className="service-link">
                                {service.public_url ? (
                                  <a href={service.public_url} target="_blank" rel="noreferrer">
                                    {service.public_url}
                                  </a>
                                ) : (
                                  "disabled"
                                )}
                              </strong>
                            </div>
                            <div>
                              <span>Path lokal <InfoHint text="Lokasi file atau folder service yang berhasil ditemukan agent di device." /></span>
                              <strong className="mono">{service.resolved_path || "-"}</strong>
                            </div>
                            <div>
                              <span>Ping terakhir <InfoHint text="Waktu terakhir status service ini diperbarui oleh agent." /></span>
                              <strong>{formatRelativeTime(service.last_ping, now)}</strong>
                            </div>
                          </div>
                          {service.location_details?.message ? (
                            <div className="service-note">{service.location_details.message}</div>
                          ) : null}
                          {service.last_error ? <div className="job-error">{service.last_error}</div> : null}
                          <PublicLinkActions
                            url={service.public_url || ""}
                            label={`${service.service_name} public URL untuk ${selectedDevice.deviceName}`}
                            compact
                            onActionComplete={setError}
                          />
                          <div className="panel-actions">
                            <ActionButton
                              className="primary-button"
                              busy={busyAction === `${selectedDevice.deviceId}:${service.service_name}:start`}
                              disabled={busyAction !== "" || runningNow}
                              onClick={() => queueCommand(selectedDevice.deviceId, service.service_name, "start")}
                            >
                              Start
                            </ActionButton>
                            <ActionButton
                              className="secondary-button"
                              busy={busyAction === `${selectedDevice.deviceId}:${service.service_name}:stop`}
                              disabled={busyAction !== "" || !runningNow}
                              onClick={() => queueCommand(selectedDevice.deviceId, service.service_name, "stop")}
                            >
                              Stop
                            </ActionButton>
                          </div>
                        </article>
                      )})}
                    </div>
                  </article>
                </section>
              ) : null}

              {selectedTab === "devices" && !selectedDevice ? (
                <div className="empty-state">Device belum tersedia atau berada di luar akses akun ini.</div>
              ) : null}

              {selectedTab === "files" && isSuperAdmin ? (
                <section className="files-shell">
                  <article className="files-toolbar">
                    <div>
                      <h3>Remote Files</h3>
                      <div className="mono">{currentPath || "Select a root path"}</div>
                    </div>
                    <div className="panel-actions">
                      <button type="button" className="secondary-button" onClick={refreshRoots}>
                        Refresh roots
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={!currentPath}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Upload here
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={selectedPaths.length === 0}
                        onClick={queueDownloadSelection}
                      >
                        Download selected
                      </button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      hidden
                      onChange={(event) => triggerUpload(event.target.files?.[0])}
                    />
                  </article>

                  <RootGrid roots={selectedDeviceRoots} onOpen={openPath} />

                  <div className="files-grid">
                    <article className="files-panel">
                      <div className="panel-heading-row">
                        <h3>Explorer</h3>
                        {directoryJobId ? <StatusChip status="running_job" label="loading" /> : null}
                      </div>
                      <FileTable
                        currentPath={currentPath}
                        items={directoryResult?.items || []}
                        warnings={directoryResult?.warnings || []}
                        focusedPath={directoryResult?.focusedPath || null}
                        selectedPaths={selectedPaths}
                        onToggle={toggleSelection}
                        onOpen={openPath}
                        onPreview={previewItem}
                        onOpenParent={openParentPath}
                      />
                    </article>

                    <article className="preview-panel">
                      <div className="panel-heading-row">
                        <h3>Preview</h3>
                        {previewJobId ? <StatusChip status="running_job" label="preparing" /> : null}
                      </div>
                      {!previewResult ? (
                        <div className="empty-state">Pilih file untuk melihat preview atau metadata.</div>
                      ) : previewResult.previewType === "text" ? (
                        <pre className="preview-text">{previewResult.content}</pre>
                      ) : (
                        <div className="preview-artifact">
                          <div className="mono">{previewResult.path}</div>
                          <div>{previewResult.mimeType}</div>
                          <div>{formatBytes(previewResult.size)}</div>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() =>
                              handleArtifactDownload({
                                artifact_bucket: previewResult.bucket,
                                artifact_object_key: previewResult.objectKey,
                                result: { fileName: previewResult.path.split(/[/\\]/).pop() },
                              })
                            }
                          >
                            Open preview artifact
                          </button>
                        </div>
                      )}
                    </article>
                  </div>

                  <article className="jobs-panel">
                    <div className="panel-heading-row">
                      <h3>File Jobs</h3>
                      <StatusChip status={selectedDeviceJobs.filter((job) => ["pending", "running"].includes(job.status)).length ? "running_job" : "ready"} label={`${selectedDeviceJobs.length} jobs`} />
                    </div>
                    <JobList
                      jobs={selectedDeviceJobs}
                      onDownload={handleArtifactDownload}
                      onPromote={promoteArchive}
                      onCancel={cancelJob}
                    />
                  </article>
                </section>
              ) : null}

              {selectedTab === "activity" ? (
                <section className="activity-shell">
                  <article className="jobs-panel">
                    <div className="panel-heading-row">
                      <h3>Operational Activity</h3>
                      <StatusChip status={channelState} />
                      <select value={logLevelFilter} onChange={(event) => setLogLevelFilter(event.target.value)}>
                        <option value="all">all levels</option>
                        <option value="error">error only</option>
                        <option value="warn">warn only</option>
                        <option value="info">info only</option>
                      </select>
                    </div>
                    <div className="log-stack">
                      {logs
                        .filter((log) => logLevelFilter === "all" || log.level === logLevelFilter)
                        .filter((log) => selectedDeviceId === "all" || log.device_id === selectedDeviceId)
                        .filter((log) => !isUser || !log.service_name || log.service_name === "rapor")
                        .map((log) => (
                          <article key={log.id} className={`log-card tone-${statusTone(log.level)}`}>
                            <div className="log-card-top">
                              <strong>{log.message}</strong>
                              <StatusChip status={log.level} />
                            </div>
                            <div className="log-card-meta mono">
                              {formatDate(log.created_at)} · {log.device_id} · {log.service_name || "system"}
                            </div>
                            {log.details ? (
                              <pre className="log-details">{JSON.stringify(log.details, null, 2)}</pre>
                            ) : null}
                          </article>
                        ))}
                    </div>
                  </article>
                </section>
              ) : null}

              {selectedTab === "accounts" && (isSuperAdmin || isOperator) ? (
                <section className="panel-stack">
                  {isSuperAdmin ? (
                    <article className="service-panel">
                      <div className="panel-heading-row">
                        <h3>Approval Policy</h3>
                        <StatusChip
                          status={authPolicy.standaloneUserApprovalMode === "auto" ? "running" : "warn"}
                          label={
                            authPolicy.standaloneUserApprovalMode === "auto"
                              ? "standalone auto"
                              : "standalone manual"
                          }
                        />
                      </div>
                      <div className="service-detail-grid">
                        <label>
                          <span>Operator auto approval</span>
                          <input
                            type="number"
                            min="1"
                            value={authPolicy.operatorAutoApproveHours}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                operatorAutoApproveHours: Number(event.target.value || 24),
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>User lingkungan</span>
                          <input
                            type="number"
                            min="1"
                            value={authPolicy.environmentUserAutoApproveHours}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                environmentUserAutoApproveHours: Number(event.target.value || 8),
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>User standalone</span>
                          <select
                            value={authPolicy.standaloneUserApprovalMode}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                standaloneUserApprovalMode: event.target.value,
                              }))
                            }
                          >
                            <option value="manual">Manual approval</option>
                            <option value="auto">Auto approval</option>
                          </select>
                        </label>
                        <label>
                          <span>Auto approval standalone</span>
                          <input
                            type="number"
                            min="1"
                            value={authPolicy.standaloneUserAutoApproveHours}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                standaloneUserAutoApproveHours: Number(event.target.value || 24),
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Maintenance interval</span>
                          <input
                            type="number"
                            min="1"
                            value={authPolicy.maintenanceIntervalMinutes}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                maintenanceIntervalMinutes: Number(event.target.value || 15),
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>Reset redirect</span>
                          <input
                            value={authPolicy.passwordResetRedirectUrl}
                            onChange={(event) =>
                              setAuthPolicy((current) => ({
                                ...current,
                                passwordResetRedirectUrl: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="panel-actions" style={{ alignItems: "end" }}>
                          <ActionButton
                            className="primary-button"
                            busy={busyAction === "account:updateAuthPolicy"}
                            onClick={() => handleAccountAction("updateAuthPolicy", authPolicy)}
                          >
                            Simpan policy
                          </ActionButton>
                        </div>
                      </div>
                    </article>
                  ) : null}
                  {environments.length ? (
                    <article className="service-panel">
                      <div className="panel-heading-row">
                        <h3>{isSuperAdmin ? "Operator Environments" : "Lingkungan Operator"}</h3>
                        <StatusChip status="ready" label={`${environments.length} lingkungan`} />
                      </div>
                      <div className="job-stack">
                        {environments.map((environment) => (
                          <article key={environment.id} className="job-card">
                            <div className="job-card-top">
                              <div>
                                <strong>{environment.name}</strong>
                                <div className="mono">{environment.referral_code}</div>
                              </div>
                              <div className="service-status-group">
                                <StatusChip status={environment.is_active ? "ready" : "disabled"} label={environment.is_active ? "active" : "inactive"} />
                              </div>
                            </div>
                            <div className="job-actions">
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => copyTextToClipboard(environment.referral_code).then(() => setError("")).catch((copyError) => setError(formatEdgeFunctionError(copyError)))}
                              >
                                Salin kode referral
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => handleAccountAction("rotateReferralCode", { environmentId: environment.id })}
                              >
                                Putar referral code
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </article>
                  ) : (
                    <article className="service-panel">
                      <div className="panel-heading-row">
                        <h3>{isSuperAdmin ? "Operator Environments" : "Lingkungan Operator"}</h3>
                        <StatusChip status="warn" label="belum tersedia" />
                      </div>
                      <div className="empty-state">
                        Kode lingkungan belum tersedia pada sesi ini. Refresh dashboard untuk memuat ulang environment operator.
                      </div>
                    </article>
                  )}
                  <article className="jobs-panel">
                    <div className="panel-heading-row">
                      <h3>Accounts</h3>
                      <StatusChip status="ready" label={`${accounts.length} accounts`} />
                    </div>
                    <div className="service-detail-grid" style={{ marginBottom: 16 }}>
                      <label>
                        <span>Email</span>
                        <input value={createEmail} onChange={(event) => setCreateEmail(event.target.value)} placeholder="user@example.com" />
                      </label>
                      <label>
                        <span>Display name</span>
                        <input value={createDisplayName} onChange={(event) => setCreateDisplayName(event.target.value)} placeholder="Nama pengguna" />
                      </label>
                      <PasswordField
                        label="Password"
                        value={createPassword}
                        onChange={(event) => setCreatePassword(event.target.value)}
                        placeholder="Password sementara"
                        autoComplete="new-password"
                      />
                      <label>
                        <span>Role</span>
                        {isSuperAdmin ? (
                          <select value={createRole} onChange={(event) => setCreateRole(event.target.value)}>
                            <option value="operator">Operator</option>
                            <option value="user">User</option>
                          </select>
                        ) : (
                          <input value="User" disabled readOnly />
                        )}
                      </label>
                      <label>
                        <span>Create as</span>
                        <select value={createApproveImmediately ? "approved" : "pending"} onChange={(event) => setCreateApproveImmediately(event.target.value === "approved")}>
                          <option value="approved">Approved now</option>
                          <option value="pending">Pending approval</option>
                        </select>
                      </label>
                      {createRole === "user" ? (
                        <label>
                          <span>Device awal</span>
                          <select
                            value={createAssignedDeviceId}
                            onChange={(event) => setCreateAssignedDeviceId(event.target.value)}
                            disabled={!deviceEntries.length}
                          >
                            <option value="">
                              {deviceEntries.length ? "Pilih device user" : "Belum ada device tersedia"}
                            </option>
                            {deviceEntries.map((device) => (
                              <option key={device.deviceId} value={device.deviceId}>
                                {device.deviceName} ({device.deviceId})
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <div className="panel-actions" style={{ alignItems: "end" }}>
                        <ActionButton
                          className="primary-button"
                          busy={busyAction === "account:createAccount"}
                          onClick={createManagedAccount}
                        >
                          Buat akun
                        </ActionButton>
                      </div>
                    </div>
                    <div className="job-stack">
                      {accounts.map((account) => (
                        <article key={account.user_id} className={`job-card tone-${statusTone(account.status)}`}>
                          <div className="job-card-top">
                            <div>
                              <strong>{account.display_name || account.email}</strong>
                              <div className="mono">{account.email}</div>
                            </div>
                            <div className="service-status-group">
                              <StatusChip status={account.role} />
                              <StatusChip status={account.status} />
                              {account.membership?.status ? <StatusChip status={account.membership.status} label={`env ${account.membership.status}`} /> : null}
                            </div>
                          </div>
                          <div className="job-card-meta">
                            <span>created {formatDate(account.created_at)}</span>
                            {account.approval_due_at ? (
                              <span>approval {formatRelativeTime(account.approval_due_at)}</span>
                            ) : null}
                            {account.membership?.joined_via ? <span>via {String(account.membership.joined_via).replace(/_/g, " ")}</span> : null}
                          </div>
                          {account.rejection_reason ? <div className="job-error">{account.rejection_reason}</div> : null}
                          <div className="job-actions">
                            {account.status !== "approved" ? (
                              <ActionButton className="primary-button" busy={busyAction === "account:approveAccount"} onClick={() => handleAccountAction("approveAccount", { userId: account.user_id })}>
                                Approve
                              </ActionButton>
                            ) : null}
                            {account.status === "pending" ? (
                              <>
                                <ActionButton className="secondary-button" busy={busyAction === "account:extendApproval"} onClick={() => handleAccountAction("extendApproval", { userId: account.user_id, hours: account.role === "operator" ? authPolicy.operatorAutoApproveHours : authPolicy.environmentUserAutoApproveHours })}>
                                  Extend
                                </ActionButton>
                                <ActionButton className="danger-button" busy={busyAction === "account:rejectAccount"} onClick={() => handleAccountAction("rejectAccount", { userId: account.user_id, reason: "Permintaan akun belum dapat disetujui." })}>
                                  Reject
                                </ActionButton>
                              </>
                            ) : null}
                            {account.status !== "disabled" ? (
                              <ActionButton className="secondary-button" busy={busyAction === "account:disableAccount"} onClick={() => handleAccountAction("disableAccount", { userId: account.user_id })}>
                                Disable
                              </ActionButton>
                            ) : null}
                            <ActionButton className="secondary-button" busy={busyAction === "account:resetPassword"} onClick={() => handleAccountAction("resetPassword", { email: account.email })}>
                              Reset password
                            </ActionButton>
                            {isSuperAdmin && ["operator", "user"].includes(account.role) ? (
                              <ActionButton
                                className="danger-button"
                                busy={busyAction === "account:deleteAccount"}
                                onClick={() => handleDeleteAccount(account)}
                              >
                                Hapus akun
                              </ActionButton>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}
            </>
          ) : (
            <div className="empty-state">Belum ada device yang aktif.</div>
          )}
        </section>
      </div>
        </section>
      </div>
      <MobileNav activeSection={selectedTab} items={dashboardNavItems} onNavigate={navigateRoute} />
    </main>
  );
}
