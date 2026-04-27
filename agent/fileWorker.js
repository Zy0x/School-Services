const fs = require("fs");
const path = require("path");
const logger = require("./logger");

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function detectMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".txt":
    case ".log":
    case ".json":
    case ".js":
    case ".ts":
    case ".jsx":
    case ".tsx":
    case ".css":
    case ".html":
    case ".xml":
    case ".csv":
    case ".md":
    case ".ini":
    case ".env":
    case ".sql":
      return "text/plain";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

function safeBasename(targetPath, fallback = "artifact") {
  const base = path.basename(String(targetPath || "").trim());
  return base || fallback;
}

function normalizeDirectoryCandidate(targetPath) {
  const normalized = path.resolve(String(targetPath || ""));
  if (!normalized) {
    return normalized;
  }

  try {
    const stats = fs.statSync(normalized);
    if (stats.isFile()) {
      return path.dirname(normalized);
    }
  } catch (error) {
    // Keep the original path when it does not exist yet.
  }

  return normalized;
}

function isConnectivityError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return [
    "fetch failed",
    "network request failed",
    "timed out",
    "econnreset",
    "enotfound",
    "getaddrinfo",
    "failed to fetch",
    "socket hang up",
    "temporarily unavailable",
    "network",
  ].some((token) => message.includes(token));
}

