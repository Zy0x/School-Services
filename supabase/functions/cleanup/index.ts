import { corsHeaders, json } from "../_shared/cors.ts";
import { requireSuperAdmin } from "../_shared/admin.ts";

const TEMP_BUCKETS = ["agent-temp-artifacts", "agent-preview-cache"];
const TEMP_RETENTION_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { service } = await requireSuperAdmin(request);
    const { data: authPolicy } = await service
      .from("app_settings")
      .select("value")
      .eq("key", "auth_policy")
      .maybeSingle();
    const autoApproveEnabled = authPolicy?.value?.autoApproveEnabled !== false;
    let approvedAccounts = 0;

    if (autoApproveEnabled) {
      const { data: approvalResult, error: approvalError } = await service.rpc(
        "process_account_maintenance"
      );
      if (approvalError) {
        throw approvalError;
      }
      approvedAccounts = Number(approvalResult?.approvedCount || 0);
    }

    const cutoffIso = new Date(Date.now() - TEMP_RETENTION_MS).toISOString();

    const { data: expiredJobs, error: jobsError } = await service
      .from("file_jobs")
      .select("*")
      .or(`status.eq.completed,status.eq.failed,status.eq.cancelled,status.eq.expired`)
      .lt("updated_at", cutoffIso)
      .limit(200);

    if (jobsError) {
      throw jobsError;
    }

    const removedArtifacts: string[] = [];

    for (const job of expiredJobs || []) {
      if (
        job.artifact_bucket &&
        job.artifact_object_key &&
        TEMP_BUCKETS.includes(job.artifact_bucket)
      ) {
        await service.storage
          .from(job.artifact_bucket)
          .remove([job.artifact_object_key]);
        removedArtifacts.push(`${job.artifact_bucket}:${job.artifact_object_key}`);
      }

      await service
        .from("file_jobs")
        .update({
          status: "expired",
          artifact_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }

    return json({
      ok: true,
      approvedAccounts,
      processedJobs: expiredJobs?.length || 0,
      removedArtifacts,
    });
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
