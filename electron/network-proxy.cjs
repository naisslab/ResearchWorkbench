async function systemProxy(url) {
  // Resolve lazily: Electron's session is available after app.whenReady().
  const { session } = require("electron");
  return session ? session.defaultSession.resolveProxy(url) : "DIRECT";
}

async function proxyEnvironment(url, env, resolveProxy = systemProxy) {
  let protocol;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return {};
  }
  if (!["http:", "https:"].includes(protocol)) return {};
  const key = protocol.slice(0, -1) + "_proxy";
  // Explicit command-line proxy settings take precedence over the system route.
  if (env.all_proxy || env.ALL_PROXY || env[key] || env[key.toUpperCase()])
    return {};
  const route = await resolveProxy(url).catch(() => undefined);
  const first = route?.split(";")[0].trim();
  const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS5)\s+(\S+)$/i.exec(first || "");
  if (!match) return {};
  const scheme = {
    PROXY: "http",
    HTTP: "http",
    HTTPS: "https",
    SOCKS: "socks5h",
    SOCKS5: "socks5h",
  }[match[1].toUpperCase()];
  return { [key]: scheme + "://" + match[2] };
}

module.exports = { proxyEnvironment, systemProxy };
