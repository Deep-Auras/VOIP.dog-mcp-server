import { createAuthManager } from "./auth.js";

export class ApiError extends Error {
  constructor(status, body, url) {
    const detail =
      typeof body === "string"
        ? body
        : body?.error || body?.message || JSON.stringify(body);
    super(`HTTP ${status} ${url} — ${detail}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export function createApiClient(config, log) {
  const auth = createAuthManager(config, log);

  async function request(path, { method = "GET", query, body, accept } = {}) {
    const url = buildUrl(config.baseUrl, path, query);
    const attempt = async (refreshOnAuth) => {
      const token = await auth.getToken();
      const headers = {
        authorization: `Bearer ${token}`,
        accept: accept || "application/json",
      };
      if (config.organizationId) {
        headers["x-organization-id"] = config.organizationId;
      }
      if (body !== undefined) {
        headers["content-type"] = "application/json";
      }

      log("→ %s %s", method, url);
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      // 401 → refresh once, then retry
      if (res.status === 401 && refreshOnAuth) {
        log("auth: 401 received, refreshing session token");
        auth.invalidate();
        await auth.getToken({ forceRefresh: true });
        return attempt(false);
      }

      const ct = res.headers.get("content-type") || "";
      const isJson = ct.includes("application/json");
      const isText = ct.startsWith("text/");
      const payload = isJson
        ? await res.json().catch(() => ({}))
        : isText
          ? await res.text()
          : await res.arrayBuffer();

      if (!res.ok) throw new ApiError(res.status, payload, url);
      return payload;
    };

    return attempt(true);
  }

  return {
    get: (path, opts) => request(path, { ...opts, method: "GET" }),
    post: (path, body, opts) =>
      request(path, { ...opts, method: "POST", body }),
    put: (path, body, opts) => request(path, { ...opts, method: "PUT", body }),
    del: (path, opts) => request(path, { ...opts, method: "DELETE" }),
    request,
  };
}

function buildUrl(baseUrl, path, query) {
  const url = new URL(
    path.startsWith("/") ? baseUrl + path : `${baseUrl}/${path}`
  );
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}
