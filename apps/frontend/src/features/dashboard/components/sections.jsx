import {
  Cloud,
  Copy,
  FileText,
  Gauge,
  KeyRound,
  Monitor,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Server,
  Share2,
  ShieldCheck,
  Square,
  Unlink,
  Users,
} from "lucide-react";
import { PublicLinkActions as GuestPublicLinkActions } from "../../guest/components/GuestActions.jsx";
import {
  AccountTable,
  DeviceCombobox,
  EmptyState,
  FileTable,
  FloatingFileActivity,
  LogOverlay,
  Pagination,
  ProfilePanel,
  RootGrid,
  SectionHeader,
  SupabaseFileTable,
  getRemoteRootPreference,
} from "./shared.jsx";
import { ActionButton, LongText, MaskedTextField, PasswordField as SharedPasswordField, StatusChip } from "../../../components/ui/core.jsx";
import {
  AGENT_LIFECYCLE_ACTIONS,
  formatRelativeTime,
  formatServiceDisplayName,
  getAgentStatusBadgeModel,
  getDeviceConnectivityBadgeModel,
  getDeviceStatusBadgeModel,
  getPublicLinkBadgeModel,
  getPublicUrlLabel,
  getServiceStatusBadgeModel,
  getTunnelProviderBadgeModel,
  statusTone,
} from "../../../app/lib/status.js";
import { buildNgrokVisitSiteNotice, isCommandInProgress, shouldShowNgrokVisitSiteNotice } from "../../../app/lib/guest.js";
import { getDeviceUpdateModel, supportsRemoteUpdate } from "../../../app/lib/update.js";
import { formatDate } from "../../../app/lib/files.js";

