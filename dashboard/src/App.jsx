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

function buildGuestPath(deviceId) {
  return `/guest/${encodeURIComponent(String(deviceId || "").trim())}`;
}

function buildGuestUrl(deviceId) {
  return `${PUBLIC_DASHBOARD_URL}${buildGuestPath(deviceId)}`;
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
  if (isInvalidSessionError(message)) {
    return "Sesi login telah berakhir. Silakan masuk lagi.";
  }
  return message;
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
      headline: "Akses perangkat sedang diblokir",
      description:
        "Guest monitor tidak bisa membuka E-Rapor sampai perangkat di-unblock oleh administrator.",
      publicStatus: "disabled",
      publicLabel: "Akses publik diblokir",
      runtimeLabel: "Perangkat diblokir",
      ready,
    };
  }

  if (deviceStatus === "offline") {
    return {
      overallStatus: "offline",
      headline: "Perangkat sedang offline",
      description:
        "Agent belum mengirim heartbeat terbaru. Jalankan shortcut School Services atau cek koneksi perangkat.",
      publicStatus: hasPublicUrl ? "unavailable" : "disabled",
      publicLabel: hasPublicUrl ? "URL terakhir tersimpan" : "Belum ada URL publik",
      runtimeLabel: "Agent tidak terhubung",
      ready,
    };
  }

  if (ready) {
    return {
      overallStatus: "ready",
      headline: "E-Rapor siap digunakan",
      description:
        "Koneksi perangkat aktif, layanan E-Rapor sedang running, dan URL publik sudah siap dibuka.",
      publicStatus: "ready",
      publicLabel: "URL publik aktif",
      runtimeLabel: "Layanan running",
      ready,
    };
  }

  if (serviceStatus === "starting") {
    return {
      overallStatus: "starting",
      headline: "E-Rapor sedang dinyalakan",
      description:
        "Perangkat online dan agent sedang memulai service atau menunggu port lokal terbuka.",
      publicStatus: hasPublicUrl ? "reconnecting" : "starting",
      publicLabel: hasPublicUrl ? "URL lama masih tersimpan" : "Menunggu URL publik",
      runtimeLabel: "Sedang starting",
      ready,
    };
  }

  if (serviceStatus === "waiting_retry") {
    return {
      overallStatus: "reconnecting",
      headline: "Koneksi publik sedang dipulihkan",
      description:
        "Service lokal merespons, tetapi tunnel publik sedang retry. Tunggu beberapa saat lalu refresh otomatis.",
      publicStatus: "waiting_retry",
      publicLabel: "Tunnel sedang retry",
      runtimeLabel: "Service lokal tersedia",
      ready,
    };
  }

  if (serviceStatus === "running" && !hasPublicUrl) {
    return {
      overallStatus: "degraded",
      headline: "Service aktif, URL publik belum siap",
      description:
        "E-Rapor sudah running di perangkat, tetapi URL publik belum dipublikasikan atau masih diproses.",
      publicStatus: "starting",
      publicLabel: "Menunggu URL publik",
      runtimeLabel: "Service running",
      ready,
    };
  }

  if (serviceStatus === "error") {
    return {
      overallStatus: "error",
      headline: "Service E-Rapor mengalami error",
      description:
        "Ada error pada service atau tunnel. Lihat pesan error terbaru di bawah untuk tindak lanjut.",
      publicStatus: hasPublicUrl ? "unavailable" : "disabled",
      publicLabel: hasPublicUrl ? "URL publik tidak stabil" : "Belum ada URL publik",
      runtimeLabel: "Service error",
      ready,
    };
  }

  if (desiredState === "stopped" || serviceStatus === "stopped") {
    return {
      overallStatus: "stopped",
      headline: "E-Rapor belum dijalankan",
      description:
        "Perangkat online, tetapi service E-Rapor belum running. Tekan Start atau buka shortcut School Services.",
      publicStatus: hasPublicUrl ? "unavailable" : "disabled",
      publicLabel: hasPublicUrl ? "URL lama tersimpan" : "Belum ada URL publik",
      runtimeLabel: "Service berhenti",
      ready,
    };
  }

  return {
    overallStatus: serviceStatus,
    headline: "Status E-Rapor sedang diperiksa",
    description:
      "Guest monitor terus memantau heartbeat perangkat, status service, dan URL publik secara realtime.",
    publicStatus: hasPublicUrl ? "available" : "disabled",
    publicLabel: hasPublicUrl ? "URL publik tersedia" : "Belum ada URL publik",
    runtimeLabel: "Menunggu pembaruan status",
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
      <div>
        <strong>School Services v2.0.0</strong>
        <p>
          Monitor guest dan dashboard admin untuk E-Rapor dengan fokus pada status realtime,
          akses publik, dan operasional yang rapi.
        </p>
      </div>
      <div className="site-footer-actions">
        <a
          className="secondary-button footer-link-button"
          href={GITHUB_PROFILE_URL}
          target="_blank"
          rel="noreferrer"
        >
          Support GitHub
        </a>
        <a
          className="secondary-button footer-link-button"
          href={PAYPAL_URL}
          target="_blank"
          rel="noreferrer"
        >
          PayPal
        </a>
        <a
          className="secondary-button footer-link-button"
          href={TRAKTEER_URL}
          target="_blank"
          rel="noreferrer"
        >
          Trakteer
        </a>
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
  visible,
  onToggleVisibility,
}) {
  const [internalVisible, setInternalVisible] = useState(false);
  const isVisible = visible !== undefined ? visible : internalVisible;
  
  const toggle = () => {
    if (onToggleVisibility) onToggleVisibility();
    else setInternalVisible(v => !v);
  };

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
          onClick={toggle}
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
  setEmail,
  setPassword,
  setDisplayName,
  setRole,
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
        <div className="login-eyebrow">Secure Admin Control</div>
        <h1>School Services Remote Console</h1>
        <p>
          Masuk sebagai super admin untuk mengontrol fleet, akses file user, backup
          data, dan memantau status agent secara realtime.
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
                <span>Role request</span>
                <select value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="operator">Operator</option>
                  <option value="user">User</option>
                </select>
              </label>
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
                ? "Submitting..."
                : "Signing in..."
              : mode === "register"
                ? "Request access"
                : "Sign in"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setMode(mode === "register" ? "login" : "register")}
          >
            {mode === "register" ? "Back to sign in" : "Need an account?"}
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
      ? "Profil akun belum ditemukan. Coba masuk ulang atau hubungi administrator."
      : profile?.status === "pending"
      ? "Akun Anda sedang menunggu persetujuan administrator."
      : profile?.status === "rejected"
        ? "Permintaan akun Anda ditolak."
        : "Akun Anda dinonaktifkan.";

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-eyebrow">Account Access</div>
        <h1>{profile?.display_name || profile?.email || "Account"}</h1>
        <p>{label}</p>
        {profile?.approval_due_at ? (
          <div className="explorer-warning">
            Auto approval ETA: {formatRelativeTime(profile.approval_due_at)}
          </div>
        ) : null}
        <div className="panel-actions" style={{ marginTop: 16 }}>
          <StatusChip status={profile?.status || "unknown"} />
          {profile?.role ? <StatusChip status={profile.role} /> : null}
        </div>
        <div className="panel-actions" style={{ marginTop: 20 }}>
          <button type="button" className="secondary-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}

