import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabase";

const HEARTBEAT_STALE_MS = Number(import.meta.env.VITE_HEARTBEAT_STALE_MS || 20000);
const REFRESH_INTERVAL_MS = Number(import.meta.env.VITE_DASHBOARD_REFRESH_MS || 5000);
const LOG_LIMIT = 120;
const JOB_LIMIT = 80;

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

function statusTone(status) {
  if (["running", "completed", "online", "ready", "super_admin"].includes(status)) {
    return "good";
  }
  if (["waiting_retry", "starting", "partial", "pending", "running_job"].includes(status)) {
    return "warn";
  }
  if (["error", "failed", "blocked", "offline", "missing", "cancelled", "expired"].includes(status)) {
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

function LoginScreen({ email, password, setEmail, setPassword, onSubmit, error, loading }) {
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
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password super admin"
              autoComplete="current-password"
            />
          </label>
          {error ? <div className="error-banner">{error}</div> : null}
          <button className="primary-button login-button" disabled={loading} type="submit">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
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
  items,
  selectedPaths,
  onToggle,
  onOpen,
  onPreview,
}) {
  if (!items || items.length === 0) {
    return <div className="empty-state">Folder ini kosong atau belum berhasil dimuat.</div>;
  }

  return (
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
        return (
          <div key={item.path} className={`file-row ${selected ? "file-row-selected" : ""}`}>
            <label className="file-name-cell">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(item)}
              />
              <button
                type="button"
                className="file-link"
                onClick={() => (item.type === "directory" ? onOpen(item.path) : onPreview(item))}
              >
                {item.name}
              </button>
            </label>
            <span>{item.type}</span>
            <span>{item.type === "directory" ? "-" : formatBytes(item.size)}</span>
            <span>{formatDate(item.modifiedAt)}</span>
            <button type="button" className="utility-button" onClick={() => onPreview(item)}>
              Preview
            </button>
          </div>
        );
      })}
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
          <div className="job-card-meta">
            <span>{formatDate(job.created_at)}</span>
            <span>{job.progress_total ? `${job.progress_current}/${job.progress_total}` : "progress n/a"}</span>
            <span>{job.delivery_mode}</span>
          </div>
          {job.error ? <div className="job-error">{job.error}</div> : null}
          <div className="job-actions">
            {job.status === "completed" && job.artifact_bucket && job.artifact_object_key ? (
              <button type="button" className="primary-button" onClick={() => onDownload(job)}>
                Download
              </button>
            ) : null}
            {job.status === "completed" && job.delivery_mode === "temp" && job.artifact_bucket ? (
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
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authError, setAuthError] = useState("");
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
  const fileInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session || null);
        setAuthLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setAuthLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function loadAll(background = false) {
    if (!session) {
      return;
    }

    if (!background) {
      setLoading(true);
    }

    const [servicesResult, logsResult, jobsResult, rootsResult] = await Promise.all([
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
    ]);

    const nextError =
      servicesResult.error?.message ||
      logsResult.error?.message ||
      jobsResult.error?.message ||
      rootsResult.error?.message ||
      "";

    setError(nextError);
    if (!nextError) {
      startTransition(() => {
        setServices(servicesResult.data || []);
        setLogs(logsResult.data || []);
        setFileJobs(jobsResult.data || []);
        setRoots(rootsResult.data || []);
      });
    }

    if (!background) {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!session) {
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
  }, [session]);

  useEffect(() => {
    if (selectedDeviceId !== "all" && !services.some((row) => row.device_id === selectedDeviceId)) {
      setSelectedDeviceId("all");
    }
  }, [services, selectedDeviceId]);

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
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });

    if (signInError) {
      setAuthError(signInError.message);
    }

    setAuthLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setServices([]);
    setLogs([]);
    setFileJobs([]);
    setRoots([]);
    setDirectoryResult(null);
    setPreviewResult(null);
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

  async function openPath(nextPath) {
    setCurrentPath(nextPath);
    const job = await createFileJob("list_directory", { sourcePath: nextPath });
    if (job) {
      setDirectoryJobId(job.id);
      setDirectoryResult(null);
      setSelectedTab("files");
    }
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
    try {
      setBusyAction(`download:${job.id}`);
      let signedUrl = "";
      try {
        const data = await invokeAdmin("signArtifact", {
          bucket: job.artifact_bucket,
          objectKey: job.artifact_object_key,
          downloadFileName: job.result?.fileName || job.artifact_object_key.split("/").pop(),
        });
        signedUrl = data.signedUrl;
      } catch (_functionError) {
        const { data, error: signError } = await supabase.storage
          .from(job.artifact_bucket)
          .createSignedUrl(job.artifact_object_key, 60 * 15, {
            download: job.result?.fileName || job.artifact_object_key.split("/").pop(),
          });
        if (signError) {
          throw signError;
        }
        signedUrl = data.signedUrl;
      }
      window.open(signedUrl, "_blank", "noopener,noreferrer");
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

  if (authLoading && !session) {
    return <LoginScreen email="" password="" setEmail={() => {}} setPassword={() => {}} onSubmit={() => {}} error="" loading />;
  }

  if (!session) {
    return (
      <LoginScreen
        email={loginEmail}
        password={loginPassword}
        setEmail={setLoginEmail}
        setPassword={setLoginPassword}
        onSubmit={signIn}
        error={authError}
        loading={authLoading}
      />
    );
  }

  return (
    <main className="console-shell">
      <header className="topbar">
        <div>
          <div className="section-eyebrow">Authenticated Admin Console</div>
          <h1>School Services Remote Control</h1>
          <p>
            Kontrol service, akses file user, backup data, preview artefak, dan
            pantau error agent dalam satu console realtime.
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
              ["files", "Remote Files"],
              ["activity", "Activity"],
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

          {selectedDevice ? (
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
                      </div>
                    </div>

                    <div className="service-stack">
                      {selectedDevice.services.map((service) => (
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
                              <span>Public URL</span>
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
                          <div className="panel-actions">
                            <button
                              type="button"
                              className="primary-button"
                              disabled={busyAction !== ""}
                              onClick={() => queueCommand(selectedDevice.deviceId, service.service_name, "start")}
                            >
                              Start
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busyAction !== ""}
                              onClick={() => queueCommand(selectedDevice.deviceId, service.service_name, "stop")}
                            >
                              Stop
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}

              {selectedTab === "files" ? (
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
                        items={directoryResult?.items || []}
                        selectedPaths={selectedPaths}
                        onToggle={toggleSelection}
                        onOpen={openPath}
                        onPreview={previewItem}
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
                    </div>
                    <div className="log-stack">
                      {logs
                        .filter((log) => selectedDeviceId === "all" || log.device_id === selectedDeviceId)
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
            </>
          ) : (
            <div className="empty-state">Belum ada device yang aktif.</div>
          )}
        </section>
      </div>
    </main>
  );
}