export function createDashboardRenderers(ctx) {
  const {
    accountByUserId,
    accountPage,
    accounts,
    activeRunningJobs,
    artifactBucketFilter,
    artifactDeviceOptions,
    artifactSearch,
    authPolicy,
    busyAction,
    copyReferralCode,
    createApproveImmediately,
    createAssignedDeviceId,
    createDisplayName,
    createEmail,
    createManagedAccount,
    createPassword,
    createRole,
    currentPath,
    currentUserId,
    deviceEntries,
    directoryJobId,
    directoryResult,
    effectiveArtifactDeviceFilter,
    environments,
    fileActivityExpanded,
    fileActivityOpen,
    fileExplorerBusy,
    fileInputRef,
    fileJobs,
    filePage,
    filesView,
    filteredFleetDevices,
    fleetPageSize,
    fleetSearch,
    handleAccountAction,
    handleArtifactDownload,
    handleDeleteAccount,
    handleInlineFeedback,
    isOperator,
    isSuperAdmin,
    isUser,
    logLevelFilter,
    logOverlayOpen,
    logs,
    navigateRoute,
    now,
    openAliasModal,
    openParentPath,
    openPath,
    pagedFleetDevices,
    pendingAccountCount,
    previewItem,
    profile,
    queueCommand,
    queueDownloadSelection,
    refreshRoots,
    refreshStorageArtifacts,
    requestDeleteStorageArtifact,
    rootDiscoveryJobId,
    safeFleetPage,
    selectedDevice,
    selectedDeviceBadge,
    selectedDeviceId,
    selectedDeviceJobs,
    selectedDeviceRoots,
    selectedPaths,
    selectedTab,
    session,
    setAccountPage,
    setArtifactBucketFilter,
    setArtifactSearch,
    setAuthPolicy,
    setCreateApproveImmediately,
    setCreateAssignedDeviceId,
    setCreateDisplayName,
    setCreateEmail,
    setCreatePassword,
    setCreateRole,
    setError,
    setFileActivityExpanded,
    setFileActivityOpen,
    setFilePage,
    setFilesView,
    setFleetPage,
    setFleetSearch,
    setLogLevelFilter,
    setLogOverlayOpen,
    shareReferralCode,
    signOut,
    syncGlobalDeviceSelection,
    toggleSelection,
    triggerUpload,
    unlinkDeviceAssignment,
    visibleCommandRows,
    visibleServices,
    visibleStorageArtifacts,
  } = ctx;

  function openDeviceRoute(deviceId) {
    syncGlobalDeviceSelection(deviceId);
    navigateRoute("devices", { deviceId });
  }

  function renderFreshMetric(label, value, helper, Icon = Gauge, tone = "") {
    return (
      <article className={`fresh-metric ${tone ? `tone-${tone}` : ""}`}>
        <span className="fresh-metric-icon" aria-hidden="true">
          <Icon size={19} strokeWidth={2.2} />
        </span>
        <div>
          <span>{label}</span>
          <strong>{value}</strong>
          {helper ? <small>{helper}</small> : null}
        </div>
      </article>
    );
  }

  function renderFreshDeviceList(limit = 0) {
    const source = limit ? deviceEntries.slice(0, limit) : deviceEntries;
    if (!source.length) {
      return <EmptyState title="Belum ada perangkat" description="Perangkat akan muncul setelah agent mengirim heartbeat." />;
    }

    return (
      <div className="fresh-device-list">
        {source.map((device) => {
          const badge = getDeviceStatusBadgeModel(device.deviceStatus);
          const agentBadge = getAgentStatusBadgeModel(device.agentStatus);
          const connectivityBadge = getDeviceConnectivityBadgeModel(device.connectivityStatus);
          const update = getDeviceUpdateModel(device.deviceRecord);
          return (
            <button
              key={device.deviceId}
              type="button"
              className={`fresh-device-row ${selectedDevice?.deviceId === device.deviceId ? "is-active" : ""}`}
              onClick={() => openDeviceRoute(device.deviceId)}
            >
              <span className="fresh-device-main">
                <strong>{device.deviceName}</strong>
                <LongText value={device.deviceId} label="ID perangkat" className="mono" maxLength={26} />
              </span>
              <span className="fresh-device-meta">
                <StatusChip status={badge.status} label={badge.label} />
                <StatusChip status={agentBadge.status} label={agentBadge.label} />
                <StatusChip status={connectivityBadge.status} label={connectivityBadge.label} />
                {update.updateAvailable ? <StatusChip status="available" label="update" /> : null}
                <small>{device.runningCount} layanan aktif</small>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderFreshServiceList() {
    if (!selectedDevice) {
      return <EmptyState title="Pilih perangkat" description="Pilih perangkat untuk melihat layanan dan tautan E-Rapor." />;
    }

    if (!visibleServices.length) {
      return <EmptyState title="Belum ada layanan" description="Agent belum melaporkan layanan untuk perangkat ini." />;
    }

    return (
      <div className="fresh-service-list">
        {visibleServices.map((service) => {
          const serviceLabel = formatServiceDisplayName(service.service_name);
          const runtimeBadge = getServiceStatusBadgeModel(service.serviceStatus);
          const publicBadge = getPublicLinkBadgeModel(service);
          const tunnelProviderBadge = getTunnelProviderBadgeModel(service.tunnel_provider);
          const showNgrokVisitSiteNotice = shouldShowNgrokVisitSiteNotice(
            service.public_url,
            service.tunnel_provider
          );
          const normalizedServiceStatus = String(service.serviceStatus || service.status || "").toLowerCase();
          const desiredServiceState = String(service.desired_state || "").toLowerCase();
          const runningNow = normalizedServiceStatus === "running" && desiredServiceState !== "stopped";
          const serviceStarting =
            ["starting", "reconnecting", "waiting_retry"].includes(normalizedServiceStatus) ||
            (desiredServiceState === "running" && normalizedServiceStatus !== "running");
          const serviceStopping = desiredServiceState === "stopped" && normalizedServiceStatus === "running";
          const serviceCommandInFlight = visibleCommandRows.some(
            (command) =>
              command.deviceId === selectedDevice.deviceId &&
              command.serviceName === service.service_name &&
              isCommandInProgress(command)
          );
          const agentRunning = selectedDevice.agentStatus === "running";
          const canStartService = agentRunning && !runningNow && !serviceStarting && !serviceCommandInFlight;
          const canStopService = agentRunning && (runningNow || serviceStarting || serviceStopping) && !serviceCommandInFlight;
          return (
            <article
              key={service.id}
              className={`fresh-service-card tone-${statusTone(service.serviceStatus)} service-${service.service_name}`}
            >
              <div className="fresh-card-head">
                <div>
                  <span className="section-eyebrow">Service</span>
                  <strong>{serviceLabel}</strong>
                  <small className="mono">localhost:{service.port}</small>
                </div>
                <div className="fresh-pill-group">
                  <StatusChip status={runtimeBadge.status} label={runtimeBadge.label} />
                  <StatusChip status={publicBadge.status} label={publicBadge.label} />
                  <StatusChip status={tunnelProviderBadge.status} label={tunnelProviderBadge.label} />
                </div>
              </div>
              <div className="fresh-data-grid compact-service-grid">
                <div>
                  <span>{getPublicUrlLabel(service)}</span>
                  <strong>
                    {service.public_url ? (
                      <LongText value={service.public_url} href={service.public_url} label={`Tautan ${serviceLabel}`} maxLength={44} />
                    ) : (
                      "Belum tersedia"
                    )}
                  </strong>
                </div>
              </div>
              <div className="fresh-actions">
                <ActionButton
                  className="primary-button action-start"
                  busy={busyAction === `${selectedDevice.deviceId}:${service.service_name}:start`}
                  disabled={busyAction !== "" || !canStartService}
                  onClick={() => queueCommand(selectedDevice.deviceId, service.service_name, "start")}
                >
                  Mulai
                </ActionButton>
                <ActionButton
                  className="danger-button action-stop"
                  busy={busyAction === `${selectedDevice.deviceId}:${service.service_name}:stop`}
                  disabled={busyAction !== "" || !canStopService}
                  onClick={() => queueCommand(selectedDevice.deviceId, service.service_name, "stop")}
                >
                  Hentikan
                </ActionButton>
                  <GuestPublicLinkActions
                    url={service.public_url || ""}
                    label={`Tautan ${serviceLabel} untuk ${selectedDevice.deviceName}`}
                    compact
                    tunnelProvider={service.tunnel_provider}
                    ngrokWarningUrl={service.public_url || ""}
                    serverName={serviceLabel}
                    targetName={selectedDevice.deviceName}
                    onActionComplete={setError}
                    onFeedback={handleInlineFeedback}
                  />
              </div>
              {showNgrokVisitSiteNotice ? (
                <div className="fresh-inline-note ngrok-visit-site-note">
                  {buildNgrokVisitSiteNotice(serviceLabel)}
                </div>
              ) : null}
              <details className="compact-detail-disclosure service-detail-disclosure">
                <summary>
                  <span>Detail layanan</span>
                  <strong>Path, tunnel, ping, dan error</strong>
                </summary>
                <div className="compact-detail-grid">
                  <div>
                    <span>Lokasi aplikasi</span>
                    <strong>
                      <LongText value={service.resolved_path || ""} label="Lokasi aplikasi" className="mono" maxLength={52} />
                    </strong>
                  </div>
                  <div>
                    <span>Update status</span>
                    <strong>{formatRelativeTime(service.last_ping, now)}</strong>
                  </div>
                  <div>
                    <span>Provider tunnel</span>
                    <strong>{tunnelProviderBadge.name}</strong>
                  </div>
                  <div>
                    <span>Status target</span>
                    <strong>{service.desired_state || "-"}</strong>
                  </div>
                </div>
                {service.location_details?.message ? (
                  <div className="fresh-inline-note">
                    <LongText value={service.location_details.message} label="Detail lokasi" maxLength={76} />
                  </div>
                ) : null}
                {service.last_error ? (
                  <div className="fresh-inline-error">
                    <LongText value={service.last_error} label="Error layanan" maxLength={76} />
                  </div>
                ) : null}
              </details>
            </article>
          );
        })}
      </div>
    );
  }

  function renderSelectedDeviceOperations() {
    if (!selectedDevice) {
      return <EmptyState title="Pilih perangkat" description="Pilih perangkat untuk membuka kontrol SuperAdmin." />;
    }

    const update = getDeviceUpdateModel(selectedDevice.deviceRecord);
    const agentBadge = getAgentStatusBadgeModel(selectedDevice.agentStatus);
    const connectivityBadge = getDeviceConnectivityBadgeModel(selectedDevice.connectivityStatus);
    const agentLifecycleInFlight = visibleCommandRows.some(
      (command) =>
        command.deviceId === selectedDevice.deviceId &&
        AGENT_LIFECYCLE_ACTIONS.has(String(command.action || "").toLowerCase()) &&
        isCommandInProgress(command)
    );
    const agentStopped = selectedDevice.agentStatus === "stopped";
    const agentRunning = selectedDevice.agentStatus === "running";
    const agentControlReady = selectedDevice.agentControlReady;
    const remoteUpdateSupported = supportsRemoteUpdate(selectedDevice.deviceRecord);
    const canControlAgent = isSuperAdmin || isOperator;
    const canUpdate =
      canControlAgent &&
      update.updateAvailable &&
      update.status !== "updating" &&
      remoteUpdateSupported &&
      agentRunning &&
      agentControlReady &&
      selectedDevice.deviceStatus === "online";
    const updateBusy = busyAction === `${selectedDevice.deviceId}:device:update`;
    const activeAssignment = selectedDevice.activeAssignments?.[0] || null;
    const assignmentAccount = activeAssignment
      ? accountByUserId.get(String(activeAssignment.user_id || ""))
      : null;
    const assignmentLabel = activeAssignment
      ? assignmentAccount?.display_name || assignmentAccount?.email || activeAssignment.user_id
      : "Belum tertaut";
    const canUnlinkSelectedDevice =
      Boolean(activeAssignment) &&
      (isSuperAdmin || isOperator || String(activeAssignment.user_id || "") === currentUserId);
    const updateLabel =
      update.status === "updating"
        ? "Mengupdate"
        : canUpdate
          ? "Update Agent"
          : update.status === "current"
            ? "Agent terbaru"
            : update.updateAvailable && selectedDevice.deviceStatus !== "online"
              ? "Device offline"
              : update.updateAvailable && !remoteUpdateSupported
                ? "Update manual"
                : "Belum ada update";
    const issueText =
      selectedDevice.agentStatus === "stopped"
        ? agentControlReady
          ? "Agent sedang berhenti, tetapi device masih online dan kontrol agent siap. Gunakan Start Agent untuk menghidupkan kembali sinkronisasi layanan."
          : "Agent sedang berhenti dan kontrol agent belum terverifikasi. Pastikan perangkat tersambung internet sebelum menyalakan agent."
        : selectedDevice.deviceStatus === "offline"
        ? "Perangkat offline. Command akan masuk antrean, tetapi eksekusi menunggu agent tersambung."
        : selectedDevice.issueCount > 0
          ? `${selectedDevice.issueCount} layanan perlu perhatian.`
          : update.updateAvailable
            ? `Update tersedia: ${update.localVersion} ke ${update.latestVersion}.`
            : "Perangkat siap dikontrol.";

    return (
      <article className={`fresh-panel selected-device-operations tone-${statusTone(selectedDevice.deviceStatus)}`}>
        <div className="selected-device-operations-head">
          <div>
            <span className="section-eyebrow">{canControlAgent ? "Kontrol SuperAdmin" : "Perangkat terpilih"}</span>
            <strong>{selectedDevice.deviceName}</strong>
            <LongText value={selectedDevice.deviceId} label="ID perangkat" className="mono" maxLength={34} />
            {selectedDevice.deviceAlias ? <small>Nama asli: {selectedDevice.rawDeviceName}</small> : null}
          </div>
          <div className="selected-device-status">
            <StatusChip status={selectedDeviceBadge.status} label={selectedDeviceBadge.label} />
            <StatusChip status={connectivityBadge.status} label={connectivityBadge.label} />
            <StatusChip status={agentBadge.status} label={agentBadge.label} />
            <StatusChip status={update.toneStatus} label={update.label} />
            <ActionButton className="secondary-button action-view selected-device-alias-button" onClick={() => openAliasModal(selectedDevice)}>
              Edit alias
            </ActionButton>
          </div>
        </div>
        <div className="selected-device-operation-strip" aria-label="Ringkasan operasional perangkat">
          <div>
            <span>Heartbeat</span>
            <strong>{formatRelativeTime(selectedDevice.deviceRecord?.last_seen, now)}</strong>
          </div>
          <div>
            <span>Agent</span>
            <strong>{agentBadge.label}</strong>
            <small>{update.localVersion}</small>
          </div>
          <div>
            <span>Koneksi device</span>
            <strong>{connectivityBadge.label}</strong>
            <small>{selectedDevice.deviceRecord?.supervisor_last_seen ? `Supervisor: ${formatRelativeTime(selectedDevice.deviceRecord.supervisor_last_seen, now)}` : "Menunggu heartbeat supervisor"}</small>
          </div>
          <div>
            <span>Layanan aktif</span>
            <strong>{selectedDevice.runningCount}/{selectedDevice.services.length}</strong>
          </div>
          <div>
            <span>Perlu perhatian</span>
            <strong>{selectedDevice.issueCount}</strong>
          </div>
          <div>
            <span>Tertaut akun</span>
            <strong>{assignmentLabel}</strong>
          </div>
        </div>
        {canControlAgent ? (
          <div className="fresh-actions selected-device-agent-actions">
            <ActionButton
              className="primary-button action-start"
              icon={Play}
              busy={busyAction === `${selectedDevice.deviceId}:device:agent_start`}
              disabled={busyAction !== "" || agentLifecycleInFlight || !agentStopped || !agentControlReady}
              onClick={() => queueCommand(selectedDevice.deviceId, null, "agent_start")}
            >
              Start Agent
            </ActionButton>
            <ActionButton
              className="danger-button action-stop"
              icon={Square}
              busy={busyAction === `${selectedDevice.deviceId}:device:agent_stop`}
              disabled={busyAction !== "" || agentLifecycleInFlight || !agentRunning || !agentControlReady}
              onClick={() => queueCommand(selectedDevice.deviceId, null, "agent_stop")}
            >
              Stop Agent
            </ActionButton>
            <ActionButton
              className="secondary-button action-restart"
              icon={RotateCcw}
              busy={busyAction === `${selectedDevice.deviceId}:device:agent_restart`}
              disabled={busyAction !== "" || agentLifecycleInFlight || !agentRunning || !agentControlReady}
              onClick={() => queueCommand(selectedDevice.deviceId, null, "agent_restart")}
            >
              Restart Agent
            </ActionButton>
            <ActionButton
              className="secondary-button action-update"
              icon={Rocket}
              busy={updateBusy}
              disabled={busyAction !== "" || !canUpdate}
              onClick={() => queueCommand(selectedDevice.deviceId, null, "update")}
            >
              {updateLabel}
            </ActionButton>
          </div>
        ) : null}
        {canUnlinkSelectedDevice ? (
          <div className="fresh-actions selected-device-link-actions">
            <ActionButton
              className="danger-button action-unlink"
              icon={Unlink}
              busy={busyAction === `device-unlink:${selectedDevice.deviceId}:${activeAssignment.user_id}`}
              disabled={busyAction !== ""}
              onClick={() => unlinkDeviceAssignment({
                deviceId: selectedDevice.deviceId,
                userId: activeAssignment.user_id,
                label: selectedDevice.deviceName,
              })}
            >
              Lepas device dari akun
            </ActionButton>
          </div>
        ) : null}
        <p className={`selected-device-operation-note ${selectedDevice.deviceStatus === "offline" || selectedDevice.agentStatus === "stopped" || selectedDevice.issueCount ? "tone-warn" : ""}`}>
          {issueText}
        </p>
      </article>
    );
  }

  function renderFreshDeviceDetail(options = {}) {
    if (!selectedDevice) {
      return <EmptyState title="Belum ada perangkat aktif" description="Dashboard akan terisi setelah perangkat tersedia." />;
    }

    const tunnelPreferredProvider = selectedDevice.deviceRecord?.tunnel_preferred_provider || "cloudflare";
    const ngrokAccountConfigured = Boolean(selectedDevice.deviceRecord?.tunnel_ngrok_account_configured);
    const ngrokDeviceConfigured = Boolean(selectedDevice.deviceRecord?.tunnel_ngrok_configured);
    const tunnelUpdatedAt = selectedDevice.deviceRecord?.tunnel_settings_updated_at;
    const accessService =
      selectedDevice.services.find((service) => service.service_name === "rapor") ||
      selectedDevice.services[0] ||
      null;
    const accessServiceLabel = formatServiceDisplayName(accessService?.service_name || "rapor");
    const accessTunnelBadge = getTunnelProviderBadgeModel(accessService?.tunnel_provider || tunnelPreferredProvider);
    const accessNgrokWarningUrl = accessService?.public_url || "";
    const showAccessNgrokVisitSiteNotice = shouldShowNgrokVisitSiteNotice(
      accessNgrokWarningUrl,
      accessService?.tunnel_provider || tunnelPreferredProvider
    );
    const tunnelBusy = busyAction === `${selectedDevice.deviceId}:device:configure_tunnel`;
    const canManageTunnel = isSuperAdmin || isOperator;
    const showNgrokTokenForm = tunnelProviderDraft === "ngrok" || ngrokTokenEditing;
    const providerOptions = [
      {
        value: "cloudflare",
        label: "Cloudflared",
        description: "Default ringan untuk link publik cepat.",
        icon: Cloud,
      },
      {
        value: "ngrok",
        label: "Ngrok",
        description: "Opsi fallback saat Cloudflared gagal atau tidak stabil.",
        icon: KeyRound,
      },
    ];

    return (
      <section className="fresh-section-stack">
        {selectedTab === "devices" && !options.compact ? (
          <>
            <DeviceCombobox
              devices={deviceEntries}
              selectedDeviceId={selectedDevice.deviceId}
              onSelect={(deviceId) => openDeviceRoute(deviceId)}
              label="Pilih perangkat"
              className="page-device-combobox"
            />
            <DeviceWarningPanel device={selectedDevice} />
            {renderSelectedDeviceOperations()}
          </>
        ) : null}
        <article className="fresh-panel compact-device-access-panel">
          <SectionHeader
            eyebrow={options.compact ? "Detail perangkat" : "Akses"}
            title={options.compact ? selectedDevice.deviceName : "Tautan E-Rapor"}
            description={options.compact ? "Akses utama dan detail teknis perangkat disimpan ringkas." : "Tautan utama disingkat di layar dan detail lengkap tetap tersedia lewat overlay."}
            actions={
              <GuestPublicLinkActions
                url={selectedGuestUrl}
                label={`Tautan akses untuk ${selectedDevice.deviceName}`}
                compact
                tunnelProvider={accessService?.tunnel_provider || tunnelPreferredProvider}
                ngrokWarningUrl={accessNgrokWarningUrl}
                serverName={accessServiceLabel}
                targetName={selectedDevice.deviceName}
                onActionComplete={setError}
                onFeedback={handleInlineFeedback}
              />
            }
          />
          <div className="fresh-link-bar">
            <LongText value={selectedGuestUrl} href={selectedGuestUrl} label="Tautan akses" className="mono" maxLength={70} />
            <StatusChip status={accessTunnelBadge.status} label={accessTunnelBadge.label} />
          </div>
          {showAccessNgrokVisitSiteNotice ? (
            <div className="fresh-inline-note ngrok-visit-site-note">
              {buildNgrokVisitSiteNotice(accessServiceLabel)}
            </div>
          ) : null}
        </article>
        <details className="fresh-panel compact-detail-disclosure tunnel-settings-panel">
          <summary>
            <span>Detail tunnel</span>
            <strong>Provider link publik dan token Ngrok</strong>
          </summary>
          <div className="tunnel-settings-status">
            <StatusChip status="ready" label={`Default: ${tunnelPreferredProvider === "ngrok" ? "Ngrok" : "Cloudflared"}`} />
            <StatusChip
              status={ngrokAccountConfigured ? "ready" : "idle"}
              label={
                ngrokAccountConfigured
                  ? "Token Ngrok akun ini tersimpan"
                  : ngrokDeviceConfigured
                    ? "Token Ngrok akun ini belum ada"
                    : "Token Ngrok belum ada"
              }
            />
            {tunnelUpdatedAt ? <small>Diubah {formatRelativeTime(tunnelUpdatedAt, now)}</small> : null}
          </div>
          <div className="tunnel-provider-grid" role="radiogroup" aria-label="Provider tunnel">
            {providerOptions.map((option) => {
              const OptionIcon = option.icon;
              const active = tunnelProviderDraft === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`tunnel-provider-option ${active ? "is-active" : ""}`}
                  onClick={() => setTunnelProviderDraft(option.value)}
                  disabled={tunnelBusy || !canManageTunnel}
                >
                  <span className="tunnel-provider-icon">
                    <OptionIcon size={18} strokeWidth={2.2} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </button>
              );
            })}
          </div>
          {showNgrokTokenForm ? (
            <div className="tunnel-token-row">
              <SharedPasswordField
                label={tunnelProviderDraft === "ngrok" ? "Auth token Ngrok" : "Auth token fallback Ngrok"}
                value={ngrokTokenDraft}
                onChange={(event) => setNgrokTokenDraft(event.target.value)}
                placeholder={
                  ngrokAccountConfigured
                    ? "Isi hanya jika ingin mengganti token"
                    : "Tempel token atau perintah ngrok config add-authtoken"
                }
                autoComplete="off"
                disabled={tunnelBusy || !canManageTunnel}
              />
              {tunnelProviderDraft !== "ngrok" ? (
                <ActionButton
                  className="secondary-button action-config tunnel-token-edit-button"
                  icon={KeyRound}
                  disabled={tunnelBusy || !canManageTunnel}
                  onClick={() => setNgrokTokenEditing(false)}
                >
                  Tutup token
                </ActionButton>
              ) : null}
              <ActionButton
                className="primary-button action-save"
                busy={tunnelBusy}
                disabled={busyAction !== "" || !selectedDevice || !canManageTunnel}
                onClick={saveTunnelSettings}
              >
                Simpan provider
              </ActionButton>
            </div>
          ) : (
            <div className="tunnel-token-note-row">
              <p>Cloudflared tidak memakai auth token. Token hanya diperlukan untuk fallback Ngrok.</p>
              <ActionButton
                className="secondary-button action-config tunnel-token-edit-button"
                icon={KeyRound}
                disabled={tunnelBusy || !canManageTunnel}
                onClick={() => setNgrokTokenEditing(true)}
              >
                Atur fallback Ngrok
              </ActionButton>
              <ActionButton
                className="primary-button action-save"
                busy={tunnelBusy}
                disabled={busyAction !== "" || !selectedDevice || !canManageTunnel}
                onClick={saveTunnelSettings}
              >
                Simpan provider
              </ActionButton>
            </div>
          )}
        </details>
        <article className="fresh-panel">
          <SectionHeader eyebrow="Services" title="Kontrol layanan" description="Tombol pada tiap kartu hanya memengaruhi layanan tersebut, bukan seluruh perangkat." />
          {renderFreshServiceList()}
        </article>
      </section>
    );
  }

  function renderFreshOverview() {
    const onlineDevices = deviceEntries.filter((device) => device.deviceStatus !== "offline").length;
    const controlReadyDevices = deviceEntries.filter((device) => device.agentControlReady).length;
    const runningServices = deviceEntries.reduce((total, device) => total + device.runningCount, 0);
    return (
      <section className="fresh-section-stack">
        <section className="fresh-metric-grid">
          {renderFreshMetric("Perangkat aktif", `${onlineDevices}/${deviceEntries.length}`, "Status koneksi agent", Monitor, "good")}
          {renderFreshMetric("Kontrol agent siap", `${controlReadyDevices}/${deviceEntries.length}`, "Siap Start/Stop Agent", ShieldCheck, controlReadyDevices ? "good" : "warn")}
          {renderFreshMetric("Layanan berjalan", runningServices, "Service siap dipakai", Server)}
          {renderFreshMetric("Akun pending", pendingAccountCount, "Menunggu approval", Users, pendingAccountCount ? "warn" : "")}
          {renderFreshMetric("Job berkas", activeRunningJobs, "Transfer berjalan", FileText)}
        </section>
        <article className="fresh-panel fleet-strip-panel">
          <SectionHeader
            eyebrow="Fleet"
            title="Perangkat"
            description="Tampilkan 10 perangkat per halaman dengan pencarian nama, alias, atau device id."
            actions={
              <label className="fleet-search-field">
                <Search size={16} aria-hidden="true" />
                <input value={fleetSearch} onChange={(event) => setFleetSearch(event.target.value)} placeholder="Server TU atau device id" />
              </label>
            }
          />
          <div className="fleet-strip" aria-label="Daftar perangkat">
            {pagedFleetDevices.length ? pagedFleetDevices.map((device) => {
              const badge = getDeviceStatusBadgeModel(device.deviceStatus);
              return (
                <button
                  key={device.deviceId}
                  type="button"
                  className={`fleet-strip-card ${selectedDevice?.deviceId === device.deviceId ? "is-active" : ""}`}
                  onClick={() => syncGlobalDeviceSelection(device.deviceId)}
                >
                  <strong>{device.deviceName}</strong>
                  <LongText value={device.deviceId} label="ID perangkat" className="mono" maxLength={24} />
                  <div className="fresh-pill-group">
                    <StatusChip status={badge.status} label={badge.label} />
                    <span>{device.runningCount} service</span>
                  </div>
                </button>
              );
            }) : <EmptyState title="Device tidak ditemukan" description="Ubah kata kunci pencarian fleet." />}
          </div>
          {filteredFleetDevices.length > fleetPageSize ? (
            <Pagination
              page={safeFleetPage}
              totalItems={filteredFleetDevices.length}
              pageSize={fleetPageSize}
              onPageChange={setFleetPage}
            />
          ) : null}
        </article>
        {renderSelectedDeviceOperations()}
        {selectedDevice ? (
          <section className="compact-device-detail-panel">
            <SectionHeader eyebrow="Detail cepat" title={selectedDevice.deviceName} description="Akses, tunnel, dan layanan diringkas agar halaman tetap padat." />
            {renderFreshDeviceDetail({ compact: true })}
          </section>
        ) : null}
      </section>
    );
  }

  function renderFreshFiles() {
    if (!isSuperAdmin) {
      return <EmptyState title="Tidak tersedia" description="Berkas hanya tersedia untuk SuperAdmin." />;
    }

    const filteredRoots = selectedDeviceRoots
      .map((root) => {
        const match = getRemoteRootPreference(root);
        return match ? { ...root, label: match.label, _priority: match.score } : null;
      })
      .filter(Boolean)
      .sort((left, right) => left._priority - right._priority);
    const activeExplorerJob =
      (directoryJobId ? fileJobs.find((entry) => entry.id === directoryJobId) : null) ||
      (rootDiscoveryJobId ? fileJobs.find((entry) => entry.id === rootDiscoveryJobId) : null) ||
      null;
    const explorerLoadingProgress = activeExplorerJob
      ? {
          percent: Math.min(
            100,
            Math.max(
              8,
              Math.round(
                (Number(activeExplorerJob.progress_current || 0) /
                  Math.max(1, Number(activeExplorerJob.progress_total || 1))) *
                  100
              )
            )
          ),
          label:
            activeExplorerJob.job_type === "discover_roots"
              ? "Memindai drive dan lokasi perangkat"
              : "Membaca isi folder perangkat",
        }
      : null;

    const refreshCurrentPath = () => {
      if (currentPath) {
        openPath(currentPath);
        return;
      }
      refreshRoots();
    };

    return (
      <section className="fresh-section-stack">
        <article className="fresh-panel files-view-panel">
          <SectionHeader eyebrow="Berkas" title="Sumber berkas" description="Pisahkan storage arsip dan remote file agar halaman tetap fokus." />
          <div className="subpage-tabs" role="tablist" aria-label="Sub halaman berkas">
            <button
              type="button"
              className={`tab-button ${filesView === "storage" ? "is-active" : ""}`}
              aria-selected={filesView === "storage"}
              onClick={() => setFilesView("storage")}
            >
              Storage
            </button>
            <button
              type="button"
              className={`tab-button ${filesView === "remote" ? "is-active" : ""}`}
              aria-selected={filesView === "remote"}
              onClick={() => setFilesView("remote")}
            >
              Remote File
            </button>
          </div>
        </article>
        {filesView === "storage" ? (
          <>
            <article className="fresh-panel file-library-filter-panel">
              <SectionHeader
                eyebrow="Storage"
                title="Pustaka berkas"
                description="Daftar arsip utama dibatasi 10 item per halaman."
                actions={<ActionButton className="secondary-button action-refresh" busy={busyAction === "artifacts:refresh"} icon={RefreshCw} onClick={refreshStorageArtifacts}>Segarkan storage</ActionButton>}
              />
              <div className="artifact-filter-bar file-library-filters">
                <label>
                  <span>Bucket</span>
                  <select value={artifactBucketFilter} onChange={(event) => setArtifactBucketFilter(event.target.value)}>
                    <option value="all">Semua bucket</option>
                    <option value="agent-temp-artifacts">Berkas sementara</option>
                    <option value="agent-archives">Arsip permanen</option>
                    <option value="agent-preview-cache">Cache pratinjau</option>
                    <option value="admin-upload-staging">Unggahan admin</option>
                  </select>
                </label>
                <label>
                  <span>Device</span>
                  <select value={effectiveArtifactDeviceFilter} onChange={(event) => syncGlobalDeviceSelection(event.target.value)}>
                    <option value="all">Semua device</option>
                    {artifactDeviceOptions.map((device) => (
                      <option key={device.id} value={device.id}>{device.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Cari</span>
                  <input value={artifactSearch} onChange={(event) => setArtifactSearch(event.target.value)} placeholder="rapor-2026.zip" />
                </label>
              </div>
            </article>
            <SupabaseFileTable
              artifacts={visibleStorageArtifacts}
              page={filePage}
              onPageChange={setFilePage}
              busyAction={busyAction}
              onDownload={handleArtifactDownload}
              onDelete={requestDeleteStorageArtifact}
            />
          </>
        ) : (
          <article className="fresh-panel">
            <SectionHeader
              eyebrow="Remote file"
              title="Akses berkas perangkat"
              description="Pilih perangkat, buka This PC, lalu unggah atau unduh file yang dipilih."
              actions={
                <>
                  <ActionButton className="secondary-button action-view" onClick={() => setLogOverlayOpen(true)}>Log</ActionButton>
                  <ActionButton className="secondary-button action-refresh" onClick={refreshCurrentPath}>Refresh list</ActionButton>
                </>
              }
            />
            <DeviceCombobox
              devices={deviceEntries}
              selectedDeviceId={selectedDevice?.deviceId || ""}
              onSelect={syncGlobalDeviceSelection}
              label="Pilih perangkat"
              className="page-device-combobox"
            />
            <input ref={fileInputRef} type="file" hidden onChange={(event) => triggerUpload(event.target.files?.[0])} />
            {filteredRoots.length ? (
              <div className="remote-root-quick-actions">
                <SectionHeader
                  eyebrow="Quick action"
                  title="Akses cepat lokasi"
                  description="Buka drive dan lokasi umum perangkat langsung dari kartu cepat."
                />
                <RootGrid roots={filteredRoots} onOpen={openPath} />
              </div>
            ) : null}
            <div className="fresh-link-bar">
              <LongText value={currentPath || "This PC"} label="Path aktif" className="mono" maxLength={80} empty="This PC" />
            </div>
            <div className="fresh-file-list-shell">
              <div className="floating-selection-actions remote-file-actions is-visible">
                <div className="remote-file-actions-copy">
                  <strong>{selectedPaths.length ? `${selectedPaths.length} item dipilih` : "Belum ada file dipilih"}</strong>
                  <small>Unggah ke folder aktif atau unduh file yang sudah dipilih.</small>
                </div>
                <ActionButton className="secondary-button action-upload" disabled={!currentPath} onClick={() => fileInputRef.current?.click()}>
                  Unggah ke folder ini
                </ActionButton>
                <ActionButton className="primary-button action-download" disabled={!selectedPaths.length} onClick={queueDownloadSelection}>
                  {selectedPaths.length ? `Unduh pilihan (${selectedPaths.length})` : "Unduh pilihan"}
                </ActionButton>
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
                loading={fileExplorerBusy}
                loadingLabel={explorerLoadingProgress?.label || ""}
                loadingProgress={explorerLoadingProgress}
                virtualRootLabel={directoryResult?.virtualRootLabel || ""}
              />
            </div>
          </article>
        )}
        {filesView === "remote" ? (
          <FloatingFileActivity
            jobs={selectedDeviceJobs}
            open={fileActivityOpen}
            expanded={fileActivityExpanded}
            onToggleOpen={() => setFileActivityOpen((current) => !current)}
            onToggleExpanded={() => setFileActivityExpanded((current) => !current)}
            onDownload={handleArtifactDownload}
          />
        ) : null}
        <LogOverlay open={logOverlayOpen} logs={logs} jobs={fileJobs} deviceId={selectedDevice?.deviceId || "all"} onClose={() => setLogOverlayOpen(false)} />
      </section>
    );
  }

  function renderFreshActivity() {
    const effectiveActivityDeviceId = selectedDeviceId || "all";
    const visibleLogs = logs
      .filter((log) => logLevelFilter === "all" || log.level === logLevelFilter)
      .filter((log) => effectiveActivityDeviceId === "all" || log.device_id === effectiveActivityDeviceId)
      .filter((log) => !isUser || !log.service_name || log.service_name === "rapor");
    return (
      <section className="fresh-section-stack">
        <article className="fresh-panel">
          <SectionHeader
            eyebrow="Activity"
            title="Aktivitas terbaru"
            description="Detail JSON panjang dibuka lewat overlay agar daftar tetap bersih."
            actions={
              <select value={logLevelFilter} onChange={(event) => setLogLevelFilter(event.target.value)}>
                <option value="all">Semua</option>
                <option value="error">Perlu dicek</option>
                <option value="warn">Peringatan</option>
                <option value="info">Informasi</option>
              </select>
            }
          />
          <DeviceCombobox
            devices={deviceEntries}
            selectedDeviceId={effectiveActivityDeviceId}
            onSelect={syncGlobalDeviceSelection}
            includeAll
            allLabel="Semua device"
            label="Filter device"
            className="page-device-combobox"
          />
          <div className="fresh-timeline">
            {visibleLogs.length ? visibleLogs.map((log) => (
              <article key={log.id} className={`fresh-timeline-row tone-${statusTone(log.level)}`}>
                <span className="fresh-timeline-dot" />
                <div>
                  <strong><LongText value={log.message} label="Pesan log" maxLength={84} /></strong>
                  <small className="mono">
                    {formatDate(log.created_at)} |{" "}
                    <LongText value={`${log.device_id} | ${log.service_name || "system"}`} label="Sumber log" maxLength={48} />
                  </small>
                  {log.details ? <LongText value={JSON.stringify(log.details, null, 2)} label="Detail log" className="mono" maxLength={90} /> : null}
                </div>
                <StatusChip status={log.level} />
              </article>
            )) : <EmptyState title="Belum ada aktivitas" description="Aktivitas realtime akan muncul di sini." />}
          </div>
        </article>
      </section>
    );
  }

  function renderReferralPanel() {
    if (!(isSuperAdmin || isOperator)) {
      return null;
    }

    const visibleEnvironments = environments.filter((environment) => environment?.referral_code);
    const emptyMessage = isOperator
      ? "Kode referral lingkungan operator belum tersedia. Coba segarkan dashboard atau hubungi SuperAdmin."
      : "Belum ada lingkungan operator dengan kode referral.";

    return (
      <article className="fresh-panel referral-code-panel">
        <SectionHeader
          eyebrow="Referral"
          title="Kode penautan lingkungan"
          description="Bagikan kode ini ke User agar pendaftaran masuk ke lingkungan yang benar."
        />
        {visibleEnvironments.length ? (
          <div className="referral-code-grid">
            {visibleEnvironments.map((environment) => (
              <div key={environment.id} className="referral-code-card">
                <div>
                  <span>{environment.name || "Lingkungan operator"}</span>
                  <strong className="mono">{environment.referral_code}</strong>
                </div>
                <div className="fresh-actions referral-code-actions">
                  <ActionButton className="secondary-button action-copy" icon={Copy} onClick={() => copyReferralCode(environment.referral_code)}>
                    Salin
                  </ActionButton>
                  <ActionButton className="secondary-button action-share whatsapp-share-button" icon={Share2} onClick={() => shareReferralCode(environment.referral_code, environment.name || "Lingkungan")}>
                    WhatsApp
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="fresh-inline-note">{emptyMessage}</div>
        )}
      </article>
    );
  }

  function renderFreshAccounts() {
    if (!(isSuperAdmin || isOperator)) {
      return <EmptyState title="Tidak tersedia" description="Manajemen akun hanya untuk Operator dan SuperAdmin." />;
    }

    return (
      <section className="fresh-section-stack">
        {renderReferralPanel()}
        {isSuperAdmin ? (
          <article className="fresh-panel">
            <SectionHeader eyebrow="Policy" title="Aturan persetujuan" description="Nilai angka memakai field khusus dan URL reset dinormalisasi ke HTTPS." />
            <div className="fresh-form-grid">
              <MaskedTextField label="Persetujuan Operator (jam)" mask="number" inputMode="numeric" value={authPolicy.operatorAutoApproveHours} onChange={(value) => setAuthPolicy((current) => ({ ...current, operatorAutoApproveHours: Number(value || 24) }))} />
              <MaskedTextField label="Pengguna lingkungan (jam)" mask="number" inputMode="numeric" value={authPolicy.environmentUserAutoApproveHours} onChange={(value) => setAuthPolicy((current) => ({ ...current, environmentUserAutoApproveHours: Number(value || 8) }))} />
              <label>
                <span>Pengguna mandiri</span>
                <select value={authPolicy.standaloneUserApprovalMode} onChange={(event) => setAuthPolicy((current) => ({ ...current, standaloneUserApprovalMode: event.target.value }))}>
                  <option value="manual">Manual</option>
                  <option value="auto">Otomatis</option>
                </select>
              </label>
              <MaskedTextField label="Waktu persetujuan mandiri (jam)" mask="number" inputMode="numeric" value={authPolicy.standaloneUserAutoApproveHours} onChange={(value) => setAuthPolicy((current) => ({ ...current, standaloneUserAutoApproveHours: Number(value || 24) }))} />
              <MaskedTextField label="Interval pemeriksaan (menit)" mask="number" inputMode="numeric" value={authPolicy.maintenanceIntervalMinutes} onChange={(value) => setAuthPolicy((current) => ({ ...current, maintenanceIntervalMinutes: Number(value || 15) }))} />
              <MaskedTextField label="Halaman reset password" mask="url" value={authPolicy.passwordResetRedirectUrl} onChange={(value) => setAuthPolicy((current) => ({ ...current, passwordResetRedirectUrl: value }))} placeholder="https://example.com/auth/reset-password" />
              <ActionButton className="primary-button action-save" busy={busyAction === "account:updateAuthPolicy"} onClick={() => handleAccountAction("updateAuthPolicy", authPolicy)}>Simpan aturan</ActionButton>
            </div>
          </article>
        ) : null}
        <article className="fresh-panel">
          <SectionHeader eyebrow="Create" title="Buat akun" description="Akun baru langsung masuk daftar dengan status yang dipilih." />
          <div className="fresh-form-grid">
            <MaskedTextField label="Email" type="email" mask="email" value={createEmail} onChange={setCreateEmail} placeholder="Example@gmail.com" inputMode="email" />
            <MaskedTextField label="Nama" value={createDisplayName} onChange={setCreateDisplayName} placeholder="Budi Santoso" mask="alias" maxLength={80} />
            <SharedPasswordField label="Password" value={createPassword} onChange={(event) => setCreatePassword(event.target.value)} placeholder="********" autoComplete="new-password" />
            <label>
              <span>Jenis akun</span>
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
              <span>Status awal</span>
              <select value={createApproveImmediately ? "approved" : "pending"} onChange={(event) => setCreateApproveImmediately(event.target.value === "approved")}>
                <option value="approved">Aktif sekarang</option>
                <option value="pending">Menunggu persetujuan</option>
              </select>
            </label>
            {createRole === "user" ? (
              <label>
                <span>Perangkat awal</span>
                <select value={createAssignedDeviceId} onChange={(event) => setCreateAssignedDeviceId(event.target.value)} disabled={!deviceEntries.length}>
                  <option value="">{deviceEntries.length ? "Pilih perangkat" : "Belum ada perangkat tersedia"}</option>
                  {deviceEntries.map((device) => (
                    <option key={device.deviceId} value={device.deviceId} disabled={Boolean(device.activeAssignments?.length)}>
                      {device.deviceName} ({device.deviceId}){device.activeAssignments?.length ? " - sudah tertaut" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <ActionButton className="primary-button action-create" busy={busyAction === "account:createAccount"} onClick={createManagedAccount}>Buat akun</ActionButton>
          </div>
        </article>
        <article className="fresh-panel">
          <SectionHeader eyebrow="Accounts" title="Daftar akun" description="Daftar akun ditampilkan sebagai tabel terstruktur dengan pagination." />
          <AccountTable
            accounts={accounts}
            page={accountPage}
            onPageChange={setAccountPage}
            busyAction={busyAction}
            onAction={handleAccountAction}
            onDelete={handleDeleteAccount}
            onUnlinkDevice={unlinkDeviceAssignment}
            isSuperAdmin={isSuperAdmin}
          />
        </article>
      </section>
    );
  }

  function renderFreshScene() {
    let scene = renderFreshOverview();
    if (selectedTab === "devices") {
      scene = renderFreshDeviceDetail();
    } else if (selectedTab === "files") {
      scene = renderFreshFiles();
    } else if (selectedTab === "activity") {
      scene = renderFreshActivity();
    } else if (selectedTab === "accounts") {
      scene = renderFreshAccounts();
    } else if (selectedTab === "profile") {
      scene = <ProfilePanel profile={profile} session={session} onSignOut={signOut} />;
    }
    return (
      <section className="fresh-console-stage">
        {scene}
      </section>
    );
  }

  return { renderFreshScene };
}