function ProfilePanel({ profile, session, onSignOut }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
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
            visible={newPasswordVisible}
            onToggleVisibility={() => setNewPasswordVisible(!newPasswordVisible)}
          />
          <PasswordField
            label="Konfirmasi password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Ulangi password baru"
            autoComplete="new-password"
            disabled={busy}
            visible={newPasswordVisible}
            onToggleVisibility={() => setNewPasswordVisible(!newPasswordVisible)}
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadGuest() {
    try {
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
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGuest();
    const refreshId = window.setInterval(loadGuest, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(refreshId);
  }, [deviceId]);

  useEffect(() => {
    const channel = supabase
      .channel(`guest-console:${deviceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices", filter: `device_id=eq.${deviceId}` },
        () => loadGuest()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "services", filter: `device_id=eq.${deviceId}` },
        () => loadGuest()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [deviceId]);

  async function sendCommand(action) {
    try {
      setBusy(true);
      const { data, error: invokeError } = await supabase.functions.invoke("guest-access", {
        body: { action, deviceId },
      });
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.ok) {
        throw new Error(data?.error || "Guest command failed.");
      }
      await loadGuest();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy(false);
    }
  }

  const service = state.service;
  const guestStatus = getGuestStatusModel(state.device, service);
  const canOpenService = guestStatus.ready;
  const isRunning = service?.status === "running" && service?.desired_state !== "stopped";
  const loginUrl = `${PUBLIC_DASHBOARD_URL}/?mode=login`;
  const registerUrl = `${PUBLIC_DASHBOARD_URL}/?mode=register`;

  return (
    <main className="console-shell guest-console-shell">
      <header className="guest-nav">
        <div className="guest-brand">
          <div className="guest-brand-mark">SS</div>
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
              label={`device ${state.device?.deviceStatus || "offline"}`}
            />
            <StatusChip
              status={service?.status || "offline"}
              label={`service ${service?.status || "offline"}`}
            />
            <StatusChip
              status={guestStatus.publicStatus}
              label={guestStatus.publicLabel}
            />
          </div>
        </div>
        <div className="guest-hero-actions">
          <StatusChip status={guestStatus.overallStatus} label={guestStatus.headline} />
          <button type="button" className={`secondary-button ${loading ? "button-busy" : ""}`} disabled={loading} onClick={loadGuest}>
            {loading ? "Refreshing..." : "Refresh"}
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
                <strong>{state.device?.deviceStatus || "offline"}</strong>
                <StatusChip status={state.device?.deviceStatus || "offline"} />
              </article>
              <article className="metric-card guest-status-card">
                <span>Status service</span>
                <strong>{guestStatus.runtimeLabel}</strong>
                <StatusChip status={service?.status || "offline"} />
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
                  <StatusChip status={state.device?.deviceStatus || "offline"} />
                  <StatusChip status={service?.status || "offline"} />
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
                  <span>Desired state</span>
                  <strong>{service?.desired_state || "-"}</strong>
                </div>
                <div>
                  <span>Last ping</span>
                  <strong>{formatRelativeTime(service?.last_ping)}</strong>
                </div>
                <div>
                  <span>Last heartbeat</span>
                  <strong>{formatRelativeTime(state.device?.lastSeen)}</strong>
                </div>
                
              </div>

              
              {service?.last_error ? <div className="job-error">{service.last_error}</div> : null}

              <div className="guest-cta-row">
                <div className="panel-actions">
                  <button
                    type="button"
                    className={`primary-button ${busy ? "button-busy" : ""}`}
                    disabled={busy}
                    onClick={() => sendCommand("start")}
                  >
                    {busy ? "Starting..." : "Start Service"}
                  </button>
                  <button
                    type="button"
                    className={`secondary-button ${busy ? "button-busy" : ""}`}
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
      
    </main>
  );
}

function PasswordResetScreen() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
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
      setInfo("Password baru berhasil disimpan. Mengalihkan ke halaman login...");
      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
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
            disabled={busy || !ready}
            visible={newPasswordVisible}
            onToggleVisibility={() => setNewPasswordVisible(!newPasswordVisible)}
          />
          <PasswordField
            label="Konfirmasi password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Ulangi password baru"
            autoComplete="new-password"
            disabled={busy || !ready}
            visible={newPasswordVisible}
            onToggleVisibility={() => setNewPasswordVisible(!newPasswordVisible)}
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
          <div className="device-list-meta mono">{device.deviceId}</div>
          <div className="device-list-foot">
            <span>{device.runningCount} running</span>
            <span>{device.fileJobCount} jobs</span>
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
  const requestedAuthMode =
    typeof window !== "undefined"
      ? new URLSearchParams(currentSearch).get("mode")
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
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [authPolicy, setAuthPolicy] = useState({
    autoApproveEnabled: true,
    approvalWindowHours: 24,
    maintenanceIntervalMinutes: 15,
    passwordResetRedirectUrl: `${PUBLIC_DASHBOARD_URL}/reset-password`,
  });
  const [services, setServices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [fileJobs, setFileJobs] = useState([]);
  const [roots, setRoots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("all");
  const [selectedTab, setSelectedTab] = useState("overview");
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
  const [createAutoApprove, setCreateAutoApprove] = useState(false);
  const fileInputRef = useRef(null);

  function resetAuthenticatedState() {
    setSession(null);
    setProfile(null);
    setProfileLoading(false);
    setAccounts([]);
    setServices([]);
    setLogs([]);
    setFileJobs([]);
    setRoots([]);
    setLoading(true);
    setError("");
    setSelectedDeviceId("all");
    setSelectedTab("overview");
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
    setCreateAutoApprove(false);
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

  async function loadAll(background = false) {
    if (!session || guestDeviceId) {
      return;
    }

    if (!background) {
      setLoading(true);
    }

    const [servicesResult, logsResult, jobsResult, rootsResult, accountsResult, settingsResult] = await Promise.all([
      supabase
        .from("services")
        .select("*, devices(device_name, status, last_seen)")
        .order("device_id", { ascending: true })
        .order("service_name", { ascending: true }),
      supabase
        .from("agent_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(LOG_LIMIT),
      supabase
        .from("file_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(JOB_LIMIT),
      supabase
        .from("file_roots")
        .select("*")
        .order("root_type", { ascending: true })
        .order("label", { ascending: true }),
      profile?.role === "super_admin"
        ? invokeAdmin("listAccounts").catch((invokeError) => ({
            ok: false,
            error: invokeError.message,
          }))
        : Promise.resolve(null),
      profile?.role === "super_admin"
        ? invokeAdmin("setupStatus").catch((invokeError) => ({
            ok: false,
            error: invokeError.message,
          }))
        : Promise.resolve(null),
    ]);

    const nextError =
      servicesResult.error?.message ||
      logsResult.error?.message ||
      jobsResult.error?.message ||
      rootsResult.error?.message ||
      (accountsResult && accountsResult.ok === false ? accountsResult.error : "") ||
      (settingsResult && settingsResult.ok === false ? settingsResult.error : "") ||
      "";

    setError(nextError);
    if (!nextError) {
      startTransition(() => {
        setServices(servicesResult.data || []);
        setLogs(logsResult.data || []);
        setFileJobs(jobsResult.data || []);
        setRoots(rootsResult.data || []);
        if (accountsResult?.ok) {
          setAccounts(accountsResult.accounts || []);
        }
        if (settingsResult?.ok && settingsResult.authPolicy) {
          setAuthPolicy(settingsResult.authPolicy);
        }
      });
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
    const channel = supabase
      .channel("remote-control-plane")
      .on("postgres_changes", { event: "*", schema: "public", table: "services" }, () => loadAll(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, () => loadAll(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_logs" }, () => loadAll(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "file_jobs" }, () => loadAll(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "file_roots" }, () => loadAll(true))
      .subscribe((status) => setChannelState(String(status || "").toLowerCase()));

    const refreshId = window.setInterval(() => {
      loadAll(true);
      setNow(Date.now());
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshId);
      supabase.removeChannel(channel);
    };
  }, [session, profile, guestDeviceId]);

  useEffect(() => {
    if (selectedDeviceId !== "all" && !services.some((row) => row.device_id === selectedDeviceId)) {
      setSelectedDeviceId("all");
    }
  }, [services, selectedDeviceId]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    if (profile.role !== "super_admin" && ["files", "accounts"].includes(selectedTab)) {
      setSelectedTab("overview");
    }
  }, [profile, selectedTab]);

  const deviceEntries = useMemo(() => {
    const grouped = new Map();
    for (const row of services) {
      const deviceRecord = Array.isArray(row.devices) ? row.devices[0] : row.devices;
      const deviceStatus = deriveDeviceStatus(deviceRecord);
      const serviceStatus = deriveServiceStatus(row, deviceStatus);

      if (!grouped.has(row.device_id)) {
        grouped.set(row.device_id, {
          deviceId: row.device_id,
          deviceName: deviceRecord?.device_name || row.device_id,
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
  }, [services, fileJobs]);

  const selectedDevice =
    selectedDeviceId === "all"
      ? deviceEntries[0] || null
      : deviceEntries.find((entry) => entry.deviceId === selectedDeviceId) || null;
  const selectedGuestUrl = selectedDevice ? buildGuestUrl(selectedDevice.deviceId) : "";

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
        });
        setAuthInfo(
          "Registration received. Sign in with the same credentials to view approval status."
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
        if (/invalid login credentials/i.test(signInError.message)) {
          setAuthError("Email atau kata sandi yang Anda masukkan belum tepat.");
        } else if (/email not confirmed/i.test(signInError.message)) {
          setAuthError("Email belum terkonfirmasi.");
        } else {
          setAuthError(signInError.message);
        }
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

      setAuthInfo("Email verifikasi untuk ganti password sudah dikirim. Buka email Anda, verifikasi tautan, lalu buat password baru.");
    } catch (forgotError) {
      setAuthError(formatEdgeFunctionError(forgotError));
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    setAuthLoading(true);
    setAuthError("");
    setAuthInfo("");
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
    }
  }

  async function queueCommand(deviceId, serviceName, action) {
    setBusyAction(`${deviceId}:${serviceName || "device"}:${action}`);
    setError("");
    const { error: insertError } = await supabase.from("commands").insert({
      device_id: deviceId,
      service_name: serviceName,
      action,
      status: "pending",
    });
    setBusyAction("");
    if (insertError) {
      setError(insertError.message);
      return;
    }
    loadAll(true);
  }

  async function updateDeviceStatus(deviceId, status) {
    setBusyAction(`${deviceId}:${status}`);
    const { error: updateError } = await supabase
      .from("devices")
      .update({ status })
      .eq("device_id", deviceId);
    setBusyAction("");
    if (updateError) {
      setError(updateError.message);
      return;
    }
    loadAll(true);
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
      setError(jobError.message);
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
      setError(copyError.message);
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
      setError(accountError.message);
    } finally {
      setBusyAction("");
    }
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
      autoApprove: createAutoApprove,
      approvalWindowHours: authPolicy.approvalWindowHours,
    });

    setCreateEmail("");
    setCreatePassword("");
    setCreateDisplayName("");
    setCreateRole("operator");
    setCreateAutoApprove(false);
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
      setError(downloadError.message);
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
      setError(promoteError.message);
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
      setError(cancelError.message);
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
      setError(uploadError.message);
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
        setEmail={() => {}}
        setPassword={() => {}}
        setDisplayName={() => {}}
        setRole={() => {}}
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
        setEmail={setLoginEmail}
        setPassword={setLoginPassword}
        setDisplayName={setRegisterDisplayName}
        setRole={setRegisterRole}
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

  return (
    <main className="console-shell">
      <header className="topbar">
        <div>
          <div className="section-eyebrow">
            {isSuperAdmin ? "Authenticated Admin Console" : isOperator ? "Operator Console" : "User Console"}
          </div>
          <h1>School Services Remote Control</h1>
          <p>
            {isSuperAdmin
              ? "Kontrol service, akses file user, backup data, approval account, dan pantau error agent dalam satu console realtime."
              : isOperator
                ? "Pantau device dan kontrol service dari device yang tersedia."
                : "Pantau E-Rapor dan status device secara realtime."}
          </p>
        </div>
        <div className="topbar-actions">
          <StatusChip status={channelState || "connecting"} label={channelState || "connecting"} />
          <button type="button" className="secondary-button" onClick={() => loadAll()}>
            Refresh
          </button>
          <button type="button" className="secondary-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="console-grid">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Fleet</h2>
            <button type="button" className="utility-button" onClick={() => setSelectedDeviceId("all")}>
              All
            </button>
          </div>
          <DeviceList
            devices={deviceEntries}
            selectedDeviceId={selectedDeviceId}
            onSelect={setSelectedDeviceId}
            now={now}
          />
        </aside>

        <section className="workspace">
          <nav className="tabbar">
            {[
              ["overview", "Overview"],
              ...(isSuperAdmin ? [["files", "Remote Files"]] : []),
              ["activity", "Activity"],
              ["profile", "Profile"],
              ...(isSuperAdmin || isOperator ? [["accounts", "Accounts"]] : []),
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`tab-button ${selectedTab === id ? "tab-button-active" : ""}`}
                onClick={() => setSelectedTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {selectedTab === "profile" ? (
            <ProfilePanel profile={profile} session={session} onSignOut={signOut} />
          ) : selectedDevice ? (
            <>
              {selectedTab === "overview" ? (
                <section className="panel-stack">
                  <article className="device-panel">
                    <div className="device-panel-top">
                      <div>
                        <h2>{selectedDevice.deviceName}</h2>
                        <div className="mono">{selectedDevice.deviceId}</div>
                      </div>
                      <StatusChip status={selectedDevice.deviceStatus} />
                    </div>
                    <div className="metric-grid">
                      <div className="metric-card">
                        <span>Heartbeat</span>
                        <strong>{formatRelativeTime(selectedDevice.deviceRecord?.last_seen, now)}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Services running</span>
                        <strong>{selectedDevice.runningCount}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Active file jobs</span>
                        <strong>{selectedDevice.fileJobCount}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Needs attention</span>
                        <strong>{selectedDevice.issueCount}</strong>
                      </div>
                    </div>
                  </article>

                  <article className="service-panel">
                    <div className="panel-heading-row">
                      <h3>Service Control</h3>
                      <div className="panel-actions">
                        {isSuperAdmin ? (
                          <>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busyAction !== ""}
                              onClick={() => queueCommand(selectedDevice.deviceId, null, "kill")}
                            >
                              Stop agent
                            </button>
                            <button
                              type="button"
                              className={selectedDevice.deviceStatus === "blocked" ? "primary-button" : "danger-button"}
                              disabled={busyAction !== ""}
                              onClick={() =>
                                updateDeviceStatus(
                                  selectedDevice.deviceId,
                                  selectedDevice.deviceStatus === "blocked" ? "active" : "blocked"
                                )
                              }
                            >
                              {selectedDevice.deviceStatus === "blocked" ? "Unblock device" : "Block device"}
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busyAction !== ""}
                              onClick={() => copyGuestLink(selectedDevice.deviceId)}
                            >
                              Sync guest shortcut
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {isSuperAdmin ? (
                      <div className="metric-card guest-monitor-card">
                        <span>Guest monitor link</span>
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
                              <span>{getPublicUrlLabel(service)}</span>
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
                              <span>Resolved path</span>
                              <strong className="mono">{service.resolved_path || "-"}</strong>
                            </div>
                            <div>
                              <span>Last ping</span>
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
                            <button
                              type="button"
                              className="primary-button"
                              disabled={busyAction !== "" || runningNow}
                              onClick={() => queueCommand(selectedDevice.deviceId, service.service_name, "start")}
                            >
                              Start
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busyAction !== "" || !runningNow}
                              onClick={() => queueCommand(selectedDevice.deviceId, service.service_name, "stop")}
                            >
                              Stop
                            </button>
                          </div>
                        </article>
                      )})}
                    </div>
                  </article>
                </section>
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
                      <StatusChip status={authPolicy.autoApproveEnabled ? "running" : "warn"} label={authPolicy.autoApproveEnabled ? "auto approve on" : "manual approval"} />
                    </div>
                    <div className="service-detail-grid">
                      <label>
                        <span>Approval window</span>
                        <input
                          type="number"
                          min="1"
                          value={authPolicy.approvalWindowHours}
                          onChange={(event) =>
                            setAuthPolicy((current) => ({
                              ...current,
                              approvalWindowHours: Number(event.target.value || 24),
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
                      <label>
                        <span>Auto approve</span>
                        <select
                          value={authPolicy.autoApproveEnabled ? "enabled" : "disabled"}
                          onChange={(event) =>
                            setAuthPolicy((current) => ({
                              ...current,
                              autoApproveEnabled: event.target.value === "enabled",
                            }))
                          }
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <div className="panel-actions" style={{ alignItems: "end" }}>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => handleAccountAction("updateAuthPolicy", authPolicy)}
                        >
                          Save policy
                        </button>
                      </div>
                    </div>
                  </article>
                  ) : null}
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
                        <select value={createRole} onChange={(event) => setCreateRole(event.target.value)}>
                          <option value="operator">Operator</option>
                          <option value="user">User</option>
                        </select>
                      </label>
                      <label>
                        <span>Create as</span>
                        <select value={createAutoApprove ? "pending" : "approved"} onChange={(event) => setCreateAutoApprove(event.target.value === "pending")}>
                          <option value="approved">Approved now</option>
                          <option value="pending">Pending approval</option>
                        </select>
                      </label>
                      <div className="panel-actions" style={{ alignItems: "end" }}>
                        <button type="button" className="primary-button" onClick={createManagedAccount}>
                          Create account
                        </button>
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
                            </div>
                          </div>
                          <div className="job-card-meta">
                            <span>created {formatDate(account.created_at)}</span>
                            {account.approval_due_at ? (
                              <span>approval {formatRelativeTime(account.approval_due_at)}</span>
                            ) : null}
                          </div>
                          {account.rejection_reason ? <div className="job-error">{account.rejection_reason}</div> : null}
                          <div className="job-actions">
                            {account.status !== "approved" ? (
                              <button type="button" className="primary-button" onClick={() => handleAccountAction("approveAccount", { userId: account.user_id })}>
                                Approve
                              </button>
                            ) : null}
                            {account.status === "pending" ? (
                              <>
                                <button type="button" className="secondary-button" onClick={() => handleAccountAction("extendApproval", { userId: account.user_id, hours: authPolicy.approvalWindowHours })}>
                                  Extend
                                </button>
                                <button type="button" className="danger-button" onClick={() => handleAccountAction("rejectAccount", { userId: account.user_id, reason: "Rejected by administrator." })}>
                                  Reject
                                </button>
                              </>
                            ) : null}
                            {account.status !== "disabled" ? (
                              <button type="button" className="secondary-button" onClick={() => handleAccountAction("disableAccount", { userId: account.user_id })}>
                                Disable
                              </button>
                            ) : null}
                            <button type="button" className="secondary-button" onClick={() => handleAccountAction("resetPassword", { email: account.email })}>
                              Reset password
                            </button>
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
    </main>
  );
}
