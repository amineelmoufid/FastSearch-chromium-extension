/**
 * FastSearch Extension - Cloudflare Sync Worker
 * 
 * Instructions:
 * 1. Go to Cloudflare Dashboard -> Workers & Pages -> Create Worker.
 * 2. Paste this code into the worker editor.
 * 3. Create a KV Namespace named `FASTSEARCH_KV` and bind it to this worker with variable name `FASTSEARCH_KV`.
 * 4. (Optional) Set an environment variable secret named `SECRET_KEY` for auth protection.
 * 5. Deploy and copy your worker URL (e.g. https://fastsearch-sync.yoursubdomain.workers.dev).
 */

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "application/json"
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Optional Secret Authorization Check
    if (env.SECRET_KEY) {
      const authHeader = request.headers.get("Authorization");
      const expectedAuth = `Bearer ${env.SECRET_KEY}`;
      if (!authHeader || authHeader !== expectedAuth) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Invalid or missing secret key" }),
          { status: 401, headers: corsHeaders }
        );
      }
    }

    const kvKey = "search_engines_data";

    if (request.method === "GET") {
      try {
        const dataStr = await env.FASTSEARCH_KV.get(kvKey);
        if (!dataStr) {
          return new Response(
            JSON.stringify({ engines: [], updatedAt: 0 }),
            { status: 200, headers: corsHeaders }
          );
        }
        return new Response(dataStr, { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Failed to read from KV: " + err.message }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    if (request.method === "POST" || request.method === "PUT") {
      try {
        const body = await request.json();
        if (!body || !Array.isArray(body.engines)) {
          return new Response(
            JSON.stringify({ error: "Invalid payload format. Expected { engines: [], updatedAt: number }" }),
            { status: 400, headers: corsHeaders }
          );
        }

        const payload = {
          engines: body.engines,
          updatedAt: body.updatedAt || Date.now()
        };

        await env.FASTSEARCH_KV.put(kvKey, JSON.stringify(payload));

        return new Response(
          JSON.stringify({ success: true, updatedAt: payload.updatedAt }),
          { status: 200, headers: corsHeaders }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Failed to write to KV: " + err.message }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: corsHeaders }
    );
  }
};
