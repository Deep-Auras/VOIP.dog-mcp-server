// Session-token manager. Tokens are issued by POST /api/auth/signin and live
// 7 days. We refresh proactively at the 6-day mark when email/password is
// available; otherwise we use the static token from env.

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

export function createAuthManager(config, log) {
  let token = config.sessionToken || null;
  let issuedAt = token ? Date.now() : 0;

  async function signIn() {
    if (!config.email || !config.password) {
      throw new Error(
        "Session token missing/expired and no VOIPDOG_EMAIL/VOIPDOG_PASSWORD set for auto-signin."
      );
    }

    const url = `${config.baseUrl}/auth/signin`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: config.email, password: config.password }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body?.error || body?.message || res.statusText;
      throw new Error(`Sign-in failed (${res.status}): ${detail}`);
    }
    if (!body.sessionToken) {
      throw new Error("Sign-in succeeded but no sessionToken in response.");
    }
    token = body.sessionToken;
    issuedAt = Date.now();
    log("auth: signed in as %s", config.email);
    return token;
  }

  async function getToken({ forceRefresh = false } = {}) {
    const stale = token && Date.now() - issuedAt > SIX_DAYS_MS;
    if (forceRefresh || !token || stale) {
      if (config.email && config.password) {
        await signIn();
      } else if (!token) {
        throw new Error(
          "No session token available. Provide VOIPDOG_SESSION_TOKEN or VOIPDOG_EMAIL/VOIPDOG_PASSWORD."
        );
      }
    }
    return token;
  }

  function invalidate() {
    token = null;
    issuedAt = 0;
  }

  return { getToken, invalidate };
}
