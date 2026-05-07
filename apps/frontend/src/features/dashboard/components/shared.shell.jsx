import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Gauge,
  Info,
  LayoutDashboard,
  LogOut,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlink,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { legacyDataClient } from "../../../services/legacyDataClient.js";
import { supabase } from "../../../services/providers/supabase/supabaseClient.js";
import { GUEST_BRAND_ICON } from "../../../app/lib/constants.js";
import { getRouteCopy } from "../../../app/lib/routes.js";
import { invokeEdgeFunction } from "../../../app/lib/edgeFunctions.js";
import {
  formatRelativeTime,
  getAgentStatusBadgeModel,
  getDeviceConnectivityBadgeModel,
  getDeviceStatusBadgeModel,
  getStatusLabel,
  statusTone,
} from "../../../app/lib/status.js";
import { getDeviceUpdateModel, getUpdateStatusSummary } from "../../../app/lib/update.js";
import {
  buildBreadcrumbs,
  formatArtifactDetailValue,
  formatBytes,
  formatDate,
  getFileKindLabel,
  getItemGlyph,
  getJobStatusDetail,
  safeFileNameFromKey,
} from "../../../app/lib/files.js";
import {
  clearStoredAuthArtifacts,
  formatPasswordUpdateError,
  isInvalidSessionError,
} from "../../../app/lib/errors.js";
import {
  ActionButton,
  DetailDrawer,
  IconButton,
  LongText,
  MaskedTextField,
  PasswordField as SharedPasswordField,
  ProfileInfoField,
  Skeleton,
  StatusChip,
} from "../../../components/ui/core.jsx";
import { MetricTile } from "./shared.primitives.jsx";

function NavIcon({ section }) {
  const icons = {
    overview: LayoutDashboard,
    devices: Monitor,
    files: FolderOpen,
    activity: Activity,
    accounts: Users,
    profile: User,
  };
  const Icon = icons[section] || icons.overview;
  return <Icon className="nav-icon" size={21} strokeWidth={2.2} aria-hidden="true" />;
}

function getDashboardNavItems({ isSuperAdmin, isOperator, deviceCount, pendingAccounts, runningJobs }) {
  return [
    { id: "overview", label: "Ringkasan", helper: "Kondisi utama", badge: deviceCount },
    { id: "devices", label: "Perangkat", helper: "Nama dan layanan", badge: deviceCount },
    ...(isSuperAdmin ? [{ id: "files", label: "Berkas", helper: "Kelola berkas", badge: runningJobs }] : []),
    { id: "activity", label: "Aktivitas", helper: "Riwayat terbaru", badge: runningJobs },
    ...((isSuperAdmin || isOperator)
      ? [{ id: "accounts", label: "Akun", helper: "Pengguna dan akses", badge: pendingAccounts }]
      : []),
    { id: "profile", label: "Profil", helper: "Data akun" },
  ];
}

function NotificationPopover({ open, items, onClose }) {
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        onClose?.();
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div ref={popoverRef} className="notification-popover" role="dialog" aria-label="Notifikasi dashboard">
      <div className="notification-popover-head">
        <div>
          <span className="section-eyebrow">Notifikasi</span>
          <strong>Ringkasan sistem</strong>
        </div>
        <IconButton label="Tutup notifikasi" icon={X} onClick={onClose} />
      </div>
      <div className="notification-popover-list">
        {items.length ? (
          items.map((item) => {
            const Icon = item.icon || Info;
            return (
              <article key={item.id} className={`notification-item tone-${item.tone || "neutral"}`}>
                <Icon size={17} strokeWidth={2.2} aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState title="Tidak ada notifikasi" description="Semua status utama sedang normal." />
        )}
      </div>
    </div>
  );
}

function SidebarNav({
  profile,
  activeSection,
  items,
  onNavigate,
  pinned = false,
  onTogglePinned,
  onExpandedChange,
}) {
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  return (
    <aside
      className={`app-sidebar collapsible-sidebar ${pinned ? "is-pinned" : ""} ${expanded ? "is-expanded" : ""}`}
      aria-label="Navigasi dashboard"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setHovered(false);
        }
      }}
    >
      <div className="app-sidebar-brand">
        <img src={GUEST_BRAND_ICON} alt="" aria-hidden="true" />
        <div className="app-sidebar-copy">
          <strong>School Services</strong>
          <span>{profile.email || getStatusLabel(profile.role)}</span>
        </div>
        <IconButton
          label={pinned ? "Collapse sidebar" : "Pin sidebar"}
          icon={pinned ? PanelLeftClose : PanelLeftOpen}
          className="sidebar-pin-button"
          onClick={onTogglePinned}
        />
      </div>
      <nav className="app-nav-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`app-nav-item ${activeSection === item.id ? "app-nav-item-active" : ""}`}
            aria-current={activeSection === item.id ? "page" : undefined}
            onClick={() => {
              onNavigate(item.id);
              if (!pinned) {
                setHovered(false);
              }
            }}
          >
            <span className="app-nav-icon-shell">
              <NavIcon section={item.id} />
              {Number(item.badge || 0) > 0 ? <span className="app-nav-icon-badge">{item.badge}</span> : null}
            </span>
            <span className="app-nav-copy">
              <strong>{item.label}</strong>
              <small>{item.helper}</small>
            </span>
            {Number(item.badge || 0) > 0 ? <span className="app-nav-badge">{item.badge}</span> : null}
          </button>
        ))}
      </nav>
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

