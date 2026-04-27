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
        await this.bestEffortUpdateFileJob(job.id, {
          status: "running",
          result,
          error:
            result.message ||
            "Artifact is ready locally and will upload automatically when connectivity returns.",
          progress_current: result.progressCurrent || 1,
          progress_total: result.progressTotal || 1,
          artifact_bucket: result.bucket || null,
          artifact_object_key: result.objectKey || null,
          artifact_expires_at: result.expiresAt || null,
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

      await this.supabaseApi.updateFileJob(job.id, {
        status: "completed",
        result,
        error: null,
        artifact_bucket: result?.bucket || null,
        artifact_object_key: result?.objectKey || null,
        artifact_expires_at: result?.expiresAt || null,
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
    const record = {
      jobId: job.id,
      jobType: job.job_type,
      requestedBy: job.requested_by || null,
      sourcePath: job.source_path || null,
      destinationPath: job.destination_path || null,
      bucket: artifact.bucket,
      objectKey: artifact.objectKey,
      localPath: artifact.localPath,
      result: artifact,
      queuedAt: new Date().toISOString(),
    };

    this.writePendingUploadRecord(record);

    return {
      ...artifact,
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
        if (!fs.existsSync(record.localPath)) {
          await this.bestEffortUpdateFileJob(record.jobId, {
            status: "failed",
            error: `Pending artifact not found: ${record.localPath}`,
            locked_by_device: null,
            completed_at: new Date().toISOString(),
          });
          this.deletePendingUploadRecord(record.jobId);
          continue;
        }

        await this.uploadFileToBucket(record.bucket, record.objectKey, record.localPath);

        await this.supabaseApi.updateFileJob(record.jobId, {
          status: "completed",
          result: {
            ...record.result,
            pendingUpload: false,
            localReady: true,
            uploadedAt: new Date().toISOString(),
          },
          error: null,
          artifact_bucket: record.bucket,
          artifact_object_key: record.objectKey,
          artifact_expires_at: record.result?.expiresAt || null,
          progress_current: record.result?.progressCurrent || 1,
          progress_total: record.result?.progressTotal || 1,
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
            fileName: record.result?.fileName || null,
            objectKey: record.objectKey,
          },
        });

        this.deletePendingUploadRecord(record.jobId);
        logger.info(`Uploaded deferred artifact for file job #${record.jobId}`, {
          serviceName: null,
          jobId: record.jobId,
          jobType: record.jobType,
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
      await this.uploadFileToBucket(bucket, objectKey, targetPath);
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
    const archiveFileName = `${safeBasename(resolvedSelection[0], "backup")}-${job.id}.zip`;
    ensureDirectory(this.stagingRoot);
    const archivePath = path.join(this.stagingRoot, archiveFileName);
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }

    const literalPaths = resolvedSelection
      .map((targetPath) => `'${String(targetPath).replace(/'/g, "''")}'`)
      .join(", ");
    const command = [
      `$paths = @(${literalPaths})`,
      `Compress-Archive -LiteralPath $paths -DestinationPath '${archivePath.replace(/'/g, "''")}' -Force`,
    ].join("; ");

    await this.serviceManager.runCapture(this.serviceManager.getPowerShellPath(), [
      "-NoProfile",
      "-Command",
      command,
    ]);

    if (!fs.existsSync(archivePath)) {
      throw new Error(`Archive was not created at ${archivePath}`);
    }

    const bucket = job.delivery_mode === "persistent" ? "agent-archives" : "agent-temp-artifacts";
    const objectKey = `${this.device.deviceId}/${job.id}/${archiveFileName}`;
    const size = fs.statSync(archivePath).size;
    const artifact = {
      bucket,
      objectKey,
      localPath: archivePath,
      fileName: archiveFileName,
      mimeType: "application/zip",
      size,
      progressCurrent: selection.length,
      progressTotal: selection.length,
      expiresAt:
        job.delivery_mode === "persistent"
          ? null
          : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    try {
      await this.uploadFileToBucket(bucket, objectKey, archivePath);
      return artifact;
    } catch (error) {
      if (isConnectivityError(error)) {
        return this.queuePendingArtifactUpload(job, artifact);
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
