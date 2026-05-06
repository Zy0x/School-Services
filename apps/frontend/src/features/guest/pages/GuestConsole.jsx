import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import Avatar3D from "../../../components/Avatar3D.jsx";
import { legacyDataClient } from "../../../services/legacyDataClient.js";
import { REFRESH_INTERVAL_MS } from "../../../app/lib/constants.js";
import { formatEdgeFunctionError } from "../../../app/lib/errors.js";
import { buildAuthUrl } from "../../../app/lib/routes.js";
import {
  formatRelativeTime,
  formatServiceDisplayName,
  getServiceStatusBadgeModel,
  statusTone,
} from "../../../app/lib/status.js";
import {
  buildNgrokVisitSiteNotice,
  getGuestStatusModel,
  shouldAutoShowCommandProgress,
  shouldShowNgrokVisitSiteNotice,
} from "../../../app/lib/guest.js";
import {
  getDeviceUpdateModel,
  getUpdateStatusSummary,
  REMOTE_UPDATE_MIN_VERSION,
  supportsRemoteUpdate,
} from "../../../app/lib/update.js";
import {
  ActionButton,
  CommandProgressOverlay,
  LongText,
  Skeleton,
  StatusChip,
  ToastViewport,
} from "../../../components/ui/core.jsx";
import { PublicLinkActions, SiteFooter } from "../components/GuestActions.jsx";

function getTunnelProviderBadgeModel(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "ngrok") {
    return { status: "ready", label: "Tunnel: Ngrok", name: "Ngrok" };
  }
  if (provider === "cloudflare" || provider === "cloudflared") {
    return { status: "ready", label: "Tunnel: Cloudflared", name: "Cloudflared" };
  }
  return { status: "idle", label: "Tunnel: menunggu", name: "Menunggu" };
}

