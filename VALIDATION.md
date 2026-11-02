# Catpaw Harness 插件验证记录

## 2026-11-02：v0.1.6 发布核对

- 发布代码沿用已完成构建、类型检查、9 项同步流程测试及 10 项功能测试的版本。实际安装后的版本与本地 Catpaw、插件清单、安装包均为 `0.1.6`；记录见 `output/version-follow-verification.json`。
- README 下载入口及安装示例更新为 `v0.1.6`。安装包与 SHA-256 校验文件通过 GitHub Release 分发。

## 2026-11-02：插件版本持续跟随本地 Catpaw

- `update:catpaw` 与 `pack:plugin` 共用本地同步、验证及打包流程，插件版本直接采用 Catpaw 版本；不再单独递增补丁号。默认读取本地 `package.json`，指定其他 Git 提交或标签时读取该提交版本。
- 在临时 Git 项目中实际生成 `0.1.6` 与 `0.1.7` 安装包：即使提交号未变，版本号变化也会更新插件清单、锁文件、构建内版本和安装包文件名。另验证了只检查不修改、失败不出包、修复后重试、同版本源码更新、固定历史提交和无效版本拒绝。
- 在实际项目运行 `npm run pack:plugin`，构建、类型检查、9 项同步流程测试和 10 项功能测试全部通过。完整日志：`output/version-follow-pack.log`。
- 当前本地 Catpaw 为 `0.1.6`，生成 `output/dsh-catpaw-0.1.6.tgz`。Catpaw 原仓库保持原样；来源记录仍忠实保留已提交源码的 `0.1.3 / 5c703811c179…`。

## 2026-11-02：插件版本统一为 0.1.6

- 按本地 Catpaw 版本号，将插件 package.json、依赖锁文件及当前安装说明统一为 0.1.6。界面与后台版本从同一份项目版本信息读取。
- 保留已验证的 Catpaw 源码提交和原始版本记录，避免把未提交的上游版本号写成源码来源。
- 重新运行 `npm run check`：构建、类型检查、6 项同步流程测试和 10 项功能测试全部通过。后台版本检查随当前项目版本验证为 0.1.6。日志：`output/release-v0.1.6-check.log`。
- 本地安装包为 `output/dsh-catpaw-0.1.6.tgz`；尚未发布新的 GitHub Release。

## 2026-11-02：本地 Catpaw 跟进流程与 0.1.1 候选

- 沿用 vendor 源码快照与 Harness 适配层；新增本地一键更新命令，不包含远程自动更新、GitHub 工作流或远程仓库修改。
- 固定 Catpaw 已提交源码 5c703811c179c592ca1c602383def7f395bdeaf9。该提交内版本为 0.1.3；本地未提交的 0.1.6 版本号没有混入。Electron 更新为 44.9.3，DOMPurify 更新为 3.4.17。
- 本地一键流程实际执行成功，完整构建、类型检查、6 项同步/流程测试和 10 项功能测试通过。覆盖错误来源、快照校验、接口差异、同步失败恢复、依赖分类、检查失败不打包、重试不重复增加版本。日志见 output/catpaw-update.log，结果见 output/catpaw-update-result.json。
- 额外在隔离副本中使适配审核记录过期，检查按预期失败并指出 electron/main.ts。
- 真实 Electron 后台验证全部接口覆盖、自动备份启动/手动执行/保留七份/重启持久化、Harness 模型共享额度、长文同意/拒绝/取消及跨客户端确认隔离。模型均为本地样本。
- 使用更新前后台建立独立阅读库，再用新后台打开：文章数、已读和收藏保持不变，schema 为 22。证据为 output/upstream-upgrade-result.json。
- 通过真实 Harness 0.2.1-rc.2 将候选包安装到 .dev/package-harness 的隔离配置，核对安装后的宿主、后台和界面文件与构建一致。首次 Electron 下载需使用已有环境代理，启用 NODE_USE_ENV_PROXY 后安装启动成功。正式 desktop 配置和阅读数据未修改。
- 隐藏 Chrome 页面验证自动备份状态、立即备份、开关保存和目录选择提示的取消；验证浏览器内长文确认和取消，1 Token 上限确实阻止翻译。截图见 output/playwright/catpaw-update-backups.png、catpaw-update-model-confirmation.png。
- 页面仅观察到本地 RSS 的外部 favicon 请求返回 404；未发现 Catpaw 页面运行异常。浏览器设置 10 分钟无操作自动退出，并在结束后关闭本轮会话及测试服务。

## 2026-11-02：v0.1.0 发布前检查

- 在 macOS / Apple Silicon、Node.js 24.9.0、DeepSeek Harness 0.2.1-rc.2 环境重新执行 `npm run check`：构建、类型检查和全部 6 项测试通过，无失败或跳过。日志：`output/release-v0.1.0-check.log`。
- 核对 `package.json` 与 `package-lock.json` 的运行、开发和宿主依赖声明一致；发布源码包含现有的 Harness 0.2.1-rc.2 适配更新。
- README 增加版本固定的 GitHub Release 安装包下载入口、桌面版界面安装步骤与命令行安装说明。界面文案与本机 0.2.1-rc.2 插件管理器文档及实现核对。
- 本次自动检查使用隔离测试数据，不修改用户现有的阅读数据；现有真实在线验收范围见下方 2026-11-01 记录。

