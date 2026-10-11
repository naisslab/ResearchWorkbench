// Isolated stdio MCP server used by the real bundled Codex runtime in tests.
const readline = require("node:readline");
const send = (value) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
let pending;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize")
    send({
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "native-fixture", version: "1" },
      },
    });
  else if (message.method === "tools/list")
    send({
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Return the user's approved label",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        ],
      },
    });
  else if (message.method === "tools/call") {
    pending = message.id;
    send({
      id: "ask-label",
      method: "elicitation/create",
      params: {
        mode: "form",
        message: "Choose the fixture label",
        requestedSchema: {
          type: "object",
          properties: { label: { type: "string" } },
          required: ["label"],
        },
      },
    });
  } else if (message.id === "ask-label")
    send({
      id: pending,
      result: {
        content: [{ type: "text", text: JSON.stringify(message.result) }],
      },
    });
  else if (message.id !== undefined) send({ id: message.id, result: {} });
});
