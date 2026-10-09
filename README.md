# Research Workbench

一个面向 Mac 的本地研究工作台，把研究项目、论文阶段、里程碑、LaTeX 编辑、PDF 预览和终端放在同一个窗口。

界面采用 [Snazzy Light](https://github.com/loilo/vscode-snazzy-light) 风格的浅色主题：近白色编辑区、浅灰色侧栏和彩色语法高亮。界面使用 Inter，编辑器和终端使用 JetBrains Mono；字体随应用打包，可离线使用。

## 启动

```sh
npm install
npm run dev
```

已经安装依赖时，可以直接运行 `npm run dev`。生产模式使用 `npm run build`，然后运行 `npm start`。

生成可双击启动的 Mac 应用：

```sh
npm run package
```

应用位于 `release/mac-arm64/Research Workbench.app`（Intel Mac 对应 `mac`）。`npm run dist` 可生成 DMG。当前构建没有开发者签名或公证。

## 使用

1. 在 Overview 点击 **New project**，选择研究方向和当前阶段。工作区预设 ML Systems、Security and Privacy 和 Cyber-Physical Systems，也支持自定义方向。
2. 在项目详情中添加下一步任务、研究笔记和目标会议。在 **Workbench setup** 选择本地项目目录和 LaTeX 入口文件。
3. 点击 **Open workbench**。左侧选择 `.tex`、`.bib` 或笔记文件，中间编辑，右侧查看 PDF。`⌘S` 保存文件，**Compile** 保存当前编辑文件并执行 `latexmk`。
4. 底部终端支持本机交互式 shell。设置 `user@hostname` 或 SSH config alias 后，切换 **SSH**。端口、密钥和代理配置使用 `~/.ssh/config`；密码和主机密钥确认在终端完成。
5. 在 **Project board** 拖动卡片，或用卡片菜单切换阶段：Idea Exploration、Experiments、Paper Writing、Submitted、Revision、Published。
6. **Dates & deadlines** 的 My dates 汇总独立会议日期和个人事项；首次启动会从本机 `mac-ddl-count` 导入已保存的日期、状态和来源。CCF conferences 可搜索会议并添加 Abstract、Paper 等日期；Project milestones 保留每个项目的里程碑。
7. 右上角的月亮/太阳按钮切换浅色和深色；Workspace settings 的 Appearance 可选择 Light、Dark 或跟随系统。主题覆盖编辑器、终端和弹窗，并在重启后保留。
7. 在 **Workspace settings** 管理研究方向，导入或导出项目资料。

启动时自动将 Current research 的 22 个项目加入工作区，按 ML Systems、Security and Privacy、Cyber-Physical Systems 分组显示在左侧，并进入 Project board。升级已有工作区时移除六个示例项目，保留已有真实项目的笔记、任务和阶段；迁移前保存备份。此操作只执行一次，之后删除的项目不会在重启时重新加入。

左侧列表、Overview 和 Project board 优先显示写作和修改中的项目，已录用、已发表的项目放在后面。同一阶段按最近的投稿或修改截止日排序。在看板中点击左侧研究方向可筛选项目。FlowWise 已标为 Accepted。

## PDF 标注

右侧阅读器支持文字选择、高亮、便签和画笔，提供四种标注颜色。点击 **Show PDF annotations** 查看批注列表、搜索内容或跳到对应页面；选择批注后可编辑评论或删除，工具栏支持撤销。扫描件没有文字层时，可使用便签和画笔。

标注自动保存在本机，也可在阅读器内按 `⌘S` 或 `Ctrl+S` 保存。数据和原始 PDF 快照位于 Application Support 的 `Research Workbench/pdf-annotations/`，按项目与 PDF 内容版本关联。重新编译得到不同内容时，新版从空白标注开始，旧版可通过 **Annotated PDF versions** 打开。项目没有编译产物时，工作台会恢复最近标注的文档。

**Export annotated PDF** 生成包含标准 Highlight、Text 和 Ink 批注的 PDF 副本，保留中文评论和标注外观。导出不会覆盖原始文档。工作区 JSON 导出不包含批注或 PDF 快照，备份时请单独保存 `pdf-annotations/`。目前单个文档最大 64 MB，最多 1,000 个标注；跨页文字高亮请按页添加。

## ChatGPT Agent

工作台底部的 **AI** 与 **Terminal**、**Build log** 并列。点击 **Continue with ChatGPT**，在系统浏览器登录并允许应用使用 ChatGPT plan。应用使用 [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/) 和 [Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) 执行本地 Agent 任务；Codex runtime 与 Code Mode host 随应用打包。`gpt-6-astra` 等模型通过 Code Mode host 调用本地文件与执行工具。

模型菜单读取该账户实时返回的可用模型。选择项目目录后，可要求 Agent 修改多个文件、运行脚本或修复 LaTeX 编译。**Current file** 和 **Selection** 附加文本快照；发送前保存当前编辑文件，运行时暂停编辑，结束后刷新文件、PDF 和 Git 状态。执行记录可展开查看命令输出及文件 diff，需要额外访问时在 AI 页审批。**Stop** 中断当前任务，已完成的文件修改会保留。

**Usage** 显示本机记录的 Agent 次数及 token 用量，并通过 **Open ChatGPT Usage** 打开订阅额度页面。本机统计不代表剩余订阅额度。账户菜单支持重新授权、添加账户和退出；对话按账户与项目保存，**New AI chat** 清空当前对话。

登录凭据由 Electron safeStorage 加密，保存在 Application Support 的 `Research Workbench/ai/`，不会传给界面或纳入工作区导出。对话、附加的文本快照、执行记录及 Codex 会话也保存在该目录。Agent 使用本机环境中的编译器与脚本工具，LaTeX 仍需下面的环境配置。

## LaTeX 环境

安装 MacTeX 或确保 `latexmk`、`pdflatex` 在 PATH 中。应用会加入 `/Library/TeX/texbin`、`/opt/homebrew/bin` 和 `/usr/local/bin`。

当前编译器为 pdfLaTeX，通过 `latexmk -pdf -interaction=nonstopmode -halt-on-error -no-shell-escape` 执行。产物保存在入口文件旁的 `.research-build/`。失败时保留日志和此前的 PDF；编译超过 90 秒会终止。

## 数据与边界

项目资料保存在 macOS 用户 Application Support 目录中的 `Research Workbench/workspace.json`；设置页显示实际路径。应用采用临时文件加重命名保存，导入前自动备份旧资料。

工作区导出包含项目资料和文件夹路径，**不包含项目文件**。请单独备份论文目录。移除项目不会删除论文文件。

SSH 提供真实远端终端。当前编辑器和 Compile 使用本地文件，尚未实现远端目录浏览、同步或远端 LaTeX 构建。

日期由用户录入，当前粒度为日，不自动抓取会议 CFP，不发送后台或系统通知。会议的具体时间和时区应以官网为准。笔记和项目字段在离开输入框时保存；稿件通过 `⌘S` 或 Compile 保存。

## 验证

```sh
npm test
npm run build
npm run test:ui
npm run test:pdf-ui
npm run test:ai-ui
```

核心测试验证数据保存、导入校验、目录边界、SSH 参数和实际 LaTeX 成功／失败编译。桌面集成测试在隔离数据目录启动 Electron，验证项目创建、任务、日期、阶段、PTY shell、PDF 响应、编译错误、文件保存及重启后的数据恢复。

AI 测试验证签名身份、PKCE 回调、加密凭据、刷新令牌恢复、账户隔离、Agent JSON-RPC、真实样例文件修改、脚本执行和审批。AI 界面测试使用隔离的模拟账户，不调用真实模型或消耗订阅；真实登录需在系统浏览器完成。

截图存于 `output/playwright/`。桌面集成测试需要可启动 GUI 的 macOS 会话以及 LaTeX 环境。

## 实现

Electron 主进程负责文件访问、JSON 保存、LaTeX 子进程和 node-pty 会话。React 界面使用 CodeMirror 编辑文本、xterm.js 显示交互式终端，PDF.js 渲染本地 PDF 及文字层，pdf-lib 导出标准批注。PDF 数据通过受限的 IPC 和自定义协议在本机传递。

渲染进程启用 sandbox 和 context isolation；preload 只暴露具体操作，不开放 Node.js 或通用 IPC。实现参考 [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security/) 与 [Context Bridge](https://www.electronjs.org/docs/latest/api/context-bridge)。

## 个人研究项目清单

**Research collection** 整合个人网站、NAISS Lab 网站、本地代码和论文目录，以及登录后的 Overleaf 项目列表。2026-10-09 的清单包含 44 个项目：22 个重点项目、12 个需要核对范围或阶段的候选项目、10 个归档项目。

Current research 已经加入工作区。需要补充候选项目或归档项目时，勾选项目后点击 **Add selected projects**，应用会加入左侧研究方向并打开 Project board。应用保留已有项目及研究方向设置，跳过重复项目，并在加入前备份工作区。清单为整理后的快照；Overleaf 链接可打开在线稿件，应用不自动同步云端文件。来源和不同稿件版本保存在项目的 **Sources & manuscripts** 中。

投稿状态来自网站记录或带说明的本地稿件推断。**Accepted** 与 **Published** 分开显示；清单没有编造截止日期。完整来源和合并说明见 [研究项目清单](docs/research-project-inventory.md)。

应用图标采用用户选定的 imagegen 大 R 设计，再转换成真正的 SVG 路径。使用石墨灰、米白色和淡紫色；矢量图位于 `build/icon.svg`，生成提示和转换说明见 [图标设计记录](docs/icon-design.md)。`npm run icons` 从 PNG 渲染生成 Mac ICNS。

Project Files 以可展开的目录树显示项目的 Manuscript、Code 和其他本地文件夹。点击 **Add local folder** 可添加任意本地目录，并用自己的名称标记。支持搜索文件、查看子目录和编辑常用代码文件；移除文件夹只解除项目关联。已有研究项目会一次性补充目录记录里的本地代码关联，保留手动选择的目录。

工作台顶部的 **Git** 显示当前仓库的分支、改动数量和待推送提交数。Source control 左侧显示文件改动、逐行差异和最近提交，右侧提供提交与远端操作。勾选要提交的文件，填写说明后点击 **Commit changes**；未选中的暂存改动会保留。可以切换项目内的文件夹，在本地初始化仓库，或连接已有的 HTTPS、SSH 远程仓库。GitHub 远端可直接打开仓库页面。

**Check remote** 拉取远端状态，即使存在本地改动也可以使用。待推送和待拉取数量根据最近一次 fetch 显示。**Sync** 先拉取再推送，拉取只接受 fast-forward；存在未提交改动、冲突或分支分叉时，界面说明下一步并禁用相应操作。提交使用本机 Git 身份，远程访问使用已有的凭据和 SSH 配置。应用生成的 `.research-build` 文件不纳入提交。可用 `npm run test:git-ui` 在临时仓库验证差异、选择性提交、远端检查和推送。

**⌘S** 和 **Ctrl+S** 都会将当前文件写入本地，并刷新 Git 改动状态。保存文件和 Git 提交是两个独立操作。

工作台支持拖动分界线调整研究项目栏、Project Files、编辑器与 PDF 的宽度，底部终端支持上下拖动。悬停或拖动时分界线显示强调色，双击恢复对应区域的默认尺寸。也可选中分界线，用方向键调整，按 Shift 加快调整；拖动时按 Esc 取消。尺寸在本机自动保存，切换项目和重启后继续使用。窗口缩小时保留编辑器及 PDF 的最小可用宽度；顶部 **Reset panel layout** 可恢复整个布局。
