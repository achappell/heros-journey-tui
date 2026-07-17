const UPSTREAM = "https://opencode.ai/zen/go";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const upstreamUrl = `${UPSTREAM}${url.pathname}${url.search}`;
    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: {
        "Authorization": request.headers.get("Authorization") || "",
        "Content-Type": request.headers.get("Content-Type") || "application/json",
      },
      body: request.method === "GET" ? undefined : await request.text(),
    });

    const upstreamResponse = await fetch(upstreamRequest);
    const responseBody = await upstreamResponse.text();

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("Content-Type") || "application/json",
        ...corsHeaders,
      },
    });
  },
};
