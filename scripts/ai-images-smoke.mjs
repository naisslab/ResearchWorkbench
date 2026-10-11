import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { launchApp, smoke } from "./smoke-harness.mjs";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGNQSDjwHx9mGBkKAMSvj8GdcOtmAAAAAElFTkSuQmCC";
const imageFile = (name) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(png, "base64"),
});

await smoke("ai-images", async (root) => {
  const folder = path.join(root, "manuscript");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "main.tex"), "Image fixture\n");
  const { app, page } = await launchApp({ dataDirectory: root });
  await page.evaluate(async (folder) => {
    const state = await window.research.load();
    await window.research.save({
      ...state,
      appearance: "light",
      projects: [
        {
          ...state.projects[0],
          id: "images-project",
          name: "Image attachments",
          folder,
          mainFile: "main.tex",
          localFolders: [],
          tasks: [],
          notes: "",
          deadlines: [],
          links: [],
        },
      ],
    });
  }, folder);

  // Replace handlers only in this temporary Electron process. No real account,
  // model request, or system clipboard is involved in these composer checks.
  await app.evaluate(({ ipcMain, BrowserWindow }, png) => {
    const ok = (value) => ({ ok: true, value });
    const state = {
      status: "connected",
      sharing: true,
      activeProfileId: "image-fixture",
      profiles: [
        {
          id: "image-fixture",
          label: "images@example.test",
          status: "connected",
          sharing: true,
        },
      ],
      models: [
        {
          slug: "image-fixture-model",
          displayName: "Image fixture model",
          images: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Balanced" },
          ],
          serviceTiers: [],
        },
      ],
      usage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        unreportedRequests: 0,
      },
      runtime: { available: true, version: "0.160.0" },
    };
    const chats = new Map();
    const createChat = (id, title) => ({
      projectId: "images-project",
      chatId: id,
      profileId: state.activeProfileId,
      title,
      messages: [],
      queue: [],
      queuePaused: false,
    });
    let conversation = createChat("first", "First images chat");
    chats.set(conversation.chatId, conversation);
    const emit = () =>
      BrowserWindow.getAllWindows()[0].webContents.send(
        "ai:conversation",
        conversation,
      );
    const fixture = { failSend: false, requests: [] };
    globalThis.__imageFixture = fixture;
    const handlers = {
      "ai:state": () => ok(state),
      "ai:models": () => ok(state),
      "ai:skills": () => ok({ skills: [], warnings: 0 }),
      "ai:conversation": () => ok(conversation),
      "ai:chats": () =>
        ok(
          [...chats.values()].map((chat) => ({
            id: chat.chatId,
            title: chat.title,
            active: chat === conversation,
            archived: false,
          })),
        ),
      "ai:manage-chat": (_, _project, action, id) => {
        if (action === "new") {
          conversation = createChat("second", "Second images chat");
          chats.set(conversation.chatId, conversation);
        } else if (action === "select") {
          conversation = chats.get(id);
          if (!conversation) throw new Error("Missing image fixture chat");
        } else throw new Error(`Unexpected chat action: ${action}`);
        emit();
        return ok(conversation);
      },
      "ai:send": (_, request) => {
        fixture.requests.push(request);
        if (fixture.failSend)
          return {
            ok: false,
            error: { code: "fixture", message: "Image send fixture failed" },
          };
        conversation.messages.push({
          id: `image-message-${fixture.requests.length}`,
          role: "user",
          text: request.message,
          status: "completed",
          createdAt: new Date().toISOString(),
          images: request.images.map(({ name }, index) => ({
            name,
            file: `fixture-image-${index}.png`,
          })),
        });
        emit();
        return ok(conversation);
      },
      "ai:image": () => ok(new Uint8Array(Buffer.from(png, "base64"))),
    };
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, handler);
    }
  }, png);
  await page.reload();
  await page
    .locator(".area-projects")
    .getByRole("button", { name: "Image attachments", exact: true })
    .click();
  const composer = page.getByLabel("Message the AI agent", { exact: true });
  const images = page.locator(".ai-image-attachments img");
  const send = page.getByRole("button", { name: "Run AI agent", exact: true });
  const countImages = (count) =>
    page.waitForFunction(
      (count) =>
        document.querySelectorAll(".ai-image-attachments img").length === count,
      count,
    );
  const pick = async (...names) => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Attach images" }).click();
    await (await chooser).setFiles(names.map(imageFile));
  };
  const transfer = (kind, name, type = "image/png") =>
    page.locator(".ai-composer").evaluate(
      (form, { kind, name, type, png }) => {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        const data = new DataTransfer();
        data.items.add(new File([bytes], name, { type }));
        if (kind === "paste") {
          form.querySelector("textarea").dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            }),
          );
        } else {
          for (const event of ["dragover", "drop"])
            form.dispatchEvent(
              new DragEvent(event, {
                dataTransfer: data,
                bubbles: true,
                cancelable: true,
              }),
            );
        }
      },
      { kind, name, type, png },
    );
  const selectChat = async (title) => {
    await page.getByTitle("Conversation history", { exact: true }).click();
    await page
      .locator(".chat-row")
      .filter({ hasText: title })
      .locator("button")
      .first()
      .click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
  };
  await composer.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Attach images"]').disabled,
  );
  assert.equal(await send.isDisabled(), true);
  assert.equal(
    await page
      .locator('.ai-composer input[type="file"]')
      .getAttribute("accept"),
    "image/png,image/jpeg,image/gif,image/webp",
  );
  await pick("picked.png");
  await countImages(1);
  assert.equal(await send.isEnabled(), true, "An image alone enables Send");
  await transfer("paste", "pasted.png");
  await transfer("drop", "dropped.png");
  await countImages(3);
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".ai-image-attachments img")].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await page.getByRole("button", { name: "Remove pasted.png" }).click();
  await countImages(2);
  assert.deepEqual(
    await images.evaluateAll((nodes) => nodes.map((n) => n.alt)),
    ["picked.png", "dropped.png"],
  );
  await transfer("drop", "notes.txt", "text/plain");
  await page.getByText("Attach PNG, JPEG, GIF or WebP images.").waitFor();
  assert.equal(await images.count(), 2);

  await app.evaluate(() => (globalThis.__imageFixture.failSend = true));
  await composer.fill("Review these figures");
  await send.click();
  await page.getByText("Image send fixture failed", { exact: true }).waitFor();
  assert.equal(await images.count(), 2, "Failed sends retain attached images");
  assert.equal(await composer.inputValue(), "Review these figures");
  await app.evaluate(() => (globalThis.__imageFixture.failSend = false));
  await composer.fill("");
  await send.click();
  await countImages(0);
  const request = await app.evaluate(() => {
    const request = globalThis.__imageFixture.requests.at(-1);
    return {
      message: request.message,
      images: request.images.map(({ name, type, data }) => ({
        name,
        type,
        base64: Buffer.from(data).toString("base64"),
      })),
    };
  });
  assert.deepEqual(request, {
    message: "",
    images: ["picked.png", "dropped.png"].map((name) => ({
      name,
      type: "image/png",
      base64: png,
    })),
  });
  await page.locator('.ai-message-images img[alt="picked.png"]').waitFor();
  await page.locator('.ai-message-images img[alt="dropped.png"]').waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".ai-message-images img")].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );

  await pick("first-draft.png");
  await countImages(1);
  await page.getByTitle("New AI chat", { exact: true }).click();
  await countImages(0);
  await pick("second-draft.png");
  await countImages(1);
  await selectChat("First images chat");
  await page
    .locator('.ai-image-attachments img[alt="first-draft.png"]')
    .waitFor();
  assert.equal(await images.count(), 1);

  // Hold individual reads without sleeping, so a chat switch and overlapping
  // attachments reliably exercise the async ownership and six-image limit.
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    window.__imageReads = new Map();
    File.prototype.arrayBuffer = function () {
      if (!this.name.startsWith("held-")) return original.call(this);
      return new Promise((resolve, reject) =>
        window.__imageReads.set(this.name, () =>
          original.call(this).then(resolve, reject),
        ),
      );
    };
  });
  const finishRead = (name) =>
    page.evaluate(async (name) => {
      const finish = window.__imageReads.get(name);
      if (!finish) throw new Error(`No held read for ${name}`);
      window.__imageReads.delete(name);
      await finish();
    }, name);
  await transfer("paste", "held-first.png");
  await page
    .getByRole("status")
    .filter({ hasText: "Loading images…" })
    .waitFor();
  assert.equal(
    await send.isDisabled(),
    true,
    "Wait for all image bytes before Send",
  );
  await selectChat("Second images chat");
  await page
    .locator('.ai-image-attachments img[alt="second-draft.png"]')
    .waitFor();
  await finishRead("held-first.png");
  assert.deepEqual(
    await images.evaluateAll((nodes) => nodes.map((n) => n.alt)),
    ["second-draft.png"],
  );
  await selectChat("First images chat");
  await page
    .locator('.ai-image-attachments img[alt="held-first.png"]')
    .waitFor();
  await countImages(2);
  await pick("third.png", "fourth.png", "fifth.png");
  await countImages(5);
  await transfer("paste", "held-sixth.png");
  await transfer("drop", "held-seventh.png");
  await finishRead("held-sixth.png");
  await countImages(6);
  assert.equal(await send.isDisabled(), true);
  await finishRead("held-seventh.png");
  await page.getByText("Attach up to six images.", { exact: true }).waitFor();
  assert.equal(
    await images.count(),
    6,
    "Overlapping reads cannot exceed six images",
  );
  assert.equal(await send.isEnabled(), true);
  assert.equal(
    await page
      .locator('.ai-image-attachments img[alt="held-seventh.png"]')
      .count(),
    0,
  );
  await page.screenshot({ path: "output/playwright/ai-images.png" });
  assert.equal(
    await app.evaluate(() => globalThis.__imageFixture.requests.length),
    2,
    "Attachment and chat operations never send requests themselves",
  );
  return "PASS: image picker, synthetic screenshot paste and drop, rendered previews, removal and type validation, image-only byte payload, failed-send recovery, sent previews, per-chat drafts, chat switches during reads, and overlapping six-image limit without real model or clipboard access.";
});
