import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import Avatar3D from "../../../components/Avatar3D.jsx";
import { legacyDataClient } from "../../../services/legacyDataClient.js";
import { REFRESH_INTERVAL_MS } from "../../../app/lib/constants.js";
import { formatEdgeFunctionError } from "../../../app/lib/errors.js";
import { buildAuthUrl } from "../../../app/lib/routes.js";
import {
  deriveAgentStatus,
  deriveDeviceConnectivityStatus,
  formatRelativeTime,
  formatServiceDisplayName,
  getAgentStatusBadgeModel,
  getDeviceConnectivityBadgeModel,
  getServiceStatusBadgeModel,
  isAgentControlReady,
  statusTone,
} from "../../../app/lib/status.js";
import {
  buildNgrokVisitSiteNotice,
  getGuestStatusModel,
  isCommandInProgress,
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
import { GuestConsoleView } from "../components/GuestConsoleView.jsx";

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function handleCopyFeedback(event) {
      const detail = event.detail || {};
      const tone = detail.tone || "success";
      pushToast(
        detail.title || (tone === "error" ? "Salin gagal" : "Berhasil disalin"),
        detail.message || "Teks berhasil disalin.",
        tone
      );
    }

    window.addEventListener("school-services:copy-feedback", handleCopyFeedback);
    return () => window.removeEventListener("school-services:copy-feedback", handleCopyFeedback);
  });

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
  const agentStatus = deriveAgentStatus(state.device, guestCommands, state.device?.deviceStatus);
  const agentBadge = getAgentStatusBadgeModel(agentStatus);
  const connectivityStatus = deriveDeviceConnectivityStatus(state.device, state.device?.deviceStatus);
  const connectivityBadge = getDeviceConnectivityBadgeModel(connectivityStatus);
  const agentControlReady = isAgentControlReady(state.device, connectivityStatus);
  const deviceWithAgentStatus = state.device ? { ...state.device, agentStatus, connectivityStatus, agentControlReady } : state.device;
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
  const commandInFlight =
    (Boolean(activeCommand) && ["pending", "running"].includes(activeCommandStatus)) ||
    (commandModal.open && ["pending", "running"].includes(String(commandModal.status || "")));
  const guestStatus = getGuestStatusModel(deviceWithAgentStatus, service);
  const guestRuntimeStatus =
    guestStatus.overallStatus === "ready" || guestStatus.overallStatus === "degraded"
      ? "running"
      : guestStatus.overallStatus;
  const guestRuntimeBadge = getServiceStatusBadgeModel(guestRuntimeStatus);
  const guestUpdate = getDeviceUpdateModel(state.device);
  const guestUpdateSummary = getUpdateStatusSummary(guestUpdate);
  const remoteUpdateSupported = supportsRemoteUpdate(state.device);
  const canOpenService = guestStatus.ready;
  const isDeviceOffline =
    state.device?.deviceStatus === "offline" ||
    agentStatus === "stopped" ||
    guestStatus.overallStatus === "offline" ||
    guestStatus.overallStatus === "blocked";
  const isDeviceOnline = state.device?.deviceStatus === "online" && agentStatus === "running";
  const normalizedServiceStatus = String(service?.status || "").toLowerCase();
  const desiredServiceState = String(service?.desired_state || "").toLowerCase();
  const isRunning = normalizedServiceStatus === "running" && desiredServiceState !== "stopped";
  const isServicePendingActive =
    ["starting", "reconnecting", "waiting_retry"].includes(normalizedServiceStatus) ||
    (desiredServiceState === "running" && normalizedServiceStatus !== "running");
  const isServiceStopping = desiredServiceState === "stopped" && normalizedServiceStatus === "running";
  const isServiceActiveOrStarting = isRunning || isServicePendingActive;
  const activeServiceCommandInFlight = guestCommands.some(
    (command) => ["start", "stop"].includes(String(command.action || "")) && isCommandInProgress(command)
  );
  const serviceCommandAvailable = agentStatus === "running";
  const startDisabled = busy || commandInFlight || activeServiceCommandInFlight || !serviceCommandAvailable || isServiceActiveOrStarting;
  const stopDisabled = busy || commandInFlight || activeServiceCommandInFlight || !serviceCommandAvailable || (!isServiceActiveOrStarting && !isServiceStopping);
  const canUpdateService =
    guestUpdate.updateAvailable &&
    guestUpdate.status !== "updating" &&
    remoteUpdateSupported &&
    serviceCommandAvailable &&
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
  const agentControlMessage =
    agentStatus === "stopped"
      ? agentControlReady
        ? "Agent sedang berhenti, tetapi device masih online dan siap menerima Start Agent dari panel pengelola."
        : "Agent sedang berhenti dan kontrol agent belum terverifikasi. Pastikan perangkat tersambung internet sebelum dinyalakan."
      : ["starting", "stopping", "restarting", "updating"].includes(agentStatus)
        ? "Agent sedang memproses perubahan. Tombol layanan akan aktif kembali setelah status stabil."
        : "";
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
    const body = document.body;
    if (!body) {
      return undefined;
    }

    body.classList.remove("school-device-online", "school-device-offline");
    if (isDeviceOnline) {
      body.classList.add("school-device-online");
    } else if (state.device && (isDeviceOffline || state.device.deviceStatus === "unstable")) {
      body.classList.add("school-device-offline");
    }

    return () => {
      body.classList.remove("school-device-online", "school-device-offline");
    };
  }, [isDeviceOnline, isDeviceOffline, state.device?.deviceId, state.device?.deviceStatus]);

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

  useEffect(() => {
    if (!activeCommand?.id || !["done", "failed"].includes(activeCommandStatus)) {
      return undefined;
    }

    const commandId = activeCommand.id;
    const timeoutId = window.setTimeout(() => {
      setCommandModal((current) =>
        String(current.commandId || "") === String(commandId)
          ? {
              open: false,
              action: "",
              title: "",
              message: "",
              commandId: null,
              minimized: false,
              status: "",
            }
          : current
      );
    }, activeCommandStatus === "done" ? 1400 : 2600);

    return () => window.clearTimeout(timeoutId);
  }, [activeCommand?.id, activeCommandStatus]);

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
    <GuestConsoleView
      activeCommand={activeCommand}
      activeCommandAction={activeCommandAction}
      activeCommandMessage={activeCommandMessage}
      activeCommandPercent={activeCommandPercent}
      activeCommandStatus={activeCommandStatus}
      accessHint={accessHint}
      agentBadge={agentBadge}
      agentControlMessage={agentControlMessage}
      agentStatus={agentStatus}
      busy={busy}
      canOpenService={canOpenService}
      cancelActiveCommand={cancelActiveCommand}
      cancelingCommandId={cancelingCommandId}
      commandModal={commandModal}
      connectivityBadge={connectivityBadge}
      deviceId={deviceId}
      dismissToast={dismissToast}
      error={error}
      guestRuntimeBadge={guestRuntimeBadge}
      guestRuntimeStatus={guestRuntimeStatus}
      guestStatus={guestStatus}
      guestUpdate={guestUpdate}
      guestUpdateSummary={guestUpdateSummary}
      handleGuestFeedback={handleGuestFeedback}
      handleOpenService={handleOpenService}
      isDeviceOffline={isDeviceOffline}
      isDeviceOnline={isDeviceOnline}
      loadGuest={loadGuest}
      loading={loading}
      loginUrl={loginUrl}
      offlineUpdateMessage={offlineUpdateMessage}
      refreshing={refreshing}
      registerUrl={registerUrl}
      sendCommand={sendCommand}
      service={service}
      serviceLabel={serviceLabel}
      serviceTarget={serviceTarget}
      setCommandModal={setCommandModal}
      setError={setError}
      showNgrokVisitSiteNotice={showNgrokVisitSiteNotice}
      startDisabled={startDisabled}
      state={state}
      stopDisabled={stopDisabled}
      toastItems={toastItems}
      tunnelProviderBadge={tunnelProviderBadge}
      unsupportedUpdateMessage={unsupportedUpdateMessage}
      updateButtonLabel={updateButtonLabel}
      updateDisabled={updateDisabled}
    />
  );
}
