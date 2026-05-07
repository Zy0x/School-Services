import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CircleArrowUp,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Cloud,
  Copy,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Server,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Unlink,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { legacyDataClient } from "../services/legacyDataClient.js";
import { supabase } from "../services/providers/supabase/supabaseClient.js";
import Avatar3D from "../components/Avatar3D.jsx";
import {
  AUTH_PATH,
  DASHBOARD_SECTIONS,
  GUEST_BRAND_ICON,
  REFRESH_INTERVAL_MS,
  RESET_PASSWORD_PATH,
} from "./lib/constants.js";
import {
  buildAuthPath,
  buildAuthUrl,
  buildGuestPath,
  buildGuestUrl,
  buildResetPasswordUrl,
  buildRoutePath,
  getAllowedDashboardSections,
  getRouteCopy,
  normalizePathname,
  parseAppRoute,
} from "./lib/routes.js";
import {
  buildNgrokVisitSiteNotice,
  buildWhatsAppShareUrl,
  getCommandCopy,
  getGuestStatusModel,
  isCommandInProgress,
  shouldAutoShowCommandProgress,
  shouldShowNgrokVisitSiteNotice,
} from "./lib/guest.js";
import {
  deriveAgentStatus,
  deriveDeviceConnectivityStatus,
  deriveDeviceStatus,
  deriveServiceStatus,
  formatRelativeTime,
  formatServiceDisplayName,
  AGENT_LIFECYCLE_ACTIONS,
  getAgentStatusBadgeModel,
  getDeviceConnectivityBadgeModel,
  getDeviceStatusBadgeModel,
  getLatestAgentLifecycleCommand,
  getPublicLinkBadgeModel,
  getPublicUrlLabel,
  getServiceStatusBadgeModel,
  getStatusIcon,
  getStatusLabel,
  getTunnelProviderBadgeModel,
  isAgentControlReady,
  statusTone,
} from "./lib/status.js";
import {
  getDeviceUpdateModel,
  getUpdateStatusSummary,
  supportsRemoteUpdate,
} from "./lib/update.js";
import {
  buildBreadcrumbs,
  buildThisPcDirectoryResult,
  copyTextToClipboard,
  formatArtifactDetailValue,
  formatBytes,
  formatDate,
  getFileKindLabel,
  getItemGlyph,
  getJobStatusDetail,
  safeFileNameFromKey,
} from "./lib/files.js";
import { invokeEdgeFunction } from "./lib/edgeFunctions.js";
import {
  clearStoredAuthArtifacts,
  formatEdgeFunctionError,
  formatPasswordUpdateError,
  formatSignInError,
  isInvalidSessionError,
} from "./lib/errors.js";
import {
  ActionButton,
  CommandProgressOverlay,
  ConfirmDialog,
  DetailDrawer,
  IconButton,
  InfoHint,
  LongText,
  MaskedTextField,
  PageSkeleton,
  PasswordField as SharedPasswordField,
  ProfileInfoField,
  Skeleton,
  StatusChip,
  ToastViewport,
} from "../components/ui/core.jsx";
import { UpdateProgressModal as FeatureUpdateProgressModal } from "../features/dashboard/components/updates.jsx";
import { createDashboardRenderers } from "../features/dashboard/components/sections.jsx";
import {
  AccountStatusScreen,
  LoginScreen,
  PasswordResetScreen as FeaturePasswordResetScreen,
} from "../features/auth/pages/AuthScreens.jsx";
import { PublicLinkActions as GuestPublicLinkActions } from "../features/guest/components/GuestActions.jsx";
import { GuestConsole as FeatureGuestConsole } from "../features/guest/pages/GuestConsole.jsx";
import {
  AccountTable,
  DeviceAliasModal,
  DeviceCombobox,
  DeviceWarningPanel,
  dismissOnBackdrop,
  EmptyState,
  FileTable,
  FloatingFileActivity,
  getDashboardNavItems,
  getRemoteRootPreference,
  getRouteBreadcrumbs,
  LogOverlay,
  matchesDeviceQuery,
  MobileNav,
  normalizeLoginEmail,
  normalizeLoginPassword,
  Pagination,
  PriorityBanner,
  ProfilePanel,
  RootGrid,
  RouteHeader,
  SectionHeader,
  SidebarNav,
  SupabaseFileTable,
  TopCommandBar,
  TransferHistoryModal,
} from "../features/dashboard/components/shared.jsx";


const LOG_LIMIT = 120;
const JOB_LIMIT = 80;
const PUBLIC_DASHBOARD_URL = String(
  import.meta.env.VITE_PUBLIC_SITE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "") ||
    "https://school-services.netlify.app"
).replace(/\/+$/, "");
const ROOT_PATH = "/";
const LEGACY_RESET_PASSWORD_PATH = "/reset-password";

