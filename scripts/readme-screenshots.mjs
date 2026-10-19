// Capture the real app with disposable, fictional research data.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { smoke, launchApp, resizeWindow } from "./smoke-harness.mjs";

await smoke("readme", async (root) => {
  const folder = path.join(root, "example-manuscript");
  await fs.mkdir(folder);
  await fs.writeFile(
    path.join(folder, "main.tex"),
    String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\title{Adaptive Inference at the Edge}
\author{Example Research Group}
\date{Research Workbench Demo}
\begin{document}
\maketitle
\begin{abstract}
This fictional manuscript demonstrates a local research workflow.
We study how a scheduler can balance response time and resource use
across a collection of edge devices.
\end{abstract}
\section{Research Question}
How should an inference service allocate its limited compute budget
when request sizes and device availability change?
\section{Approach}
The scheduler observes queue length and selects a batch size.
Each experiment records latency, throughput, and memory use.
\begin{enumerate}
  \item Establish a reproducible baseline.
  \item Compare scheduling policies under the same workload.
  \item Report uncertainty across repeated runs.
\end{enumerate}
\section{Evaluation Plan}
Use held-out workloads to measure generalization.
Check whether each component contributes to the observed result.
All names and research content in this example are fictional.
\end{document}
`,
  );
  const { app, page } = await launchApp({ demoData: false });
  await resizeWindow(app, page, 1510, 980);
  await page.evaluate(
    async ({ folder }) => {
      const state = await window.research.load();
      state.appearance = "light";
      state.deadlineReminders = false;
      state.areas = [
        { id: "systems", name: "ML Systems", color: "#527ac7", icon: "cpu" },
        {
          id: "security",
          name: "Security & Privacy",
          color: "#9c6dcc",
          icon: "shield",
        },
      ];
      const projects = [
        [
          "edge",
          "Adaptive Inference",
          "systems",
          "writing",
          "Balance latency and compute budgets for edge inference.",
          "Alex Chen",
        ],
        [
          "cache",
          "Shared Model Cache",
          "systems",
          "experiments",
          "Measure model reuse across concurrent inference workloads.",
          "Sam Lee",
        ],
        [
          "trace",
          "Reproducible Traces",
          "systems",
          "revision",
          "Build a repeatable evaluation workflow for distributed systems.",
          "Jordan Kim",
        ],
        [
          "privacy",
          "Private Telemetry",
          "security",
          "writing",
          "Study aggregate monitoring with explicit privacy constraints.",
          "Taylor Park",
        ],
        [
          "audit",
          "Agent Audit Trails",
          "security",
          "exploration",
          "Explore reviewable records of automated tool execution.",
          "Morgan Li",
        ],
        [
          "isolation",
          "Workload Isolation",
          "security",
          "submitted",
          "Evaluate interference between isolated research workloads.",
          "Alex Chen",
        ],
      ];
      state.projects = projects.map(
        ([id, name, areaId, stage, summary, owner]) => ({
          id,
          name,
          areaId,
          stage,
          summary,
          owner,
          folder: id === "edge" ? folder : "",
          mainFile: id === "edge" ? "main.tex" : "",
          sshHost: "",
          venue: "Example Systems Conference",
          notes: "Demo workspace with fictional projects and collaborators.",
          tasks: [
            {
              id: `${id}-baseline`,
              text: "Verify the reproducible baseline",
              done: true,
              assignee: owner,
            },
            {
              id: `${id}-ablation`,
              text: "Complete the ablation study",
              done: false,
              assignee: owner,
              dueDate: "2026-11-02",
            },
          ],
          deadlines: [
            {
              id: `${id}-draft`,
              label: "Internal draft review",
              date: "2026-11-06",
              kind: "other",
            },
          ],
          updatedAt: "2026-10-19T08:00:00.000Z",
        }),
      );
      state.trackedDeadlines = [];
      await window.research.save(state);
      localStorage.setItem(
        "research-workbench.navigation",
        JSON.stringify({ view: "overview", area: "all" }),
      );
    },
    { folder },
  );
  await page.reload();
  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `output/playwright/readme-${name}.png`,
      animations: "disabled",
    });
  };
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await capture("overview");
  await page
    .getByRole("button", { name: "Project board", exact: true })
    .first()
    .click();
  await capture("board");
  const compilation = await page.evaluate(() =>
    window.research.compile("edge"),
  );
  assert.equal(compilation.ok, true, compilation.log);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Adaptive Inference", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Workbench mode" })
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await page.locator(".cm-content").waitFor();
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
  await capture("workbench");
  await page.getByRole("button", { name: "Add PDF note", exact: true }).click();
  await page
    .locator('.pdf-page[data-page-number="1"]')
    .click({ position: { x: 170, y: 310 } });
  await page
    .getByLabel("Annotation comment", { exact: true })
    .fill(
      "Add an ablation for batch size and report variance across repeated runs.",
    );
  await page.keyboard.press("Control+s");
  await capture("feedback");
  await page.evaluate(async () => {
    const state = await window.research.load();
    state.appearance = "dark";
    await window.research.save(state);
  });
  await page.reload();
  await page
    .locator('.pdf-page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
  await capture("dark");
  return "README screenshots captured from the app using fictional data; LaTeX compilation passed.";
});
