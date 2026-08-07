const ROUTES = {
  "/opencode": "https://opencode.ai/zen/go",
  "/openai": "https://api.openai.com",
  "/anthropic": "https://api.anthropic.com",
};

function matchRoute(pathname) {
  for (const prefix of Object.keys(ROUTES)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { prefix, host: ROUTES[prefix] };
    }
  }
  return null;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-api-key, anthropic-version, content-type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const route = matchRoute(url.pathname);
    if (!route) {
      return new Response(JSON.stringify({ error: { message: "Unknown route" } }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const upstreamPath = url.pathname.slice(route.prefix.length);
    const upstreamUrl = `${route.host}${upstreamPath}${url.search}`;

    const forwardedHeaders = new Headers();
    for (const [key, value] of request.headers) {
      if (["authorization", "x-api-key", "anthropic-version", "content-type"].includes(key.toLowerCase())) {
        forwardedHeaders.set(key, value);
      }
    }

    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: forwardedHeaders,
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
