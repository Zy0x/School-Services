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

export {
  AccountTable
};