function TopCommandBar({
  profile,
  loading,
  authBusy,
  onRefresh,
  onSignOut,
  notifications = [],
  notificationOpen = false,
  onNotificationToggle,
  onNotificationClose,
}) {
  const notificationCount = notifications.length;
  return (
    <header className="top-command-bar" aria-label="Status dan aksi cepat">
      <div className="workspace-switcher">
        <span className="workspace-logo" aria-hidden="true">
          <ShieldCheck size={18} strokeWidth={2.4} />
        </span>
        <div>
          <strong>{profile.display_name || "School Services"}</strong>
          <small>{profile.email || getStatusLabel(profile.role)}</small>
        </div>
      </div>
      <div className="top-command-spacer" />
      <div className="notification-anchor">
        <button
          type="button"
          className={`icon-button notification-button ${notificationOpen ? "is-active" : ""}`}
          aria-label="Buka notifikasi"
          aria-expanded={notificationOpen}
          onClick={onNotificationToggle}
        >
          <Bell size={17} strokeWidth={2.2} aria-hidden="true" />
          {notificationCount ? <span className="notification-count">{notificationCount}</span> : null}
        </button>
        <NotificationPopover open={notificationOpen} items={notifications} onClose={onNotificationClose} />
      </div>
      <ActionButton className="secondary-button action-refresh" busy={loading} icon={RefreshCw} onClick={onRefresh}>
        Refresh
      </ActionButton>
      <ActionButton className="secondary-button action-session" busy={authBusy} icon={LogOut} onClick={onSignOut}>
        Log Out
      </ActionButton>
    </header>
  );
}

function getPriorityBanner({ route, profile, devices, fileJobs, accounts }) {
  const onlineDevices = devices.filter((device) => device.deviceStatus !== "offline").length;
  const stoppedAgents = devices.filter((device) => device.agentStatus === "stopped").length;
  const runningJobs = fileJobs.filter((job) => ["pending", "running"].includes(job.status)).length;
  const pendingAccounts = accounts.filter((account) => account.status === "pending").length;

  if (route.section === "files") {
    return {
      icon: FolderOpen,
      tone: "files",
      title: "File library Supabase menjadi tampilan utama.",
      description: `${runningJobs} aktivitas berjalan. Berkas dikelompokkan per bucket supaya arsip mudah dicari.`,
    };
  }
  if (route.section === "accounts" && pendingAccounts) {
    return {
      icon: UserPlus,
      tone: "warn",
      title: `${pendingAccounts} akun menunggu keputusan.`,
      description: "Setujui atau tolak akun dari daftar akun agar akses sekolah tetap terkendali.",
    };
  }
  return {
    icon: Sparkles,
    tone: "good",
    title: `${onlineDevices}/${devices.length || 0} perangkat siap dipantau.`,
    description:
      profile.role === "super_admin"
        ? "Status perangkat, akun, update, dan berkas sudah diprioritaskan dari satu dashboard."
        : "Status layanan utama ditampilkan dulu agar akses E-Rapor mudah dipastikan.",
  };
}

function PriorityBanner({ route, profile, devices, fileJobs, accounts }) {
  const banner = getPriorityBanner({ route, profile, devices, fileJobs, accounts });
  const Icon = banner.icon;
  return (
    <section className={`priority-banner tone-${banner.tone}`}>
      <span className="priority-banner-icon" aria-hidden="true">
        <Icon size={22} strokeWidth={2.2} />
      </span>
      <div>
        <strong>{banner.title}</strong>
        <p>{banner.description}</p>
      </div>
    </section>
  );
}

function RouteHeader({ route, profile, breadcrumbs = [] }) {
  const copy = getRouteCopy(route.section, profile.role);
  return (
    <header className="app-route-header">
      <div>
        {breadcrumbs.length ? (
          <nav className="route-breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((item, index) => (
              <span key={`${item.label}-${index}`} className="route-breadcrumb-item">
                {index > 0 ? <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" /> : null}
                <span>{item.label}</span>
              </span>
            ))}
          </nav>
        ) : null}
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </div>
    </header>
  );
}

