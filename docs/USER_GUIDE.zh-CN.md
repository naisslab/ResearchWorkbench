# Research Workbench 中文使用指南

**一个面向研究工作的 Agent Native Mac App，让所有项目、Agent 和论文工作流汇集在同一个工作区。**

Research Workbench 面向研究者、学生和课题组负责人。你可以集中管理研究项目，让 Agent 协助修改论文，在同一个窗口编辑 LaTeX、编译稿件和审阅 PDF。文件保存在你选择的普通文件夹中，也可以通过 Git 连接 Overleaf，与合作者继续使用同一份稿件。

[安装](#安装) · [管理项目](#把研究项目放在一起) · [使用 Agent](#与-agent-一起工作) · [写作与审阅](#写作审阅与协作) · [更新](#更新或重新安装) · [English](../README.md)

![Research Workbench 中并排显示的 LaTeX 源码与论文 PDF](images/workbench.png)

## 安装

[**下载 macOS 安装包**](https://github.com/naisslab/ResearchWorkbench/releases) · [版本记录](../CHANGELOG.md)

打开下载的 DMG，将 **Research Workbench** 拖入 Applications，然后启动应用。首次打开时，可以选择 **Open a folder** 打开本地文件夹、**Connect Overleaf** 连接稿件，或 **Try an example** 体验示例项目。

> **当前版本为 0.1.0 开发预览版。** 已提供的安装包适用于 Apple silicon Mac，需要 macOS 13 或更新版本。此版本尚未签名或公证，macOS 可能阻止首次启动。正式签名版本仍待发布。Intel 打包流程已配置，但当前预览版没有 Intel 安装包。暂不支持 Windows 和 Linux。

### 一行命令安装

先安装 [GitHub CLI](https://cli.github.com)，运行 `gh auth login` 完成登录，再执行：

```sh
bash -c 'set -e; installer=$(gh api -H "Accept: application/vnd.github.raw+json" "repos/naisslab/ResearchWorkbench/contents/scripts/install-macos.sh?ref=main"); bash -c "$installer" -- --preview'
```

[安装脚本](../scripts/install-macos.sh)会查找最新稳定版。尚无稳定版时，`--preview` 表示允许安装未签名的 0.1.0 预览版。新安装默认放在 `~/Applications`，已有安装则在原位置更新。脚本会先校验下载的应用。使用发布版不需要安装 Node.js、Xcode，也不需要签名证书。

**如果想让 Claude Code 或 Codex 帮忙安装**，可以把下面这段话直接发给它：

```text
请从 https://github.com/naisslab/ResearchWorkbench 为我的 Mac 安装 Research Workbench。先阅读 README，再按其中的安装说明操作。需要时协助安装 GitHub CLI，并让我自行完成登录。安装后告诉我应用所在路径，以及首次启动是否有限制。
```

### 打开第一个项目

1. **导入文件。** 打开本地文件夹、连接 Overleaf，或选择内置示例。
2. **设置论文。** 选择主 `.tex` 文件和 TeX 引擎，然后点击 **Compile** 编译。
3. **选择工作方式。** **Source** 用于手动编辑，**Agent** 用于对话协作，**Both** 同时显示源码、对话和 PDF。

项目管理和 PDF 阅读不需要安装 TeX，也不需要登录 AI 账户。编译 LaTeX 需要 `latexmk` 和所选 TeX 引擎，可以使用 [MacTeX](https://www.tug.org/mactex/)。使用 Agent 时，需要连接受支持的 ChatGPT 账户。可用模型以账户实际返回的列表为准。

## 把研究项目放在一起

把不同本地文件夹和 Overleaf 仓库中的项目加入同一个工作区，按研究方向分组，为项目指定负责人。从探索想法、开展实验到写作、投稿、修改和发表，都可以记录当前阶段与下一步任务。

**Overview** 汇总任务、近期日期和 PI 审阅收件箱。审阅请求可以关联具体的稿件版本，让反馈与当时审阅的内容对应起来。

![项目总览中的研究阶段、负责人和下一步任务](images/overview.png)

切换项目时，应用保留编辑草稿、PDF 阅读位置、布局和对话。Agent 可以在你查看其他项目时继续工作。按 `⌘K` 搜索工作区中的文件、PDF 正文、笔记、反馈和历史对话，点击结果即可回到对应内容。

<details>
<summary>查看项目看板与日常管理操作</summary>

在 **Project board** 拖动项目卡片或使用卡片菜单更改阶段。侧边栏中的项目与研究方向也支持拖动排序，顺序会保留到下次启动。

![按研究阶段排列的项目看板](images/board.png)

项目详情中可以维护任务、研究笔记和里程碑。**Dates & deadlines** 汇总个人日期、会议日期和项目里程碑。提醒可在 Settings 中关闭。删除任务、日期或项目后，提示条提供 **Undo**。

`⌘K` 输入内容时先显示搜索结果。按 Enter 打开选中的结果，点击 **Ask** 才将问题发送给 Agent。输入 `>` 或按 `⇧⌘P` 可以查找应用命令。

</details>

## 与 Agent 一起工作

Agent 可以在你正在使用的研究工作区中执行任务，包括编辑文件、编译论文、检查错误、查找参考文献、读取 PDF 反馈和更新项目资料。结果会出现在编辑器、编译日志、PDF 预览和项目视图中。

![源码、Agent 对话与论文 PDF 同时显示](images/agent-workbench.png)

*本指南复用已有的界面截图。Agent 截图使用测试对话和示例模型名称，实际可用模型取决于你的账户。*

### 从一个请求开始

| 可以这样问 | Agent 可以做什么 |
| --- | --- |
| “看看我正在写作的项目，哪些事情需要优先处理？” | 读取工作区状态、搜索不同项目，并提供文件和 PDF 来源链接。 |
| “添加一个消融实验任务，把这个项目改为修改阶段。” | 更新任务、笔记、里程碑和项目阶段；工作区修改提供撤销入口。 |
| “修复编译错误，再编译一次论文。” | 编辑源码、调用工作台编译、查看文件与行号对应的问题，并刷新 PDF。 |
| “通过这个 DOI 找到论文，把引用加入稿件。” | 获取参考文献资料和 BibTeX，再修改参考文献文件与正文。 |
| “处理这份 PDF 中尚未解决的评论。” | 读取反馈，在有定位信息时关联源码，修改内容并记录回复。评论是否解决由你决定。 |
| “帮我做投稿前检查。” | 检查引用、源码和已编译的 PDF。这些检查帮助发现问题，不代表已经满足投稿要求。 |

### 补充方向与安排后续任务

用 **Steer** 给正在执行的任务补充方向。用 **Queue next** 保存后续请求，队列会保留请求的模型设置、附件和所选技能。你可以调整顺序，也可以暂停或恢复队列。

请求可以附带当前文件、选中文本、PDF 摘录或图片。每个项目支持多个独立对话，历史内容可以搜索。用 **Fork conversation** 分出一条对话来探索另一种方案；分出的对话仍共享同一份项目文件。

<details>
<summary>查看请求队列</summary>

![深色主题下已暂停的请求队列与 Resume 控件](images/agent-queue.png)

在 PDF 中选中文字后，可用 **Ask Agent about selection** 将摘录附加到输入框。批注中的 **Ask Agent to address this** 会附带评论、页码和可用的源码位置。附件先进入输入框，由你提交。

**Stop** 会中断当前任务，已经完成的文件修改仍会保留。关闭窗口会停止 Agent 并暂停队列，重新启动后不会自动重放任务。

</details>

### 使用 Skills 与工具

在输入框或 `/` 菜单中选择已经安装的研究、写作技能。通过 MCP 连接本地工具或 HTTP 服务，在服务支持时使用 OAuth 登录。工具面板还提供代码审阅和网页搜索设置。

<table>
<tr>
<th>为请求选择技能</th>
<th>连接工具与设置审阅</th>
</tr>
<tr>
<td width="50%"><a href="images/agent-skills.png"><img src="images/agent-skills.png" alt="选择研究写作技能的 Skills 面板"></a></td>
<td width="50%"><a href="images/agent-tools.png"><img src="images/agent-tools.png" alt="包含代码审阅、网页搜索和 MCP 连接的工具面板"></a></td>
</tr>
</table>

### 审阅 Agent 的修改

任务结束后，打开 **Review changes** 查看逐文件差异和执行记录。可以打开文件继续编辑，也可以选择 **Revert selected** 还原部分文件。若文件已有后续修改，应用会阻止有冲突的还原。通过权限模式和访问审批控制 Agent 可以在哪里工作。

![Agent 修改审阅窗口中的新增、修改和删除文件，以及选择性还原控件](images/agent-changes.png)

**Paper result** 在有快照时并排显示任务前后的论文 PDF。**Compile and verify this run** 会核对当前源码是否仍与该次任务记录一致，再编译验证，避免把后续编辑的结果归到旧任务上。

<details>
<summary>查看任务前后的论文 PDF</summary>

![Paper result 中的前后 PDF 对照与编译验证](images/agent-paper-review.png)

旧任务没有 PDF 快照时，界面会说明无法比较。编译失败也会提示预览可能来自此前的成功构建。源码差异、PDF 快照与修改备份可以随完整备份保留。

</details>

AI 是可选功能。模型和已连接工具的可用性取决于账户与服务。AI 请求中包含的文件内容和工具输出会发送给 OpenAI，详见[安全与隐私说明](../SECURITY.md)。

## 写作、审阅与协作

编辑多文件 LaTeX 项目时，可以使用语法高亮、大纲、字数统计和引用补全。工作台支持 pdfLaTeX、XeLaTeX 和 LuaLaTeX。点击编译问题即可跳到对应源码，使用 SyncTeX 可以在源码与 PDF 之间定位。

在 PDF 上添加高亮、便签和画笔标注，搜索反馈，区分未解决与已解决的评论。可以回看带批注的历史版本，也可以导出包含标准批注的 PDF。

![论文源码旁的 PDF 批注与反馈](images/feedback.png)

### 常用操作

| 操作 | 入口或快捷键 |
| --- | --- |
| 保存当前文件 | `⌘S`；保存与 Git 提交是两个独立操作。 |
| 编译论文 | **Compile** 或 `⌘↵`；编译中可用 **Stop** 停止。 |
| 从源码定位到 PDF | **Show in PDF** 或 `⇧⌘J`。 |
| 从 PDF 定位到源码 | 双击文字；需要当前编译产物的 SyncTeX 数据。 |
| 查看或筛选批注 | **Show PDF annotations**，可选择 Open 或 Resolved。 |
| 导出带批注的副本 | **Export annotated PDF**；不会覆盖原文档。 |
| 搜索项目与内容 | `⌘K`。 |
| 调整布局与主题 | 拖动分隔线调整宽度，双击恢复；在 Settings 中选择 Light、Dark 或 System。 |

重新编译后，批注按 PDF 内容版本保留。通过 **Annotated PDF versions** 打开旧版本；**Copy highlights to current PDF…** 可以预览并复制能够唯一匹配的高亮。扫描件没有文字层时，可使用便签和画笔。

### 与 Overleaf 和 Git 配合

通过 Git 连接 Overleaf 后，先查看远端源码变化，再编译待审阅版本，最后明确发布审阅后的源码。也可以将 Overleaf 导出的源码 ZIP 作为本地项目打开。

Git 同步不包含 Overleaf 评论线程或实时编辑状态。本地 TeX 配置与 Overleaf 不同时，编译结果也可能不同。连接与同步步骤见 [Overleaf 指南](overleaf.md)。

工作台的 **Git** 面板提供状态、差异、选择性提交和远端操作。**Check remote** 更新远端状态，**Push** 发布已有提交；**Pull** 和 **Sync** 仅接受 fast-forward，遇到可能覆盖本地编辑的情况会停止。本地终端和 SSH 终端可用于运行项目命令。

## 功能速查

| 领域 | 已包含的功能 |
| --- | --- |
| 研究项目管理 | 研究方向、负责人、阶段看板、项目笔记、任务分配、里程碑、会议日期、提醒和 PI 审阅记录。 |
| Agent 工作流 | 跨项目搜索与更新、文件编辑、编译、参考文献、PDF 反馈、Steer、请求队列、Skills、MCP 和修改审阅。 |
| 论文准备 | LaTeX 编辑、三种 TeX 引擎、SyncTeX、BibTeX 查询、引用检查、版本对照和投稿检查。 |
| 开发工具 | Git 状态与差异、本地终端和 SSH 终端。 |
| 恢复与分享 | 未保存草稿恢复、可迁移的项目资料、日历导出、投稿文件包，以及带完整性校验的备份与恢复。 |
| 桌面交互 | 可调整的布局、浅色与深色主题、键盘命令、随应用打包的字体，以及设备端听写。听写需要 macOS 26 或更新版本和受支持的语音模型。 |

## 更新或重新安装

先退出 Research Workbench，再次执行上面的安装命令。脚本会选择最新稳定版，升级旧版本；已经是当前版本时不会重复安装。

| 需要做什么 | 操作方式 |
| --- | --- |
| 更新 | 再次运行一行安装命令，或下载新版本 DMG，在原目录替换应用。 |
| 重新安装同一版本 | 在命令中的 `--preview` 后加入 `--reinstall`。 |
| 只检查是否有更新 | 在 `--preview` 后加入 `--check`，查看版本信息而不下载 DMG。 |

安装脚本只替换应用包，并保留旧应用副本。项目文件夹与应用支持数据会保留。脚本拒绝降级，替换失败时会尝试恢复旧应用。升级前建议创建 **Complete backup**：旧应用副本无法撤销未来版本的数据格式迁移。手动用 DMG 替换时，请自行保留需要的旧应用副本。

签名和公证由发布者在制作正式签名版本时完成，使用者不需要重复操作。应用内自动更新尚未实现。发布者可参阅[分发与更新说明](distribution.md)。

## 文件、数据与备份

项目源码保留在你选择的文件夹中。从工作区移除项目不会删除其文件。项目资料、草稿、PDF 反馈和对话保存在应用的支持目录，具体路径可以在 Settings 中查看。

工作区 JSON 导出包含项目资料和路径。**Complete backup** 还可以包含项目文件夹、PDF 快照、批注、对话和修改备份，登录凭据不会导出。

在 Settings 中选择 **Create complete backup** 创建带校验清单的备份。默认包含关联项目文件夹，也可以取消勾选。备份前需要等待 Agent、编译和 Git 操作结束。

**Restore backup…** 会先校验备份，再让你选择项目文件的恢复位置。恢复会替换应用内研究状态并重启；原有应用数据会另存，原始项目文件夹不会被覆盖。新 Mac 上可在登录后选择将恢复的对话归属当前账户。详见[安全与隐私说明](../SECURITY.md)。

## 构建与贡献

以下步骤面向开发者。开发环境需要 Node.js 24 LTS、npm 11+，以及用于编译原生听写辅助程序的 Xcode 26+。

```sh
git clone https://github.com/naisslab/ResearchWorkbench.git
cd ResearchWorkbench
npm ci
npm run dev
```

`npm run package` 生成应用目录，`npm run dist` 生成开发用 DMG，两者都是未签名构建。提交代码前运行 `npm test`、`npm run build` 和相关界面测试。桌面测试需要能够启动 GUI 的 macOS 环境，论文测试还需要 TeX 工具。

[贡献说明](../CONTRIBUTING.md) · [架构与路线图](architecture-and-roadmap.md) · [发布指南](release.md) · [版本记录](../CHANGELOG.md) · [截图来源](images/README.md)

## 许可证

Research Workbench 使用 [MIT 许可证](../LICENSE)。依赖与随应用分发的资源保留各自的许可证，见[第三方声明](../THIRD_PARTY_NOTICES.md)。
