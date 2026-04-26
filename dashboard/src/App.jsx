import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "./supabase";

const HEARTBEAT_STALE_MS = Number(import.meta.env.VITE_HEARTBEAT_STALE_MS || 20000);
const REFRESH_INTERVAL_MS = Number(import.meta.env.VITE_DASHBOARD_REFRESH_MS || 5000);
const TUNNEL_WAITING_STATUSES = new Set(["waiting_retry", "starting"]);
const LOG_LIMIT = 150;

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function formatStatusLabel(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function isFresh(timestamp) {
  if (!timestamp) {
    return false;
  }

  const parsed = new Date(timestamp).getTime();
  if (Number.isNaN(parsed)) {
    return false;
  }

  return Date.now() - parsed <= HEARTBEAT_STALE_MS;
}

function formatRelativeTime(value, now = Date.now()) {
  if (!value) {
    return "never";
  }

  const deltaMs = new Date(value).getTime() - now;
  if (Number.isNaN(deltaMs)) {
    return "-";
  }

  const tense = deltaMs >= 0 ? "future" : "past";
  const absoluteMs = Math.abs(deltaMs);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absoluteMs < 60000) {
    const seconds = Math.max(1, Math.round(deltaMs / 1000));
    return rtf.format(seconds, "second");
  }

  if (absoluteMs < 3600000) {
    return rtf.format(Math.round(deltaMs / 60000), "minute");
  }

  if (absoluteMs < 86400000) {
    return rtf.format(Math.round(deltaMs / 3600000), "hour");
  }

  return rtf.format(Math.round(deltaMs / 86400000), "day");
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

  if (row.status === "running" && !isFresh(row.last_ping)) {
    return "offline";
  }

  return row.status;
}

function getActionLabel(action) {
  return action === "start" ? "Start" : action === "stop" ? "Stop" : "Block";
}

function getActionTone(action) {
  return action === "start" ? "success" : "danger";
}

function buildLogDownloadContent(entries) {
  return entries
    .map((entry) => {
      const details = entry.details
        ? `\n${JSON.stringify(entry.details, null, 2)}`
        : "";
      return `[${formatDate(entry.created_at)}] [${String(entry.level || "info").toUpperCase()}] [${
        entry.device_id
      }] [${entry.service_name || "system"}] ${entry.message}${details}`;
    })
    .join("\n\n");
}

function StatusPill({ value, emphasis = "default" }) {
  return (
    <span className={`status-pill status-${value} status-pill-${emphasis}`}>
      {formatStatusLabel(value)}
    </span>
  );
}