function DashboardStats({ devices, fileJobs, accounts, now }) {
  const onlineDevices = devices.filter((device) => device.deviceStatus !== "offline").length;
  const controlReadyDevices = devices.filter((device) => device.agentControlReady).length;
  const runningServices = devices.reduce((total, device) => total + device.runningCount, 0);
  const issueCount = devices.reduce((total, device) => total + device.issueCount, 0);
  const runningJobs = fileJobs.filter((job) => ["pending", "running"].includes(job.status)).length;
  const pendingAccounts = accounts.filter((account) => account.status === "pending").length;

  return (
    <section className="dashboard-stats-grid" aria-label="Ringkasan dashboard">
      {[
        ["Perangkat aktif", `${onlineDevices}/${devices.length}`, "Perangkat yang tersambung saat ini.", Monitor],
        ["Kontrol agent siap", `${controlReadyDevices}/${devices.length}`, "Device yang bisa menerima Start/Stop Agent.", ShieldCheck],
        ["Layanan aktif", runningServices, "Layanan yang siap digunakan.", Server],
        ["Perlu perhatian", issueCount, "Perangkat atau layanan yang perlu dicek.", AlertTriangle],
        ["Proses berkas", runningJobs, "Aktivitas berkas yang sedang berlangsung.", FileText],
        ["Akun menunggu", pendingAccounts, "Akun yang menunggu persetujuan.", Users],
      ].map(([label, value, helper, icon]) => (
        <MetricTile key={label} label={label} value={value} helper={helper} icon={icon} />
      ))}
      <MetricTile
        label="Update data"
        value={formatRelativeTime(new Date(now).toISOString(), now)}
        helper="Data diperbarui otomatis tanpa memuat ulang halaman."
        icon={RefreshCw}
      />
    </section>
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
    const currentPasswordValue = String(currentPassword || "");
    const nextPasswordValue = String(nextPassword || "");
    const confirmPasswordValue = String(confirmPassword || "");

    if (!currentPasswordValue) {
      setError("Password saat ini wajib diisi.");
      setInfo("");
      return;
    }

    if (nextPasswordValue.length < 8) {
      setError("Password baru minimal 8 karakter.");
      setInfo("");
      return;
    }

    if (currentPasswordValue === nextPasswordValue) {
      setError("Password baru tidak boleh sama dengan password saat ini.");
      setInfo("");
      return;
    }

    if (nextPasswordValue !== confirmPasswordValue) {
      setError("Konfirmasi password tidak cocok.");
      setInfo("");
      return;
    }

    try {
      setBusy(true);
      setError("");
      setInfo("");
      await invokeEdgeFunction("account-access", {
        action: "changeOwnPassword",
        currentPassword: currentPasswordValue,
        nextPassword: nextPasswordValue,
      }, session);
      await legacyDataClient.auth.signOut({ scope: "global" }).catch(() =>
        legacyDataClient.auth.signOut({ scope: "local" }).catch(() => {})
      );
      clearStoredAuthArtifacts();
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setInfo("Password berhasil diperbarui. Silakan login ulang.");
      window.setTimeout(() => {
        onSignOut();
      }, 700);
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
    <section className="panel-stack profile-panel-shell">
      <article className="service-panel profile-summary-panel">
        <div className="panel-heading-row">
          <h3>Profil</h3>
          <div className="service-status-group">
            <StatusChip status={profile?.status || "unknown"} />
            {profile?.role ? <StatusChip status={profile.role} /> : null}
          </div>
        </div>
        <div className="profile-identity-grid">
          <ProfileInfoField label="Nama" value={profile?.display_name || "-"} />
          <ProfileInfoField label="Email" value={profile?.email || session?.user?.email || ""} />
          <ProfileInfoField label="ID akun" value={session?.user?.id || ""} mono />
        </div>
      </article>

      <article className="service-panel profile-password-panel">
        <div className="panel-heading-row">
          <h3>Ganti Password</h3>
        </div>
        <div className="profile-password-grid">
          <SharedPasswordField
            label="Password saat ini"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="********"
            autoComplete="current-password"
            disabled={busy}
          />
          <SharedPasswordField
            label="Password baru"
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
            placeholder="8 karakter atau lebih"
            autoComplete="new-password"
            disabled={busy}
            visible={showNextPasswords}
            onToggleVisibility={() => setShowNextPasswords((current) => !current)}
          />
          <SharedPasswordField
            label="Konfirmasi password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="8 karakter atau lebih"
            autoComplete="new-password"
            disabled={busy}
            visible={showNextPasswords}
            onToggleVisibility={() => setShowNextPasswords((current) => !current)}
          />
        </div>
        <div className="profile-password-actions">
          <button
            type="button"
            className="primary-button action-save action-button"
            disabled={busy || !currentPassword || !nextPassword || !confirmPassword}
            onClick={submitPasswordChange}
          >
            {busy ? "Menyimpan..." : "Simpan password"}
          </button>
          <button type="button" className="secondary-button action-session action-button" disabled={busy} onClick={onSignOut}>
            Log Out
          </button>
        </div>
        {error ? <div className="job-error">{error}</div> : null}
        {info ? <div className="service-note">{info}</div> : null}
      </article>
    </section>
  );
}

export {
  DashboardStats,
  getDashboardNavItems,
  MobileNav,
  PriorityBanner,
  ProfilePanel,
  RouteHeader,
  SidebarNav,
  TopCommandBar
};