export function GuestConsole({ deviceId }) {
  const [state, setState] = useState({ device: null, service: null, commands: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [toastItems, setToastItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [cancelingCommandId, setCancelingCommandId] = useState(null);
  const [commandModal, setCommandModal] = useState({
    open: false,
    action: "",
    title: "",
    message: "",
    commandId: null,
    minimized: false,
    status: "",
  });
  const announcedCommandStatusRef = useRef(new Map());

  function dismissToast(id) {
    setToastItems((current) => current.filter((item) => item.id !== id));
  }

  function pushToast(title, message = "", tone = "info") {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToastItems((current) => [...current, { id, title, message, tone }].slice(-4));
    window.setTimeout(() => {
      setToastItems((current) => current.filter((item) => item.id !== id));
    }, 3200);
  }

  function handleGuestFeedback(message, tone = "info", title = "") {
    if (!message) {
      return;
    }
    pushToast(title || (tone === "error" ? "Aksi belum berhasil" : "Aksi berhasil"), message, tone);
  }

  async function loadGuest(options = {}) {
    const silent = Boolean(options.silent);
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const { data, error: invokeError } = await legacyDataClient.functions.invoke("guest-access", {
        body: { action: "status", deviceId },
      });
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.ok) {
        throw new Error(data?.error || "Status perangkat belum dapat dimuat.");
      }
      setState({ device: data.device, service: data.service, commands: data.commands || [] });
      setError("");
      if (options.announce) {
        pushToast("Status diperbarui", "Informasi guest access sudah disegarkan.", "success");
      }
    } catch (nextError) {
      const message = formatEdgeFunctionError(nextError);
      setError(message);
      if (options.announce) {
        pushToast("Gagal memuat status", message, "error");
      }
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
    const channel = legacyDataClient
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "commands", filter: `device_id=eq.${deviceId}` },
        () => loadGuest({ silent: true })
      )
      .subscribe();

    return () => {
      legacyDataClient.removeChannel(channel);
    };
  }, [deviceId]);

  async function sendCommand(action) {
    try {
      setBusy(true);
      const isUpdateAction = action === "update";
      setCommandModal({
        open: true,
        action,
        title:
          action === "start"
            ? "Menyalakan E-Rapor"
            : isUpdateAction
              ? "Mengupdate Agent & Service"
              : "Menghentikan E-Rapor",
        message:
          action === "start"
            ? "Permintaan sedang diproses. Status halaman akan diperbarui otomatis."
            : isUpdateAction
              ? "Permintaan update sedang dikirim. Installer silent akan berjalan setelah agent menerima command."
              : "Permintaan sedang diproses. Tunggu beberapa saat sampai status berubah.",
        commandId: null,
        minimized: false,
        status: "pending",
      });
      const { data, error: invokeError } = await legacyDataClient.functions.invoke("guest-access", {
        body: { action, deviceId },
      });
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.ok) {
        throw new Error(data?.error || "Permintaan belum dapat diproses.");
      }
      if (data.command?.id) {
        setState((current) => ({
          ...current,
          commands: [data.command, ...(current.commands || []).filter((command) => command.id !== data.command.id)],
        }));
      }
      await loadGuest({ silent: true });
      pushToast(
        isUpdateAction ? "Update dimulai" : action === "start" ? "Perintah start dikirim" : "Perintah stop dikirim",
        isUpdateAction
          ? "Agent akan menghentikan layanan, memasang versi baru, lalu aktif kembali otomatis."
          : action === "start"
            ? "Layanan E-Rapor sedang disiapkan."
            : "Permintaan penghentian layanan sedang dijalankan.",
        "success"
      );
      setCommandModal((current) => ({
        ...current,
        commandId: data.command?.id || current.commandId,
        message:
          action === "start"
            ? "E-Rapor sedang dinyalakan. Status akan berubah setelah layanan siap."
            : isUpdateAction
              ? "Update diminta. Agent akan menghentikan layanan, memasang versi baru, lalu aktif kembali otomatis."
              : "E-Rapor sedang dihentikan. Status akan diperbarui setelah selesai.",
      }));
    } catch (nextError) {
      const message = formatEdgeFunctionError(nextError);
      setError(message);
      pushToast("Perintah gagal", message, "error");
      setCommandModal((current) => ({ ...current, open: true, message, status: "failed" }));
    } finally {
      setBusy(false);
    }
  }

  async function cancelActiveCommand() {
    if (!activeCommand?.id || cancelingCommandId) {
      return;
    }

    const commandId = activeCommand.id;
    setCancelingCommandId(commandId);
    try {
      const { data, error: invokeError } = await legacyDataClient.functions.invoke("guest-access", {
        body: { action: "cancelCommand", deviceId, commandId },
      });
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.ok) {
        throw new Error(data?.error || "Perintah belum dapat dibatalkan.");
      }
      if (data.command?.id) {
        setState((current) => ({
          ...current,
          commands: [data.command, ...(current.commands || []).filter((command) => command.id !== data.command.id)],
        }));
      }
      await loadGuest({ silent: true });
      pushToast(
        data?.alreadyCompleted ? "Perintah sudah selesai" : "Aksi dibatalkan",
        data?.alreadyCompleted ? "Perintah sudah selesai sebelum pembatalan diproses." : "Perintah dibatalkan pengguna.",
        "info"
      );
      setCommandModal((current) => ({
        ...current,
        open: true,
        commandId,
        message: data?.alreadyCompleted ? current.message : "Perintah dibatalkan pengguna.",
        status: data?.alreadyCompleted ? current.status : "failed",
      }));
    } catch (nextError) {
      const message = formatEdgeFunctionError(nextError);
      setError(message);
      pushToast("Gagal membatalkan", message, "error");
    } finally {
      setCancelingCommandId(null);
    }
  }

  function handleOpenService(event) {
    if (!canOpenService || !service?.public_url) {
      event?.preventDefault?.();
      handleGuestFeedback("Tautan belum aktif. Pastikan perangkat online dan layanan berjalan.", "error", "Tautan belum tersedia");
      return;
    }
    pushToast("Membuka E-Rapor", "Tautan publik dibuka di tab baru.", "success");
    window.open(service.public_url, "_blank", "noopener,noreferrer");
  }

  const service = state.service;
  const guestCommands = (state.commands || [])
    .map((command) => ({
      ...command,
      status: String(command.status || "pending"),
      progressPercent: Number(command.progress_percent ?? 0) || 0,
      phase: command.phase || "",
      message: command.message || "",
      error: command.error || "",
    }))
    .sort((left, right) => new Date(right.updated_at || right.created_at || 0).getTime() - new Date(left.updated_at || left.created_at || 0).getTime());
  const activeCommand =
    (commandModal.commandId
      ? guestCommands.find((command) => String(command.id) === String(commandModal.commandId))
      : null) ||
    guestCommands.find((command) => shouldAutoShowCommandProgress(command, state.device?.deviceStatus));
  const activeCommandStatus = activeCommand?.status || commandModal.status || (commandModal.open ? "pending" : "");
  const activeCommandPhase = String(activeCommand?.phase || "").toLowerCase();
  const activeCommandAction = activeCommand?.action || commandModal.action;
  const activeCommandMessage = activeCommand?.message || commandModal.message;
  const activeCommandPercent = activeCommand?.progressPercent || (activeCommandStatus === "pending" ? 4 : 24);
  const commandInFlight = ["pending", "running"].includes(activeCommandStatus);
  const guestStatus = getGuestStatusModel(state.device, service);
  const guestRuntimeStatus =
    guestStatus.overallStatus === "ready" || guestStatus.overallStatus === "degraded"
      ? "running"
      : guestStatus.overallStatus;
  const guestRuntimeBadge = getServiceStatusBadgeModel(guestRuntimeStatus);
  const guestUpdate = getDeviceUpdateModel(state.device);
  const guestUpdateSummary = getUpdateStatusSummary(guestUpdate);
  const remoteUpdateSupported = supportsRemoteUpdate(state.device);
  const canOpenService = guestStatus.ready;
  const isRunning = service?.status === "running" && service?.desired_state !== "stopped";
  const isServicePendingActive =
    ["starting", "reconnecting", "waiting_retry"].includes(String(service?.status || "").toLowerCase()) ||
    service?.desired_state === "running";
  const isServiceActiveOrStarting = isRunning || isServicePendingActive;
  const startDisabled = busy || commandInFlight || isServiceActiveOrStarting;
  const stopDisabled = busy || commandInFlight || !isServiceActiveOrStarting;
  const canUpdateService =
    guestUpdate.updateAvailable &&
    guestUpdate.status !== "updating" &&
    remoteUpdateSupported &&
    state.device?.deviceStatus === "online";
  const updateButtonLabel =
    guestUpdate.status === "updating"
      ? "Mengupdate"
      : canUpdateService
        ? "Update Agent"
        : guestUpdate.status === "current"
          ? "Sudah terupdate"
          : guestUpdate.updateAvailable && state.device?.deviceStatus !== "online"
            ? "Perangkat offline"
          : guestUpdate.updateAvailable && !remoteUpdateSupported
            ? "Update manual"
            : "Update belum tersedia";
  const updateDisabled = busy || commandInFlight || !canUpdateService;
  const unsupportedUpdateMessage =
    guestUpdate.updateAvailable && !remoteUpdateSupported
      ? `Update jarak jauh tersedia mulai agent v${REMOTE_UPDATE_MIN_VERSION}. Jalankan installer terbaru langsung di komputer ini.`
      : "";
  const offlineUpdateMessage =
    guestUpdate.updateAvailable && state.device?.deviceStatus !== "online"
      ? "Perangkat harus online sebelum update jarak jauh bisa dimulai."
      : "";
  const isDeviceOffline =
    state.device?.deviceStatus === "offline" ||
    guestStatus.overallStatus === "offline" ||
    guestStatus.overallStatus === "blocked";
  const serviceLabel = formatServiceDisplayName(service?.service_name || "rapor");
  const tunnelProviderBadge = getTunnelProviderBadgeModel(service?.tunnel_provider);
  const showNgrokVisitSiteNotice =
    canOpenService && shouldShowNgrokVisitSiteNotice(service?.public_url, service?.tunnel_provider);
  const loginUrl = buildAuthUrl({
    mode: "login",
    linkDeviceId: deviceId,
    guestDeviceId: deviceId,
  });
  const registerUrl = buildAuthUrl({
    mode: "register",
    linkDeviceId: deviceId,
    guestDeviceId: deviceId,
  });

  useEffect(() => {
    if (guestUpdate.status === "updating") {
      setCommandModal({
        open: true,
        action: "update",
        title: "Mengupdate Agent & Service",
        message: "Pembaruan otomatis sedang berjalan. Agent akan hidup kembali setelah installer selesai.",
        commandId: null,
        minimized: false,
        status: "running",
      });
    }
  }, [guestUpdate.status]);

  useEffect(() => {
    if (!activeCommand?.id || !["done", "failed"].includes(activeCommandStatus)) {
      return;
    }
    const key = String(activeCommand.id);
    if (announcedCommandStatusRef.current.get(key) === activeCommandStatus) {
      return;
    }
    announcedCommandStatusRef.current.set(key, activeCommandStatus);
    if (activeCommandStatus === "done") {
      pushToast("Aksi selesai", activeCommand.message || "Command selesai diproses.", "success");
      return;
    }
    if (activeCommandPhase === "cancelled") {
      pushToast("Aksi dibatalkan", activeCommand.message || "Perintah dibatalkan pengguna.", "info");
      return;
    }
    pushToast("Aksi gagal", activeCommand.error || activeCommand.message || "Command gagal diproses.", "error");
  }, [activeCommand?.id, activeCommandStatus, activeCommandPhase, activeCommand?.message, activeCommand?.error]);

  const accessHint = guestStatus.ready
    ? "Layanan siap. Gunakan tautan utama untuk membuka E-Rapor."
    : guestStatus.publicStatus === "disabled"
      ? "Perangkat atau layanan belum siap, jadi tautan publik belum tersedia."
      : "Status akan diperbarui otomatis begitu perangkat kembali stabil.";
  const serviceTarget =
    service?.desired_state === "running"
      ? "Dijalankan"
      : service?.desired_state === "stopped"
        ? "Dihentikan"
        : service?.desired_state || "-";

  return (
    <main className={`console-shell guest-console-shell route-guest ${isDeviceOffline ? "is-device-offline" : ""}`.trim()}>
      <div className="guest-shell-inner">
        <header className="top-command-bar guest-top-command-bar guest-top-command-surface" aria-label="Status dan aksi guest access">
          <div className="workspace-switcher guest-workspace-switcher">
            <Avatar3D size="sm" />
            <div>
              <strong>{state.device?.deviceName || "Perangkat tamu"}</strong>
              <small>{state.device?.deviceId || deviceId}</small>
            </div>
          </div>
          <div className="guest-top-command-actions">
            <ActionButton className="secondary-button guest-refresh-button" busy={refreshing} icon={RefreshCw} onClick={() => loadGuest({ silent: true, announce: true })}>
              Segarkan
            </ActionButton>
            <a className="secondary-button footer-link-button action-button" href={loginUrl}>
              <span>Login</span>
            </a>
            <a className="primary-button footer-link-button action-button" href={registerUrl}>
              <span>Daftar</span>
            </a>
          </div>
        </header>

        {error ? <div className="error-banner guest-error-banner">{error}</div> : null}

        <section className="fresh-console-stage guest-console-stage">
        {loading ? (
          <section className="guest-loading-shell" aria-busy="true" aria-label="Memuat status perangkat">
            <div className="guest-loading-layout">
              <article className="guest-panel guest-loading-card guest-loading-card-wide">
                <Skeleton lines={7} />
              </article>
            </div>
          </section>
        ) : (
          <section className="guest-main-layout guest-main-layout-streamlined">
            <article className={`guest-panel guest-access-main guest-access-card tone-${statusTone(guestRuntimeStatus)}`}>
              <div className="guest-access-card-head">
                <div className="guest-access-title">
                  <span className="section-eyebrow">Guest access</span>
                  <h1>{guestStatus.headline}</h1>
                  <p>{accessHint}</p>
                </div>
                <div className="guest-access-status-row">
                  <StatusChip status={guestRuntimeBadge.status} label={guestStatus.runtimeChipLabel} />
                  <StatusChip status={guestStatus.publicStatus} label={guestStatus.publicLabel} />
                  <StatusChip status={tunnelProviderBadge.status} label={tunnelProviderBadge.label} />
                </div>
              </div>

              <div className="guest-link-panel">
                <div className="guest-link-panel-top">
                  <div>
                    <span className="section-eyebrow">Tautan publik</span>
                    <strong>{canOpenService ? "Siap dibuka" : "Menunggu layanan aktif"}</strong>
                  </div>
                  <small>{serviceLabel}</small>
                </div>
                <div className="guest-link-focus-box guest-link-hero-box">
                  <LongText
                    value={service?.public_url || ""}
                    href={canOpenService ? service?.public_url : ""}
                    label="Tautan E-Rapor"
                    className="mono"
                    maxLength={96}
                    empty="Belum tersedia"
                    onCopySuccess={() => handleGuestFeedback("Tautan publik berhasil disalin.", "success", "Tautan disalin")}
                    onCopyError={(copyError) => handleGuestFeedback(copyError?.message || "Gagal menyalin tautan publik.", "error", "Salin gagal")}
                  />
                </div>
                <div className="guest-link-focus-actions guest-link-hero-actions">
                  <ActionButton
                    className="primary-button guest-open-button"
                    disabled={busy || !canOpenService}
                    onClick={handleOpenService}
                  >
                    Buka E-Rapor
                  </ActionButton>
                  <PublicLinkActions
                    url={service?.public_url || ""}
                    label={`Tautan ${serviceLabel} untuk ${state.device?.deviceName || deviceId}`}
                    compact
                    tunnelProvider={service?.tunnel_provider}
                    ngrokWarningUrl={service?.public_url || ""}
                    serverName={serviceLabel}
                    targetName={state.device?.deviceName || deviceId}
                    onActionComplete={setError}
                    onFeedback={handleGuestFeedback}
                  />
                </div>
                {showNgrokVisitSiteNotice ? (
                  <div className="fresh-inline-note ngrok-visit-site-note">
                    {buildNgrokVisitSiteNotice(serviceLabel)}
                  </div>
                ) : null}
              </div>

              <div className="guest-service-facts" aria-label="Ringkasan perangkat dan layanan">
                <div>
                  <span>Perangkat</span>
                  <strong>{state.device?.deviceName || deviceId}</strong>
                  <small className="mono">{state.device?.deviceId || deviceId}</small>
                </div>
                <div>
                  <span>Heartbeat</span>
                  <strong>{formatRelativeTime(state.device?.lastSeen)}</strong>
                  <small>Agent terakhir tersambung</small>
                </div>
                <div>
                  <span>Update service</span>
                  <strong>{formatRelativeTime(service?.last_ping)}</strong>
                  <small>Sinkronisasi status E-Rapor</small>
                </div>
                <div>
                  <span>Target layanan</span>
                  <strong>{serviceTarget}</strong>
                  <small>Status permintaan layanan</small>
                </div>
                <div>
                  <span>Kesiapan aplikasi</span>
                  <strong>{service?.location_status || "unknown"}</strong>
                  <small>Validasi lokasi E-Rapor</small>
                </div>
                <div>
                  <span>Update agent</span>
                  <strong>{guestUpdate.label}</strong>
                  <small>{guestUpdate.localVersion}</small>
                </div>
              </div>

              <div className="guest-control-band" aria-label="Kontrol layanan E-Rapor">
                <div className="guest-cta-row guest-control-actions">
                  <ActionButton className="primary-button guest-cta-button guest-cta-start" busy={busy && commandModal.action === "start"} disabled={startDisabled} onClick={() => sendCommand("start")}>
                    Mulai
                  </ActionButton>
                  <ActionButton className="secondary-button guest-cta-button guest-cta-stop" busy={busy && commandModal.action === "stop"} disabled={stopDisabled} onClick={() => sendCommand("stop")}>
                    Hentikan
                  </ActionButton>
                  <ActionButton
                    className="secondary-button guest-cta-button guest-cta-update"
                    busy={(busy && commandModal.action === "update") || guestUpdate.status === "updating"}
                    disabled={updateDisabled}
                    onClick={() => sendCommand("update")}
                  >
                    {updateButtonLabel}
                  </ActionButton>
                </div>
                <p>{offlineUpdateMessage || unsupportedUpdateMessage || guestUpdateSummary}</p>
              </div>

              <details className="guest-detail-disclosure">
                <summary>
                  <span>Detail teknis</span>
                  <strong>Lokasi aplikasi, pesan layanan, dan error</strong>
                </summary>
                <div className="guest-detail-disclosure-body">
                  <div className="guest-detail-row">
                    <span>Lokasi aplikasi</span>
                    <div className="guest-detail-long mono">
                      <LongText
                        value={service?.resolved_path || ""}
                        label="Lokasi aplikasi"
                        maxLength={72}
                        empty="Belum tersedia"
                        onCopySuccess={() => handleGuestFeedback("Lokasi aplikasi berhasil disalin.", "success", "Lokasi disalin")}
                        onCopyError={(copyError) => handleGuestFeedback(copyError?.message || "Gagal menyalin lokasi aplikasi.", "error", "Salin gagal")}
                      />
                    </div>
                  </div>
                  {service?.location_details?.message ? (
                    <div className="guest-detail-row guest-detail-note">
                      <span>Detail lokasi</span>
                      <LongText
                        value={service.location_details.message}
                        label="Detail lokasi"
                        maxLength={72}
                        onCopySuccess={() => handleGuestFeedback("Detail lokasi berhasil disalin.", "success", "Detail disalin")}
                        onCopyError={(copyError) => handleGuestFeedback(copyError?.message || "Gagal menyalin detail lokasi.", "error", "Salin gagal")}
                      />
                    </div>
                  ) : null}
                  {service?.last_error ? (
                    <div className="guest-detail-row guest-detail-error">
                      <span>Error layanan</span>
                      <LongText
                        value={service.last_error}
                        label="Error layanan"
                        maxLength={72}
                        onCopySuccess={() => handleGuestFeedback("Pesan error layanan berhasil disalin.", "success", "Error disalin")}
                        onCopyError={(copyError) => handleGuestFeedback(copyError?.message || "Gagal menyalin pesan error.", "error", "Salin gagal")}
                      />
                    </div>
                  ) : null}
                </div>
              </details>
            </article>
          </section>
        )}
        </section>
        <SiteFooter />
      </div>
      <CommandProgressOverlay
        open={commandModal.open || Boolean(activeCommand)}
        title={commandModal.title || (activeCommandAction === "update" ? "Mengupdate Agent & Service" : "Perintah sedang diproses")}
        message={activeCommandMessage}
        percent={activeCommandPercent}
        phase={activeCommand?.phase || ""}
        status={activeCommandStatus || "running"}
        error={activeCommand?.error || ""}
        minimized={commandModal.minimized}
        cancelLabel={cancelingCommandId ? "Membatalkan..." : "Batalkan"}
        onMinimize={() => setCommandModal((current) => ({ ...current, minimized: true }))}
        onRestore={() => setCommandModal((current) => ({ ...current, minimized: false }))}
        onCancel={activeCommand?.id && ["pending", "running"].includes(activeCommandStatus) ? cancelActiveCommand : undefined}
        onClose={() =>
          setCommandModal((current) =>
            ["done", "failed"].includes(activeCommandStatus)
              ? { ...current, open: false, commandId: null }
              : current
          )
        }
      />
      <ToastViewport items={toastItems} onDismiss={dismissToast} />
    </main>
  );
}