## 2026-11-01：安装到现有桌面版并进行真实在线验收

本机 Harness Desktop 和其附带 CLI 均为 `0.2.1-rc.2`。项目的 Harness 依赖已更新到此版本，Cordis 和 Schemastery 开发依赖与桌面运行时一致。没有使用版本豁免。

- `npm run check`：构建、类型检查和全部 6 项测试通过，无失败或跳过。日志：`output/check-harness-0.2.1.log`。
- 使用桌面版附带的 `dsh plugin --profile desktop add <本地安装包>` 安装 `dsh-catpaw@0.1.0`。逐项核对已安装的前端、宿主和后台文件，均与本次构建一致。
- 桌面原生界面未开放自动操作权限；界面验收使用该桌面安装自带的 **同一份 0.2.1-rc.2 运行时**，启动 `catpaw-preview` Web 配置，加载 `desktop` 已安装的插件目录。未将独立开发环境的结果当作桌面原生界面验收。
- 正式阅读数据位于 `~/.dsh/data/catpaw`。通过真实页面添加 `https://github.com/deepseek-ai/deepseek-harness/releases.atom`，命名为“DeepSeek Harness 官方发布”，成功抓取 10 篇文章。
- 验证文章正文、当前订阅内搜索、无匹配搜索、已读状态和收藏。注意“全部未读”范围会排除已读文章；选中订阅后可搜索全部文章。
- Catpaw 复用 Harness 原有的 `deepseek-account / deepseek-flash` 配置，实际完成一篇文章的中文摘要和分段全文翻译。模型输出来自真实服务；未复制或展示模型密钥。
- 刷新页面并重新进入阅读器后，订阅、收藏、文章摘要和已保存译文仍可使用。
- 在“Catpaw 阅读器接入验收”会话中，真实模型成功调用 `catpaw_list_feeds`、`catpaw_search_articles` 和 `catpaw_read_article`。展开工具详情核对了实际返回的文章 ID、标题、正文和来源链接；正文返回 `excerptOnly: false`。
- `allowAgentWrites` 保持 `false`。安装前的桌面配置备份位于本项目 `.dev/desktop-profile-backup-20261101/`。

截图：

- `output/playwright/harness-0.2.1-live-reader.png`：真实文章、收藏、中文译文及摘要。
- `output/playwright/harness-0.2.1-ai-tools.png`：Harness 对话及 Catpaw 工具调用。

测试使用隐藏 Chrome 会话，设置 10 分钟无操作自动退出。结束后关闭测试浏览器和预览服务，使桌面应用可独占阅读数据库。

本轮环境问题：首次依赖更新遇到磁盘空间不足，清理了本项目旧验收环境和失败安装中可重新生成的依赖后重装成功；首次 Electron 下载因未使用环境代理而失败，使用 `NODE_USE_ENV_PROXY=1` 完成官方运行时下载后完整重测通过。浏览器观察到一次 Harness 账号资料读取错误（`deepseek-account` 的 profile 请求返回 403），但真实模型列表、摘要、翻译和对话工具调用成功；未发现 Catpaw 的页面异常。

## 2026-09-30 历史验收

验证日期：2026 年 9 月 30 日（本机时区）。插件版本：0.1.0。

## 验证环境和数据范围

- macOS / Apple Silicon，Node.js 24.9.0，Electron 44.2.0。
- DeepSeek Harness 0.2.0-rc.2；对应本地源码提交 `639ed015397290b3745d163aafe02ffee4aa3f84`。
- Catpaw 导入基线 `cdb8e60d07c08611b20bc24b85d08060f02358ab`；实际文件摘要见 `vendor/catpaw/SOURCE.json`。
- 全部测试使用独立的临时数据库和本项目 `.dev/` 数据目录，不访问现有 Catpaw 数据库、来源登录状态或真实模型密钥。
- 本机已安装的 Harness Desktop 0.1.7-rc.2 未修改。插件验收使用独立的 0.2.0-rc.2 Web 环境。

## 自动检查

执行 `npm run check`：构建、TypeScript 检查及 6 组测试全部通过，无跳过项。完整输出保存在 `output/check.log`。