function StatCard({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`stat-card stat-card-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">{detail}</div>
    </article>
  );
}

function LoadingSkeleton({ className = "" }) {
  return (
    <div className={`skeleton-block ${className}`}>
      <span />
      <span />
      <span />
    </div>
  );
}

function FleetItem({ entry, selected, now, onSelect }) {
  return (
    <button
      type="button"
      className={`fleet-item ${selected ? "fleet-item-selected" : ""}`}
      onClick={() => onSelect(entry.deviceId)}
    >
      <div className="fleet-item-top">
        <div>
          <strong>{entry.deviceName}</strong>
          <div className="fleet-item-id mono">{entry.deviceId}</div>
        </div>
        <StatusPill value={entry.deviceStatus} emphasis="soft" />
      </div>
      <div className="fleet-item-stats">
        <span>{entry.runningCount} running</span>
        <span>{entry.waitingCount} waiting</span>
        <span>{entry.errorCount} issues</span>
      </div>
      <div className="fleet-item-foot">
        Last heartbeat {formatRelativeTime(entry.deviceRecord?.last_seen, now)}
      </div>
    </button>
  );
}

function ConfirmDialog({
  pendingAction,
  busy,
  onCancel,
  onConfirm,
}) {
  if (!pendingAction) {
    return null;
  }

  const tone =
    pendingAction.kind === "command"
      ? getActionTone(pendingAction.action)
      : pendingAction.kind === "status" && pendingAction.action === "unblock"
        ? "success"
        : "danger";
  const title =
    pendingAction.kind === "command"
      ? `Konfirmasi ${getActionLabel(pendingAction.action).toLowerCase()} service`
      : pendingAction.kind === "status"
        ? `Konfirmasi ${pendingAction.action === "block" ? "blokir" : "unblock"} device`
        : "Konfirmasi stop agent";

  const description =
    pendingAction.kind === "command"
      ? `Anda akan ${getActionLabel(pendingAction.action).toLowerCase()} service ${pendingAction.serviceName} pada device ${pendingAction.deviceName}.`
      : pendingAction.kind === "status"
        ? pendingAction.action === "block"
          ? `Device ${pendingAction.deviceName} akan diblokir. Agent tetap berjalan, tetapi akses dan kontrol dashboard akan dibatasi sampai di-unblock.`
          : `Device ${pendingAction.deviceName} akan diaktifkan kembali agar kontrol dashboard dan publikasi link bisa berjalan lagi.`
        : `Agent pada device ${pendingAction.deviceName} akan dihentikan. Public URL akan diputus dan device akan menjadi offline sampai agent dijalankan lagi di laptop user.`;

  return (
    <div className="confirm-overlay" role="presentation">
      <div className="confirm-dialog" role="dialog" aria-modal="true">
        <div className="confirm-eyebrow">Action confirmation</div>
        <h3>{title}</h3>
        <p>{description}</p>

        <div className="confirm-summary">
          <div>
            <span>Device</span>
            <strong>{pendingAction.deviceName}</strong>
          </div>
          <div>
            <span>Target</span>
            <strong>{pendingAction.serviceName || "device"}</strong>
          </div>
          <div>
            <span>Action</span>
            <strong>
              {pendingAction.kind === "command"
                ? getActionLabel(pendingAction.action)
                : pendingAction.kind === "status"
                  ? pendingAction.action === "block"
                    ? "Block"
                    : "Unblock"
                  : "Stop agent"}
            </strong>
          </div>
        </div>

        <div className="confirm-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            Batal
          </button>
          <button
            type="button"
            className={tone === "success" ? "primary-button" : "danger-button"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy
              ? "Memproses..."
              : `Ya, ${
                  pendingAction.kind === "command"
                    ? pendingAction.action
                    : pendingAction.kind === "status"
                      ? pendingAction.action
                      : "stop agent"
                }`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [servicesRefreshing, setServicesRefreshing] = useState(false);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [selectedDeviceId, setSelectedDeviceId] = useState("all");
  const [selectedLogLevel, setSelectedLogLevel] = useState("all");
  const [channelState, setChannelState] = useState("connecting");
  const [lastRealtimeAt, setLastRealtimeAt] = useState(null);
  const [lastServicesSyncAt, setLastServicesSyncAt] = useState(null);
  const [lastLogsSyncAt, setLastLogsSyncAt] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [copiedUrlKey, setCopiedUrlKey] = useState("");

  const loadServices = useCallback(async (options = {}) => {
    const background = options.background === true;
    if (!background) {
      setServicesRefreshing(true);
    }

    const { data, error: queryError } = await supabase
      .from("services")
      .select(
        "id, device_id, service_name, port, status, desired_state, last_error, public_url, last_ping, devices(device_name, status, last_seen)"
      )
      .order("device_id", { ascending: true })
      .order("service_name", { ascending: true });

    if (queryError) {
      setError(queryError.message);
      if (!background) {
        setServicesRefreshing(false);
      }
      return;
    }

    setError("");
    startTransition(() => {
      setRows(data || []);
    });
    setLastServicesSyncAt(Date.now());
    if (!background) {
      setServicesRefreshing(false);
    }
  }, []);

  const loadLogs = useCallback(async (options = {}) => {
    const background = options.background === true;
    if (!background) {
      setLogsRefreshing(true);
    }

    const { data, error: queryError } = await supabase
      .from("agent_logs")
      .select("id, device_id, service_name, level, message, details, created_at")
      .order("created_at", { ascending: false })
      .limit(LOG_LIMIT);

    if (queryError) {
      setError(queryError.message);
      if (!background) {
        setLogsRefreshing(false);
      }
      return;
    }

    setError("");
    startTransition(() => {
      setLogs(data || []);
    });
    setLastLogsSyncAt(Date.now());
    if (!background) {
      setLogsRefreshing(false);
    }
  }, []);

  const refreshAll = useCallback(
    async (options = {}) => {
      await Promise.all([loadServices(options), loadLogs(options)]);
    },
    [loadLogs, loadServices]
  );

  useEffect(() => {
    let active = true;

    refreshAll()
      .catch((loadError) => {
        if (active) {
          setError(loadError.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    const handleRealtimeEvent = () => {
      setLastRealtimeAt(Date.now());
      refreshAll({ background: true }).catch((loadError) => setError(loadError.message));
    };

    const channel = supabase
      .channel("services-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "services" },
        handleRealtimeEvent
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices" },
        handleRealtimeEvent
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_logs" },
        handleRealtimeEvent
      )
      .subscribe((status) => {
        setChannelState(String(status || "").toLowerCase());
        if (String(status).toUpperCase() === "SUBSCRIBED") {
          setLastRealtimeAt(Date.now());
        }
      });

    const intervalId = window.setInterval(() => {
      refreshAll({ background: true }).catch((loadError) => setError(loadError.message));
    }, REFRESH_INTERVAL_MS);

    const clockId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.clearInterval(clockId);
      supabase.removeChannel(channel);
    };
  }, [refreshAll]);

  const deviceEntries = useMemo(() => {
    const grouped = new Map();

    for (const row of rows) {
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
        deviceRecord,
        deviceStatus,
        serviceStatus,
      });
    }

    return Array.from(grouped.values()).map((entry) => {
      const runningCount = entry.services.filter(
        (service) => service.serviceStatus === "running"
      ).length;
      const waitingCount = entry.services.filter((service) =>
        TUNNEL_WAITING_STATUSES.has(service.serviceStatus)
      ).length;
      const errorCount = entry.services.filter((service) =>
        ["error", "blocked", "offline"].includes(service.serviceStatus)
      ).length;

      return {
        ...entry,
        runningCount,
        waitingCount,
        errorCount,
      };
    });
  }, [rows, now]);

  const deviceOptions = useMemo(
    () =>
      deviceEntries.map((entry) => ({
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
      })),
    [deviceEntries]
  );

  const filteredDeviceEntries = useMemo(() => {
    if (selectedDeviceId === "all") {
      return deviceEntries;
    }

    return deviceEntries.filter((entry) => entry.deviceId === selectedDeviceId);
  }, [deviceEntries, selectedDeviceId]);

  const summary = useMemo(() => {
    const totalDevices = deviceEntries.length;
    const onlineDevices = deviceEntries.filter(
      (entry) => entry.deviceStatus === "online"
    ).length;
    const totalServices = rows.length;
    const runningServices = deviceEntries.reduce(
      (count, entry) => count + entry.runningCount,
      0
    );
    const waitingServices = deviceEntries.reduce(
      (count, entry) => count + entry.waitingCount,
      0
    );
    const issueServices = deviceEntries.reduce(
      (count, entry) => count + entry.errorCount,
      0
    );

    return {
      totalDevices,
      onlineDevices,
      totalServices,
      runningServices,
      waitingServices,
      issueServices,
    };
  }, [deviceEntries, rows.length]);

  const logSummary = useMemo(() => {
    return logs.reduce(
      (accumulator, entry) => {
        const level = entry.level || "info";
        accumulator[level] = (accumulator[level] || 0) + 1;
        return accumulator;
      },
      { info: 0, warn: 0, error: 0, debug: 0 }
    );
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (selectedDeviceId !== "all" && log.device_id !== selectedDeviceId) {
        return false;
      }

      if (selectedLogLevel !== "all" && log.level !== selectedLogLevel) {
        return false;
      }

      return true;
    });
  }, [logs, selectedDeviceId, selectedLogLevel]);

  const liveTone =
    channelState === "subscribed"
      ? "live"
      : channelState === "closed" || channelState === "errored"
        ? "danger"
        : "warm";

  async function queueCommand(deviceId, serviceName, action) {
    setBusyKey(`${deviceId}:${serviceName}:${action}`);
    setError("");

    const { error: insertError } = await supabase.from("commands").insert({
      device_id: deviceId,
      service_name: serviceName,
      action,
      status: "pending",
    });

    setBusyKey("");

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setLastRealtimeAt(Date.now());
  }

  async function blockDevice(deviceId) {
    return updateDeviceStatus(deviceId, "blocked");
  }

  async function updateDeviceStatus(deviceId, status) {
    setBusyKey(`${deviceId}:${status}`);
    setError("");

    const { error: updateError } = await supabase
      .from("devices")
      .update({ status })
      .eq("device_id", deviceId);

    setBusyKey("");

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setLastRealtimeAt(Date.now());
  }

  async function copyPublicUrl(deviceId, serviceName, publicUrl) {
    if (!publicUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(publicUrl);
      const nextKey = `${deviceId}:${serviceName}`;
      setCopiedUrlKey(nextKey);
      window.setTimeout(() => {
        setCopiedUrlKey((current) => (current === nextKey ? "" : current));
      }, 2000);
    } catch (copyError) {
      setError(copyError.message);
    }
  }

  function downloadLogs() {
    const payload = buildLogDownloadContent(filteredLogs);
    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `agent-logs-${selectedDeviceId}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.log`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  function requestServiceAction(entry, service, action) {
    setPendingAction({
      kind: "command",
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      serviceName: service.service_name,
      action,
    });
  }

  function requestDeviceStatusAction(entry, action) {
    setPendingAction({
      kind: "status",
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      serviceName: null,
      action,
    });
  }

  function requestAgentStopAction(entry) {
    setPendingAction({
      kind: "agent-stop",
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      serviceName: null,
      action: "kill",
    });
  }

  async function confirmPendingAction() {
    if (!pendingAction) {
      return;
    }

    const action = pendingAction;
    setPendingAction(null);

    if (action.kind === "status") {
      await updateDeviceStatus(action.deviceId, action.action === "unblock" ? "active" : "blocked");
      return;
    }

    if (action.kind === "agent-stop") {
      await queueCommand(action.deviceId, null, "kill");
      return;
    }

    await queueCommand(action.deviceId, action.serviceName, action.action);
  }

  return (
    <>
      <main className="app-shell">
        <div className="app-backdrop app-backdrop-top" />
        <div className="app-backdrop app-backdrop-bottom" />

        <section className="hero-panel">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className={`live-dot live-dot-${liveTone}`} />
              Realtime operations center
            </div>
            <h1>E-Rapor Fleet Dashboard</h1>
            <p>
              Pantau status device, service, public URL, retry tunnel, dan log agent
              dalam satu tampilan yang lebih rapi, fokus, dan aman untuk operasional.
            </p>
            <div className="hero-meta">
              <div className="hero-chip">
                <span>Realtime socket</span>
                <strong>{formatStatusLabel(channelState)}</strong>
              </div>
              <div className="hero-chip">
                <span>Last realtime event</span>
                <strong>{formatRelativeTime(lastRealtimeAt, now)}</strong>
              </div>
              <div className="hero-chip">
                <span>Last services sync</span>
                <strong>{formatRelativeTime(lastServicesSyncAt, now)}</strong>
              </div>
              <div className="hero-chip">
                <span>Last logs sync</span>
                <strong>{formatRelativeTime(lastLogsSyncAt, now)}</strong>
              </div>
            </div>
          </div>

          <div className="hero-side">
            <div className="hero-note">
              <div className="hero-note-title">Control safety</div>
              <p>
                Semua aksi `start`, `stop`, `stop agent`, `block`, dan `unblock`
                sekarang memerlukan konfirmasi terlebih dahulu agar tidak ada salah
                tekan saat operasional.
              </p>
            </div>
            <button
              className="secondary-button hero-button"
              disabled={servicesRefreshing || logsRefreshing}
              onClick={() => refreshAll()}
            >
              {servicesRefreshing || logsRefreshing ? "Refreshing..." : "Refresh sekarang"}
            </button>
          </div>
        </section>

        {error ? <div className="error-banner">{error}</div> : null}

        <section className="stats-grid">
          <StatCard
            label="Connected devices"
            value={summary.totalDevices}
            detail={`${summary.onlineDevices} online saat ini`}
            tone="blue"
          />
          <StatCard
            label="Running services"
            value={summary.runningServices}
            detail={`${summary.totalServices} total service dipantau`}
            tone="green"
          />
          <StatCard
            label="Waiting pipeline"
            value={summary.waitingServices}
            detail="Startup atau retry tunnel sedang berjalan"
            tone="amber"
          />
          <StatCard
            label="Needs attention"
            value={summary.issueServices}
            detail="Offline, blocked, atau error"
            tone="rose"
          />
        </section>

        <section className="workspace-grid">
          <aside className="sidebar-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">
                  <span className={`live-dot live-dot-${liveTone}`} />
                  Fleet navigator
                </div>
                <h2>Device Navigator</h2>
              </div>
              <p>Pilih satu device untuk fokus, atau tampilkan seluruh armada.</p>
            </div>

            <div className="sidebar-controls">
              <label className="filter-field">
                <span>Device focus</span>
                <select
                  value={selectedDeviceId}
                  onChange={(event) => setSelectedDeviceId(event.target.value)}
                >
                  <option value="all">Semua device</option>
                  {deviceOptions.map((option) => (
                    <option key={option.deviceId} value={option.deviceId}>
                      {option.deviceName} ({option.deviceId})
                    </option>
                  ))}
                </select>
              </label>

              <label className="filter-field">
                <span>Log level</span>
                <select
                  value={selectedLogLevel}
                  onChange={(event) => setSelectedLogLevel(event.target.value)}
                >
                  <option value="all">Semua level</option>
                  <option value="error">Error</option>
                  <option value="warn">Warn</option>
                  <option value="info">Info</option>
                  <option value="debug">Debug</option>
                </select>
              </label>
            </div>

            <div className="sidebar-status-grid">
              <div className="mini-panel">
                <span>Live feed</span>
                <strong>{formatRelativeTime(lastRealtimeAt, now)}</strong>
              </div>
              <div className="mini-panel">
                <span>Refresh cycle</span>
                <strong>{Math.round(REFRESH_INTERVAL_MS / 1000)}s</strong>
              </div>
            </div>

            <div className="fleet-list">
              <button
                type="button"
                className={`fleet-item fleet-item-all ${
                  selectedDeviceId === "all" ? "fleet-item-selected" : ""
                }`}
                onClick={() => setSelectedDeviceId("all")}
              >
                <div className="fleet-item-top">
                  <div>
                    <strong>Semua device</strong>
                    <div className="fleet-item-id mono">fleet overview</div>
                  </div>
                  <StatusPill value="online" emphasis="soft" />
                </div>
                <div className="fleet-item-stats">
                  <span>{summary.totalDevices} device</span>
                  <span>{summary.runningServices} running</span>
                  <span>{summary.issueServices} issues</span>
                </div>
              </button>

              {loading ? (
                <>
                  <LoadingSkeleton className="fleet-skeleton" />
                  <LoadingSkeleton className="fleet-skeleton" />
                </>
              ) : (
                deviceEntries.map((entry) => (
                  <FleetItem
                    key={entry.deviceId}
                    entry={entry}
                    selected={selectedDeviceId === entry.deviceId}
                    now={now}
                    onSelect={setSelectedDeviceId}
                  />
                ))
              )}
            </div>
          </aside>

          <section className="content-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">
                  <span className={`live-dot live-dot-${liveTone}`} />
                  Service control
                </div>
                <h2>Device & Service Workspace</h2>
              </div>
              <p>
                Status device, service, link publik, heartbeat, dan error dikelompokkan
                per device agar scanning operasional lebih cepat.
              </p>
            </div>

            {loading ? (
              <div className="device-grid">
                <LoadingSkeleton className="device-skeleton" />
                <LoadingSkeleton className="device-skeleton" />
              </div>
            ) : filteredDeviceEntries.length === 0 ? (
              <div className="empty-panel">
                <h3>Tidak ada device pada filter ini</h3>
                <p>Ubah filter device atau tunggu agent mengirim status terbaru.</p>
              </div>
            ) : (
              <div className="device-grid">
                {filteredDeviceEntries.map((entry) => (
                  <article key={entry.deviceId} className="device-card">
                    <div className="device-card-header">
                      <div className="device-header-copy">
                        <div className="device-title-row">
                          <h3>{entry.deviceName}</h3>
                          <StatusPill value={entry.deviceStatus} emphasis="soft" />
                        </div>
                        <div className="device-meta mono">{entry.deviceId}</div>
                        <div className="device-submeta">
                          Last heartbeat {formatRelativeTime(entry.deviceRecord?.last_seen, now)}
                        </div>
                      </div>

                      <div className="device-card-actions">
                        <button
                          className="secondary-button"
                          disabled={busyKey !== "" || entry.deviceStatus === "offline"}
                          onClick={() => requestAgentStopAction(entry)}
                        >
                          Stop agent
                        </button>
                        <button
                          className={
                            entry.deviceStatus === "blocked"
                              ? "primary-button"
                              : "danger-button"
                          }
                          disabled={busyKey !== ""}
                          onClick={() =>
                            requestDeviceStatusAction(
                              entry,
                              entry.deviceStatus === "blocked" ? "unblock" : "block"
                            )
                          }
                        >
                          {entry.deviceStatus === "blocked"
                            ? "Unblock device"
                            : "Block device"}
                        </button>
                      </div>
                    </div>

                    <div className="device-health-strip">
                      <div>
                        <strong>{entry.runningCount}</strong>
                        <span>running</span>
                      </div>
                      <div>
                        <strong>{entry.waitingCount}</strong>
                        <span>waiting</span>
                      </div>
                      <div>
                        <strong>{entry.errorCount}</strong>
                        <span>issues</span>
                      </div>
                      <div>
                        <strong>{formatDate(entry.deviceRecord?.last_seen)}</strong>
                        <span>last seen</span>
                      </div>
                    </div>

                    <div className="service-stack">
                      {entry.services.map((service) => {
                        const blocked = entry.deviceStatus === "blocked";
                        const canStart =
                          !blocked &&
                          service.desired_state !== "running" &&
                          service.serviceStatus !== "running";
                        const canStop =
                          !blocked &&
                          (service.desired_state !== "stopped" ||
                            service.serviceStatus === "running" ||
                            TUNNEL_WAITING_STATUSES.has(service.serviceStatus));

                        return (
                          <section
                            key={service.id}
                            className={`service-card service-card-${service.serviceStatus}`}
                          >
                            <div className="service-card-top">
                              <div className="service-overview">
                                <div className="service-heading">
                                  <h4>{service.service_name}</h4>
                                  <span className="service-port mono">localhost:{service.port}</span>
                                </div>
                                <div className="service-status-row">
                                  <StatusPill value={service.serviceStatus} />
                                  <StatusPill
                                    value={service.desired_state || "stopped"}
                                    emphasis="soft"
                                  />
                                </div>
                              </div>

                              <div className="service-actions">
                                <button
                                  className="primary-button"
                                  disabled={busyKey !== "" || !canStart}
                                  onClick={() => requestServiceAction(entry, service, "start")}
                                >
                                  Start
                                </button>
                                <button
                                  className="secondary-button"
                                  disabled={busyKey !== "" || !canStop}
                                  onClick={() => requestServiceAction(entry, service, "stop")}
                                >
                                  Stop
                                </button>
                              </div>
                            </div>

                            <div className="service-grid">
                              <div className="service-metric service-metric-wide">
                                <span>Public URL</span>
                                <div className="service-url-row">
                                  <strong className="service-url">
                                    {service.public_url ? (
                                      <a href={service.public_url} target="_blank" rel="noreferrer">
                                        {service.public_url}
                                      </a>
                                    ) : service.desired_state === "stopped" ? (
                                      "disabled"
                                    ) : (
                                      "-"
                                    )}
                                  </strong>
                                  <button
                                    type="button"
                                    className="utility-button"
                                    disabled={!service.public_url}
                                    onClick={() =>
                                      copyPublicUrl(
                                        service.device_id,
                                        service.service_name,
                                        service.public_url
                                      )
                                    }
                                  >
                                    {copiedUrlKey ===
                                    `${service.device_id}:${service.service_name}`
                                      ? "Tersalin"
                                      : "Salin"}
                                  </button>
                                </div>
                              </div>
                              <div className="service-metric">
                                <span>Last ping</span>
                                <strong>{formatRelativeTime(service.last_ping, now)}</strong>
                              </div>
                              <div className="service-metric">
                                <span>Updated at</span>
                                <strong>{formatDate(service.last_ping)}</strong>
                              </div>
                            </div>

                            {service.last_error ? (
                              <div className="service-error">
                                <div className="service-error-label">Latest issue</div>
                                <div className="mono">{service.last_error}</div>
                              </div>
                            ) : null}
                          </section>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>

        <section className="logs-section">
          <div className="logs-header">
            <div>
              <div className="eyebrow">
                <span className={`live-dot live-dot-${liveTone}`} />
                Activity stream
              </div>
              <h2>Realtime Agent Logs</h2>
              <p>
                Log operasional terbaru untuk command, retry tunnel, warning service,
                dan sinkronisasi agent.
              </p>
            </div>

            <div className="stream-meta">
              <button
                type="button"
                className="secondary-button"
                disabled={filteredLogs.length === 0}
                onClick={downloadLogs}
              >
                Unduh log
              </button>
              <div className="stream-badge">
                <span>Info</span>
                <strong>{logSummary.info}</strong>
              </div>
              <div className="stream-badge">
                <span>Warn</span>
                <strong>{logSummary.warn}</strong>
              </div>
              <div className="stream-badge">
                <span>Error</span>
                <strong>{logSummary.error}</strong>
              </div>
              <div className="stream-badge">
                <span>Debug</span>
                <strong>{logSummary.debug}</strong>
              </div>
            </div>
          </div>

          <div className="logs-wrap">
            {loading ? (
              <>
                <LoadingSkeleton className="log-skeleton" />
                <LoadingSkeleton className="log-skeleton" />
              </>
            ) : filteredLogs.length === 0 ? (
              <div className="empty-state">Belum ada log yang cocok dengan filter saat ini.</div>
            ) : (
              filteredLogs.map((log) => (
                <article key={log.id} className={`log-entry log-entry-${log.level}`}>
                  <div className="log-entry-meta">
                    <span className="mono">{formatDate(log.created_at)}</span>
                    <StatusPill value={log.level} emphasis="soft" />
                    <span className="mono">{log.device_id}</span>
                    <span>{log.service_name || "system"}</span>
                  </div>
                  <div className="log-entry-message">{log.message}</div>
                  {log.details ? (
                    <pre className="log-entry-details">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      </main>

      <ConfirmDialog
        pendingAction={pendingAction}
        busy={busyKey !== ""}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </>
  );
}
