// Interactive installer. Single command:
//   npx voipdog-mcp install
// Detects the user's MCP hosts, prompts for API URL + token, writes the
// `voipdog` server entry into each selected host's config file.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const PAT_PREFIX = "voipdog_pat_";

// Named environments. `--testing` selects the testing one. `--api-url=` and
// `--name=` override either field.
const ENVIRONMENTS = {
  production: {
    apiUrl: "https://api.voip.dog/api",
    webUrl: "https://app.voip.dog",
    serverKey: "voipdog",
  },
  testing: {
    apiUrl:
      "https://tools-server-1044181257559.northamerica-northeast2.run.app/api",
    webUrl: "https://tools.liberteks.com",
    serverKey: "voipdog-testing",
  },
};

function parseFlags(argv) {
  let apiUrl = null;
  let serverKey = null;
  let env = "production";
  for (const a of argv) {
    if (a === "--testing") env = "testing";
    else if (a === "--production") env = "production";
    else if (a.startsWith("--api-url=")) apiUrl = a.slice(10).trim();
    else if (a.startsWith("--name=")) serverKey = a.slice(7).trim();
  }
  const preset = ENVIRONMENTS[env];
  return {
    env,
    apiUrl: apiUrl || preset.apiUrl,
    serverKey: serverKey || preset.serverKey,
    apiUrlFromFlag: !!apiUrl,
    serverKeyFromFlag: !!serverKey,
  };
}

// Where to find each host's config file. We don't try to be exhaustive —
// these are the four hosts that cover ~95% of usage. Manual fallback is
// printed at the end.
function hostCandidates() {
  const home = os.homedir();
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";

  const claudeDesktopMac = path.join(
    home,
    "Library/Application Support/Claude/claude_desktop_config.json"
  );
  const claudeDesktopWin = path.join(
    process.env.APPDATA || path.join(home, "AppData/Roaming"),
    "Claude/claude_desktop_config.json"
  );
  const claudeDesktopLinux = path.join(
    home,
    ".config/Claude/claude_desktop_config.json"
  );

  return [
    {
      id: "claude-code",
      label: "Claude Code (CLI)",
      configPath: path.join(home, ".claude.json"),
      mcpKey: "mcpServers",
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      configPath: isMac
        ? claudeDesktopMac
        : isWin
          ? claudeDesktopWin
          : claudeDesktopLinux,
      mcpKey: "mcpServers",
    },
    {
      id: "cursor",
      label: "Cursor",
      configPath: path.join(home, ".cursor/mcp.json"),
      mcpKey: "mcpServers",
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      configPath: path.join(home, ".gemini/settings.json"),
      mcpKey: "mcpServers",
    },
  ];
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function detectHosts() {
  const candidates = hostCandidates();
  const detected = [];
  for (const c of candidates) {
    if (await fileExists(c.configPath)) {
      detected.push({ ...c, exists: true });
    } else {
      detected.push({ ...c, exists: false });
    }
  }
  return detected;
}

async function readJson(p) {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

async function writeJsonAtomic(p, value) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.voipdog.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, p);
}

async function prompt(rl, question, { defaultValue } = {}) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || "";
}

async function verifyToken(baseUrl, token) {
  const res = await fetch(`${baseUrl}/auth/user`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.error || body?.message || res.statusText;
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return body;
}

function deriveWebUrl(apiBaseUrl) {
  // The frontend lives at the same origin as the API for the
  // tools.liberteks.com testing env, and at app.<domain> for production.
  // Either way, drop the trailing /api and route to /settings#api-tokens.
  try {
    const url = new URL(apiBaseUrl);
    if (url.hostname.startsWith("api.")) {
      url.hostname = "app." + url.hostname.slice(4);
    }
    url.pathname = "/settings";
    url.hash = "api-tokens";
    return url.toString();
  } catch {
    return null;
  }
}

function tryOpenBrowser(url) {
  if (!url) return;
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best effort */
  }
}

function serverEntry({ scriptPath, baseUrl, token }) {
  return {
    command: "node",
    args: [scriptPath],
    env: {
      VOIPDOG_API_BASE_URL: baseUrl,
      VOIPDOG_SESSION_TOKEN: token,
    },
  };
}

async function applyToHost(host, serverKey, entry) {
  let config = {};
  if (host.exists) {
    try {
      config = await readJson(host.configPath);
    } catch (err) {
      throw new Error(
        `${host.configPath} is not valid JSON (${err.message}). Fix it manually before running install.`
      );
    }
  }
  if (!config[host.mcpKey] || typeof config[host.mcpKey] !== "object") {
    config[host.mcpKey] = {};
  }
  const existed = !!config[host.mcpKey][serverKey];
  config[host.mcpKey][serverKey] = entry;
  await writeJsonAtomic(host.configPath, config);
  return { existed };
}

