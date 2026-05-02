import "dotenv/config";

function required(name, value) {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

function trimTrailingSlash(s) {
  return s.replace(/\/+$/, "");
}

export function loadConfig() {
  const baseUrl = trimTrailingSlash(
    required("VOIPDOG_API_BASE_URL", process.env.VOIPDOG_API_BASE_URL)
  );

  const sessionToken = process.env.VOIPDOG_SESSION_TOKEN?.trim() || null;
  const email = process.env.VOIPDOG_EMAIL?.trim() || null;
  const password = process.env.VOIPDOG_PASSWORD || null;

  if (!sessionToken && !(email && password)) {
    throw new Error(
      "Authentication required: set VOIPDOG_SESSION_TOKEN, or both VOIPDOG_EMAIL and VOIPDOG_PASSWORD."
    );
  }

  return {
    baseUrl,
    sessionToken,
    email,
    password,
    organizationId: process.env.VOIPDOG_ORGANIZATION_ID?.trim() || null,
    debug:
      process.env.VOIPDOG_MCP_DEBUG === "1" ||
      process.env.VOIPDOG_MCP_DEBUG === "true",
    http: {
      port: Number.parseInt(process.env.MCP_HTTP_PORT || "8765", 10),
      host: process.env.MCP_HTTP_HOST || "127.0.0.1",
    },
  };
}
