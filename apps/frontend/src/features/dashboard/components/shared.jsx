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

function dismissOnBackdrop(event, onClose) {
  if (event.target === event.currentTarget) {
    onClose?.();
  }
}

function getRouteBreadcrumbs(route, profile, options = {}) {
  const items = [
    { label: profile?.role === "super_admin" ? "SuperAdmin" : profile?.role === "operator" ? "Operator" : "User" },
  ];
  const copy = getRouteCopy(route.section, profile?.role || "user");
  items.push({ label: copy.title });

  if (route.section === "files" && options.filesView) {
    items.push({ label: options.filesView === "remote" ? "Remote File" : "Storage" });
  }
  if (route.section === "devices" && options.deviceName) {
    items.push({ label: options.deviceName });
  }
  if (route.section === "activity" && options.deviceName) {
    items.push({ label: options.deviceName });
  }

  return items;
}

function normalizeLoginEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLoginPassword(value) {
  return String(value || "");
}

function getActivityLabel(value) {
  const normalized = String(value || "").trim();
  const labels = {
    list_directory: "Buka folder",
    discover_roots: "Muat lokasi",
    preview_file: "Lihat file",
    download_file: "Unduh file",
    archive_paths: "Siapkan arsip",
    upload_place: "Unggah file",
    transfer: "Aktivitas berkas",
    activity: "Aktivitas",
    complete_preview_file: "Pratinjau selesai",
    complete_download_file: "Unduhan selesai",
    complete_archive_paths: "Arsip selesai",
    complete_upload_place: "Unggahan selesai",
  };
  return labels[normalized] || normalized.replace(/_/g, " ");
}

function truncateText(value, maxLength = 42) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(12, maxLength - 12))}...${text.slice(-8)}`;
}

function Surface({ children, className = "", as: Component = "section", ...props }) {
  return (
    <Component className={`surface ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}

function SectionHeader({ eyebrow, title, description, actions = null }) {
  return (
    <div className="section-header">
      <div>
        {eyebrow ? <span className="section-eyebrow">{eyebrow}</span> : null}
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="toolbar">{actions}</div> : null}
    </div>
  );
}