| 测试文件 | 已验证内容 |
| --- | --- |
| `tests/backend.test.ts` | 请求格式和客户端标识校验；真实 SQLite 全文检索、空结果、错误参数与提前取消；通过 Harness 工具运行器查询和分页读取正文；工具卸载后重新注册；后台关闭、重启及重启与关闭同时发生时的清理 |
| `tests/reading.test.ts` | 真实 RSS 抓取、新文章增量、去重、HTTP 失败；取消排队请求不影响另一条抓取；分组、订阅、已读和收藏；OPML 导入去重与导出；备份校验、上传归属校验、恢复、回滚副本和恢复后的重启；删除工具获得批准、拒绝、取消、确认服务不可用的不同结果 |
| `tests/advanced.test.ts` | JavaScript 动态网页的浏览器正文提取；使用真实 Harness 模型运行器和本地适配器验证摘要、分段翻译、进度、缓存及重启后读取；截断输出不保存为成功结果；取消和调用方超时传播后可重试；不复制 Harness 密钥；Jev 智能筛选的设置、判断、反馈、缓存和取消 |
| `tests/bridge.test.ts` | 页面遇到后台尚未就绪的连接错误后，自动重载阅读数据和设置；卸载时停止重试和释放客户端 |

模型输出来自明确标记的本地测试服务。超时检查使用较短的调用方截止时间验证取消传播，未等待实际生产模型耗时。

## 浏览器实际操作

使用 Chrome 和 Playwright CLI，在真实 Harness 页面中完成：

- 打开 Catpaw 原生侧栏和阅读页面，添加本地 RSS 订阅、刷新并读取文章正文。
- 检查搜索、已读和收藏状态；AI 工具与页面读取同一数据库。
- 实际导出 OPML、下载数据库备份、上传备份、查看校验结果并确认恢复；恢复后订阅、文章和收藏保留。
- 配置标为“本地验收模型”的服务，生成摘要和译文，检查显示及缓存状态。
- 检查浅色、深色及窄屏的订阅／文章／阅读切换。
- 检查删除确认弹窗可以取消，取消后订阅和文章仍保留。

截图位于 `output/playwright/`：

| 文件 | 内容 |
| --- | --- |
| `phase1-reader.png` | 第一阶段的 Harness 阅读页面 |
| `phase2-restored.png` | 备份恢复后文章与收藏 |
| `phase3-translation.png` | 本地翻译流程 |
| `phase3-dark.png` | 深色阅读页面 |
| `phase3-narrow.png` | 窄屏阅读布局 |
| `installed-package.png` | 安装打包产物后的实际阅读页面 |
| `confirmation-cancel.png` | 浏览器内删除确认 |

本地 RSS 没有公共网站图标，外部图标服务会产生 404；不影响文章和阅读操作。停用及浏览器网络暂停时观察到请求中断。验收发现的重新启用加载顺序问题已修复：先注册请求入口，再等待后台就绪；连接恢复后重新载入页面数据。未发现插件自身的未捕获 JavaScript 异常。

## 安装与生命周期

- `npm run pack:plugin` 生成 `output/dsh-catpaw-0.1.0.tgz`。
- 通过真实 Harness CLI 和 pnpm 11.7.0 安装到隔离的 `package-check` 配置。安装原生 SQLite 依赖，并使用该配置自己的 Electron 运行时启动，未借用开发项目的 Electron 路径。
- 从安装后的插件界面导入 OPML、刷新订阅并显示文章。
- 在 Harness 插件管理页面停用并重新启用，检查侧栏、后台进程和数据保留。
- 停用后后台进程确实退出；重新启用后侧栏只有一个 Catpaw 入口，原订阅和两篇测试文章正常重新载入。
- 安装脚本按安装包内容生成独立路径，避免同版本本地压缩包被 pnpm 的路径缓存替代；启动前逐项核对安装后的前端、宿主和后台代码与当前构建完全相同。
- 安装包包含运行代码、来源记录、第三方声明和使用文档，不包含 `.dev/` 数据、测试账号信息或开发依赖目录。

安装日志中的 Harness 运行时 peer 提示来自配置的 `autoInstallPeers: false`。这些依赖由 Harness 的运行时解析器提供，前端 React 由宿主提供；已在真实宿主中加载验证，没有另外安装一套宿主运行时。另有原有 `jsdom` 的 `whatwg-encoding` 废弃提示，本轮未变更上游依赖以消除此提示。

复现安装验收（默认使用本项目隔离目录与端口 19394）：

```sh
npm run pack:plugin
node scripts/package-smoke.mjs
```

脚本只对自己的测试配置允许 `electron`、`better-sqlite3` 的安装步骤。正式安装说明见 `README.md`。

## 尚未进行的在线或跨平台验证

| 项目 | 当前结论 |
| --- | --- |
| 微信真实账号登录、受限文章 | 登录窗口和原抓取服务已接入；未用真实账号完成在线验收 |
| X、小宇宙、第三方 RSSHub 和外部媒体 | 保留原 Catpaw 的来源、正文和媒体处理路径；未逐站在线验证 |
| DeepSeek、OpenAI 兼容、Anthropic、Gemini 的真实模型请求 | 配置与调用路径已接入；本地协议测试通过，未验证真实鉴权、额度或模型质量 |
| Jev 线上服务 | 保留独立的判断协议；本地协议测试通过，未使用真实服务密钥 |
| 旧版 Harness Desktop、Windows、无图形桌面的 Linux | 不在本轮已验证范围内 |

这些项目需要相应账号、外部服务或运行环境，不能由本地样本测试得出在线可用性结论。
