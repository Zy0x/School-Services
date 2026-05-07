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
import { dismissOnBackdrop } from "./shared.utils.jsx";

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

export {
  DeviceAliasModal,
  DeviceCombobox,
  DeviceGrid,
  DeviceList,
  DeviceWarningPanel,
  matchesDeviceQuery
};
