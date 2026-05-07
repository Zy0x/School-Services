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
import { dismissOnBackdrop, getActivityLabel, truncateText } from "./shared.utils.jsx";

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
  ArtifactInventory,
  FileTable,
  FloatingFileActivity,
  GuestMetricCard,
  JobList,
  LegacyArtifactInventory,
  LogOverlay,
  RootGrid,
  SupabaseFileTable,
  TransferHistoryModal
};