export async function runInstall() {
  // Resolve absolute path to the running script — this becomes the `node`
  // arg that hosts will spawn. Works whether installed via npx, globally,
  // or run from a checkout.
  const here = fileURLToPath(import.meta.url);
  const scriptPath = path.resolve(path.dirname(here), "index.js");

  const flags = parseFlags(process.argv.slice(2));
  const baseUrl = flags.apiUrl.replace(/\/+$/, "");
  const serverKey = flags.serverKey;

  output.write("\nVOIP.dog MCP — install\n");
  output.write("──────────────────────\n\n");
  output.write(
    `Environment: ${flags.env}${flags.apiUrlFromFlag || flags.serverKeyFromFlag ? " (overridden)" : ""}\n`
  );
  output.write(`API:         ${baseUrl}\n`);
  output.write(`MCP key:     ${serverKey}\n`);

  const rl = readline.createInterface({ input, output });
  try {
    const webUrl = deriveWebUrl(baseUrl);
    output.write(`\nGenerate an API token in the web app:\n`);
    if (webUrl) {
      output.write(`  ${webUrl}\n`);
      tryOpenBrowser(webUrl);
    } else {
      output.write(`  Settings → API Tokens → Generate token\n`);
    }
    output.write(`(Pick a label like "Claude Code" and a 90-day lifetime.)\n\n`);

    output.write(`(token will be visible — clear scrollback after if needed)\n`);
    const token = await prompt(rl, "Paste your token");
    if (!token) {
      output.write("Aborted: token is required.\n");
      process.exit(1);
    }
    if (!token.startsWith(PAT_PREFIX)) {
      output.write(
        `\n  Heads up: tokens normally start with "${PAT_PREFIX}". Continuing.\n`
      );
    }

    output.write("\nVerifying token… ");
    let verifiedAs = null;
    try {
      const u = await verifyToken(baseUrl, token);
      verifiedAs = u?.user?.email || u?.email || null;
      output.write(verifiedAs ? `ok (${verifiedAs})\n` : "ok\n");
    } catch (err) {
      output.write(`failed (${err.message})\n`);
      const cont = (
        await prompt(rl, "Install anyway? (y/N)", { defaultValue: "n" })
      ).toLowerCase();
      if (cont !== "y" && cont !== "yes") {
        output.write("Aborted.\n");
        process.exit(1);
      }
    }

    const hosts = await detectHosts();
    const present = hosts.filter((h) => h.exists);
    output.write("\nDetected MCP hosts:\n");
    for (const h of hosts) {
      output.write(
        `  [${h.exists ? "✓" : " "}] ${h.label.padEnd(22)} ${h.configPath}\n`
      );
    }
    output.write("\n");

    const targets = [];
    if (present.length === 0) {
      output.write(
        "No host configs found. Pick one to create (or press enter to skip).\n"
      );
      const opts = hosts.map(
        (h, i) => `  ${i + 1}. ${h.label} (${h.configPath})`
      );
      output.write(opts.join("\n") + "\n");
      const pick = (await prompt(rl, "Choice (1-4 or empty)")).trim();
      if (pick) {
        const idx = Number.parseInt(pick, 10) - 1;
        if (Number.isInteger(idx) && hosts[idx]) targets.push(hosts[idx]);
      }
    } else {
      for (const h of present) {
        const ans = (
          await prompt(rl, `Install into ${h.label}? (Y/n)`, {
            defaultValue: "y",
          })
        ).toLowerCase();
        if (ans === "" || ans === "y" || ans === "yes") targets.push(h);
      }
    }

    if (targets.length === 0) {
      output.write(
        "\nNothing to write. You can edit a host config manually with this entry:\n\n"
      );
      output.write(JSON.stringify(serverEntry({ scriptPath, baseUrl, token: "<your token>" }), null, 2));
      output.write("\n");
      return;
    }

    const entry = serverEntry({ scriptPath, baseUrl, token });
    output.write("\n");
    for (const host of targets) {
      try {
        const { existed } = await applyToHost(host, serverKey, entry);
        output.write(
          `${existed ? "Updated" : "Added"} ${host.label}: ${host.configPath}\n`
        );
      } catch (err) {
        output.write(`Failed ${host.label}: ${err.message}\n`);
      }
    }

    output.write("\nDone. Restart your MCP host to pick up the new server.\n");
    output.write(
      "Tip: revoke tokens any time at Settings → API Tokens in the web app.\n"
    );
  } finally {
    rl.close();
  }
}

export function printHelp() {
  output.write(`voipdog-mcp — MCP server for the VOIP.dog backend\n\n`);
  output.write(`Usage:\n`);
  output.write(`  npx voipdog-mcp install                  Install into MCP host (production)\n`);
  output.write(`  npx voipdog-mcp install --testing        Install pointing at testing env\n`);
  output.write(`  npx voipdog-mcp install --api-url=URL    Custom API URL\n`);
  output.write(`  npx voipdog-mcp install --name=NAME      Custom MCP server key\n`);
  output.write(`  npx voipdog-mcp                          Run MCP over stdio (used by hosts)\n`);
  output.write(`  npx voipdog-mcp --http                   Run MCP over Streamable HTTP\n`);
  output.write(`  npx voipdog-mcp help                     Print this message\n\n`);
  output.write(`Environments:\n`);
  for (const [name, env] of Object.entries(ENVIRONMENTS)) {
    output.write(`  ${name.padEnd(12)} ${env.apiUrl} (key: ${env.serverKey})\n`);
  }
  output.write(`\nGenerate API tokens in the web app: Settings → API Tokens.\n`);
}