function EmptyState({ title = "Belum ada data", description = "" }) {
  return (
    <div className="empty-state clean-empty-state">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function MetricTile({ label, value, helper, icon: Icon = Gauge }) {
  return (
    <article className="dashboard-stat-card metric-tile">
      <span className="metric-tile-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </article>
  );
}

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

function matchesDeviceQuery(device, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [device.deviceName, device.deviceAlias, device.rawDeviceName, device.deviceId]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(needle));
}

function DeviceCombobox({
  devices,
  selectedDeviceId,
  onSelect,
  label = "Perangkat",
  includeAll = false,
  allLabel = "Semua device",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const comboboxRef = useRef(null);
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId) || null;
  const filteredDevices = devices.filter((device) => matchesDeviceQuery(device, query)).slice(0, 12);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function closeOnOutside(event) {
      if (comboboxRef.current && !comboboxRef.current.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectDevice(deviceId) {
    onSelect(deviceId);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={`device-combobox ${open ? "is-open" : ""} ${className}`.trim()} ref={comboboxRef}>
      <label className="device-combobox-label">{label}</label>
      <button
        type="button"
        className="device-combobox-current"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <strong>{selectedDevice ? selectedDevice.deviceName : allLabel}</strong>
          <small>
            {selectedDevice
              ? `${selectedDevice.deviceId}${selectedDevice.deviceAlias ? ` | Alias: ${selectedDevice.deviceAlias}` : ""}`
              : "Menampilkan seluruh perangkat"}
          </small>
        </span>
        <span className="device-combobox-current-meta">
          {selectedDevice ? (
            <>
              <StatusChip
                status={getDeviceStatusBadgeModel(selectedDevice.deviceStatus).status}
                label={getDeviceStatusBadgeModel(selectedDevice.deviceStatus).label}
              />
              <StatusChip
                status={getAgentStatusBadgeModel(selectedDevice.agentStatus).status}
                label={getAgentStatusBadgeModel(selectedDevice.agentStatus).label}
              />
              <StatusChip
                status={getDeviceConnectivityBadgeModel(selectedDevice.connectivityStatus).status}
                label={getDeviceConnectivityBadgeModel(selectedDevice.connectivityStatus).label}
              />
            </>
          ) : (
            <StatusChip status="ready" label={`${devices.length} device`} />
          )}
          <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div className="device-combobox-menu">
          <div className="device-combobox-search">
            <Search size={16} strokeWidth={2.2} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari nama device, alias, atau device id"
              aria-label={`Cari ${label.toLowerCase()}`}
            />
          </div>
          {includeAll ? (
            <button
              type="button"
              className={`device-combobox-option ${selectedDeviceId === "all" ? "is-selected" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectDevice("all")}
            >
              <span>
                <strong>{allLabel}</strong>
                <small>Gabungan semua perangkat</small>
              </span>
              <StatusChip status="ready" label={`${devices.length} device`} />
            </button>
          ) : null}
          {filteredDevices.length ? (
            filteredDevices.map((device) => {
              const badge = getDeviceStatusBadgeModel(device.deviceStatus);
              const agentBadge = getAgentStatusBadgeModel(device.agentStatus);
              const connectivityBadge = getDeviceConnectivityBadgeModel(device.connectivityStatus);
              return (
                <button
                  key={device.deviceId}
                  type="button"
                  className={`device-combobox-option ${device.deviceId === selectedDeviceId ? "is-selected" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectDevice(device.deviceId)}
                >
                  <span>
                    <strong>{device.deviceName}</strong>
                    <small>{device.deviceId}</small>
                    {device.deviceAlias ? <small>Alias: {device.deviceAlias}</small> : null}
                  </span>
                  <span className="fresh-pill-group">
                    <StatusChip status={badge.status} label={badge.label} />
                    <StatusChip status={agentBadge.status} label={agentBadge.label} />
                    <StatusChip status={connectivityBadge.status} label={connectivityBadge.label} />
                  </span>
                </button>
              );
            })
          ) : (
            <div className="device-combobox-empty">Device tidak ditemukan.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DeviceWarningPanel({ device }) {
  if (!device) {
    return null;
  }

  const update = getDeviceUpdateModel(device.deviceRecord);
  const connectivityBadge = getDeviceConnectivityBadgeModel(device.connectivityStatus);
  const warnings = [];
  if (device.connectivityStatus === "control_ready" && device.agentStatus === "stopped") {
    warnings.push("Device online dan siap menerima Start Agent.");
  } else if (!device.agentControlReady && device.agentStatus === "stopped") {
    warnings.push("Kontrol agent belum terverifikasi; bedakan dari offline total sebelum menyalakan ulang.");
  }
  if (device.agentStatus === "stopped") {
    warnings.push("Agent sedang berhenti dan kontrol layanan tidak akan diproses sampai dinyalakan kembali.");
  } else if (["starting", "stopping", "restarting", "updating"].includes(device.agentStatus)) {
    warnings.push("Agent sedang memproses perubahan runtime.");
  }
  if (device.deviceStatus === "offline") {
    warnings.push("Perangkat sedang offline.");
  }
  if (device.issueCount > 0) {
    warnings.push(`${device.issueCount} layanan perlu dicek.`);
  }
  if (update.updateAvailable) {
    warnings.push(`Update agent tersedia: ${update.localVersion} -> ${update.latestVersion}.`);
  }
  if (!warnings.length) {
    return null;
  }

  return (
    <article className="device-warning-panel">
      <AlertTriangle size={19} strokeWidth={2.2} aria-hidden="true" />
      <div>
        <strong>Perhatian untuk {device.deviceName}</strong>
        <StatusChip status={connectivityBadge.status} label={connectivityBadge.label} />
        <p>{warnings.join(" ")}</p>
      </div>
    </article>
  );
}

function Pagination({ page, totalItems, pageSize = 10, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return (
    <div className="pagination-bar">
      <span>
        Halaman {safePage} dari {totalPages}
      </span>
      <div>
        <IconButton
          label="Halaman sebelumnya"
          icon={ChevronsLeft}
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        />
        <IconButton
          label="Halaman berikutnya"
          icon={ChevronsRight}
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        />
      </div>
    </div>
  );
}

function getRemoteRootPreference(root) {
  const label = String(root?.label || root?.name || "").trim().toUpperCase();
  const path = String(root?.path || "").trim().toUpperCase();
  const combined = `${label} ${path}`;
  const priorities = [
    { key: "DAPODIK", score: 1, label: "Dapodik" },
    { key: "E-RAPOR", score: 2, label: "E-Rapor" },
    { key: "ERAPOR", score: 2, label: "E-Rapor" },
    { key: "DESKTOP", score: 3, label: "Desktop" },
    { key: "DOCUMENTS", score: 4, label: "Documents" },
    { key: "DOWNLOAD", score: 5, label: "Download" },
    { key: "VIDEOS", score: 6, label: "Videos" },
    { key: "PICTURES", score: 7, label: "Pictures" },
  ];
  const match = priorities.find((entry) => combined.includes(entry.key));
  return match || null;
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

function DeviceGrid({ devices, selectedDeviceId, onOpen, now }) {
  return (
    <section className="device-grid" aria-label="Daftar perangkat">
      {devices.map((device) => {
        const agentBadge = getAgentStatusBadgeModel(device.agentStatus);
        const connectivityBadge = getDeviceConnectivityBadgeModel(device.connectivityStatus);
        return (
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
            <span className="fresh-pill-group">
              <StatusChip status={agentBadge.status} label={agentBadge.label} />
              <StatusChip status={connectivityBadge.status} label={connectivityBadge.label} />
            </span>
            <LongText value={device.deviceId} label="ID perangkat" className="mono" maxLength={28} />
            <span className="device-grid-meta">
              {device.runningCount} layanan aktif | {device.issueCount} perlu perhatian |{" "}
              {formatRelativeTime(device.deviceRecord?.last_seen, now)}
            </span>
          </button>
        );
      })}
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



function DeviceList({ devices, selectedDeviceId, onSelect, now }) {
  return (
    <div className="device-list">
      {devices.map((device) => {
        const deviceBadge = getDeviceStatusBadgeModel(device.deviceStatus);
        const agentBadge = getAgentStatusBadgeModel(device.agentStatus);
        const connectivityBadge = getDeviceConnectivityBadgeModel(device.connectivityStatus);
        return (
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
              <StatusChip status={deviceBadge.status} label={deviceBadge.label} />
              <StatusChip status={agentBadge.status} label={agentBadge.label} />
              <StatusChip status={connectivityBadge.status} label={connectivityBadge.label} />
            </div>
            {device.deviceAlias ? <div className="device-list-meta">Nama tampilan</div> : null}
            <div className="device-list-meta mono">
              <LongText value={device.deviceId} label="ID perangkat" maxLength={24} />
            </div>
            <div className="device-list-foot">
              <span>{device.runningCount} aktif</span>
              <span>{device.fileJobCount} transfer</span>
              <span>{formatRelativeTime(device.deviceRecord?.last_seen, now)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}



function RootGrid({ roots, onOpen }) {
  if (roots.length === 0) {
    return <div className="empty-state">Belum ada lokasi berkas yang tersedia.</div>;
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
          <div className="root-card-path mono">
            <LongText value={root.path} label="Path lokasi" maxLength={42} />
          </div>
          {root.metadata?.message ? (
            <div className="root-card-note">
              <LongText value={root.metadata.message} label="Pesan lokasi" maxLength={64} />
            </div>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function GuestMetricCard({
  label,
  value,
  helper = "",
  icon: Icon = Gauge,
  status = "",
  statusLabel = "",
}) {
  return (
    <article className="metric-card guest-status-card">
      <div className="guest-status-card-top">
        <span className="guest-status-card-icon" aria-hidden="true">
          <Icon size={18} strokeWidth={2.2} />
        </span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
      {status ? <StatusChip status={status} label={statusLabel || undefined} /> : null}
    </article>
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
  loading = false,
  loadingLabel = "",
  loadingProgress = null,
  virtualRootLabel = "",
}) {
  if (loading) {
    return (
      <div className="explorer-shell explorer-loading-shell" aria-busy="true">
        <Skeleton lines={4} />
        {loadingLabel ? <div className="explorer-loading-copy">{loadingLabel}</div> : null}
        {loadingProgress ? (
          <div className="explorer-loading-progress" aria-label={`${loadingProgress.label} ${loadingProgress.percent}%`}>
            <div className="explorer-loading-progress-track">
              <span style={{ width: `${loadingProgress.percent}%` }} />
            </div>
            <small>{loadingProgress.label}</small>
          </div>
        ) : null}
      </div>
    );
  }

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
  const showingVirtualRoot = !currentPath && virtualRootLabel;

  return (
    <div className="explorer-shell">
      <div className="explorer-toolbar">
        <div className="explorer-breadcrumbs">
          {showingVirtualRoot ? (
            <span className="breadcrumb-chip breadcrumb-chip-active">{virtualRootLabel}</span>
          ) : (
            <>
              <button type="button" className="utility-button" onClick={onOpenParent}>
                Naik
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
            </>
          )}
        </div>
        <div className="explorer-summary">
          <span>{folderCount} folder</span>
          <span>{fileCount} file</span>
          {warnings?.length ? <span>{warnings.length} dilewati</span> : null}
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
            <span>Nama</span>
            <span>Jenis</span>
            <span>Ukuran</span>
            <span>Diubah</span>
            <span>Aksi</span>
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
                  item.type === "directory" ? onOpen(item.path) : onToggle(item)
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
                      item.type === "directory" ? onOpen(item.path) : onToggle(item)
                    }
                  >
                    {getItemGlyph(item)}
                  </button>
                  <div className="file-name-content">
                    <button
                      type="button"
                      className="file-link"
                      onClick={() =>
                        item.type === "directory" ? onOpen(item.path) : onToggle(item)
                      }
                    >
                      {item.name}
                    </button>
                    <div className="file-subpath mono">
                      <LongText value={item.path} label="Path file" maxLength={46} />
                    </div>
                  </div>
                </div>
                <span>{item.virtualKind ? String(item.virtualKind).replace(/_/g, " ") : getFileKindLabel(item)}</span>
                <span>{item.type === "directory" ? "-" : formatBytes(item.size)}</span>
                <span>{item.description || formatDate(item.modifiedAt)}</span>
                <button
                  type="button"
                  className={`utility-button ${item.type === "directory" ? "open-folder-button" : ""}`}
                  onClick={() =>
                    item.type === "directory" ? onOpen(item.path) : onToggle(item)
                  }
                >
                  {item.type === "directory" ? "Buka folder" : selected ? "Batalkan" : "Pilih"}
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
    return <div className="empty-state">Belum ada aktivitas berkas untuk perangkat ini.</div>;
  }

  return (
    <div className="job-stack">
      {jobs.map((job) => (
        <article key={job.id} className={`job-card tone-${statusTone(job.status)}`}>
          <div className="job-card-top">
            <div>
              <strong>{getActivityLabel(job.job_type)}</strong>
              <div className="mono">#{job.id}</div>
            </div>
            <StatusChip status={job.status} />
          </div>
          <div className="job-card-path mono">
            <LongText value={job.source_path || job.destination_path || ""} label="Path aktivitas" maxLength={54} />
          </div>
          {job.result?.fileName ? (
            <div className="job-card-path mono">
              <LongText value={job.result.fileName} label="Nama file" maxLength={54} />
            </div>
          ) : null}
          <div className="job-card-meta">
            <span>{formatDate(job.created_at)}</span>
            <span>{job.progress_total ? `${job.progress_current}/${job.progress_total}` : "proses belum tersedia"}</span>
            <span>{job.delivery_mode === "temp" ? "Sementara" : job.delivery_mode || "-"}</span>
            {Array.isArray(job.result?.parts) && job.result.parts.length > 1 ? (
              <span>{job.result.parts.length} parts</span>
            ) : null}
            {job.result?.size ? <span>{formatBytes(job.result.size)}</span> : null}
          </div>
          {getJobStatusDetail(job) ? (
            <div className="explorer-warning">{getJobStatusDetail(job)}</div>
          ) : null}
          {job.error ? (
            <div className="job-error">
              <LongText value={job.error} label="Error aktivitas" maxLength={72} />
            </div>
          ) : null}
          <div className="job-actions">
            {job.status === "completed" && job.artifact_bucket && job.artifact_object_key ? (
              <button type="button" className="primary-button action-download action-button" onClick={() => onDownload(job)}>
                {Array.isArray(job.result?.parts) && job.result.parts.length > 1
                  ? "Unduh bagian"
                  : "Unduh"}
              </button>
            ) : null}
            {job.status === "completed" &&
            job.delivery_mode === "temp" &&
            job.artifact_bucket &&
            !Array.isArray(job.result?.parts) ? (
              <button type="button" className="secondary-button action-save action-button" onClick={() => onPromote(job)}>
                Simpan permanen
              </button>
            ) : null}
            {["pending", "running"].includes(job.status) ? (
              <button type="button" className="secondary-button action-cancel action-button" onClick={() => onCancel(job)}>
                Batalkan
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function ArtifactInventory({
  artifacts,
  deviceOptions,
  bucketFilter,
  deviceFilter,
  search,
  busyAction,
  onBucketFilter,
  onDeviceFilter,
  onSearch,
  onRefresh,
  onDownload,
  onDelete,
}) {
  const buckets = ["agent-temp-artifacts", "agent-archives", "agent-preview-cache", "admin-upload-staging"];
  const bucketLabels = {
    "agent-temp-artifacts": "Berkas sementara",
    "agent-archives": "Arsip permanen",
    "agent-preview-cache": "Cache pratinjau",
    "admin-upload-staging": "Unggahan admin",
  };
  const groupedBuckets = buckets
    .map((bucket) => {
      const files = artifacts.filter((artifact) => String(artifact.bucket || "") === bucket);
      const totalSize = files.reduce((sum, artifact) => sum + Number(artifact.size || 0), 0);
      const deviceCount = new Set(
        files.map((artifact) => artifact.deviceId || artifact.device_id || artifact.deviceName).filter(Boolean)
      ).size;
      return { bucket, files, totalSize, deviceCount };
    })
    .filter((group) => bucketFilter === "all" || group.bucket === bucketFilter);

  return (
    <article className="jobs-panel artifact-inventory-panel file-library-panel">
      <SectionHeader
        eyebrow="Storage"
        title="Pustaka berkas"
        description="Berkas dikelompokkan berdasarkan bucket storage. Aktivitas proses tetap tersedia di bagian riwayat."
        actions={
          <ActionButton
            className="secondary-button action-refresh"
            busy={busyAction === "artifacts:refresh"}
            icon={RefreshCw}
            onClick={onRefresh}
          >
            Segarkan bucket
          </ActionButton>
        }
      />

      <div className="artifact-filter-bar file-library-filters">
        <label>
          <span>Bucket</span>
          <select value={bucketFilter} onChange={(event) => onBucketFilter(event.target.value)}>
            <option value="all">Semua bucket</option>
            {buckets.map((bucket) => (
              <option key={bucket} value={bucket}>{bucketLabels[bucket] || bucket}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Device</span>
          <select value={deviceFilter} onChange={(event) => onDeviceFilter(event.target.value)}>
            <option value="all">Semua device</option>
            {deviceOptions.map((device) => (
              <option key={device.id} value={device.id}>{device.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Cari</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="rapor-2026.zip"
          />
        </label>
      </div>

      <div className="file-bucket-grid">
        {groupedBuckets.map((group) => (
          <article key={group.bucket} className="file-bucket-card">
            <div>
              <span className="section-eyebrow">{group.bucket}</span>
              <strong>{bucketLabels[group.bucket] || group.bucket}</strong>
            </div>
            <div className="file-bucket-stats">
              <span>{group.files.length} berkas</span>
              <span>{group.deviceCount || 0} device</span>
              <span>{formatBytes(group.totalSize)}</span>
            </div>
          </article>
        ))}
      </div>

      {artifacts.length === 0 ? (
        <div className="empty-state">Belum ada berkas Supabase yang cocok dengan filter ini.</div>
      ) : (
        <div className="file-library-groups">
          {groupedBuckets.map((group) => (
            <section key={group.bucket} className="file-library-group">
              <div className="panel-heading-row">
                <div>
                  <h3>{bucketLabels[group.bucket] || group.bucket}</h3>
                  <div className="root-card-note">{group.files.length} berkas dari bucket {group.bucket}</div>
                </div>
                <StatusChip status={group.files.length ? "ready" : "unknown"} label={`${group.files.length} berkas`} />
              </div>
              {group.files.length === 0 ? (
                <div className="empty-state compact-empty">Tidak ada berkas di bucket ini untuk filter aktif.</div>
              ) : (
                <div className="file-library-list">
                  {group.files.map((artifact) => {
                    const downloadJob = {
                      id: artifact.jobId || artifact.id,
                      artifact_bucket: artifact.bucket,
                      artifact_object_key: artifact.objectKey,
                      result: {
                        fileName: artifact.fileName,
                        size: artifact.size,
                      },
                    };
                    const canDownload = artifact.bucket && artifact.objectKey && artifact.status !== "deleted";
                    return (
                      <article key={artifact.id || `${artifact.bucket}:${artifact.objectKey}`} className={`file-library-row tone-${statusTone(artifact.status)}`}>
                        <div className="file-library-main">
                          <FileText size={18} aria-hidden="true" />
                          <div>
                            <strong>{artifact.fileName || safeFileNameFromKey(artifact.objectKey)}</strong>
                            <LongText
                              value={artifact.sourcePath || artifact.objectKey || ""}
                              label="Path berkas"
                              className="mono"
                              maxLength={58}
                            />
                          </div>
                        </div>
                        <div className="file-library-meta">
                          <span>{artifact.deviceName || artifact.deviceId || "Device tidak diketahui"}</span>
                          <span>{formatBytes(Number(artifact.size || 0))}</span>
                          <span>{formatDate(artifact.createdAt || artifact.completedAt)}</span>
                        </div>
                        <div className="artifact-actions">
                          <StatusChip status={artifact.status || "unknown"} />
                          {canDownload ? (
                            <ActionButton className="primary-button action-download" icon={Download} onClick={() => onDownload(downloadJob)}>
                              Unduh
                            </ActionButton>
                          ) : null}
                          {canDownload ? (
                            <ActionButton
                              className="danger-button action-delete"
                              icon={Trash2}
                              busy={busyAction === `artifact-delete:${artifact.id || artifact.objectKey}`}
                              onClick={() => onDelete(artifact)}
                            >
                              Hapus
                            </ActionButton>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function SupabaseFileTable({
  artifacts,
  page,
  onPageChange,
  busyAction,
  onDownload,
  onDelete,
}) {
  const [detailArtifact, setDetailArtifact] = useState(null);
  const pageSize = 10;
  const safePage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(artifacts.length / pageSize)));
  const pageItems = artifacts.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <article className="fresh-panel supabase-file-table-panel">
      <SectionHeader
        eyebrow="Storage"
        title="Pustaka berkas"
        description="Seluruh artefak yang sudah diambil dari perangkat dan tersimpan di storage pusat."
      />
      {artifacts.length ? (
        <>
          <div className="supabase-file-table" role="table" aria-label="Daftar berkas storage">
            <div className="supabase-file-row supabase-file-head" role="row">
              <span>Nama file/folder</span>
              <span>Path</span>
              <span>Waktu diambil</span>
              <span>Device</span>
              <span>Size</span>
              <span>Status</span>
              <span>Aksi</span>
            </div>
            {pageItems.map((artifact) => {
              const key = artifact.id || `${artifact.bucket}:${artifact.objectKey}`;
              const downloadJob = {
                id: artifact.jobId || artifact.id,
                artifact_bucket: artifact.bucket,
                artifact_object_key: artifact.objectKey,
                result: {
                  fileName: artifact.fileName,
                  size: artifact.size,
                  parts: artifact.result?.parts,
                },
              };
              const canDelete = artifact.bucket && artifact.objectKey && artifact.status !== "deleted";
              const canDownload = canDelete && !artifact.isFolder;
              return (
                <article key={key} className={`supabase-file-row tone-${statusTone(artifact.status)}`} role="row">
                  <strong>{artifact.fileName || safeFileNameFromKey(artifact.objectKey)}</strong>
                  <LongText
                    value={artifact.sourcePath || artifact.objectKey || ""}
                    label="Path lengkap berkas"
                    className="mono"
                    maxLength={46}
                  />
                  <span>{formatDate(artifact.createdAt || artifact.completedAt)}</span>
                  <span>{artifact.deviceName || artifact.deviceId || "Device tidak diketahui"}</span>
                  <span>{formatBytes(Number(artifact.size || 0))}</span>
                  <StatusChip status={artifact.status || "unknown"} />
                  <div className="fresh-actions">
                    <ActionButton className="secondary-button action-view" icon={Eye} onClick={() => setDetailArtifact(artifact)}>
                      Detail
                    </ActionButton>
                    {canDownload ? (
                      <ActionButton className="primary-button action-download" icon={Download} onClick={() => onDownload(downloadJob)}>
                        Unduh
                      </ActionButton>
                    ) : null}
                    {canDelete ? (
                      <ActionButton
                        className="danger-button action-delete"
                        icon={Trash2}
                        busy={busyAction === `artifact-delete:${artifact.id || artifact.objectKey}`}
                        onClick={() => onDelete(artifact)}
                      >
                        Hapus
                      </ActionButton>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          <Pagination page={safePage} totalItems={artifacts.length} pageSize={pageSize} onPageChange={onPageChange} />
        </>
      ) : (
        <EmptyState title="Belum ada berkas" description="Artefak storage yang cocok dengan filter akan tampil di sini." />
      )}
      {detailArtifact ? (
        <DetailDrawer
          title={detailArtifact.fileName || safeFileNameFromKey(detailArtifact.objectKey) || "Detail berkas"}
          value={formatArtifactDetailValue(detailArtifact)}
          onClose={() => setDetailArtifact(null)}
        />
      ) : null}
    </article>
  );
}

function FloatingFileActivity({ jobs, open, expanded, onToggleOpen, onToggleExpanded, onDownload }) {
  const visibleJobs = jobs.filter((job) =>
    ["download_file", "archive_paths", "upload_place", "preview_file"].includes(job.job_type || job.type || "")
  );
  return (
    <aside className={`floating-file-activity ${open ? "is-open" : "is-minimized"} ${expanded ? "is-expanded" : ""}`}>
      <button type="button" className="floating-file-activity-tab" onClick={onToggleOpen}>
        <FileText size={16} aria-hidden="true" />
        <span>Aktivitas Berkas</span>
        <StatusChip status={visibleJobs.some((job) => ["pending", "running"].includes(job.status)) ? "running_job" : "ready"} label={String(visibleJobs.length)} />
      </button>
      {open ? (
        <div className="floating-file-activity-panel">
          <div className="floating-file-activity-head">
            <strong>Riwayat transfer</strong>
            <IconButton
              label={expanded ? "Minimize riwayat" : "Maksimize riwayat"}
              icon={expanded ? PanelLeftClose : PanelLeftOpen}
              onClick={onToggleExpanded}
            />
          </div>
          <div className="floating-file-activity-list">
            {visibleJobs.length ? (
              visibleJobs.slice(0, expanded ? 12 : 5).map((job) => (
                <article key={job.id} className={`floating-file-job tone-${statusTone(job.status)}`}>
                  <div>
                    <strong>{getActivityLabel(job.job_type || job.type || "transfer")}</strong>
                    <LongText value={job.source_path || job.result?.fileName || job.artifact_object_key || ""} label="Path aktivitas berkas" className="mono" maxLength={32} />
                  </div>
                  <div className="fresh-pill-group">
                    <StatusChip status={job.status} />
                    {job.status === "completed" && job.artifact_bucket && job.artifact_object_key ? (
                      <IconButton label="Unduh artifact" icon={Download} onClick={() => onDownload(job)} />
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <EmptyState title="Belum ada transfer" description="Aktivitas download/upload akan muncul di sini." />
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function LogOverlay({ open, logs, jobs = [], deviceId, onClose }) {
  if (!open) {
    return null;
  }

  const scopedLogs = logs.filter((log) => !deviceId || deviceId === "all" || log.device_id === deviceId);
  const scopedJobs = jobs.filter((job) => !deviceId || deviceId === "all" || job.device_id === deviceId);
  return (
    <div className="detail-drawer-backdrop log-overlay-backdrop" role="dialog" aria-modal="true" aria-labelledby="log-overlay-title" onMouseDown={(event) => dismissOnBackdrop(event, onClose)}>
      <section className="log-overlay-card">
        <div className="detail-drawer-header">
          <div>
            <span className="section-eyebrow">Log</span>
            <strong id="log-overlay-title">Log aktivitas {deviceId && deviceId !== "all" ? deviceId : "semua device"}</strong>
          </div>
          <IconButton label="Tutup log" icon={X} onClick={onClose} />
        </div>
        <div className="log-overlay-list">
          {scopedJobs.length ? (
            <section className="log-overlay-section">
              <span className="section-eyebrow">Riwayat berkas</span>
              {scopedJobs.map((job) => (
                <article key={job.id} className={`fresh-timeline-row tone-${statusTone(job.status)}`}>
                  <span className="fresh-timeline-dot" />
                  <div>
                    <strong>{getActivityLabel(job.job_type || "transfer")}</strong>
                    <small className="mono">{formatDate(job.created_at || job.updated_at)} | {job.device_id}</small>
                    <LongText value={job.source_path || job.artifact_object_key || job.result?.fileName || ""} label="Path riwayat berkas" className="mono" maxLength={110} />
                  </div>
                  <StatusChip status={job.status} />
                </article>
              ))}
            </section>
          ) : null}
          {scopedLogs.length ? (
            scopedLogs.map((log) => (
              <article key={log.id} className={`fresh-timeline-row tone-${statusTone(log.level)}`}>
                <span className="fresh-timeline-dot" />
                <div>
                  <strong><LongText value={log.message} label="Pesan log" maxLength={96} /></strong>
                  <small className="mono">{formatDate(log.created_at)} | {log.device_id} | {log.service_name || "system"}</small>
                  {log.details ? <LongText value={JSON.stringify(log.details, null, 2)} label="Detail log" className="mono" maxLength={110} /> : null}
                </div>
                <StatusChip status={log.level} />
              </article>
            ))
          ) : (
            <EmptyState title="Belum ada log" description="Log untuk scope ini belum tersedia." />
          )}
        </div>
      </section>
    </div>
  );
}

function AccountTable({ accounts, page, onPageChange, busyAction, onAction, onDelete, onUnlinkDevice, isSuperAdmin }) {
  const pageSize = 10;
  const safePage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(accounts.length / pageSize)));
  const pageItems = accounts.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <div className="account-table-wrap">
      {accounts.length ? (
        <>
          <div className="account-table" role="table" aria-label="Daftar akun">
            <div className="account-table-row account-table-head" role="row">
              <span>Akun</span>
              <span>Role</span>
              <span>Status</span>
              <span>Dibuat</span>
              <span>Lingkungan / Device</span>
              <span>Aksi</span>
            </div>
            {pageItems.map((account) => (
              <article key={account.user_id} className={`account-table-row tone-${statusTone(account.status)}`} role="row">
                <div>
                  <strong>{account.display_name || account.email}</strong>
                  <LongText value={account.email} label="Email akun" className="mono" maxLength={34} />
                </div>
                <StatusChip status={account.role} />
                <StatusChip status={account.status} />
                <span>{formatDate(account.created_at)}</span>
                <div className="account-device-cell">
                  <span>{account.membership?.status ? getStatusLabel(account.membership.status) : "-"}</span>
                  {(account.deviceAssignments || []).filter((assignment) => assignment.status === "active").slice(0, 2).map((assignment) => (
                    <button
                      key={assignment.id || `${assignment.device_id}:${assignment.user_id}`}
                      type="button"
                      className="device-assignment-chip"
                      disabled={busyAction !== ""}
                      onClick={() => onUnlinkDevice?.({
                        deviceId: assignment.device_id,
                        userId: account.user_id,
                        label: account.display_name || account.email || assignment.device_id,
                      })}
                    >
                      <Unlink size={13} aria-hidden="true" />
                      <span>{assignment.device_id}</span>
                    </button>
                  ))}
                </div>
                <div className="fresh-actions">
                  {account.status !== "approved" ? (
                    <ActionButton className="primary-button action-approve" busy={busyAction === "account:approveAccount"} onClick={() => onAction("approveAccount", { userId: account.user_id })}>
                      Setujui
                    </ActionButton>
                  ) : null}
                  {account.status === "pending" ? (
                    <ActionButton className="danger-button action-reject" busy={busyAction === "account:rejectAccount"} onClick={() => onAction("rejectAccount", { userId: account.user_id, reason: "Permintaan akun belum dapat disetujui." })}>
                      Tolak
                    </ActionButton>
                  ) : null}
                  {account.status !== "disabled" ? (
                    <ActionButton className="secondary-button action-disable" busy={busyAction === "account:disableAccount"} onClick={() => onAction("disableAccount", { userId: account.user_id })}>
                      Nonaktifkan
                    </ActionButton>
                  ) : null}
                  <ActionButton className="secondary-button action-reset" busy={busyAction === "account:resetPassword"} onClick={() => onAction("resetPassword", { email: account.email })}>
                    Reset password
                  </ActionButton>
                  {isSuperAdmin && ["operator", "user"].includes(account.role) ? (
                    <ActionButton className="danger-button action-delete" busy={busyAction === "account:deleteAccount"} onClick={() => onDelete(account)}>
                      Hapus akun
                    </ActionButton>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <Pagination page={safePage} totalItems={accounts.length} pageSize={pageSize} onPageChange={onPageChange} />
        </>
      ) : (
        <EmptyState title="Belum ada akun" description="Akun yang terdaftar akan muncul di sini." />
      )}
    </div>
  );
}

function LegacyArtifactInventory({
  artifacts,
  deviceOptions,
  bucketFilter,
  deviceFilter,
  search,
  busyAction,
  onBucketFilter,
  onDeviceFilter,
  onSearch,
  onRefresh,
  onDownload,
  onDelete,
}) {
  const buckets = ["agent-temp-artifacts", "agent-archives", "agent-preview-cache", "admin-upload-staging"];

  return (
    <article className="jobs-panel artifact-inventory-panel legacy-artifact-inventory">
      <div className="panel-heading-row">
        <div>
          <h3>Bucket & Arsip Berkas</h3>
          <div className="root-card-note">Semua artifact storage dengan nama ramah, bucket, dan device asal.</div>
        </div>
        <div className="panel-actions">
          <ActionButton
            className="secondary-button action-refresh"
            busy={busyAction === "artifacts:refresh"}
            onClick={onRefresh}
          >
            Segarkan bucket
          </ActionButton>
        </div>
      </div>

      <div className="artifact-filter-bar">
        <label>
          <span>Bucket</span>
          <select value={bucketFilter} onChange={(event) => onBucketFilter(event.target.value)}>
            <option value="all">Semua bucket</option>
            {buckets.map((bucket) => (
              <option key={bucket} value={bucket}>{bucket}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Device</span>
          <select value={deviceFilter} onChange={(event) => onDeviceFilter(event.target.value)}>
            <option value="all">Semua device</option>
            {deviceOptions.map((device) => (
              <option key={device.id} value={device.id}>{device.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Cari</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="rapor-2026.zip"
          />
        </label>
      </div>

      {artifacts.length === 0 ? (
        <div className="empty-state">Belum ada artifact yang cocok dengan filter ini.</div>
      ) : (
        <div className="artifact-table">
          {artifacts.map((artifact) => {
            const downloadJob = {
              id: artifact.jobId || artifact.id,
              artifact_bucket: artifact.bucket,
              artifact_object_key: artifact.objectKey,
              result: {
                fileName: artifact.fileName,
                size: artifact.size,
              },
            };
            const canDownload = artifact.bucket && artifact.objectKey && artifact.status !== "deleted";
            return (
              <article key={artifact.id || `${artifact.bucket}:${artifact.objectKey}`} className={`artifact-row tone-${statusTone(artifact.status)}`}>
                <div className="artifact-main">
                  <strong>{artifact.fileName || safeFileNameFromKey(artifact.objectKey)}</strong>
                  <LongText
                    value={artifact.sourcePath || artifact.objectKey || ""}
                    label="Path artifact"
                    className="mono"
                    maxLength={54}
                  />
                </div>
                <div className="artifact-meta">
                  <span>{artifact.deviceName || artifact.deviceId || "Device tidak diketahui"}</span>
                  <span>{artifact.bucket}</span>
                  <span>{formatBytes(Number(artifact.size || 0))}</span>
                  <span>{formatDate(artifact.createdAt || artifact.completedAt)}</span>
                </div>
                <div className="artifact-actions">
                  <StatusChip status={artifact.status || "unknown"} />
                  {canDownload ? (
                    <ActionButton className="primary-button action-download" onClick={() => onDownload(downloadJob)}>
                      Unduh
                    </ActionButton>
                  ) : null}
                  {canDownload ? (
                    <ActionButton
                      className="danger-button action-delete"
                      busy={busyAction === `artifact-delete:${artifact.id || artifact.objectKey}`}
                      onClick={() => onDelete(artifact)}
                    >
                      Hapus
                    </ActionButton>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </article>
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
    <div className="guest-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="device-alias-title" onMouseDown={(event) => dismissOnBackdrop(event, onClose)}>
      <div className="guest-modal-card dashboard-modal-card">
        <strong id="device-alias-title">Ubah nama tampilan perangkat</strong>
        <p>
          Nama tampilan hanya berlaku untuk akun Anda. Nama asli perangkat tetap tersimpan sebagai{" "}
          <LongText
            value={device.deviceRecord?.device_name || device.deviceId}
            label="Nama asli perangkat"
            className="mono"
            maxLength={32}
          />
          .
        </p>
        <MaskedTextField
          label="Nama tampilan"
          value={value}
          maxLength={80}
          onChange={onChange}
          placeholder="Server TU"
          mask="alias"
        />
        <div className="guest-modal-actions">
          <ActionButton className="secondary-button action-cancel" disabled={busy} onClick={onClose}>
            Batal
          </ActionButton>
          <ActionButton className="primary-button action-save" busy={busy} onClick={onSave}>
            Simpan
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
  device,
  deviceId,
  onClose,
  onDownload,
}) {
  if (!open) {
    return null;
  }

  const jobs = history?.jobs || [];
  const audits = history?.auditLogs || [];
  const contextLabel = device?.deviceName || deviceId || "Semua perangkat";

  return (
    <div className="guest-modal-backdrop modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="transfer-history-title" onMouseDown={(event) => dismissOnBackdrop(event, onClose)}>
      <div className="guest-modal-card transfer-modal-card">
        <div className="modal-title-row">
          <div>
            <strong id="transfer-history-title">Riwayat Berkas</strong>
            <p>
              Berkas yang pernah diproses untuk{" "}
              <LongText value={contextLabel} label="Konteks riwayat" className="mono" maxLength={32} />.
            </p>
          </div>
          <ActionButton className="secondary-button action-session" onClick={onClose}>
            Tutup
          </ActionButton>
        </div>
        {loading ? (
          <div className="empty-state compact-empty">Memuat riwayat berkas...</div>
        ) : !jobs.length && !audits.length ? (
          <div className="empty-state compact-empty">Belum ada riwayat berkas untuk perangkat ini.</div>
        ) : (
          <div className="transfer-history-grid">
            <section className="transfer-files-section">
              <h4>Berkas Perangkat</h4>
              <div className="job-stack">
                {jobs.map((job) => (
                  <article key={job.id} className={`job-card tone-${statusTone(job.status)}`}>
                    <div className="job-card-top">
                      <div>
                        <strong>{getActivityLabel(job.job_type || "transfer")}</strong>
                        <div className="mono">
                          Aktivitas #{job.id} ·{" "}
                          <LongText value={job.device_id} label="ID perangkat" maxLength={24} />
                        </div>
                      </div>
                      <StatusChip status={job.status} />
                    </div>
                    <div className="job-card-meta">
                      <span>{formatDate(job.created_at)}</span>
                      <span>{job.delivery_mode === "temp" || !job.delivery_mode ? "Sementara" : job.delivery_mode}</span>
                      <span>{formatBytes(Number(job.artifact_size || job.result?.size || 0))}</span>
                    </div>
                    <div className="root-card-note">
                      <LongText
                        value={job.source_path || job.destination_path || job.result?.fileName || ""}
                        label="Path riwayat"
                        maxLength={52}
                        empty="Detail path tidak tersedia."
                      />
                    </div>
                    {job.artifact_bucket && job.artifact_object_key ? (
                      <div className="job-actions">
                        <ActionButton className="primary-button action-download" onClick={() => onDownload(job)}>
                          Unduh berkas
                        </ActionButton>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
            <section className="transfer-audit-section">
              <h4>Catatan</h4>
              <div className="job-stack">
                {audits.map((audit) => (
                  <article key={audit.id} className="job-card">
                    <div className="job-card-top">
                      <div>
                        <strong>{getActivityLabel(audit.action || "activity")}</strong>
                        <div className="mono">
                          <LongText
                            value={`${audit.device_id} · ${audit.job_id ? `Aktivitas #${audit.job_id}` : "sistem"}`}
                            label="Sumber audit"
                            maxLength={40}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="job-card-meta">
                      <span>{formatDate(audit.created_at)}</span>
                      <LongText value={audit.target_path || ""} label="Target audit" maxLength={44} empty="target tidak tersedia" />
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

export {
  AccountTable,
  ArtifactInventory,
  DashboardStats,
  DeviceAliasModal,
  DeviceCombobox,
  DeviceGrid,
  DeviceList,
  DeviceWarningPanel,
  dismissOnBackdrop,
  EmptyState,
  FileTable,
  FloatingFileActivity,
  getDashboardNavItems,
  getRemoteRootPreference,
  getRouteBreadcrumbs,
  GuestMetricCard,
  JobList,
  LegacyArtifactInventory,
  LogOverlay,
  matchesDeviceQuery,
  MobileNav,
  normalizeLoginEmail,
  normalizeLoginPassword,
  Pagination,
  PriorityBanner,
  ProfilePanel,
  RootGrid,
  RouteHeader,
  SectionHeader,
  SidebarNav,
  SupabaseFileTable,
  Surface,
  TopCommandBar,
  TransferHistoryModal,
};
