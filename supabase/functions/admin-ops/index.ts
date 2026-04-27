import { corsHeaders, json } from "../_shared/cors.ts";
import { requireSuperAdmin } from "../_shared/admin.ts";

const TEMP_BUCKET = "agent-temp-artifacts";
const ARCHIVE_BUCKET = "agent-archives";

function sanitizeSelection(selection: unknown) {
  if (!Array.isArray(selection)) {
    return [];
  }

  return selection
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { service, user } = await requireSuperAdmin(request);
    const body = await request.json();
    const action = String(body.action || "").trim();

    if (action === "createJob") {
      const payload = {
        device_id: String(body.deviceId || "").trim(),
        requested_by: user.id,
        job_type: String(body.jobType || "").trim(),
        delivery_mode: String(body.deliveryMode || "temp").trim(),
        source_path: body.sourcePath ? String(body.sourcePath) : null,
        destination_path: body.destinationPath ? String(body.destinationPath) : null,
        selection: sanitizeSelection(body.selection),
        options: body.options && typeof body.options === "object" ? body.options : {},
        status: "pending",
      };

      const { data, error } = await service
        .from("file_jobs")
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      await service.from("file_audit_logs").insert({
        device_id: payload.device_id,
        requested_by: user.id,
        job_id: data.id,
        action: `create:${payload.job_type}`,
        target_path: payload.source_path || payload.destination_path,
        details: {
          deliveryMode: payload.delivery_mode,
          selectionCount: payload.selection.length,
        },
      });

      return json({ ok: true, job: data });
    }

    if (action === "cancelJob") {
      const jobId = Number(body.jobId);
      const { data, error } = await service
        .from("file_jobs")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      return json({ ok: true, job: data });
    }

    if (action === "signArtifact") {
      const bucket = String(body.bucket || TEMP_BUCKET);
      const objectKey = String(body.objectKey || "").trim();

      if (!objectKey) {
        throw new Error("Artifact object key is required.");
      }

      const { data, error } = await service.storage
        .from(bucket)
        .createSignedUrl(objectKey, 60 * 15, {
          download: body.downloadFileName ? String(body.downloadFileName) : undefined,
        });

      if (error) {
        throw error;
      }

      return json({ ok: true, signedUrl: data.signedUrl });
    }

    if (action === "promoteArchive") {
      const jobId = Number(body.jobId);
      const { data: job, error: jobError } = await service
        .from("file_jobs")
        .select("*")
        .eq("id", jobId)
        .single();

      if (jobError) {
        throw jobError;
      }

      if (!job.artifact_object_key || !job.artifact_bucket) {
        throw new Error("Job has no artifact to promote.");
      }

      const nextKey = `${job.device_id}/${job.id}/${Date.now()}-${job.artifact_object_key
        .split("/")
        .pop()}`;

      const { data: sourceData, error: sourceError } = await service.storage
        .from(job.artifact_bucket)
        .download(job.artifact_object_key);

      if (sourceError) {
        throw sourceError;
      }

      const { error: uploadError } = await service.storage
        .from(ARCHIVE_BUCKET)
        .upload(nextKey, sourceData, {
          upsert: true,
          contentType: sourceData.type || "application/octet-stream",
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: updatedJob, error: updateError } = await service
        .from("file_jobs")
        .update({
          delivery_mode: "persistent",
          artifact_bucket: ARCHIVE_BUCKET,
          artifact_object_key: nextKey,
          artifact_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .select("*")
        .single();

      if (updateError) {
        throw updateError;
      }

      await service.from("file_audit_logs").insert({
        device_id: job.device_id,
        requested_by: user.id,
        job_id: job.id,
        action: "promote_archive",
        target_path: job.source_path,
        details: {
          fromBucket: job.artifact_bucket,
          toBucket: ARCHIVE_BUCKET,
          nextKey,
        },
      });

      return json({ ok: true, job: updatedJob });
    }

    if (action === "setupStatus") {
      const [adminProfiles, fileJobs, fileRoots] = await Promise.all([
        service.from("admin_profiles").select("user_id", { count: "exact", head: true }),
        service.from("file_jobs").select("id", { count: "exact", head: true }),
        service.from("file_roots").select("id", { count: "exact", head: true }),
      ]);

      return json({
        ok: true,
        counts: {
          adminProfiles: adminProfiles.count || 0,
          fileJobs: fileJobs.count || 0,
          fileRoots: fileRoots.count || 0,
        },
      });
    }

    throw new Error(`Unsupported action: ${action}`);
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
});
