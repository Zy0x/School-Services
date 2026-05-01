import { AlertTriangle, CheckCircle2, CircleArrowUp, Info, Rocket } from "lucide-react";
import { dismissOnBackdrop } from "../../../app/lib/browser.js";
import {
  getDeviceUpdateModel,
  getUpdateStatusSummary,
  REMOTE_UPDATE_MIN_VERSION,
  supportsRemoteUpdate,
} from "../../../app/lib/update.js";
import { ActionButton } from "../../../components/ui/core.jsx";

export function DeviceUpdateStatusIndicator({ update, toneStatus }) {
  let Icon = Info;
  let tooltip = "Versi terbaru belum diketahui.";
  let indicatorTone = "unknown";

  if (update.status === "current") {
    Icon = CheckCircle2;
    tooltip = "Versi ini sudah menggunakan rilis terbaru.";
    indicatorTone = "ready";
  } else if (update.status === "available") {
    Icon = CircleArrowUp;
    tooltip = `Perlu update ke ${update.latestVersion || "versi terbaru"}.`;
    indicatorTone = "available";
  } else if (update.status === "updating") {
    Icon = CircleArrowUp;
    tooltip = update.latestVersion
      ? `Sedang update ke ${update.latestVersion}.`
      : "Sedang memasang pembaruan.";
    indicatorTone = "updating";
  } else if (update.status === "failed") {
    Icon = AlertTriangle;
    tooltip = update.error || "Update gagal. Periksa log agent.";
    indicatorTone = "failed";
  } else if (toneStatus === "reconnecting") {
    Icon = CircleArrowUp;
    tooltip = "Permintaan update sudah dikirim.";
    indicatorTone = "updating";
  }

  return (
    <span className={`device-update-indicator tone-${indicatorTone}`} tabIndex={0} aria-label={tooltip}>
      <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
      <span className="device-update-indicator-bubble">{tooltip}</span>
    </span>
  );
}

export function DeviceUpdateCard({
  deviceRecord,
  deviceStatus = "offline",
  busy = false,
  onUpdate = null,
  showAction = false,
}) {
  const update = getDeviceUpdateModel(deviceRecord);
  const summary = getUpdateStatusSummary(update);
  const remoteUpdateSupported = supportsRemoteUpdate(deviceRecord);
  const toneStatus = busy && update.status !== "updating" ? "reconnecting" : update.toneStatus;
  const canUpdate =
    showAction &&
    typeof onUpdate === "function" &&
    update.updateAvailable &&
    update.status !== "updating" &&
    remoteUpdateSupported &&
    deviceStatus === "online";
  const unsupportedUpdateMessage =
    showAction && update.updateAvailable && !remoteUpdateSupported
      ? `Update jarak jauh tersedia mulai agent v${REMOTE_UPDATE_MIN_VERSION}. Jalankan installer terbaru langsung di komputer ini.`
      : "";

  return (
    <article className="metric-card device-update-card">
      <div className="device-update-topline">
        <span className="device-update-title-row">
          <span className="device-update-icon" aria-hidden="true">
            <Rocket size={18} strokeWidth={2.2} />
          </span>
          <span className="device-update-title">Versi & update</span>
        </span>
        <DeviceUpdateStatusIndicator update={update} toneStatus={toneStatus} />
      </div>
      <div className="device-update-summary">
        <strong className="device-update-version">{update.localVersion}</strong>
        <small className="device-update-note">{summary}</small>
      </div>
      {showAction && canUpdate ? (
        <ActionButton
          className="primary-button device-update-action"
          busy={busy}
          disabled={busy}
          onClick={onUpdate}
        >
          Update Agent & Service
        </ActionButton>
      ) : null}
      {update.error ? <div className="job-error">{update.error}</div> : null}
      {unsupportedUpdateMessage ? <div className="job-error">{unsupportedUpdateMessage}</div> : null}
    </article>
  );
}

export function UpdateProgressModal({
  open,
  update,
  title = "Mengupdate Agent & Service",
  message = "Permintaan update dikirim. Agent akan menghentikan layanan, menjalankan installer silent, lalu hidup kembali otomatis.",
  onClose,
}) {
  if (!open) {
    return null;
  }

  const model = update || {
    status: "unchecked",
    label: "Update diminta",
    localVersion: "belum dilaporkan",
    latestVersion: "belum dilaporkan",
  };
  const progress =
    model.status === "current"
      ? 100
      : model.status === "failed"
        ? 100
        : model.status === "updating"
          ? 68
          : 34;
  const canClose = model.status !== "updating";
  const statusText =
    model.status === "current"
      ? "Update selesai. Buka ulang aplikasi atau halaman ini agar sesi dan tautan perangkat memakai data terbaru."
      : model.status === "failed"
        ? "Update gagal. Periksa pesan error dan log agent."
        : model.status === "updating"
          ? "Agent dan service sedang diupdate. Jangan gunakan layanan sampai agent aktif kembali, lalu buka ulang aplikasi atau halaman ini."
          : message;

  return (
    <div
      className="guest-modal-backdrop"
      role="status"
      aria-live="polite"
      onMouseDown={(event) => dismissOnBackdrop(event, canClose ? onClose : undefined)}
    >
      <div className="guest-modal-card update-progress-card">
        <div className={`update-progress-orb tone-${model.status}`}>
          <span className="update-progress-core" aria-hidden="true" />
        </div>
        <div>
          <strong>{title}</strong>
          <p>{statusText}</p>
        </div>
        <div className="update-version-row">
          <span>Versi lokal: {model.localVersion}</span>
          <span>Latest GitHub: {model.latestVersion}</span>
        </div>
        <div className="update-progress-track" aria-label={`Progress update ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="update-step-list">
          <span className="update-step-active">Command diterima</span>
          <span className={model.status === "updating" || model.status === "current" ? "update-step-active" : ""}>
            Installer silent
          </span>
          <span className={model.status === "current" ? "update-step-active" : ""}>Agent aktif kembali</span>
        </div>
        {model.error ? <div className="job-error">{model.error}</div> : null}
        {canClose && typeof onClose === "function" ? (
          <div className="guest-modal-actions">
            <button type="button" className="primary-button" onClick={onClose}>
              Tutup
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
