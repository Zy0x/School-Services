import { corsHeaders } from "../_shared/cors.ts";
import { handleAdminOpsRequest } from "./handler.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return handleAdminOpsRequest(request);
});
