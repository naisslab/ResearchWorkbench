const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const environment = require("./environment.cjs");
const { proxyEnvironment } = require("./network-proxy.cjs");

function parseOverleafUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter an Overleaf project URL or Git URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTPS Overleaf URL without credentials, query parameters, or fragments.",
    );
  const web = ["overleaf.com", "www.overleaf.com"].includes(url.hostname);
  if (
    (!web && url.hostname !== "git.overleaf.com") ||
    (url.username && (web || url.username !== "git"))
  )
    throw new Error(
      "Use an overleaf.com project URL or git.overleaf.com repository URL. Keep tokens out of URLs.",
    );
  const match = (
    web ? /^\/project\/([a-f\d]{24})\/?$/i : /^\/([a-f\d]{24})(?:\.git)?\/?$/i
  ).exec(url.pathname);
  if (!match) throw new Error("The URL must identify one Overleaf project.");
  const projectId = match[1].toLowerCase();
  return {
    overleafProjectId: projectId,
    projectUrl: `https://www.overleaf.com/project/${projectId}`,
    gitUrl: `https://git.overleaf.com/${projectId}`,
  };
}

async function writePrivate(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, value, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function createTokenStore(directory, encryption) {
  const available = () =>
    !!encryption?.isEncryptionAvailable?.() &&
    encryption.getSelectedStorageBackend?.() !== "basic_text";
  function file(reference) {
    if (!/^[a-f\d-]{36}$/.test(reference || ""))
      throw new Error("Invalid credential reference.");
    return path.join(directory, `${reference}.bin`);
  }
  return {
    available,
    async put(token) {
      if (!available())
        throw new Error(
          "Secure operating-system credential storage is unavailable. Unlock the keychain before connecting Overleaf.",
        );
      if (
        typeof token !== "string" ||
        !token.trim() ||
        /[\r\n\0]/.test(token) ||
        token.length > 4096
      )
        throw new Error("Enter a valid Overleaf access token.");
      const reference = crypto.randomUUID();
      await writePrivate(
        file(reference),
        encryption.encryptString(token.trim()),
      );
      return reference;
    },
    async get(reference) {
      if (!available())
        throw new Error(
          "Unlock secure credential storage before contacting Overleaf.",
        );
      try {
        return encryption.decryptString(await fs.readFile(file(reference)));
      } catch {
        throw new Error(
          "The saved Overleaf credential is unavailable. Reconnect with an access token.",
        );
      }
    },
    async remove(reference) {
      if (reference) await fs.rm(file(reference), { force: true });
    },
  };
}

// Secrets are supplied only through child-process environment configuration.
// They never appear in URLs, argv, repository config, journal records, or errors.
async function withOverleafCredential(
  git,
  folder,
  args,
  connection,
  token,
  options = {},
) {
  const { gitUrl } = parseOverleafUrl(connection.gitUrl);
  const authorization = `Authorization: Basic ${Buffer.from(`git:${token}`).toString("base64")}`;
  const { resolveProxy, ...commandOptions } = options;
  const env = {
    ...(await proxyEnvironment(gitUrl, environment, resolveProxy)),
  };
  for (const key of Object.keys(process.env)) {
    if (/^(GIT_TRACE|GIT_CURL|GIT_CONFIG_|GIT_ASKPASS|SSH_ASKPASS)/.test(key))
      env[key] = "";
  }
  Object.assign(env, {
    GIT_TRACE: "0",
    GIT_TRACE_CURL: "0",
    GIT_CURL_VERBOSE: "0",
    GIT_TRACE_PACKET: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${gitUrl}.extraHeader`,
    GIT_CONFIG_VALUE_0: authorization,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
  });
  try {
    return await git.run(
      folder,
      args,
      [
        "-c",
        "credential.helper=",
        "-c",
        "http.extraHeader=",
        "-c",
        "http.followRedirects=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.file.allow=never",
        "-c",
        "protocol.ext.allow=never",
      ],
      env,
      commandOptions,
    );
  } catch (error) {
    const raw = String(error.message || error);
    const clean = raw
      .split(token)
      .join("[redacted]")
      .split(authorization)
      .join("[redacted]")
      .split(Buffer.from(`git:${token}`).toString("base64"))
      .join("[redacted]");
    throw new Error(clean);
  }
}

module.exports = {
  parseOverleafUrl,
  createTokenStore,
  withOverleafCredential,
  writePrivate,
};
