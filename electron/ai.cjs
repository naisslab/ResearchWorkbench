const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  createChatGPT,
  AIError,
  publicError,
  apiError,
  protectedWrite,
  remote,
  jsonResponse,
  RESOURCE,
  USAGE_URL,
} = require("./chatgpt.cjs");
const { createCodexAgent, codexExecutable } = require("./codex-agent.cjs");

function createAI({
  directory,
  encryption,
  openBrowser,
  project,
  validateContext,
  scope,
  environment,
  skillRoots = [],
  agentFactory = createCodexAgent,
  fetcher = fetch,
  emit = () => {},
}) {
  let models = [],
    modelProfileId = null;
  let modelError;
  let usage = {};
  let loadedUsage;
  let usageQueue = Promise.resolve();
  let accountQueue = Promise.resolve();
  let skillAgent;
  const conversations = new Map(),
    running = new Map(),
    writes = new Map(),
    agents = new Map();
  const auth = createChatGPT({
    directory,
    encryption,
    openBrowser,
    fetcher,
    onChange: () => {
      void publishState();
    },
  });
  const key = (profileId, projectId) =>
    crypto
      .createHash("sha256")
      .update(JSON.stringify([profileId, projectId]))
      .digest("hex");
  const blankUsage = () => ({
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    unreportedRequests: 0,
  });
  async function loadUsage() {
    if (!loadedUsage)
      loadedUsage = (async () => {
        try {
          usage = JSON.parse(
            await fs.readFile(path.join(directory, "ai-usage.json"), "utf8"),
          );
        } catch (error) {
          if (error.code !== "ENOENT")
            throw new AIError(
              "usage_storage_error",
              "Saved token statistics could not be read. Their data has been preserved.",
            );
        }
      })().catch((error) => {
        loadedUsage = undefined;
        throw error;
      });
    await loadedUsage;
  }
  async function getState() {
    const session = await auth.getSession();
    try {
      await loadUsage();
    } catch (error) {
      session.error ||= publicError(error);
    }
    return {
      ...session,
      models:
        modelProfileId === session.activeProfileId && session.sharing
          ? models
          : [],
      modelError:
        modelProfileId === session.activeProfileId ? modelError : undefined,
      usage: usage[session.activeProfileId] || blankUsage(),
      runtime: (() => {
        try {
          codexExecutable();
          return { available: true, version: "0.160.0" };
        } catch (error) {
          return { available: false, error: publicError(error) };
        }
      })(),
    };
  }
  async function publishState() {
    emit("state", await getState());
  }
  function queuedAccount(operation) {
    accountQueue = accountQueue.catch(() => {}).then(operation);
    return accountQueue;
  }
  async function stopAll() {
    await Promise.all(
      [...running.values()].map(async (job) => {
        job.controller.abort();
        await job.done;
      }),
    );
  }
  async function closeAgents() {
    await Promise.allSettled(
      [...agents.values()].map((entry) => entry.agent.close()),
    );
    agents.clear();
  }
  async function availableSkills(projectId, rootId, forceReload = false) {
    project(projectId);
    const { cwd } = await scope(projectId, rootId);
    if (!skillAgent || skillAgent.isClosed())
      skillAgent = agentFactory({
        accessToken: "",
        home: path.join(directory, "codex", "skill-catalog"),
        environment,
        skillRoots,
      });
    const result = await skillAgent.listSkills(cwd, forceReload);
    const entry = result.data?.find((entry) => entry.cwd === cwd);
    return {
      skills: (entry?.skills || []).map((skill) => ({
        ...skill,
        id: crypto.createHash("sha256").update(skill.path).digest("hex"),
        displayName: skill.interface?.displayName || skill.name,
      })),
      errors: entry?.errors || [],
    };
  }
  const publicSkills = ({ skills, errors }) => ({
    skills: skills.map(
      ({ id, name, description, displayName, scope, enabled }) => ({
        id,
        name,
        description,
        displayName,
        scope,
        enabled,
      }),
    ),
    warnings: errors.length,
  });
  async function refreshModels() {
    const session = await auth.getSession();
    const profileId = session.activeProfileId;
    try {
      const token = await auth.accessToken(profileId);
      const response = await remote(fetcher, `${RESOURCE}/models`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      const body = await jsonResponse(response, "ChatGPT model discovery");
      if (!response.ok)
        throw apiError(
          body,
          response.status,
          response.headers.get("x-request-id"),
        );
      if (!Array.isArray(body?.models))
        throw new AIError(
          "invalid_model_catalog",
          "ChatGPT returned an unexpected model catalog. Refresh models to try again.",
        );
      const next = [];
      for (const model of body.models) {
        if (model?.visibility !== "list") continue;
        if (
          typeof model.slug !== "string" ||
          !model.slug.trim() ||
          model.slug.length > 200 ||
          typeof model.display_name !== "string" ||
          !model.display_name.trim() ||
          model.display_name.length > 200
        )
          throw new AIError(
            "invalid_model_catalog",
            "ChatGPT returned an incomplete model listing. Try again.",
          );
        next.push({ slug: model.slug, displayName: model.display_name });
      }
      if ((await auth.getSession()).activeProfileId !== profileId)
        return getState();
      models = next;
      modelProfileId = profileId;
      modelError = undefined;
    } catch (error) {
      if ((await auth.getSession()).activeProfileId === profileId) {
        models = [];
        modelProfileId = profileId;
        modelError = publicError(error);
      }
    }
    const state = await getState();
    emit("state", state);
    return state;
  }
  async function conversation(projectId) {
    project(projectId);
    const { activeProfileId } = await auth.getSession();
    if (!activeProfileId) return { projectId, profileId: null, messages: [] };
    const id = key(activeProfileId, projectId);
    if (!conversations.has(id)) {
      let value = { projectId, profileId: activeProfileId, messages: [] };
      try {
        const data = JSON.parse(
          await fs.readFile(
            path.join(directory, "conversations", `${id}.json`),
            "utf8",
          ),
        );
        if (
          !Array.isArray(data.messages) ||
          data.projectId !== projectId ||
          data.profileId !== activeProfileId
        )
          throw new Error("Invalid history");
        value = data;
        for (const m of value.messages)
          if (m.status === "running") {
            m.status = "interrupted";
            m.approvals = [];
            m.error = {
              code: "app_closed",
              message:
                "Generation stopped when the app closed. Partial text was preserved.",
            };
          }
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new AIError(
            "history_storage_error",
            "This project's AI history could not be read. Its data has been preserved.",
          );
      }
      conversations.set(id, value);
    }
    return conversations.get(id);
  }
  function publicConversation(value) {
    const finalizing = running.has(key(value.profileId, value.projectId));
    return {
      ...value,
      messages: value.messages.map(({ inputText, skills, ...rest }, index) => {
        const message = {
          ...rest,
          skills: skills?.map(({ name, displayName }) => ({
            name,
            displayName,
          })),
        };
        return finalizing &&
          index === value.messages.length - 1 &&
          message.role === "assistant"
          ? { ...message, status: "running" }
          : message;
      }),
    };
  }
  async function saveConversation(value) {
    const id = key(value.profileId, value.projectId);
    const contents = JSON.stringify(value);
    const next = (writes.get(id) || Promise.resolve())
      .catch(() => {})
      .then(() =>
        protectedWrite(
          path.join(directory, "conversations", `${id}.json`),
          contents,
        ),
      );
    writes.set(id, next);
    await next;
  }
  function publishConversation(value) {
    emit("conversation", publicConversation(value));
  }
  async function send({
    projectId,
    message,
    model,
    context,
    rootId,
    skillIds = [],
  }) {
    const session = await auth.getSession();
    if (session.status === "connecting")
      throw new AIError(
        "sign_in_running",
        "Finish ChatGPT sign-in before sending a message.",
      );
    if (!session.sharing)
      throw new AIError(
        "plan_usage_disabled",
        "Connect ChatGPT and enable ChatGPT plan usage to send a message.",
      );
    if (
      typeof message !== "string" ||
      !message.trim() ||
      Buffer.byteLength(message) > 32000
    )
      throw new AIError("invalid_message", "Write a message of up to 32 KB.");
    if (
      modelProfileId !== session.activeProfileId ||
      !models.some((m) => m.slug === model)
    )
      throw new AIError(
        "invalid_model",
        "Refresh models and choose one available to your account.",
      );
    const p = project(projectId);
    const projectScope = await scope(projectId, rootId);
    const value = await conversation(projectId);
    const id = key(value.profileId, projectId);
    if (value.agentCwd && value.agentCwd !== projectScope.cwd)
      throw new AIError(
        "agent_folder_changed",
        "Start a new chat before switching the agent folder.",
      );
    if (running.has(id))
      throw new AIError(
        "request_running",
        "A response is already running for this project.",
      );
    if (
      !Array.isArray(skillIds) ||
      skillIds.length > 8 ||
      skillIds.some(
        (id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id),
      ) ||
      new Set(skillIds).size !== skillIds.length
    )
      throw new AIError(
        "invalid_skills",
        "Select up to eight available skills.",
      );
    let skills = [];
    if (skillIds.length) {
      const catalog = await availableSkills(projectId, rootId, true);
      skills = skillIds.map((id) => {
        const skill = catalog.skills.find(
          (skill) => skill.id === id && skill.enabled,
        );
        if (!skill)
          throw new AIError(
            "skill_unavailable",
            "A selected skill is no longer available. Refresh Skills and select it again.",
          );
        return skill;
      });
    }
    let attachment;
    if (context) {
      await validateContext(projectId, context);
      attachment = { name: context.file, kind: context.kind };
    }
    const projectContext = `Project: ${p.name}\nResearch question: ${p.summary || ""}\nStage: ${p.stage}\nTarget venue: ${p.venue || ""}`;
    const inputText = `${projectContext}\n\n${context ? `Attached ${context.kind}: ${context.file}\n<attached_text>\n${context.text}\n</attached_text>\n\n` : ""}${message.trim()}`;
    const requestId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      role: "user",
      text: message.trim(),
      inputText,
      attachments: attachment ? [attachment] : [],
      skills: skills.map(({ name, displayName, path }) => ({
        name,
        displayName,
        path,
      })),
      createdAt,
      status: "completed",
    };
    const assistant = {
      id: requestId,
      role: "assistant",
      text: "",
      model,
      createdAt,
      status: "running",
      activities: [],
      approvals: [],
      skills: skills.map(({ name, displayName }) => ({ name, displayName })),
    };
    const controller = new AbortController();
    if (running.has(id))
      throw new AIError(
        "request_running",
        "A response is already running for this project.",
      );
    value.agentRootId = rootId || "primary";
    const job = { controller, projectId, done: undefined };
    running.set(id, job);
    value.messages.push(user, assistant);
    try {
      await saveConversation(value);
    } catch (error) {
      value.messages.splice(-2);
      running.delete(id);
      throw error;
    }
    publishConversation(value);
    job.done = generate(
      value,
      assistant,
      model,
      projectScope,
      controller.signal,
    ).finally(() => {
      if (running.get(id) === job) running.delete(id);
    });
    return publicConversation(value);
  }
  async function generate(value, assistant, model, projectScope, signal) {
    const id = key(value.profileId, value.projectId);
    const textItems = new Map();
    let lastCheckpoint = Date.now();
    let totalUsage;
    let turnFinished = false;
    function updated() {
      publishConversation(value);
      if (Date.now() - lastCheckpoint > 1000) {
        lastCheckpoint = Date.now();
        void saveConversation(value).catch(() => {});
      }
    }
    const safeText = (text, max = 100000) =>
      typeof text === "string" ? text.slice(0, max) : "";
    function onEvent(event) {
      if (event.type === "approval") {
        assistant.approvals.push(event.approval);
        updated();
        return;
      }
      if (event.type === "approvalResolved") {
        assistant.approvals = assistant.approvals.filter(
          (a) => a.id !== event.id,
        );
        updated();
        return;
      }
      const { method, params } = event;
      if (method === "item/agentMessage/delta") {
        const previous = textItems.get(params.itemId);
        const separator =
          previous === undefined && textItems.size ? "\n\n" : "";
        textItems.set(params.itemId, (previous || "") + (params.delta || ""));
        assistant.text = [...textItems.values()].join("\n\n");
        emit("delta", {
          projectId: value.projectId,
          profileId: value.profileId,
          requestId: assistant.id,
          delta: separator + (params.delta || ""),
        });
        if (Date.now() - lastCheckpoint > 1000) {
          lastCheckpoint = Date.now();
          void saveConversation(value).catch(() => {});
        }
      } else if (method === "item/started" || method === "item/completed") {
        const item = params.item;
        if (item?.type === "agentMessage") {
          if (typeof item.text === "string" && item.text) {
            textItems.set(item.id, item.text);
            assistant.text = [...textItems.values()].join("\n\n");
            updated();
          }
        } else if (
          [
            "commandExecution",
            "fileChange",
            "mcpToolCall",
            "webSearch",
            "plan",
          ].includes(item?.type)
        ) {
          let activity = assistant.activities.find((a) => a.id === item.id);
          if (!activity) {
            activity = { id: item.id, type: item.type };
            assistant.activities.push(activity);
          }
          Object.assign(activity, {
            status:
              item.status ||
              (method === "item/completed" ? "completed" : "inProgress"),
            command: safeText(item.command, 10000),
            cwd: safeText(item.cwd, 4000),
            output:
              item.aggregatedOutput !== undefined
                ? safeText(item.aggregatedOutput)
                : activity.output || "",
            exitCode: item.exitCode,
            text: safeText(item.text, 20000),
            changes: item.changes?.map((c) => ({
              path: safeText(c.path, 4000),
              kind: c.kind,
              diff: safeText(c.diff),
            })),
          });
          updated();
        }
      } else if (method === "item/commandExecution/outputDelta") {
        const activity = assistant.activities.find(
          (a) => a.id === params.itemId,
        );
        if (activity) {
          activity.output = safeText((activity.output || "") + params.delta);
          updated();
        }
      } else if (method === "turn/diff/updated") {
        assistant.diff = safeText(params.diff, 250000);
        updated();
      } else if (method === "turn/plan/updated") {
        assistant.plan = params.plan;
        updated();
      } else if (method === "thread/tokenUsage/updated") {
        totalUsage = params.tokenUsage?.total;
      }
    }
    try {
      signal.throwIfAborted();
      const token = await auth.accessToken(value.profileId);
      signal.throwIfAborted();
      let entry = agents.get(id);
      if (!entry || entry.token !== token || entry.agent.isClosed()) {
        entry?.agent.close();
        entry = {
          token,
          agent: agentFactory({
            accessToken: token,
            home: path.join(directory, "codex", value.profileId),
            environment,
            skillRoots,
          }),
        };
        agents.set(id, entry);
      }
      value.agentCwd = projectScope.cwd;
      const turn = await entry.agent.run({
        savedThreadId: value.threadId,
        model,
        ...projectScope,
        text: value.messages.at(-2).inputText,
        skills: value.messages.at(-2).skills || [],
        signal,
        onThread: async (threadId) => {
          value.threadId = threadId;
          await saveConversation(value);
        },
        onEvent,
      });
      turnFinished = true;
      if (
        totalUsage &&
        Number.isSafeInteger(totalUsage.inputTokens) &&
        Number.isSafeInteger(totalUsage.outputTokens)
      ) {
        assistant.usage = {
          inputTokens: Math.max(
            0,
            totalUsage.inputTokens - (value.threadUsage?.inputTokens || 0),
          ),
          outputTokens: Math.max(
            0,
            totalUsage.outputTokens - (value.threadUsage?.outputTokens || 0),
          ),
        };
        value.threadUsage = totalUsage;
      }
      if (turn.status === "interrupted") assistant.status = "cancelled";
      else if (turn.status === "completed") assistant.status = "completed";
      else {
        const detail = safeText(turn.error?.message, 2000)
          .split(token)
          .join("[redacted]");
        throw new AIError(
          "agent_turn_failed",
          detail ||
            "The Codex agent could not complete this turn. Review its output and try again.",
        );
      }
    } catch (error) {
      assistant.status = signal.aborted ? "cancelled" : "failed";
      assistant.error = signal.aborted
        ? {
            code: "cancelled",
            message:
              "Agent stopped. Review any files it changed before stopping.",
          }
        : publicError(error);
    } finally {
      assistant.approvals = [];
      if (turnFinished) {
        try {
          await loadUsage();
          const totals = (usage[value.profileId] ||= blankUsage());
          totals.requests++;
          totals.inputTokens += assistant.usage?.inputTokens || 0;
          totals.outputTokens += assistant.usage?.outputTokens || 0;
          if (!assistant.usage) totals.unreportedRequests++;
          totals.lastUsedAt = new Date().toISOString();
          const contents = JSON.stringify(usage);
          usageQueue = usageQueue
            .catch(() => {})
            .then(() =>
              protectedWrite(path.join(directory, "ai-usage.json"), contents),
            );
          await usageQueue;
        } catch {
          assistant.error = {
            code: "usage_storage_error",
            message: "Token statistics could not be saved locally.",
          };
        }
      }
      try {
        await saveConversation(value);
      } catch {
        assistant.error = {
          code: "history_storage_error",
          message:
            "The response could not be saved locally. Copy it before closing the app.",
        };
      }
      await publishState();
      running.delete(id);
      publishConversation(value);
    }
  }
  async function stop(projectId) {
    const value = await conversation(projectId);
    const job = running.get(key(value.profileId, projectId));
    job?.controller.abort();
    await job?.done;
    return publicConversation(value);
  }
  async function clear(projectId) {
    const value = await conversation(projectId);
    if (!value.profileId) return value;
    await stop(projectId);
    value.messages = [];
    delete value.threadId;
    delete value.threadUsage;
    delete value.agentCwd;
    delete value.agentRootId;
    const id = key(value.profileId, projectId);
    agents.get(id)?.agent.close();
    agents.delete(id);
    await saveConversation(value);
    publishConversation(value);
    return publicConversation(value);
  }
  return {
    getState,
    isRunning: (projectId) =>
      [...running.values()].some((job) => job.projectId === projectId),
    refreshModels,
    skills: async (projectId, rootId, forceReload) =>
      publicSkills(await availableSkills(projectId, rootId, forceReload)),
    answer: async ({ projectId, id, decision, answers }) => {
      if (!["accept", "decline", "cancel", "answer"].includes(decision))
        throw new AIError("invalid_decision", "Choose an approval decision.");
      const value = await conversation(projectId);
      const request = value.messages
        .at(-1)
        ?.approvals?.find((a) => a.id === id);
      if (!request)
        throw new AIError(
          "approval_expired",
          "This agent request is no longer active.",
        );
      if (decision === "accept" && request.canAccept === false)
        throw new AIError(
          "invalid_decision",
          "This request does not allow approval.",
        );
      if (request.kind === "question") {
        if (
          !answers ||
          typeof answers !== "object" ||
          Object.keys(answers).some(
            (key) => !request.questions?.some((q) => q.id === key),
          ) ||
          request.questions?.some(
            (q) =>
              !Array.isArray(answers[q.id]?.answers) ||
              answers[q.id].answers.some(
                (a) => typeof a !== "string" || a.length > 8000,
              ),
          )
        )
          throw new AIError(
            "invalid_answer",
            "Answer the agent questions before continuing.",
          );
      }
      const agent = agents.get(key(value.profileId, projectId))?.agent;
      if (!agent)
        throw new AIError(
          "agent_stopped",
          "This project agent is no longer running.",
        );
      agent.answer(id, decision, answers);
    },
    conversation: async (projectId) =>
      publicConversation(await conversation(projectId)),
    send,
    stop,
    clear,
    signIn: (options) =>
      queuedAccount(async () => {
        await stopAll();
        await closeAgents();
        return auth.beginSignIn(options);
      }),
    cancelSignIn: () => queuedAccount(() => auth.cancelSignIn()),
    selectProfile: (id) =>
      queuedAccount(async () => {
        await stopAll();
        await closeAgents();
        models = [];
        modelError = undefined;
        return auth.selectProfile(id);
      }),
    disconnect: () =>
      queuedAccount(async () => {
        await stopAll();
        await closeAgents();
        models = [];
        return auth.disconnect();
      }),
    openUsage: () => openBrowser(USAGE_URL),
    dispose: () => {
      auth.dispose();
      for (const job of running.values()) job.controller.abort();
      return Promise.allSettled([
        ...[...running.values()].map((job) => job.done),
        ...[...agents.values()].map((entry) => entry.agent.close()),
        ...(skillAgent ? [skillAgent.close()] : []),
      ]);
    },
  };
}
module.exports = { createAI };
