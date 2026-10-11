const { AIError } = require("./chatgpt.cjs");

function serverConfig({ name, url, command, args = [] }) {
  if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(name))
    throw new AIError(
      "invalid_server",
      "Use a connection name with letters, numbers, underscores, or hyphens.",
    );
  if (url && !command) {
    let endpoint;
    try {
      endpoint = new URL(url);
    } catch {
      /* Validated below. */
    }
    if (
      !endpoint ||
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    )
      throw new AIError(
        "invalid_server",
        "Enter an HTTP or HTTPS MCP endpoint without embedded credentials.",
      );
    return {
      name,
      config: { url: endpoint.href, omit_tools_from: ["deferred"] },
    };
  }
  if (
    url ||
    typeof command !== "string" ||
    !command.trim() ||
    command.length > 4096 ||
    !Array.isArray(args) ||
    args.length > 100 ||
    args.some((arg) => typeof arg !== "string" || arg.length > 8192)
  )
    throw new AIError(
      "invalid_server",
      "Enter a local server command and its argument list.",
    );
  return {
    name,
    config: { command: command.trim(), args, omit_tools_from: ["deferred"] },
  };
}

// Native MCP form requests contain primitive fields. Unsupported schemas stay
// pending for decline rather than silently approving incomplete information.
function validateElicitation(schema, content) {
  const fail = () => {
    throw new AIError(
      "invalid_answer",
      "Complete the connection's requested fields before continuing.",
    );
  };
  if (
    schema?.type !== "object" ||
    !schema.properties ||
    !content ||
    typeof content !== "object" ||
    Array.isArray(content) ||
    JSON.stringify(content).length > 32000
  )
    fail();
  if (
    Object.keys(content).some(
      (key) => !Object.hasOwn(schema.properties, key),
    ) ||
    (schema.required || []).some((key) => content[key] === undefined)
  )
    fail();
  for (const [key, value] of Object.entries(content)) {
    const field = schema.properties[key];
    if (
      !field ||
      !["string", "number", "integer", "boolean", "array"].includes(field.type)
    )
      fail();
    if (field.type === "array") {
      const options =
        field.items?.enum || field.items?.anyOf?.map((option) => option.const);
      if (
        !Array.isArray(value) ||
        !options ||
        value.some((item) => !options.includes(item)) ||
        new Set(value).size !== value.length ||
        value.length < (field.minItems ?? 0) ||
        value.length > (field.maxItems ?? Infinity)
      )
        fail();
    } else if (
      field.type === "integer"
        ? !Number.isInteger(value)
        : typeof value !== field.type
    )
      fail();
    const options = field.enum || field.oneOf?.map((option) => option.const);
    if (options && !options.includes(value)) fail();
    if (
      typeof value === "string" &&
      (value.length < (field.minLength ?? 0) ||
        value.length > (field.maxLength ?? 32000))
    )
      fail();
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        value < (field.minimum ?? -Infinity) ||
        value > (field.maximum ?? Infinity))
    )
      fail();
  }
}

module.exports = { serverConfig, validateElicitation };