export default function App() {
  const currentPathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const currentSearch = typeof window !== "undefined" ? window.location.search : "";
  const currentHash = typeof window !== "undefined" ? window.location.hash : "";
  const normalizedPathname = normalizePathname(currentPathname);
  const guestDeviceId =
    typeof window !== "undefined"
      ? decodeURIComponent(normalizedPathname.match(/^\/guest\/([^/]+)$/)?.[1] || "")
      : "";
  const currentParams =
    typeof window !== "undefined" ? new URLSearchParams(currentSearch) : new URLSearchParams();
  const hasRecoveryCode =
    typeof window !== "undefined" &&
    currentParams.has("code") &&
    [AUTH_PATH, RESET_PASSWORD_PATH, LEGACY_RESET_PASSWORD_PATH].includes(normalizedPathname);
  const resetPasswordMode =
    normalizedPathname === RESET_PASSWORD_PATH ||
    normalizedPathname === LEGACY_RESET_PASSWORD_PATH ||
    hasRecoveryCode ||
    /(^|[&#])type=recovery(?:[&#]|$)/.test(currentHash);
  const requestedAuthMode =
    typeof window !== "undefined" ? currentParams.get("mode") : "";
  const requestedGuestLinkDeviceId =
    typeof window !== "undefined" ? currentParams.get("linkDeviceId") || "" : "";
  const requestedGuestReturnDeviceId =
    typeof window !== "undefined"
      ? currentParams.get("guestDeviceId") || requestedGuestLinkDeviceId
      : "";
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMode, setAuthMode] = useState(
    requestedAuthMode === "register" ? "register" : "login"
  );
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [registerRole, setRegisterRole] = useState("operator");
  const [registerMode, setRegisterMode] = useState("referral_code");
  const [registerReferralCode, setRegisterReferralCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [dashboardInfo, setDashboardInfo] = useState("");
  const [pendingGuestLinkDeviceId, setPendingGuestLinkDeviceId] = useState(
    requestedGuestLinkDeviceId
  );
  const [guestReturnDeviceId, setGuestReturnDeviceId] = useState(
    requestedGuestReturnDeviceId
  );
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [deviceAssignments, setDeviceAssignments] = useState([]);
  const [authPolicy, setAuthPolicy] = useState({
    operatorAutoApproveHours: 24,
    environmentUserAutoApproveHours: 8,
    standaloneUserApprovalMode: "manual",
    standaloneUserAutoApproveHours: 24,
    maintenanceIntervalMinutes: 15,
    passwordResetRedirectUrl: buildResetPasswordUrl(),
  });
  const [services, setServices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [commands, setCommands] = useState([]);
  const [fileJobs, setFileJobs] = useState([]);
  const [storageArtifacts, setStorageArtifacts] = useState([]);
  const [roots, setRoots] = useState([]);
  const [deviceAliases, setDeviceAliases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toastItems, setToastItems] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("all");
  const [appRoute, setAppRoute] = useState(() =>
    typeof window === "undefined" ? { section: "overview", deviceId: "" } : parseAppRoute(window.location.pathname)
  );
  const [now, setNow] = useState(Date.now());
  const [pageVisible, setPageVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );
  const [busyAction, setBusyAction] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [directoryJobId, setDirectoryJobId] = useState(null);
  const [rootDiscoveryJobId, setRootDiscoveryJobId] = useState(null);
  const [directoryResult, setDirectoryResult] = useState(null);
  const [previewJobId, setPreviewJobId] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [channelState, setChannelState] = useState("connecting");
  const [logLevelFilter, setLogLevelFilter] = useState("all");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createRole, setCreateRole] = useState("operator");
  const [createAssignedDeviceId, setCreateAssignedDeviceId] = useState("");
  const [createApproveImmediately, setCreateApproveImmediately] = useState(true);
  const [aliasModalDeviceId, setAliasModalDeviceId] = useState("");
  const [aliasDraft, setAliasDraft] = useState("");
  const [transferHistoryOpen, setTransferHistoryOpen] = useState(false);
  const [transferHistoryLoading, setTransferHistoryLoading] = useState(false);
  const [transferHistory, setTransferHistory] = useState({ jobs: [], auditLogs: [] });
  const [artifactBucketFilter, setArtifactBucketFilter] = useState("all");
  const [artifactDeviceFilter, setArtifactDeviceFilter] = useState("all");
  const [artifactSearch, setArtifactSearch] = useState("");
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [fleetSearch, setFleetSearch] = useState("");
  const [fleetPage, setFleetPage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [accountPage, setAccountPage] = useState(1);
  const [activityDeviceId, setActivityDeviceId] = useState("");
  const [fileActivityOpen, setFileActivityOpen] = useState(false);
  const [fileActivityExpanded, setFileActivityExpanded] = useState(false);
  const [logOverlayOpen, setLogOverlayOpen] = useState(false);
  const [filesView, setFilesView] = useState("storage");
  const [deleteArtifactTarget, setDeleteArtifactTarget] = useState(null);
  const [activeCommandId, setActiveCommandId] = useState(null);
  const [commandProgressMinimized, setCommandProgressMinimized] = useState(false);
  const [cancelingCommandId, setCancelingCommandId] = useState(null);
  const [tunnelProviderDraft, setTunnelProviderDraft] = useState("cloudflare");
  const [ngrokTokenDraft, setNgrokTokenDraft] = useState("");
  const [ngrokTokenEditing, setNgrokTokenEditing] = useState(false);
  const [updateModal, setUpdateModal] = useState({
    open: false,
    deviceId: "",
    title: "Mengupdate Agent & Service",
    message: "",
    error: "",
  });
  const fileInputRef = useRef(null);
  const pageVisibleRef = useRef(pageVisible);
  const announcedCommandStatusRef = useRef(new Map());

  function dismissToast(id) {
    setToastItems((current) => current.filter((item) => item.id !== id));
  }

  function pushToast(title, message = "", tone = "info") {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToastItems((current) => [...current, { id, title, message, tone }].slice(-4));
    window.setTimeout(() => {
      setToastItems((current) => current.filter((item) => item.id !== id));
    }, 3600);
  }

  function handleInlineFeedback(message, tone = "info") {
    if (!message) {
      return;
    }
    if (tone === "error") {
      setError(message);
      pushToast("Aksi gagal", message, "error");
      return;
    }
    setError("");
    setDashboardInfo(message);
    pushToast("Aksi berhasil", message, "success");
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function handleCopyFeedback(event) {
      const detail = event.detail || {};
      const message = detail.message || "Teks berhasil disalin.";
      const tone = detail.tone || "success";
      pushToast(detail.title || (tone === "error" ? "Salin gagal" : "Berhasil disalin"), message, tone);
      if (tone === "error") {
        setError(message);
        return;
      }
      setError("");
      setDashboardInfo(message);
    }

    window.addEventListener("school-services:copy-feedback", handleCopyFeedback);
    return () => window.removeEventListener("school-services:copy-feedback", handleCopyFeedback);
  });

  function resetAuthFormState(nextMode = "login") {
    setAuthMode(nextMode);
    setLoginEmail("");
    setLoginPassword("");
    setRegisterDisplayName("");
    setRegisterRole("operator");
    setRegisterMode("referral_code");
    setRegisterReferralCode("");
  }

  function resetAuthenticatedState() {
    setSession(null);
    setProfile(null);
    setProfileLoading(false);
    setAccounts([]);
    setEnvironments([]);
    setDeviceAssignments([]);
    setServices([]);
    setLogs([]);
    setCommands([]);
    setFileJobs([]);
    setStorageArtifacts([]);
    setRoots([]);
    setDeviceAliases([]);
    setLoading(true);
    setError("");
    setDashboardInfo("");
    setToastItems([]);
    setSelectedDeviceId("all");
    setAppRoute({ section: "overview", deviceId: "" });
    setBusyAction("");
    setCurrentPath("");
    setDirectoryJobId(null);
    setRootDiscoveryJobId(null);
    setDirectoryResult(null);
    setPreviewJobId(null);
    setPreviewResult(null);
    setSelectedPaths([]);
    setChannelState("connecting");
    setLogLevelFilter("all");
    setCreateEmail("");
    setCreatePassword("");
    setCreateDisplayName("");
    setCreateRole("operator");
    setCreateAssignedDeviceId("");
    setCreateApproveImmediately(true);
    setAliasModalDeviceId("");
    setUpdateModal({
      open: false,
      deviceId: "",
      title: "Mengupdate Agent & Service",
      message: "",
      error: "",
    });
    setAliasDraft("");
    setTransferHistoryOpen(false);
    setTransferHistoryLoading(false);
    setTransferHistory({ jobs: [], auditLogs: [] });
    setArtifactBucketFilter("all");
    setArtifactDeviceFilter("all");
    setArtifactSearch("");
    setFleetPage(1);
    setFilesView("storage");
    setDeleteArtifactTarget(null);
    setActiveCommandId(null);
    setCommandProgressMinimized(false);
  }

  function clearGuestLinkRequest() {
    setPendingGuestLinkDeviceId("");
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.delete("linkDeviceId");
    params.delete("mode");
    if (guestReturnDeviceId) {
      params.set("guestDeviceId", guestReturnDeviceId);
    }
    const nextSearch = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash || ""}`
    );
  }

  const selectedTab = appRoute.section;

  function navigateRoute(section, params = {}, options = {}) {
    const nextRoute = {
      section: DASHBOARD_SECTIONS.has(section) ? section : "overview",
      deviceId: section === "devices" ? String(params.deviceId || "").trim() : "",
    };
    setAppRoute(nextRoute);
    if (nextRoute.deviceId) {
      setSelectedDeviceId(nextRoute.deviceId);
    } else if (nextRoute.section === "devices" && params.selectAll) {
      setSelectedDeviceId("all");
    }

    if (typeof window === "undefined") {
      return;
    }

    const nextPath = buildRoutePath(nextRoute.section, { deviceId: nextRoute.deviceId });
    const routeSearchParams = new URLSearchParams(window.location.search);
    routeSearchParams.delete("mode");
    routeSearchParams.delete("linkDeviceId");
    const nextSearch = routeSearchParams.toString();
    const nextUrl = `${nextPath}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash || ""}`;
    if (window.location.pathname !== nextPath) {
      window.history[options.replace ? "replaceState" : "pushState"](null, "", nextUrl);
    }
  }

  function syncGlobalDeviceSelection(deviceId, options = {}) {
    const nextDeviceId = String(deviceId || "all").trim() || "all";
    const syncStorageFilter = options.syncStorageFilter !== false;
    const syncActivityFilter = options.syncActivityFilter !== false;

    setSelectedDeviceId(nextDeviceId);
    if (syncStorageFilter) {
      setArtifactDeviceFilter(nextDeviceId);
    }
    if (syncActivityFilter) {
      setActivityDeviceId(nextDeviceId);
    }

    if (appRoute.section === "devices") {
      if (nextDeviceId === "all") {
        navigateRoute("overview", {}, { replace: true });
      } else if (appRoute.deviceId !== nextDeviceId) {
        navigateRoute("devices", { deviceId: nextDeviceId }, { replace: true });
      }
    }
  }

  function setSelectedTab(section) {
    navigateRoute(section);
  }

  useEffect(() => {
    if (resetPasswordMode) {
      setAuthLoading(false);
      setSession(null);
      setProfile(null);
      return undefined;
    }

    if (guestDeviceId) {
      setAuthLoading(false);
      return undefined;
    }

    let active = true;
    const fallbackTimer =
      typeof window !== "undefined"
        ? window.setTimeout(() => {
            if (active) {
              setAuthLoading(false);
            }
          }, 1500)
        : null;

    legacyDataClient.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) {
          return;
        }
        if (sessionError) {
          throw sessionError;
        }
        setSession(data.session || null);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        clearStoredAuthArtifacts();
        setSession(null);
      })
      .finally(() => {
        if (!active) {
          return;
        }
        if (fallbackTimer) {
          window.clearTimeout(fallbackTimer);
        }
        setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = legacyDataClient.auth.onAuthStateChange((event, nextSession) => {
      if (resetPasswordMode && event !== "SIGNED_OUT") {
        setAuthLoading(false);
        return;
      }

      if (event === "SIGNED_OUT") {
        resetAuthenticatedState();
        resetAuthFormState("login");
      } else {
        setSession(nextSession || null);
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setAuthError("");
      }
      setAuthInfo("");
      setAuthLoading(false);
    });

    return () => {
      active = false;
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
      }
      subscription.unsubscribe();
    };
  }, [guestDeviceId, resetPasswordMode]);

  useEffect(() => {
    if (typeof window === "undefined" || guestDeviceId || resetPasswordMode) {
      return;
    }

    const authParams = {};
    if (authMode === "register") {
      authParams.mode = "register";
    }
    if (pendingGuestLinkDeviceId) {
      authParams.linkDeviceId = pendingGuestLinkDeviceId;
    }
    if (guestReturnDeviceId) {
      authParams.guestDeviceId = guestReturnDeviceId;
    }

    const currentPath = normalizePathname(window.location.pathname);
    if (session) {
      if (currentPath === ROOT_PATH || currentPath === AUTH_PATH) {
        window.history.replaceState(null, "", buildRoutePath("overview"));
      }
      return;
    }

    if (authLoading) {
      return;
    }

    if (currentPath === ROOT_PATH || currentPath.startsWith("/dashboard")) {
      window.history.replaceState(null, "", buildAuthPath(authParams));
    }
  }, [
    authLoading,
    authMode,
    guestDeviceId,
    guestReturnDeviceId,
    pendingGuestLinkDeviceId,
    resetPasswordMode,
    session,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || guestDeviceId) {
      return undefined;
    }

    const handlePopState = () => {
      const nextRoute = parseAppRoute(window.location.pathname);
      setAppRoute(nextRoute);
      if (nextRoute.section === "devices" && nextRoute.deviceId) {
        setSelectedDeviceId(nextRoute.deviceId);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [guestDeviceId]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleVisibilityChange = () => {
      setPageVisible(document.visibilityState !== "hidden");
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    pageVisibleRef.current = pageVisible;
  }, [pageVisible]);

  useEffect(() => {
    if (!session || guestDeviceId || resetPasswordMode) {
      setProfile(null);
      return;
    }

    let active = true;
    setProfileLoading(true);
    invokeEdgeFunction("account-access", { action: "sessionProfile" }, session)
      .then((data) => {
        if (!active) {
          return;
        }
        setProfile(data.profile || null);
        setAuthError("");
        setProfileLoading(false);
      })
      .catch((profileError) => {
        if (!active) {
          return;
        }
        if (isInvalidSessionError(profileError)) {
          setAuthError(formatEdgeFunctionError(profileError));
          setProfile(null);
          setProfileLoading(false);
          setSession(null);
          resetAuthFormState("login");
          legacyDataClient.auth.signOut().catch(() => {});
          clearStoredAuthArtifacts();
          return;
        }
        setAuthError(formatEdgeFunctionError(profileError));
        setProfile(null);
        setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, guestDeviceId, resetPasswordMode]);

  useEffect(() => {
    if (registerRole !== "user") {
      setRegisterMode("referral_code");
      setRegisterReferralCode("");
    }
  }, [registerRole]);

  useEffect(() => {
    if (profile?.role === "operator") {
      setCreateRole("user");
      setCreateApproveImmediately(false);
    }
  }, [profile]);

  useEffect(() => {
    if (!pendingGuestLinkDeviceId || !profile || profile.status !== "approved") {
      return;
    }
    if (!["user", "operator"].includes(profile.role)) {
      setDashboardInfo("Penautan perangkat tersedia untuk akun User atau Operator.");
      clearGuestLinkRequest();
    }
  }, [pendingGuestLinkDeviceId, profile]);

  async function loadAll(options = false) {
    if (!session || guestDeviceId) {
      return;
    }

    const background =
      typeof options === "object" && options !== null
        ? Boolean(options.background)
        : Boolean(options);
    const includeArtifacts =
      typeof options === "object" && options !== null && Object.prototype.hasOwnProperty.call(options, "includeArtifacts")
        ? Boolean(options.includeArtifacts)
        : profile?.role === "super_admin" && selectedTab === "files" && filesView === "storage";

    if (!background) {
      setLoading(true);
    }

    try {
      const [dashboard, artifactPayload] = await Promise.all([
        invokeAdmin("listDashboard"),
        includeArtifacts
          ? invokeAdmin("listStorageArtifacts")
          : Promise.resolve({ artifacts: [] }),
      ]);
      startTransition(() => {
        setServices(dashboard.services || []);
        setLogs(dashboard.logs || []);
        setCommands(dashboard.commands || []);
        setFileJobs(dashboard.fileJobs || []);
        setStorageArtifacts(artifactPayload.artifacts || []);
        setRoots(dashboard.roots || []);
        setAccounts(dashboard.accounts || []);
        setEnvironments(dashboard.environments || []);
        setDeviceAssignments(dashboard.deviceAssignments || []);
        setDeviceAliases(dashboard.deviceAliases || []);
        if (dashboard.authPolicy) {
          setAuthPolicy((current) => ({ ...current, ...dashboard.authPolicy }));
        }
      });
      setChannelState("ready");
      setError("");
    } catch (loadError) {
      setChannelState("error");
      setError(formatEdgeFunctionError(loadError));
    }

    if (!background) {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!session || !profile || guestDeviceId) {
      return undefined;
    }

    loadAll({ background: false, includeArtifacts: selectedTab === "files" && filesView === "storage" });
    const refreshId = window.setInterval(() => {
      if (!pageVisibleRef.current) {
        return;
      }
      loadAll({
        background: true,
        includeArtifacts: selectedTab === "files" && filesView === "storage",
      });
      setNow(Date.now());
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshId);
    };
  }, [session, profile?.role, guestDeviceId, selectedTab, filesView]);

  useEffect(() => {
    if (appRoute.section === "devices" && appRoute.deviceId) {
      return;
    }
    if (selectedDeviceId !== "all" && !services.some((row) => row.device_id === selectedDeviceId)) {
      syncGlobalDeviceSelection("all");
    }
  }, [services, selectedDeviceId, appRoute]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    const allowedSections = getAllowedDashboardSections(profile.role);
    if (!allowedSections.has(selectedTab)) {
      setDashboardInfo("Halaman tersebut tidak tersedia untuk role akun ini.");
      navigateRoute("overview", {}, { replace: true });
      return;
    }
    if (
      typeof window !== "undefined" &&
      (window.location.pathname === "/dashboard" || !window.location.pathname.startsWith("/dashboard"))
    ) {
      navigateRoute("overview", {}, { replace: true });
    }
  }, [profile, selectedTab]);

  useEffect(() => {
    if (appRoute.section === "devices" && appRoute.deviceId && appRoute.deviceId !== selectedDeviceId) {
      syncGlobalDeviceSelection(appRoute.deviceId);
    }
  }, [appRoute, selectedDeviceId]);

  useEffect(() => {
    const syncedDeviceId = selectedDeviceId || "all";
    setArtifactDeviceFilter((current) => (current === syncedDeviceId ? current : syncedDeviceId));
    setActivityDeviceId((current) => (current === syncedDeviceId ? current : syncedDeviceId));
  }, [selectedDeviceId]);

  useEffect(() => {
    if (!dashboardInfo) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDashboardInfo((current) => (current === dashboardInfo ? "" : current));
    }, 4200);

    return () => window.clearTimeout(timeoutId);
  }, [dashboardInfo]);

  const commandRows = useMemo(
    () =>
      commands
        .map((command) => ({
          ...command,
          id: command.id,
          deviceId: command.device_id || command.deviceId || "",
          serviceName: command.service_name || command.serviceName || "",
          progressPercent: Number(command.progress_percent ?? command.progressPercent ?? 0) || 0,
          status: String(command.status || "pending"),
          phase: command.phase || "",
          message: command.message || "",
          error: command.error || "",
        }))
        .sort((left, right) => {
          const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
          const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
          return rightTime - leftTime;
        }),
    [commands]
  );

  const deviceEntries = useMemo(() => {
    const grouped = new Map();
    const aliasMap = new Map(
      deviceAliases.map((entry) => [String(entry.device_id || ""), String(entry.alias || "").trim()])
    );
    const assignmentMap = new Map();
    for (const assignment of deviceAssignments) {
      const deviceId = String(assignment.device_id || "").trim();
      if (!deviceId) {
        continue;
      }
      if (!assignmentMap.has(deviceId)) {
        assignmentMap.set(deviceId, []);
      }
      assignmentMap.get(deviceId).push(assignment);
    }
    for (const row of services) {
      const deviceRecord = Array.isArray(row.devices) ? row.devices[0] : row.devices;
      const deviceStatus = deriveDeviceStatus(deviceRecord);
      const deviceCommands = commandRows.filter((command) => command.deviceId === row.device_id);
      const agentStatus = deriveAgentStatus(deviceRecord, deviceCommands, deviceStatus);
      const connectivityStatus = deriveDeviceConnectivityStatus(deviceRecord, deviceStatus);
      const serviceStatus = deriveServiceStatus(row, deviceStatus);
      const rawDeviceName = deviceRecord?.device_name || row.device_id;
      const deviceAlias = aliasMap.get(String(row.device_id)) || "";

      if (!grouped.has(row.device_id)) {
        grouped.set(row.device_id, {
          deviceId: row.device_id,
          deviceName: deviceAlias || rawDeviceName,
          deviceAlias,
          rawDeviceName,
          deviceStatus,
          agentStatus,
          connectivityStatus,
          agentControlReady: isAgentControlReady(deviceRecord, connectivityStatus),
          latestAgentCommand: getLatestAgentLifecycleCommand(deviceCommands),
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
      assignments: assignmentMap.get(entry.deviceId) || [],
      activeAssignments: (assignmentMap.get(entry.deviceId) || []).filter(
        (assignment) => assignment.status === "active"
      ),
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
  }, [services, fileJobs, deviceAliases, deviceAssignments, commandRows]);

  const selectedDevice =
    appRoute.section === "devices" && appRoute.deviceId
      ? deviceEntries.find((entry) => entry.deviceId === appRoute.deviceId) || null
      : selectedDeviceId === "all"
      ? deviceEntries[0] || null
      : deviceEntries.find((entry) => entry.deviceId === selectedDeviceId) || null;
  const aliasModalDevice =
    deviceEntries.find((entry) => entry.deviceId === aliasModalDeviceId) || null;
  const updateModalDevice =
    deviceEntries.find((entry) => entry.deviceId === updateModal.deviceId) || null;
  const updateModalModel = updateModalDevice
    ? {
        ...getDeviceUpdateModel(updateModalDevice.deviceRecord),
        ...(updateModal.error ? { status: "failed", label: "Gagal update", error: updateModal.error } : {}),
      }
    : {
        status: updateModal.error ? "failed" : "available",
        label: updateModal.error ? "Gagal update" : "Update diminta",
        localVersion: "belum dilaporkan",
        latestVersion: "belum dilaporkan",
        error: updateModal.error,
      };
  const autoUpdatingDevice =
    deviceEntries.find((entry) => getDeviceUpdateModel(entry.deviceRecord).status === "updating") ||
    null;
  const selectedGuestUrl = selectedDevice ? buildGuestUrl(selectedDevice.deviceId) : "";
  const selectedDeviceBadge = getDeviceStatusBadgeModel(selectedDevice?.deviceStatus || "offline");
  const accountByUserId = useMemo(
    () => new Map(accounts.map((account) => [String(account.user_id || ""), account])),
    [accounts]
  );
  const currentUserId = String(profile?.user_id || session?.user?.id || "");
  const visibleCommandRows = useMemo(() => {
    if (!selectedDevice?.deviceId) {
      return commandRows;
    }
    return commandRows.filter((command) => command.deviceId === selectedDevice.deviceId);
  }, [commandRows, selectedDevice?.deviceId]);
  const autoVisibleCommandExecution = visibleCommandRows.find((command) =>
    shouldAutoShowCommandProgress(command, selectedDevice?.deviceStatus)
  );
  const activeCommandExecution =
    (activeCommandId
      ? commandRows.find((command) => String(command.id) === String(activeCommandId))
      : null) ||
    autoVisibleCommandExecution ||
    (/:(start|stop|agent_start|agent_stop|agent_restart|update|configure_tunnel)$/.test(busyAction)
      ? {
          action: busyAction.split(":").pop() || "command",
          deviceId: busyAction.split(":")[0] || "",
          serviceName: busyAction.split(":").length > 2 ? busyAction.split(":")[1] : "",
          status: "pending",
          phase: "queued",
          progressPercent: 4,
          message: "",
          error: "",
        }
      : null);
  const commandExecutionActive = Boolean(activeCommandExecution);
  const activeCommandStatus = activeCommandExecution?.status || "";
  const activeCommandPhase = String(activeCommandExecution?.phase || "").toLowerCase();
  const commandExecutionInFlight =
    Boolean(activeCommandExecution) && ["pending", "running"].includes(activeCommandStatus);
  const commandProgressMessage = activeCommandExecution
    ? activeCommandExecution.message ||
      getCommandCopy(
        activeCommandExecution.action,
        activeCommandExecution.serviceName,
        selectedDevice ? getDeviceUpdateModel(selectedDevice.deviceRecord).latestVersion : ""
      ).pending
    : "";
  const commandExecutionProgress = commandExecutionActive
    ? activeCommandExecution.progressPercent || (activeCommandStatus === "pending" ? 4 : 24)
    : 0;
  const commandProgressTitle = activeCommandExecution
    ? getCommandCopy(
        activeCommandExecution.action,
        activeCommandExecution.serviceName,
        selectedDevice ? getDeviceUpdateModel(selectedDevice.deviceRecord).latestVersion : ""
      ).pending
    : "Perintah sedang diproses";

  useEffect(() => {
    if (!activeCommandExecution?.id || !["done", "failed"].includes(activeCommandStatus)) {
      return;
    }
    const key = String(activeCommandExecution.id);
    if (announcedCommandStatusRef.current.get(key) === activeCommandStatus) {
      return;
    }
    announcedCommandStatusRef.current.set(key, activeCommandStatus);
    const copy = getCommandCopy(
      activeCommandExecution.action,
      activeCommandExecution.serviceName,
      selectedDevice ? getDeviceUpdateModel(selectedDevice.deviceRecord).latestVersion : ""
    );
    if (activeCommandStatus === "done") {
      const message = activeCommandExecution.message || copy.success;
      pushToast("Aksi selesai", message, "success");
      setDashboardInfo(message);
      return;
    }
    if (activeCommandPhase === "cancelled") {
      const message = activeCommandExecution.message || "Perintah dibatalkan pengguna.";
      pushToast("Aksi dibatalkan", message, "info");
      setDashboardInfo(message);
      return;
    }
    const message = activeCommandExecution.error || activeCommandExecution.message || "Command gagal diproses agent.";
    pushToast("Aksi gagal", message, "error");
    setError(message);
  }, [
    activeCommandExecution?.id,
    activeCommandExecution?.message,
    activeCommandExecution?.error,
    activeCommandPhase,
    activeCommandStatus,
    selectedDevice?.deviceId,
  ]);

  useEffect(() => {
    if (!activeCommandExecution?.id || !["done", "failed"].includes(activeCommandStatus)) {
      return undefined;
    }

    const commandId = activeCommandExecution.id;
    const timeoutId = window.setTimeout(() => {
      setActiveCommandId((current) => (String(current) === String(commandId) ? null : current));
    }, activeCommandStatus === "done" ? 1400 : 2600);

    return () => window.clearTimeout(timeoutId);
  }, [activeCommandExecution?.id, activeCommandStatus]);

  useEffect(() => {
    const body = document.body;
    if (!body) {
      return undefined;
    }

    const status = String(selectedDevice?.deviceStatus || "").toLowerCase();
    body.classList.remove("school-device-online", "school-device-offline");
    if (status === "online") {
      body.classList.add("school-device-online");
    } else if (selectedDevice && ["offline", "blocked", "unstable", "pending_setup"].includes(status)) {
      body.classList.add("school-device-offline");
    }

    return () => {
      body.classList.remove("school-device-online", "school-device-offline");
    };
  }, [selectedDevice?.deviceId, selectedDevice?.deviceStatus]);

  const fileExplorerBusy =
    busyAction.startsWith("job:list_directory") ||
    busyAction.startsWith("job:discover_roots") ||
    busyAction.startsWith("job:preview_file") ||
    directoryJobId !== null ||
    rootDiscoveryJobId !== null;
  const routeBreadcrumbs = getRouteBreadcrumbs(appRoute, profile, {
    filesView,
    deviceName:
      appRoute.section === "devices"
        ? selectedDevice?.deviceName
        : appRoute.section === "activity" && activityDeviceId && activityDeviceId !== "all"
          ? deviceEntries.find((entry) => entry.deviceId === activityDeviceId)?.deviceName || activityDeviceId
          : "",
  });

  useEffect(() => {
    const preferredProvider = selectedDevice?.deviceRecord?.tunnel_preferred_provider || "cloudflare";
    setTunnelProviderDraft(preferredProvider === "ngrok" ? "ngrok" : "cloudflare");
    setNgrokTokenDraft("");
    setNgrokTokenEditing(false);
  }, [selectedDevice?.deviceId, selectedDevice?.deviceRecord?.tunnel_preferred_provider]);

  useEffect(() => {
    if (!autoUpdatingDevice) {
      return;
    }

    setUpdateModal((current) => {
      if (current.open && current.deviceId === autoUpdatingDevice.deviceId && !current.error) {
        return current;
      }

      return {
        open: true,
        deviceId: autoUpdatingDevice.deviceId,
        title: "Mengupdate Agent & Service",
        message: "Pembaruan otomatis sedang berjalan. Agent akan hidup kembali setelah installer selesai.",
        error: "",
      };
    });
  }, [autoUpdatingDevice?.deviceId]);

  useEffect(() => {
    if (createRole !== "user") {
      if (createAssignedDeviceId) {
        setCreateAssignedDeviceId("");
      }
      return;
    }

    const availableDeviceIds = deviceEntries.map((entry) => entry.deviceId).filter(Boolean);
    if (!availableDeviceIds.length) {
      if (createAssignedDeviceId) {
        setCreateAssignedDeviceId("");
      }
      return;
    }

    if (createAssignedDeviceId && availableDeviceIds.includes(createAssignedDeviceId)) {
      return;
    }

    const preferredDeviceId =
      (selectedDevice?.deviceId && availableDeviceIds.includes(selectedDevice.deviceId)
        ? selectedDevice.deviceId
        : availableDeviceIds[0]) || "";

    if (preferredDeviceId !== createAssignedDeviceId) {
      setCreateAssignedDeviceId(preferredDeviceId);
    }
  }, [createRole, createAssignedDeviceId, deviceEntries, selectedDevice]);

  const visibleServices = useMemo(() => {
    if (!selectedDevice) {
      return [];
    }

    if (profile?.role === "user") {
      return selectedDevice.services.filter((service) => service.service_name === "rapor");
    }

    return selectedDevice.services;
  }, [selectedDevice, profile]);

  const selectedDeviceJobs = useMemo(
    () =>
      selectedDevice
        ? fileJobs.filter((job) => job.device_id === selectedDevice.deviceId)
        : [],
    [fileJobs, selectedDevice]
  );

  const artifactDeviceOptions = useMemo(() => {
    const options = new Map();
    for (const artifact of storageArtifacts) {
      const deviceId = String(artifact.deviceId || artifact.device_id || "").trim();
      if (!deviceId) {
        continue;
      }
      options.set(deviceId, artifact.deviceName || deviceId);
    }
    return Array.from(options.entries()).map(([id, label]) => ({ id, label }));
  }, [storageArtifacts]);
  const effectiveArtifactDeviceFilter = selectedDeviceId || "all";

  const visibleStorageArtifacts = useMemo(() => {
    const query = artifactSearch.trim().toLowerCase();
    return storageArtifacts.filter((artifact) => {
      const bucket = String(artifact.bucket || "").trim();
      const deviceId = String(artifact.deviceId || artifact.device_id || "").trim();
      if (artifactBucketFilter !== "all" && bucket !== artifactBucketFilter) {
        return false;
      }
      if (effectiveArtifactDeviceFilter !== "all" && deviceId !== effectiveArtifactDeviceFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        artifact.fileName,
        artifact.objectKey,
        artifact.sourcePath,
        artifact.deviceName,
        artifact.bucket,
      ]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(query));
    });
  }, [artifactBucketFilter, artifactSearch, effectiveArtifactDeviceFilter, storageArtifacts]);

  const selectedDeviceRoots = useMemo(
    () =>
      selectedDevice
        ? roots.filter((root) => root.device_id === selectedDevice.deviceId)
        : [],
    [roots, selectedDevice]
  );
  const selectedDeviceDriveRoots = useMemo(
    () => selectedDeviceRoots.filter((root) => String(root.root_type || "") === "drive"),
    [selectedDeviceRoots]
  );
  const deviceScopedOffline =
    Boolean(selectedDevice) &&
    (selectedDevice.deviceStatus === "offline" || selectedDevice.agentStatus === "stopped") &&
    ["devices", "files", "activity"].includes(selectedTab);

  useEffect(() => {
    setCurrentPath("");
    setDirectoryResult(null);
    setSelectedPaths([]);
  }, [selectedDevice?.deviceId]);

  useEffect(() => {
    if (!selectedDevice || selectedTab !== "files" || filesView !== "remote") {
      return;
    }
    refreshRoots();
  }, [selectedDevice?.deviceId, selectedTab, filesView]);

  useEffect(() => {
    if (!selectedDevice || selectedTab !== "files" || filesView !== "remote") {
      return;
    }
    if (currentPath || directoryJobId || rootDiscoveryJobId || !selectedDeviceRoots.length) {
      return;
    }
    setDirectoryResult(buildThisPcDirectoryResult(selectedDeviceDriveRoots.length ? selectedDeviceDriveRoots : selectedDeviceRoots));
  }, [
    selectedDevice?.deviceId,
    selectedDeviceRoots,
    selectedDeviceDriveRoots,
    currentPath,
    directoryJobId,
    rootDiscoveryJobId,
    selectedTab,
    filesView,
  ]);

  useEffect(() => {
    setFilePage(1);
  }, [artifactBucketFilter, artifactDeviceFilter, artifactSearch]);

  useEffect(() => {
    setFleetPage(1);
  }, [fleetSearch]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [appRoute.section, appRoute.deviceId, filesView]);

  useEffect(() => {
    setAccountPage(1);
  }, [accounts.length]);

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
      if (job.result.path) {
        setCurrentPath(job.result.path);
      }
      setSelectedPaths([]);
      setDirectoryJobId(null);
    } else if (job.status === "failed") {
      setError(job.error || "Directory listing failed.");
      setDirectoryJobId(null);
    }
  }, [directoryJobId, fileJobs]);

  useEffect(() => {
    if (!rootDiscoveryJobId) {
      return;
    }

    const job = fileJobs.find((entry) => entry.id === rootDiscoveryJobId);
    if (!job) {
      return;
    }

    if (job.status === "completed") {
      setRootDiscoveryJobId(null);
      loadAll({ background: true, includeArtifacts: false });
    } else if (job.status === "failed") {
      setError(job.error || "Gagal memuat drive perangkat.");
      setRootDiscoveryJobId(null);
    }
  }, [rootDiscoveryJobId, fileJobs]);

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
      setError(job.error || "Pratinjau belum berhasil dimuat.");
      setPreviewJobId(null);
    }
  }, [previewJobId, fileJobs]);

  async function invokeAdmin(action, payload = {}) {
    const { data, error: invokeError } = await legacyDataClient.functions.invoke("admin-ops", {
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
    setAuthBusy(true);
    setAuthError("");
    setAuthInfo("");
    try {
      const normalizedEmail = normalizeLoginEmail(loginEmail);
      const normalizedPassword = normalizeLoginPassword(loginPassword);

      if (authMode === "register") {
        await invokeEdgeFunction("account-access", {
          action: "register",
          email: normalizedEmail,
          password: normalizedPassword,
          displayName: registerDisplayName,
          role: registerRole,
          registrationMode: registerRole === "user" ? registerMode : "open_operator_signup",
          referralCode: registerRole === "user" ? registerReferralCode : "",
        });
        setAuthInfo(
          "Pendaftaran berhasil diterima. Masuk dengan akun yang sama untuk memantau status persetujuan."
        );
        setAuthMode("login");
      } else {
        const { error: signInError } = await legacyDataClient.auth.signInWithPassword({
          email: normalizedEmail,
          password: normalizedPassword,
        });

        if (signInError) {
          setAuthError(formatSignInError(signInError));
        }
      }
    } catch (authActionError) {
      setAuthError(formatEdgeFunctionError(authActionError));
    } finally {
      setAuthBusy(false);
    }
  }

  async function sendForgotPassword() {
    try {
      setAuthBusy(true);
      setAuthError("");
      setAuthInfo("");
      const redirectTo = buildResetPasswordUrl();
      const normalizedEmail = normalizeLoginEmail(loginEmail);
      await invokeEdgeFunction("account-access", {
        action: "forgotPassword",
        email: normalizedEmail,
        redirectTo,
      });

      setAuthInfo("Tautan untuk mengganti password sudah dikirim ke email Anda. Buka email tersebut, verifikasi tautan, lalu buat password baru.");
    } catch (forgotError) {
      setAuthError(formatEdgeFunctionError(forgotError));
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    const returnDeviceId = String(guestReturnDeviceId || pendingGuestLinkDeviceId || "").trim();
    setAuthBusy(true);
    setAuthError("");
    setAuthInfo("");
    setDashboardInfo("");
    resetAuthenticatedState();
    try {
      const globalResult = await legacyDataClient.auth.signOut({ scope: "global" });
      if (globalResult.error) {
        await legacyDataClient.auth.signOut({ scope: "local" });
      }
    } catch (_error) {
      await legacyDataClient.auth.signOut({ scope: "local" }).catch(() => {});
    } finally {
      clearStoredAuthArtifacts();
      resetAuthFormState("login");
      setAuthBusy(false);
      if (typeof window !== "undefined") {
        if (returnDeviceId) {
          window.location.href = buildGuestPath(returnDeviceId);
        } else {
          window.location.href = buildAuthPath();
        }
      }
    }
  }

  async function queueCommand(deviceId, serviceName, action, payload = {}) {
    setBusyAction(`${deviceId}:${serviceName || "device"}:${action}`);
    setError("");
    const updateVersion = selectedDevice && selectedDevice.deviceId === deviceId
      ? getDeviceUpdateModel(selectedDevice.deviceRecord).latestVersion
      : "";
    const commandCopy = getCommandCopy(action, serviceName, updateVersion);
    try {
      const data = await invokeAdmin("queueCommand", {
        deviceId,
        serviceName,
        commandAction: action,
        ...payload,
      });
      if (data?.command?.id) {
        setCommands((current) => [data.command, ...current.filter((command) => command.id !== data.command.id)]);
        setActiveCommandId(data.command.id);
        setCommandProgressMinimized(false);
      }
      setDashboardInfo(commandCopy.pending);
      pushToast("Perintah dikirim", commandCopy.pending, "info");
      loadAll(true);
    } catch (commandError) {
      const message = formatEdgeFunctionError(commandError);
      setError(message);
      pushToast("Perintah gagal", message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function cancelActiveCommand() {
    if (!activeCommandExecution?.id || cancelingCommandId) {
      return;
    }

    const commandId = activeCommandExecution.id;
    setCancelingCommandId(commandId);
    try {
      const data = await invokeAdmin("cancelCommand", { commandId });
      if (data?.command?.id) {
        setCommands((current) => [data.command, ...current.filter((command) => command.id !== data.command.id)]);
        setActiveCommandId(data.command.id);
      }
      const message = data?.alreadyCompleted
        ? "Perintah sudah selesai sebelum pembatalan diproses."
        : "Perintah dibatalkan pengguna.";
      setDashboardInfo(message);
      pushToast(data?.alreadyCompleted ? "Perintah sudah selesai" : "Aksi dibatalkan", message, "info");
      loadAll(true);
    } catch (cancelError) {
      const message = formatEdgeFunctionError(cancelError);
      setError(message);
      pushToast("Gagal membatalkan", message, "error");
    } finally {
      setCancelingCommandId(null);
    }
  }

  async function saveTunnelSettings() {
    if (!selectedDevice) {
      return;
    }

    const provider = tunnelProviderDraft === "ngrok" ? "ngrok" : "cloudflare";
    const ngrokAuthtoken = ngrokTokenDraft.trim();
    if (
      provider === "ngrok" &&
      !ngrokAuthtoken &&
      !selectedDevice.deviceRecord?.tunnel_ngrok_account_configured
    ) {
      const message = "Auth token ngrok wajib diisi saat ngrok belum pernah dikonfigurasi untuk device ini.";
      setError(message);
      pushToast("Token ngrok diperlukan", message, "error");
      return;
    }

    await queueCommand(selectedDevice.deviceId, null, "configure_tunnel", {
      provider,
      ngrokAuthtoken,
    });
    setNgrokTokenDraft("");
    setNgrokTokenEditing(false);
  }

  async function updateDeviceStatus(deviceId, status) {
    setBusyAction(`${deviceId}:${status}`);
    setError("");
    try {
      await invokeAdmin("updateDeviceStatus", { deviceId, status });
      loadAll(true);
    } catch (statusError) {
      setError(formatEdgeFunctionError(statusError));
    } finally {
      setBusyAction("");
    }
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
      setError(formatEdgeFunctionError(jobError));
      return null;
    }
  }

  async function copyGuestLink(deviceId) {
    try {
      setBusyAction(`guest:${deviceId}`);
      const data = await invokeAdmin("syncGuestLink", { deviceId });
      await copyTextToClipboard(data.guestUrl);
      setError("");
      setDashboardInfo("Tautan guest berhasil disalin.");
      pushToast("Tautan disalin", "Tautan guest perangkat sudah masuk ke clipboard.", "success");
      loadAll(true);
    } catch (copyError) {
      setError(formatEdgeFunctionError(copyError));
      pushToast("Gagal menyalin tautan", formatEdgeFunctionError(copyError), "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleAccountAction(action, payload = {}) {
    try {
      setBusyAction(`account:${action}`);
      await invokeAdmin(action, payload);
      await loadAll(true);
      if (action === "updateAuthPolicy") {
        setDashboardInfo("Aturan policy berhasil disimpan.");
        pushToast("Policy tersimpan", "Label jam dan menit sudah mengikuti aturan terbaru.", "success");
      }
    } catch (accountError) {
      setError(formatEdgeFunctionError(accountError));
      pushToast("Aksi akun gagal", formatEdgeFunctionError(accountError), "error");
    } finally {
      setBusyAction("");
    }
  }

  async function copyReferralCode(code) {
    try {
      await copyTextToClipboard(code);
      setError("");
      setDashboardInfo("Kode referral berhasil disalin.");
      pushToast("Kode disalin", "Kode referral siap dibagikan ke User.", "success");
    } catch (copyError) {
      const message = copyError?.message || "Gagal menyalin kode referral.";
      setError(message);
      pushToast("Salin gagal", message, "error");
    }
  }

  function shareReferralCode(code, environmentName = "Lingkungan") {
    if (!code) {
      return;
    }
    window.open(buildWhatsAppShareUrl(code, `Kode referral ${environmentName}`), "_blank", "noopener,noreferrer");
    setDashboardInfo("Kode referral siap dibagikan lewat WhatsApp.");
    pushToast("Siap dibagikan", "WhatsApp dibuka dengan kode referral.", "success");
  }

  async function confirmGuestDeviceLink() {
    const deviceId = String(pendingGuestLinkDeviceId || "").trim();
    if (!deviceId) {
      return;
    }

    try {
      setBusyAction(`guest-link:${deviceId}`);
      setError("");
      setDashboardInfo("");
      await invokeAdmin("linkGuestDevice", { deviceId });
      syncGlobalDeviceSelection(deviceId);
      clearGuestLinkRequest();
      await loadAll(true);
      setDashboardInfo("Perangkat berhasil ditautkan ke akun ini.");
    } catch (linkError) {
      setError(formatEdgeFunctionError(linkError));
    } finally {
      setBusyAction("");
    }
  }

  function openAliasModal(device) {
    setAliasModalDeviceId(device.deviceId);
    setAliasDraft(device.deviceAlias || "");
  }

  async function saveDeviceAlias() {
    if (!aliasModalDevice) {
      return;
    }

    try {
      setBusyAction(`alias:${aliasModalDevice.deviceId}`);
      setError("");
      await invokeAdmin("updateDeviceAlias", {
        deviceId: aliasModalDevice.deviceId,
        alias: aliasDraft,
      });
      setAliasModalDeviceId("");
      setAliasDraft("");
      await loadAll(true);
    } catch (aliasError) {
      setError(formatEdgeFunctionError(aliasError));
    } finally {
      setBusyAction("");
    }
  }

  async function unlinkDeviceAssignment({ deviceId, userId = "", label = "" }) {
    const targetUserId = String(userId || currentUserId || "").trim();
    const selfUnlink = targetUserId && targetUserId === currentUserId;
    const targetLabel = label || deviceId;
    const confirmationMessage = selfUnlink
      ? `Device "${targetLabel}" tertaut ke akun yang sedang login. Setelah dilepas, akun ini harus menautkan device lagi sebelum bisa mengelola layanan. Lanjutkan?`
      : `Lepas tautan device "${targetLabel}" dari akun ini?`;

    if (typeof window !== "undefined" && !window.confirm(confirmationMessage)) {
      return;
    }

    try {
      setBusyAction(`device-unlink:${deviceId}:${targetUserId}`);
      setError("");
      const result = await invokeAdmin("unlinkDeviceAssignment", {
        deviceId,
        userId: targetUserId,
        confirmCurrentDevice: selfUnlink,
      });
      if (result.selfUnlink && !result.remainingActiveAssignments) {
        syncGlobalDeviceSelection("all");
        setDashboardInfo("Device dilepas dari akun ini. Tautkan device lain untuk mengelola layanan kembali.");
        pushToast("Device dilepas", "Akun ini sekarang belum memiliki device aktif.", "info");
      } else {
        setDashboardInfo("Tautan device berhasil dilepas.");
        pushToast("Device dilepas", "Device bisa ditautkan ke akun lain.", "success");
      }
      await loadAll(true);
    } catch (unlinkError) {
      const message = formatEdgeFunctionError(unlinkError);
      setError(message);
      pushToast("Gagal melepas device", message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function openTransferHistory(deviceIdOverride = "") {
    if (profile?.role !== "super_admin") {
      return;
    }

    try {
      setTransferHistoryOpen(true);
      setTransferHistoryLoading(true);
      setError("");
      const scopedDeviceId = String(deviceIdOverride || (selectedDeviceId === "all" ? "" : selectedDeviceId) || "").trim();
      const data = await invokeAdmin("listTransferHistory", {
        deviceId: scopedDeviceId,
      });
      setTransferHistory({
        jobs: data.jobs || [],
        auditLogs: data.auditLogs || [],
      });
    } catch (historyError) {
      setError(formatEdgeFunctionError(historyError));
      setTransferHistory({ jobs: [], auditLogs: [] });
    } finally {
      setTransferHistoryLoading(false);
    }
  }

  async function refreshStorageArtifacts() {
    if (profile?.role !== "super_admin") {
      return;
    }
    try {
      setBusyAction("artifacts:refresh");
      const data = await invokeAdmin("listStorageArtifacts");
      setStorageArtifacts(data.artifacts || []);
      setError("");
      pushToast("Storage diperbarui", "Daftar pustaka berkas sudah disegarkan dari Supabase.", "success");
    } catch (artifactError) {
      setError(formatEdgeFunctionError(artifactError));
      pushToast("Storage gagal dimuat", formatEdgeFunctionError(artifactError), "error");
    } finally {
      setBusyAction("");
    }
  }

  function requestDeleteStorageArtifact(artifact) {
    setDeleteArtifactTarget(artifact || null);
  }

  async function deleteStorageArtifact() {
    const artifact = deleteArtifactTarget;
    if (!artifact) {
      return;
    }

    const fileName = artifact?.fileName || artifact?.objectKey || "berkas";

    try {
      setBusyAction(`artifact-delete:${artifact.id || artifact.objectKey}`);
      await invokeAdmin("deleteStorageArtifact", {
        bucket: artifact.bucket,
        objectKey: artifact.objectKey,
        jobId: artifact.jobId,
        deviceId: artifact.deviceId,
        fileName,
        isFolder: Boolean(artifact.isFolder),
      });
      setStorageArtifacts((current) =>
        current.filter((entry) => (entry.id || `${entry.bucket}:${entry.objectKey}`) !== (artifact.id || `${artifact.bucket}:${artifact.objectKey}`))
      );
      setDeleteArtifactTarget(null);
      await refreshStorageArtifacts();
      await loadAll(true);
      setDashboardInfo(
        artifact.isFolder
          ? `Folder ${fileName} berhasil dihapus dari storage.`
          : `Berkas ${fileName} berhasil dihapus dari storage.`
      );
      pushToast(
        artifact.isFolder ? "Folder dihapus" : "Berkas dihapus",
        artifact.isFolder
          ? "Seluruh isi folder terkait juga dihapus dari Supabase storage."
          : "Artefak berhasil dihapus dari Supabase storage.",
        "success"
      );
    } catch (artifactError) {
      setError(formatEdgeFunctionError(artifactError));
      pushToast("Gagal menghapus storage", formatEdgeFunctionError(artifactError), "error");
    } finally {
      setBusyAction("");
    }
  }

  function dismissGuestDeviceLink() {
    setDashboardInfo("Penautan perangkat dilewati. Anda tetap dapat menggunakan halaman ini sesuai akses akun.");
    clearGuestLinkRequest();
  }

  async function handleDeleteAccount(account) {
    if (!account?.user_id) {
      return;
    }

    const confirmed = window.confirm(
      `Hapus akun ${account.display_name || account.email} (${account.role}) secara permanen?`
    );
    if (!confirmed) {
      return;
    }

    await handleAccountAction("deleteAccount", { userId: account.user_id });
  }

  async function createManagedAccount() {
    if (!createEmail || !createPassword) {
      setError("Email dan password account wajib diisi.");
      return;
    }

    await handleAccountAction("createAccount", {
      email: createEmail,
      password: createPassword,
      displayName: createDisplayName,
      role: createRole,
      approveImmediately: createApproveImmediately,
      environmentId: createRole === "user" ? environments[0]?.id || profile?.primary_environment_id || "" : "",
      deviceId: createRole === "user" ? createAssignedDeviceId : "",
    });

    setCreateEmail("");
    setCreatePassword("");
    setCreateDisplayName("");
    setCreateRole("operator");
    setCreateAssignedDeviceId("");
    setCreateApproveImmediately(true);
  }

  async function openPath(nextPath) {
    setCurrentPath(nextPath);
    setFilesView("remote");
    const job = await createFileJob("list_directory", { sourcePath: nextPath });
    if (job) {
      setDirectoryJobId(job.id);
      setDirectoryResult(null);
      setSelectedTab("files");
    }
  }

  async function openParentPath() {
    if (!currentPath) {
      return;
    }

    const breadcrumbs = buildBreadcrumbs(currentPath);
    if (breadcrumbs.length <= 1) {
      await openPath(currentPath);
      return;
    }

    await openPath(breadcrumbs[breadcrumbs.length - 2].path);
  }

  async function refreshRoots() {
    setFilesView("remote");
    const job = await createFileJob("discover_roots");
    if (job) {
      setRootDiscoveryJobId(job.id);
    }
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
    async function signArtifact(part, fallbackName) {
      try {
        const data = await invokeAdmin("signArtifact", {
          bucket: part.bucket,
          objectKey: part.objectKey,
          downloadFileName: fallbackName,
        });
        return data.signedUrl;
      } catch (_functionError) {
        const { data, error: signError } = await legacyDataClient.storage
          .from(part.bucket)
          .createSignedUrl(part.objectKey, 60 * 15, {
            download: fallbackName,
          });
        if (signError) {
          throw signError;
        }
        return data.signedUrl;
      }
    }

    function triggerBrowserDownload(url) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }

    try {
      setBusyAction(`download:${job.id}`);

      const parts =
        Array.isArray(job.result?.parts) && job.result.parts.length > 0
          ? job.result.parts
          : [
              {
                bucket: job.artifact_bucket,
                objectKey: job.artifact_object_key,
                fileName: job.result?.fileName || job.artifact_object_key.split("/").pop(),
              },
            ];

      for (const part of parts) {
        const downloadFileName = part.fileName || part.objectKey.split("/").pop();
        const signedUrl = await signArtifact(part, downloadFileName);
        triggerBrowserDownload(signedUrl);
        if (parts.length > 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
      }
    } catch (downloadError) {
      setError(formatEdgeFunctionError(downloadError));
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
      setError(formatEdgeFunctionError(promoteError));
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
      setError(formatEdgeFunctionError(cancelError));
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
      const { error: uploadError } = await legacyDataClient.storage
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
      setError(formatEdgeFunctionError(uploadError));
    } finally {
      setBusyAction("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  if (guestDeviceId) {
    return <FeatureGuestConsole deviceId={guestDeviceId} />;
  }

  if (resetPasswordMode) {
    return <FeaturePasswordResetScreen />;
  }

  if (!session) {
    return (
      <LoginScreen
        mode={authMode}
        email={loginEmail}
        password={loginPassword}
        displayName={registerDisplayName}
        role={registerRole}
        registrationMode={registerMode}
        referralCode={registerReferralCode}
        setEmail={setLoginEmail}
        setPassword={setLoginPassword}
        setDisplayName={setRegisterDisplayName}
        setRole={setRegisterRole}
        setRegistrationMode={setRegisterMode}
        setReferralCode={setRegisterReferralCode}
        setMode={setAuthMode}
        onSubmit={signIn}
        onForgotPassword={sendForgotPassword}
        error={authError}
        info={authInfo}
        loading={authBusy}
      />
    );
  }

  if (profileLoading) {
    return <PageSkeleton title="Memuat profil akun" />;
  }

  if (!profile) {
    return <AccountStatusScreen profile={{ status: "pending", email: session.user.email }} onSignOut={signOut} />;
  }

  if (profile.status !== "approved") {
    return <AccountStatusScreen profile={profile} onSignOut={signOut} />;
  }

  const isSuperAdmin = profile.role === "super_admin";
  const isOperator = profile.role === "operator";
  const isUser = profile.role === "user";
  const showGuestLinkPrompt =
    (isUser || isOperator) && Boolean(pendingGuestLinkDeviceId) && profile.status === "approved";
  const linkingGuestDevice = busyAction === `guest-link:${pendingGuestLinkDeviceId}`;
  const activeRunningJobs = fileJobs.filter((job) => ["pending", "running"].includes(job.status)).length;
  const pendingAccountCount = accounts.filter((account) => account.status === "pending").length;
  const dashboardNavItems = getDashboardNavItems({
    isSuperAdmin,
    isOperator,
    deviceCount: deviceEntries.length,
    pendingAccounts: pendingAccountCount,
    runningJobs: activeRunningJobs,
  });
  const filteredFleetDevices = deviceEntries.filter((device) => matchesDeviceQuery(device, fleetSearch));
  const fleetPageSize = 10;
  const totalFleetPages = Math.max(1, Math.ceil(filteredFleetDevices.length / fleetPageSize));
  const safeFleetPage = Math.min(Math.max(1, fleetPage), totalFleetPages);
  const pagedFleetDevices = filteredFleetDevices.slice(
    (safeFleetPage - 1) * fleetPageSize,
    safeFleetPage * fleetPageSize
  );
  const updateAvailableCount = deviceEntries.filter((device) => getDeviceUpdateModel(device.deviceRecord).updateAvailable).length;
  const deviceWarningCount = deviceEntries.reduce(
    (total, device) =>
      total + (device.issueCount > 0 || device.deviceStatus === "offline" || device.agentStatus === "stopped" ? 1 : 0),
    0
  );
  const latestErrorLogs = logs.filter((log) => ["error", "warn"].includes(log.level)).slice(0, 3);
  const notificationItems = [
    ...(pendingAccountCount
      ? [{
          id: "pending-accounts",
          icon: Users,
          tone: "warn",
          title: `${pendingAccountCount} akun menunggu`,
          description: "Akun baru menunggu approval SuperAdmin.",
        }]
      : []),
    ...(deviceWarningCount
      ? [{
          id: "device-warning",
          icon: AlertTriangle,
          tone: "warn",
          title: `${deviceWarningCount} perangkat perlu dicek`,
          description: "Ada perangkat offline, agent berhenti, atau service yang perlu perhatian.",
        }]
      : []),
    ...(updateAvailableCount
      ? [{
          id: "updates",
          icon: Rocket,
          tone: "info",
          title: `${updateAvailableCount} update tersedia`,
          description: "Agent memiliki versi GitHub terbaru yang bisa dipasang.",
        }]
      : []),
    ...(activeRunningJobs
      ? [{
          id: "file-jobs",
          icon: FileText,
          tone: "info",
          title: `${activeRunningJobs} proses berkas berjalan`,
          description: "Transfer atau pekerjaan file sedang diproses.",
        }]
      : []),
    ...latestErrorLogs.map((log) => ({
      id: `log-${log.id}`,
      icon: AlertTriangle,
      tone: statusTone(log.level),
      title: log.level === "error" ? "Error terbaru" : "Peringatan terbaru",
      description: String(log.message || "").slice(0, 120),
    })),
  ];

  const { renderFreshScene } = createDashboardRenderers({
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
  });

  return (
    <main className={`console-shell app-shell-page role-${profile.role} route-${selectedTab} ${selectedDevice?.deviceStatus === "online" ? "is-device-online" : ""} ${deviceScopedOffline ? "is-device-offline" : ""} ${commandExecutionInFlight ? "is-command-locked" : ""}`.trim()}>
      <div className={`app-shell ${sidebarPinned ? "sidebar-is-pinned" : ""}`}>
        <SidebarNav
          profile={profile}
          activeSection={selectedTab}
          items={dashboardNavItems}
          onNavigate={navigateRoute}
          pinned={sidebarPinned}
          onTogglePinned={() => setSidebarPinned((current) => !current)}
          onExpandedChange={setSidebarExpanded}
        />
        <section className="app-content">
          <TopCommandBar
            profile={profile}
            loading={loading}
            authBusy={authBusy}
            onRefresh={() => loadAll()}
            onSignOut={signOut}
            notifications={notificationItems}
            notificationOpen={notificationOpen}
            onNotificationToggle={() => setNotificationOpen((current) => !current)}
            onNotificationClose={() => setNotificationOpen(false)}
          />
          <RouteHeader
            route={appRoute}
            profile={profile}
            breadcrumbs={routeBreadcrumbs}
          />
          <PriorityBanner
            route={appRoute}
            profile={profile}
            devices={deviceEntries}
            fileJobs={fileJobs}
            accounts={accounts}
          />
          <MobileNav activeSection={selectedTab} items={dashboardNavItems} onNavigate={navigateRoute} />

      {error ? <div className="error-banner">{error}</div> : null}
      {dashboardInfo ? <div className="service-note">{dashboardInfo}</div> : null}
      {showGuestLinkPrompt ? (
        <div className="guest-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="guest-link-title" onMouseDown={(event) => dismissOnBackdrop(event, dismissGuestDeviceLink)}>
          <div className="guest-modal-card">
            <strong id="guest-link-title">Tautkan perangkat ini ke akun Anda?</strong>
            <p>
              Perangkat{" "}
              <LongText value={pendingGuestLinkDeviceId} label="ID perangkat" className="mono" maxLength={28} />{" "}
              akan ditambahkan ke akses akun ini.
              Setelah tertaut, Anda dapat melihat layanan yang tersedia.
            </p>
            <div className="guest-modal-actions">
              <button
                type="button"
                className="secondary-button action-cancel action-button"
                disabled={linkingGuestDevice}
                onClick={dismissGuestDeviceLink}
              >
                Lewati
              </button>
              <button
                type="button"
                className="primary-button action-link action-button"
                disabled={linkingGuestDevice}
                onClick={confirmGuestDeviceLink}
              >
                {linkingGuestDevice ? "Menautkan..." : "Tautkan perangkat"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <DeviceAliasModal
        device={aliasModalDevice}
        value={aliasDraft}
        onChange={setAliasDraft}
        onClose={() => {
          setAliasModalDeviceId("");
          setAliasDraft("");
        }}
        onSave={saveDeviceAlias}
        busy={busyAction === `alias:${aliasModalDevice?.deviceId}`}
      />
      <TransferHistoryModal
        open={transferHistoryOpen}
        loading={transferHistoryLoading}
        history={transferHistory}
        device={selectedDevice}
        deviceId={selectedDeviceId === "all" ? "" : selectedDeviceId}
        onClose={() => setTransferHistoryOpen(false)}
        onDownload={handleArtifactDownload}
      />
      <ConfirmDialog
        open={Boolean(deleteArtifactTarget)}
        title="Hapus berkas storage?"
        message={
          deleteArtifactTarget
            ? `${
                deleteArtifactTarget.isFolder ? "Folder" : "Berkas"
              } "${deleteArtifactTarget.fileName || safeFileNameFromKey(deleteArtifactTarget.objectKey)}" akan dihapus dari storage cloud dan dihilangkan dari pustaka berkas.`
            : ""
        }
        confirmLabel={deleteArtifactTarget?.isFolder ? "Hapus folder" : "Hapus berkas"}
        cancelLabel="Batal"
        destructive
        busy={busyAction === `artifact-delete:${deleteArtifactTarget?.id || deleteArtifactTarget?.objectKey || ""}`}
        onConfirm={deleteStorageArtifact}
        onClose={() => setDeleteArtifactTarget(null)}
      />
      <FeatureUpdateProgressModal
        open={updateModal.open}
        update={updateModalModel}
        title={updateModal.title}
        message={updateModal.message}
        onClose={() =>
          setUpdateModal({
            open: false,
            deviceId: "",
            title: "Mengupdate Agent & Service",
            message: "",
            error: "",
          })
        }
      />
      <CommandProgressOverlay
        open={commandExecutionActive}
        title={commandProgressTitle}
        message={commandProgressMessage}
        percent={commandExecutionProgress}
        phase={activeCommandExecution?.phase || ""}
        status={activeCommandStatus}
        error={activeCommandExecution?.error || ""}
        minimized={commandProgressMinimized}
        cancelLabel={cancelingCommandId ? "Membatalkan..." : "Batalkan"}
        onMinimize={() => setCommandProgressMinimized(true)}
        onRestore={() => setCommandProgressMinimized(false)}
        onCancel={
          activeCommandExecution?.id && ["pending", "running"].includes(activeCommandStatus)
            ? cancelActiveCommand
            : undefined
        }
        onClose={() => {
          if (["done", "failed"].includes(activeCommandStatus)) {
            setActiveCommandId(null);
          }
        }}
      />
      <ToastViewport items={toastItems} onDismiss={dismissToast} />

      {renderFreshScene()}
        </section>
      </div>
    </main>
  );
}

