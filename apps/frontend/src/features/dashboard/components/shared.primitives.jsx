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

export {
  EmptyState,
  MetricTile,
  Pagination,
  SectionHeader,
  Surface
};