function escapePowerShellSingleQuotedString(value) {
  return String(value || "").replace(/'/g, "''");
}

class FileWorker {
  constructor(options) {
    this.device = options.device;
    this.supabaseApi = options.supabaseApi;
    this.serviceManager = options.serviceManager;
    this.workspaceRoot = options.workspaceRoot;
    this.previewInlineBytes = Number(options.previewInlineBytes || 262144);
    this.previewTextExtensions = new Set(
      (options.previewTextExtensions || []).map((value) =>
        String(value || "").toLowerCase()
      )
    );
    this.rootsRefreshMs = Number(options.rootsRefreshMs || 60000);
    this.lastRootsSyncAt = 0;

    this.tempArtifactsRoot = path.join(this.workspaceRoot, "artifacts");
    this.previewRoot = path.join(this.workspaceRoot, "previews");
    this.stagingRoot = path.join(this.workspaceRoot, "staging");
    this.pendingUploadsRoot = path.join(this.workspaceRoot, "pending-uploads");

    ensureDirectory(this.tempArtifactsRoot);
    ensureDirectory(this.previewRoot);
    ensureDirectory(this.stagingRoot);
    ensureDirectory(this.pendingUploadsRoot);
  }

  async syncRootsIfNeeded(force = false) {
    if (!force && Date.now() - this.lastRootsSyncAt < this.rootsRefreshMs) {
      return;
    }

    const roots = await this.buildRoots();
    await this.supabaseApi.replaceFileRoots(this.device.deviceId, roots);
    this.lastRootsSyncAt = Date.now();
  }

  async processNextJob() {
    ensureDirectory(this.workspaceRoot);
    ensureDirectory(this.tempArtifactsRoot);
    ensureDirectory(this.previewRoot);
    ensureDirectory(this.stagingRoot);
    ensureDirectory(this.pendingUploadsRoot);

    await this.flushPendingUploads();

    try {
      await this.syncRootsIfNeeded();
    } catch (error) {
      logger.warn(`File roots refresh skipped: ${error.message}`, {
        serviceName: null,
      });
    }

    const nextJob = await this.supabaseApi.fetchNextFileJob(this.device.deviceId);
    if (!nextJob) {
      return false;
    }

    const job =
      nextJob.status === "running" && nextJob.locked_by_device === this.device.deviceId
        ? nextJob
        : await this.supabaseApi.claimFileJob(nextJob.id, this.device.deviceId);

    try {
      logger.info(`Processing file job ${job.job_type}`, {
        serviceName: null,
        jobId: job.id,
        jobType: job.job_type,
      });
      const result = await this.handleJob(job);

      if (result?.pendingUpload) {
        const primaryArtifact = this.getPrimaryArtifact(result);
        await this.bestEffortUpdateFileJob(job.id, {
          status: "running",
          result,
          error:
            result.message ||
            "Artifact is ready locally and will upload automatically when connectivity returns.",
          progress_current: result.progressCurrent || 1,
          progress_total: result.progressTotal || 1,
          artifact_bucket: primaryArtifact?.bucket || null,
          artifact_object_key: primaryArtifact?.objectKey || null,
          artifact_expires_at: primaryArtifact?.expiresAt || null,
          locked_by_device: this.device.deviceId,
        });
        await this.writeAuditLogSafe({
          deviceId: this.device.deviceId,
          requestedBy: job.requested_by,
          jobId: job.id,
          action: `deferred-upload:${job.job_type}`,
          targetPath: job.source_path || job.destination_path,
          details: {
            status: "running",
            localReady: true,
            fileName: result.fileName || null,
            localPath: result.localPath || null,
          },
        });
        return true;
      }

      const primaryArtifact = this.getPrimaryArtifact(result);
      await this.supabaseApi.updateFileJob(job.id, {
        status: "completed",
        result,
        error: null,
        artifact_bucket: primaryArtifact?.bucket || null,
        artifact_object_key: primaryArtifact?.objectKey || null,
        artifact_expires_at: primaryArtifact?.expiresAt || null,
        progress_current: result?.progressCurrent || 1,
        progress_total: result?.progressTotal || 1,
        locked_by_device: null,
        completed_at: new Date().toISOString(),
      });
      await this.writeAuditLogSafe({
        deviceId: this.device.deviceId,
        requestedBy: job.requested_by,
        jobId: job.id,
        action: `complete:${job.job_type}`,
        targetPath: job.source_path || job.destination_path,
        details: {
          status: "completed",
          fileName: result?.fileName || null,
          artifactReady: Boolean(result?.bucket && result?.objectKey),
        },
      });
    } catch (error) {
      logger.error(`File job ${job.job_type} failed: ${error.message}`, {
        serviceName: null,
        jobId: job.id,
        jobType: job.job_type,
      });
      await this.supabaseApi.updateFileJob(job.id, {
        status: "failed",
        error: error.message,
        locked_by_device: null,
        completed_at: new Date().toISOString(),
      });
      await this.writeAuditLogSafe({
        deviceId: this.device.deviceId,
        requestedBy: job.requested_by,
        jobId: job.id,
        action: `fail:${job.job_type}`,
        targetPath: job.source_path || job.destination_path,
        details: {
          error: error.message,
        },
      });
    }

    return true;
  }

  async writeAuditLogSafe(entry) {
    try {
      await this.supabaseApi.insertFileAuditLog(entry);
    } catch (error) {
      logger.warn(`Failed to write file audit log: ${error.message}`, {
        serviceName: null,
        jobId: entry.jobId || null,
        action: entry.action,
      });
    }
  }

  getPrimaryArtifact(result) {
    if (Array.isArray(result?.parts) && result.parts.length > 0) {
      return result.parts[0];
    }

    return result || null;
  }

  getPendingUploadRecordPath(jobId) {
    return path.join(this.pendingUploadsRoot, `${jobId}.json`);
  }

  writePendingUploadRecord(record) {
    fs.writeFileSync(
      this.getPendingUploadRecordPath(record.jobId),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8"
    );
  }

  readPendingUploadRecords() {
    ensureDirectory(this.pendingUploadsRoot);
    return fs
      .readdirSync(this.pendingUploadsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(this.pendingUploadsRoot, entry.name))
      .map((recordPath) => {
        try {
          return JSON.parse(fs.readFileSync(recordPath, "utf8"));
        } catch (error) {
          logger.warn(`Skipping unreadable pending upload record ${recordPath}: ${error.message}`, {
            serviceName: null,
          });
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => Number(left.jobId || 0) - Number(right.jobId || 0));
  }

  deletePendingUploadRecord(jobId) {
    const recordPath = this.getPendingUploadRecordPath(jobId);
    if (fs.existsSync(recordPath)) {
      fs.unlinkSync(recordPath);
    }
  }

  async bestEffortUpdateFileJob(jobId, patch) {
    try {
      return await this.supabaseApi.updateFileJob(jobId, patch);
    } catch (error) {
      if (isConnectivityError(error)) {
        logger.warn(
          `Deferred file job status sync for #${jobId}: ${error.message}`,
          { serviceName: null, jobId }
        );
        return null;
      }

      throw error;
    }
  }

  async queuePendingArtifactUpload(job, artifact) {
    const artifacts = Array.isArray(artifact)
      ? artifact
      : Array.isArray(artifact?.parts)
        ? artifact.parts
        : [artifact];
    const record = {
      jobId: job.id,
      jobType: job.job_type,
      requestedBy: job.requested_by || null,
      sourcePath: job.source_path || null,
      destinationPath: job.destination_path || null,
      artifacts,
      result: Array.isArray(artifact)
        ? {
            parts: artifact,
            partCount: artifact.length,
            fileName:
              artifact.length === 1 ? artifact[0].fileName : `${job.job_type}-${job.id}`,
            progressCurrent: artifact.length,
            progressTotal: artifact.length,
          }
        : artifact,
      queuedAt: new Date().toISOString(),
    };

    this.writePendingUploadRecord(record);

    return {
      ...(Array.isArray(artifact) ? record.result : artifact),
      parts: record.result.parts || undefined,
      pendingUpload: true,
      localReady: true,
      message:
        "Artifact is ready locally and will upload automatically when connectivity returns.",
    };
  }

  async flushPendingUploads() {
    const records = this.readPendingUploadRecords();

    for (const record of records) {
      try {
        const artifacts = Array.isArray(record.artifacts)
          ? record.artifacts
          : record.localPath && record.bucket && record.objectKey
            ? [
                {
                  bucket: record.bucket,
                  objectKey: record.objectKey,
                  localPath: record.localPath,
                  fileName: record.result?.fileName || path.basename(record.localPath),
                  mimeType: record.result?.mimeType || detectMimeType(record.localPath),
                  size: record.result?.size || null,
                  expiresAt: record.result?.expiresAt || null,
                },
              ]
            : [];

        if (artifacts.length === 0) {
          await this.bestEffortUpdateFileJob(record.jobId, {
            status: "failed",
            error: "Pending artifact metadata is missing.",
            locked_by_device: null,
            completed_at: new Date().toISOString(),
          });
          this.deletePendingUploadRecord(record.jobId);
          continue;
        }

        const uploadedArtifacts = [];
        for (const artifact of artifacts) {
          if (!fs.existsSync(artifact.localPath)) {
            throw new Error(`Pending artifact not found: ${artifact.localPath}`);
          }

          await this.uploadFileToBucket(
            artifact.bucket,
            artifact.objectKey,
            artifact.localPath
          );
          uploadedArtifacts.push(artifact);
        }

        const result =
          uploadedArtifacts.length > 1
            ? {
                parts: uploadedArtifacts,
                partCount: uploadedArtifacts.length,
                fileName: record.result?.fileName || uploadedArtifacts[0]?.fileName || null,
                localReady: true,
                pendingUpload: false,
                uploadedAt: new Date().toISOString(),
                progressCurrent: uploadedArtifacts.length,
                progressTotal: uploadedArtifacts.length,
              }
            : {
                ...(record.result || uploadedArtifacts[0]),
                ...uploadedArtifacts[0],
                pendingUpload: false,
                localReady: true,
                uploadedAt: new Date().toISOString(),
              };
        const primaryArtifact = this.getPrimaryArtifact(result);

        await this.supabaseApi.updateFileJob(record.jobId, {
          status: "completed",
          result,
          error: null,
          artifact_bucket: primaryArtifact?.bucket || null,
          artifact_object_key: primaryArtifact?.objectKey || null,
          artifact_expires_at: primaryArtifact?.expiresAt || null,
          progress_current: result?.progressCurrent || 1,
          progress_total: result?.progressTotal || 1,
          locked_by_device: null,
          completed_at: new Date().toISOString(),
        });

        await this.writeAuditLogSafe({
          deviceId: this.device.deviceId,
          requestedBy: record.requestedBy,
          jobId: record.jobId,
          action: `upload-complete:${record.jobType}`,
          targetPath: record.sourcePath || record.destinationPath,
          details: {
            status: "completed",
            fileName: result?.fileName || null,
            objectKey: primaryArtifact?.objectKey || null,
            partCount: Array.isArray(result?.parts) ? result.parts.length : 1,
          },
        });

        this.deletePendingUploadRecord(record.jobId);
        logger.info(`Uploaded deferred artifact for file job #${record.jobId}`, {
          serviceName: null,
          jobId: record.jobId,
          jobType: record.jobType,
          partCount: Array.isArray(result?.parts) ? result.parts.length : 1,
        });
      } catch (error) {
        if (isConnectivityError(error)) {
          logger.warn(
            `Deferred artifact upload for job #${record.jobId} is still waiting for connectivity: ${error.message}`,
            { serviceName: null, jobId: record.jobId }
          );
          return;
        }

        logger.error(`Deferred artifact upload for job #${record.jobId} failed: ${error.message}`, {
          serviceName: null,
          jobId: record.jobId,
        });
        await this.bestEffortUpdateFileJob(record.jobId, {
          status: "failed",
          error: error.message,
          locked_by_device: null,
          completed_at: new Date().toISOString(),
        });
        this.deletePendingUploadRecord(record.jobId);
      }
    }
  }

  async handleJob(job) {
    switch (job.job_type) {
      case "discover_roots":
      case "discover_app_paths":
        return this.handleDiscoverRoots(job);
      case "list_directory":
        return this.handleListDirectory(job);
      case "stat_path":
        return this.handleStatPath(job);
      case "preview_file":
        return this.handlePreviewFile(job);
      case "download_file":
        return this.handleDownloadFile(job);
      case "archive_paths":
        return this.handleArchivePaths(job);
      case "upload_place":
        return this.handleUploadPlace(job);
      default:
        throw new Error(`Unsupported file job type: ${job.job_type}`);
    }
  }

  async buildRoots() {
    const driveRoots = await this.getDriveRoots();
    const quickAccess = this.getQuickAccessRoots();
    const appRoots = await this.getApplicationRoots();
    return [...driveRoots, ...quickAccess, ...appRoots];
  }

  async getDriveRoots() {
    const script = [
      "Get-PSDrive -PSProvider FileSystem |",
      "Select-Object Name, Root, Description, Used, Free |",
      "ConvertTo-Json -Compress",
    ].join(" ");
    const { stdout } = await this.serviceManager.runCapture(
      this.serviceManager.getPowerShellPath(),
      ["-NoProfile", "-Command", script]
    );
    const parsed = stdout ? JSON.parse(stdout) : [];
    const entries = Array.isArray(parsed) ? parsed : [parsed];

    return entries
      .filter(Boolean)
      .map((entry) => ({
        root_key: `drive:${entry.Name}`,
        label: entry.Name,
        path: entry.Root,
        root_type: "drive",
        metadata: {
          description: entry.Description || null,
          used: entry.Used ?? null,
          free: entry.Free ?? null,
        },
      }));
  }

  getQuickAccessRoots() {
    const candidates = [
      ["desktop", process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Desktop") : null],
      [
        "documents",
        process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Documents") : null,
      ],
      [
        "downloads",
        process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Downloads") : null,
      ],
    ];

    return candidates
      .filter(([, directoryPath]) => directoryPath && fs.existsSync(directoryPath))
      .map(([key, directoryPath]) => ({
        root_key: `quick:${key}`,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        path: directoryPath,
        root_type: "quick_access",
        metadata: {},
      }));
  }

  async getApplicationRoots() {
    const results = [];
    for (const serviceName of ["rapor", "dapodik"]) {
      const diagnostics = await this.serviceManager.getLocationDiagnostics(serviceName, {
        forceRefresh: true,
      });
      const candidatePath =
        diagnostics.resolvedPath ||
        diagnostics.details?.windowsServices?.[0]?.executablePath ||
        "";

      results.push({
        root_key: `app:${serviceName}`,
        label: serviceName === "rapor" ? "E-Rapor" : "Dapodik",
        path: normalizeDirectoryCandidate(candidatePath),
        root_type: "application",
        metadata: {
          locationStatus: diagnostics.status,
          message: diagnostics.message,
          details: diagnostics.details || {},
        },
      });
    }

    return results.filter((root) => root.path);
  }

  async handleDiscoverRoots() {
    const roots = await this.buildRoots();
    await this.supabaseApi.replaceFileRoots(this.device.deviceId, roots);
    this.lastRootsSyncAt = Date.now();
    return { roots };
  }

  resolveExistingPath(targetPath) {
    const normalized = path.resolve(String(targetPath || ""));
    if (!fs.existsSync(normalized)) {
      throw new Error(`Path not found: ${normalized}`);
    }
    return normalized;
  }

  appendArchiveEntriesFromPath(targetPath, archiveRootName, entries, warnings) {
    let stats;
    try {
      stats = fs.statSync(targetPath);
    } catch (error) {
      warnings.push({ path: targetPath, message: error.message });
      return;
    }

    if (stats.isDirectory()) {
      const pending = [{ sourcePath: targetPath, rootPath: targetPath }];

      while (pending.length > 0) {
        const current = pending.pop();
        let children;
        try {
          children = fs.readdirSync(current.sourcePath);
        } catch (error) {
          warnings.push({ path: current.sourcePath, message: error.message });
          continue;
        }

        for (const childName of children) {
          const childPath = path.join(current.sourcePath, childName);
          try {
            const childStats = fs.statSync(childPath);
            if (childStats.isDirectory()) {
              pending.push({ sourcePath: childPath, rootPath: current.rootPath });
              continue;
            }

            const relativePath = path.relative(current.rootPath, childPath);
            entries.push({
              sourcePath: childPath,
              entryName: path.join(archiveRootName, relativePath),
              size: childStats.size,
            });
          } catch (error) {
            warnings.push({ path: childPath, message: error.message });
          }
        }
      }

      return;
    }

    entries.push({
      sourcePath: targetPath,
      entryName: path.basename(targetPath),
      size: stats.size,
    });
  }

  collectArchiveEntries(resolvedSelection) {
    const entries = [];
    const warnings = [];

    for (const targetPath of resolvedSelection) {
      const rootName = safeBasename(targetPath, "backup");
      this.appendArchiveEntriesFromPath(targetPath, rootName, entries, warnings);
    }

    return { entries, warnings };
  }

  splitArchiveEntries(entries) {
    const maxBytes = Math.max(1024 * 1024, Math.floor(this.maxArtifactBytes * 0.92));
    const parts = [];
    let currentEntries = [];
    let currentSize = 0;

    for (const entry of entries) {
      const entrySize = Number(entry.size || 0);
      if (
        currentEntries.length > 0 &&
        currentSize + entrySize > maxBytes
      ) {
        parts.push(currentEntries);
        currentEntries = [];
        currentSize = 0;
      }

      currentEntries.push(entry);
      currentSize += entrySize;
    }

    if (currentEntries.length > 0) {
      parts.push(currentEntries);
    }

    return parts;
  }

  splitEntriesInHalf(entries) {
    if (!Array.isArray(entries) || entries.length <= 1) {
      return [entries];
    }

    const midpoint = Math.ceil(entries.length / 2);
    return [entries.slice(0, midpoint), entries.slice(midpoint)];
  }

  createArchivePartFileName(baseName, jobId, partIndex, totalParts) {
    const safeBase = safeBasename(baseName, "backup");
    if (totalParts <= 1) {
      return `${safeBase}-${jobId}.zip`;
    }

    const paddedIndex = String(partIndex + 1).padStart(String(totalParts).length, "0");
    return `${safeBase}-${jobId}.part-${paddedIndex}-of-${totalParts}.zip`;
  }

  async buildArchiveArtifacts(job, resolvedSelection, deliveryMode) {
    const { entries, warnings } = this.collectArchiveEntries(resolvedSelection);
    if (!entries.length) {
      const firstWarning = warnings[0]?.message || `No readable files found in ${resolvedSelection[0]}`;
      throw new Error(firstWarning);
    }

    const entryGroups = this.splitArchiveEntries(entries);
    const bucket = deliveryMode === "persistent" ? "agent-archives" : "agent-temp-artifacts";
    const expiresAt =
      deliveryMode === "persistent"
        ? null
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const archiveBaseName = safeBasename(resolvedSelection[0], "backup");
    const groupsToProcess = entryGroups.map((partEntries) => ({ partEntries }));
    const artifacts = [];
    const skippedItems = [...warnings];
    let totalAdded = 0;

    while (groupsToProcess.length > 0) {
      const current = groupsToProcess.shift();
      const archiveFileName = `${archiveBaseName}-${job.id}-${Date.now()}-${artifacts.length + groupsToProcess.length + 1}.zip`;
      const archivePath = path.join(this.stagingRoot, archiveFileName);

      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }

      const metadata = await this.createArchiveFromEntries(current.partEntries, archivePath);

      if (!fs.existsSync(archivePath)) {
        throw new Error(`Archive was not created at ${archivePath}`);
      }

      const archiveSize = fs.statSync(archivePath).size;

      if (archiveSize > this.maxArtifactBytes) {
        fs.unlinkSync(archivePath);

        if (current.partEntries.length <= 1) {
          throw new Error(
            `One archive segment exceeded the maximum upload size (${Math.round(
              this.maxArtifactBytes / (1024 * 1024)
            )} MB). Narrow the selection or reduce very large files before downloading.`
          );
        }

        const [left, right] = this.splitEntriesInHalf(current.partEntries);
        groupsToProcess.unshift(
          { partEntries: right },
          { partEntries: left }
        );
        continue;
      }

      totalAdded += Number(metadata.added || 0);
      if (Array.isArray(metadata.skippedItems) && metadata.skippedItems.length > 0) {
        skippedItems.push(
          ...metadata.skippedItems.map((message) => ({
            path: archivePath,
            message,
          }))
        );
      }

      artifacts.push({
        bucket,
        objectKey: `${this.device.deviceId}/${job.id}/${archiveFileName}`,
        localPath: archivePath,
        fileName: archiveFileName,
        mimeType: "application/zip",
        size: archiveSize,
        expiresAt,
      });
    }

    if (!totalAdded) {
      throw new Error(
        skippedItems[0]?.message
          ? `Archive could not include any readable files. First error: ${skippedItems[0].message}`
          : `Archive could not include any readable files from ${resolvedSelection[0]}`
      );
    }

    artifacts.sort((left, right) => left.localPath.localeCompare(right.localPath));

    const finalPartCount = artifacts.length;
    for (const [index, artifact] of artifacts.entries()) {
      const finalFileName = this.createArchivePartFileName(
        archiveBaseName,
        job.id,
        index,
        finalPartCount
      );
      const finalPath = path.join(this.stagingRoot, finalFileName);

      if (artifact.localPath !== finalPath) {
        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
        }
        fs.renameSync(artifact.localPath, finalPath);
      }

      artifact.localPath = finalPath;
      artifact.fileName = finalFileName;
      artifact.objectKey = `${this.device.deviceId}/${job.id}/${finalFileName}`;
    }

    return {
      artifacts,
      progressCurrent: artifacts.length,
      progressTotal: artifacts.length,
      warnings:
        skippedItems.length > 0
          ? {
              skippedCount: skippedItems.length,
              skippedItems: skippedItems.slice(0, 20),
            }
          : null,
      totalAdded,
    };
  }

  async createArchiveFromEntries(entries, archivePath) {
    const manifestPath = path.join(
      this.stagingRoot,
      `${path.basename(archivePath)}.manifest.json`
    );
    fs.writeFileSync(manifestPath, JSON.stringify(entries, null, 2), "utf8");

    const command = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName System.IO.Compression",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem",
      `$destination = '${escapePowerShellSingleQuotedString(archivePath)}'`,
      `$manifestPath = '${escapePowerShellSingleQuotedString(manifestPath)}'`,
      "if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }",
      "$entries = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json",
      "$zip = [System.IO.Compression.ZipFile]::Open($destination, [System.IO.Compression.ZipArchiveMode]::Create)",
      "$added = 0",
      "$skipped = New-Object System.Collections.Generic.List[string]",
      "function Add-Entry($sourcePath, $entryName) {",
      "  try {",
      "    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $sourcePath, ($entryName -replace '\\\\','/'), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null",
      "    $script:added += 1",
      "  } catch {",
      "    [void]$skipped.Add(($sourcePath + ': ' + $_.Exception.Message))",
      "  }",
      "}",
      "try {",
      "  foreach ($entry in $entries) {",
      "    if (-not (Test-Path -LiteralPath $entry.sourcePath)) {",
      "      [void]$skipped.Add(($entry.sourcePath + ': path not found'))",
      "      continue",
      "    }",
      "    Add-Entry $entry.sourcePath $entry.entryName",
      "  }",
      "} finally {",
      "  $zip.Dispose()",
      "}",
      "Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue",
      "$result = @{ added = $added; skipped = $skipped.Count; skippedItems = @($skipped | Select-Object -First 20) }",
      "$result | ConvertTo-Json -Compress",
    ].join("; ");

    const { stdout } = await this.serviceManager.runCapture(
      this.serviceManager.getPowerShellPath(),
      ["-NoProfile", "-Command", command]
    );

    return stdout ? JSON.parse(stdout) : { added: 0, skipped: 0, skippedItems: [] };
  }

  buildDirectoryEntry(parentPath, entryName) {
    const fullPath = path.join(parentPath, entryName);
    const stats = fs.statSync(fullPath);
    return {
      name: entryName,
      path: fullPath,
      type: stats.isDirectory() ? "directory" : "file",
      size: stats.isDirectory() ? null : stats.size,
      modifiedAt: stats.mtime.toISOString(),
      hidden: entryName.startsWith("."),
    };
  }

  async handleListDirectory(job) {
    const targetPath = this.resolveExistingPath(job.source_path);
    const targetStats = fs.statSync(targetPath);
    const warnings = [];

    if (targetStats.isFile()) {
      return {
        path: path.dirname(targetPath),
        parentPath: path.dirname(path.dirname(targetPath)),
        focusedPath: targetPath,
        items: [this.buildDirectoryEntry(path.dirname(targetPath), path.basename(targetPath))],
        warnings,
      };
    }

    const entryNames = fs.readdirSync(targetPath);
    const entries = [];

    for (const entryName of entryNames) {
      try {
        entries.push(this.buildDirectoryEntry(targetPath, entryName));
      } catch (error) {
        warnings.push({
          name: entryName,
          path: path.join(targetPath, entryName),
          message: error.message,
        });
      }
    }

    entries.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    return {
      path: targetPath,
      parentPath: path.dirname(targetPath),
      items: entries,
      warnings,
    };
  }

  async handleStatPath(job) {
    const targetPath = this.resolveExistingPath(job.source_path);
    const stats = fs.statSync(targetPath);
    return {
      path: targetPath,
      type: stats.isDirectory() ? "directory" : "file",
      size: stats.isDirectory() ? null : stats.size,
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
    };
  }

  async handlePreviewFile(job) {
    const targetPath = this.resolveExistingPath(job.source_path);
    const extension = path.extname(targetPath).toLowerCase();
    const stats = fs.statSync(targetPath);

    if (this.previewTextExtensions.has(extension)) {
      const content = fs.readFileSync(targetPath, "utf8").slice(0, this.previewInlineBytes);
      return {
        path: targetPath,
        previewType: "text",
        content,
        truncated: content.length >= this.previewInlineBytes,
        size: stats.size,
      };
    }

    const bucket = "agent-preview-cache";
    const objectKey = `${this.device.deviceId}/${job.id}/${safeBasename(targetPath)}`;
    await this.uploadFileToBucket(bucket, objectKey, targetPath);

    return {
      path: targetPath,
      previewType: "artifact",
      bucket,
      objectKey,
      mimeType: detectMimeType(targetPath),
      size: stats.size,
    };
  }

  async handleDownloadFile(job) {
    const targetPath = this.resolveExistingPath(job.source_path);
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      throw new Error("download_file expects a file path, not a directory.");
    }

    ensureDirectory(this.stagingRoot);
    const stagedFileName = `${job.id}-${safeBasename(targetPath)}`;
    const stagedFilePath = path.join(this.stagingRoot, stagedFileName);
    fs.copyFileSync(targetPath, stagedFilePath);

    const bucket = job.delivery_mode === "persistent" ? "agent-archives" : "agent-temp-artifacts";
    const objectKey = `${this.device.deviceId}/${job.id}/${safeBasename(targetPath)}`;

    const artifact = {
      bucket,
      objectKey,
      localPath: stagedFilePath,
      fileName: safeBasename(targetPath),
      mimeType: detectMimeType(targetPath),
      size: stats.size,
      progressCurrent: 1,
      progressTotal: 1,
      expiresAt:
        job.delivery_mode === "persistent"
          ? null
          : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    try {
      await this.uploadFileToBucket(bucket, objectKey, stagedFilePath);
      return artifact;
    } catch (error) {
      if (isConnectivityError(error)) {
        return this.queuePendingArtifactUpload(job, artifact);
      }

      throw error;
    }
  }

  async handleArchivePaths(job) {
    const selection = Array.isArray(job.selection) && job.selection.length > 0
      ? job.selection
      : [job.source_path].filter(Boolean);

    if (selection.length === 0) {
      throw new Error("archive_paths requires at least one selected path.");
    }

    const resolvedSelection = selection.map((targetPath) => this.resolveExistingPath(targetPath));
    ensureDirectory(this.stagingRoot);
    const archive = await this.buildArchiveArtifacts(
      job,
      resolvedSelection,
      job.delivery_mode
    );
    logger.info(`Prepared archive artifacts for file job #${job.id}`, {
      serviceName: null,
      jobId: job.id,
      jobType: job.job_type,
      selectedPaths: resolvedSelection,
      partCount: archive.artifacts.length,
      totalBytes: archive.artifacts.reduce((sum, artifact) => sum + Number(artifact.size || 0), 0),
      skippedCount: archive.warnings?.skippedCount || 0,
    });
    const singleArtifact = archive.artifacts.length === 1 ? archive.artifacts[0] : null;
    const result = singleArtifact
      ? {
          ...singleArtifact,
          progressCurrent: archive.progressCurrent,
          progressTotal: archive.progressTotal,
          warnings: archive.warnings,
        }
      : {
          fileName: `${safeBasename(resolvedSelection[0], "backup")}-${job.id}.zip`,
          parts: archive.artifacts,
          partCount: archive.artifacts.length,
          size: archive.artifacts.reduce((sum, artifact) => sum + Number(artifact.size || 0), 0),
          progressCurrent: archive.progressCurrent,
          progressTotal: archive.progressTotal,
          warnings: archive.warnings,
          expiresAt: archive.artifacts[0]?.expiresAt || null,
        };

    try {
      for (const artifact of archive.artifacts) {
        await this.uploadFileToBucket(artifact.bucket, artifact.objectKey, artifact.localPath);
      }
      return result;
    } catch (error) {
      if (isConnectivityError(error)) {
        return this.queuePendingArtifactUpload(job, result);
      }

      throw error;
    }
  }

  async handleUploadPlace(job) {
    const options = job.options || {};
    const bucket = String(options.stagingBucket || "admin-upload-staging");
    const objectKey = String(options.stagingObjectKey || "").trim();

    if (!objectKey) {
      throw new Error("Upload job is missing staging object key.");
    }

    const destinationRoot = path.resolve(String(job.destination_path || ""));
    ensureDirectory(destinationRoot);
    const fileName = String(options.originalFileName || path.basename(objectKey));
    const targetPath = path.join(destinationRoot, fileName);

    const { data, error } = await this.supabaseApi.client.storage
      .from(bucket)
      .download(objectKey);

    if (error) {
      throw error;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(targetPath, buffer);

    return {
      path: targetPath,
      size: buffer.length,
      uploaded: true,
    };
  }

  async uploadFileToBucket(bucket, objectKey, localPath) {
    const buffer = fs.readFileSync(localPath);
    const { error } = await this.supabaseApi.client.storage.from(bucket).upload(objectKey, buffer, {
      upsert: true,
      contentType: detectMimeType(localPath),
    });

    if (error) {
      throw error;
    }
  }
}

module.exports = FileWorker;
