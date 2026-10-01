# DSH-RSS

将 Catpaw 阅读器接入 DeepSeek Harness：在侧栏阅读 RSS，并让会话中的 AI 查询阅读资料。阅读页面与 AI 工具使用同一个后台和独立数据目录。插件包名称为 `dsh-catpaw`。

这是本地可安装的 `0.1.0` 插件，适配 **DeepSeek Harness 0.2.0-rc.2**，已在独立的 Web 环境中验证。旧版 Harness 不在兼容范围内；详细验证记录见 [VALIDATION.md](VALIDATION.md)。

## 本地运行

需要 Node.js 24 或更新版本，以及 macOS 图形桌面环境。

```sh
git clone https://github.com/selenaking2025/DSH-RSS.git
cd DSH-RSS
npm ci
npm run check
npm run dev
```

打开启动日志中的地址。默认端口为 `19393`；首次进入 Harness 的模型配置引导可选择稍后配置，再点击侧栏 **Catpaw**。基础阅读不需要模型密钥。

开发环境的位置：

| 内容 | 目录 |
| --- | --- |
| 隔离的 Harness 配置 | `.dev/harness` |
| 阅读数据库和来源登录状态 | `.dev/reader-data` |
| 本地 RSS 验收服务 | `node tests/fixture-server.mjs`，地址 `http://127.0.0.1:19404/rss` |
| 本地模型验收服务 | `node scripts/fixture-model.mjs`，地址 `http://127.0.0.1:19405/v1`，仅返回测试样本 |
| 页面截图 | `output/playwright` |

开发数据中使用的“Catpaw 本地验收订阅”和“本地验收模型”是测试样本。要重新抓取样本或生成测试译文，先分别启动上表中的本地服务；已有文章和缓存仍可直接阅读。正式安装的空数据目录不会自动添加这些样本。开发模式关闭自动刷新；正式插件遵循阅读器中的刷新设置。

## 生成与安装插件包

```sh
npm run pack:plugin
```

生成 `output/dsh-catpaw-0.1.0.tgz`。在 **0.2.0-rc.2** 的 Harness 插件管理器中安装此文件；不要对旧宿主强制放行版本检查。

也可在已安装相同版本的 Harness CLI 环境中执行：

```sh
dsh plugin --profile web add /绝对路径/dsh-catpaw-0.1.0.tgz
```

pnpm 会检查依赖的安装脚本。此插件的 Electron 运行时和 SQLite 依赖需要安装步骤；如安装界面列出待允许项，仅允许该次安装实际列出的 `electron`、`better-sqlite3` 等所需依赖后重试。不要全局放开所有安装脚本。本项目使用固定的 pnpm 11.7.0，`npm run dev` 自动优先使用它。

首版需要在运行 Harness 的电脑上启动一个独立 Electron 后台，以复用 Catpaw 的网页抓取和登录浏览器。它不会再打开一套阅读器窗口。微信登录会在该电脑上打开专用窗口；远程浏览器访问 Harness 时，登录窗口仍出现在服务器所在的桌面。尚未验证 Linux 无图形环境、Windows 和旧版 Harness。

## 数据和设置

默认正式数据位置为 `$DSH_HOME/data/catpaw`；未设置 `DSH_HOME` 时为 `~/.dsh/data/catpaw`。可在插件 `catpaw` 的配置中修改 `dataDir`。

插件不会自动打开原 Catpaw 的数据库。迁移时先在原 Catpaw 中导出阅读数据备份，再通过新阅读器 **添加 → 应用与数据 → 从备份恢复** 上传。恢复前显示订阅与文章数量；确认后保存当前数据库副本，再重新启动后台完成恢复。回滚副本位于所配置数据目录的 `backups/`。浏览器备份和恢复上限为 32 MB；更大的数据库应在停止两个后台后由管理员离线迁移。

阅读数据备份包含文章、订阅、分组、阅读状态、收藏、摘要和译文。模型密钥、模型配置、微信登录状态不包含在数据库备份中。OPML 用于订阅列表的导入和导出，不能代替阅读数据备份。

插件停用或 Harness 退出时会停止自己的任务并关闭数据库；已保存内容保留，重新启用后继续使用。一个数据目录同一时间只能由一个 Catpaw 后台占用。

## 模型接入

摘要和翻译有两条路径：

1. **使用 Harness 已配置模型**：在 `catpaw` 插件配置中同时设置 `harnessProvider` 和 `harnessModel`，值使用 Harness 模型设置中的实际提供方 ID 和模型 ID。重新加载插件后，Catpaw 的摘要和翻译模型列表出现“**Harness 已配置模型**”。请求通过 Harness 的模型服务发送，密钥不会复制到 Catpaw，也不会通过浏览器传递。
2. **单独配置 Catpaw 提供方**：进入 **添加 → API Key**，配置现有 OpenAI 兼容、Anthropic 或 Gemini 提供方，然后在摘要设置、翻译设置中选择模型。模型配置只写入本插件的数据目录。

插件配置示意；模型名称须替换成当前 Harness 中实际配置的值：

```yaml
- id: catpaw
  config:
    dataDir: /绝对路径/catpaw-data
    allowAgentWrites: false
    disableScheduler: false
    harnessProvider: YOUR_HARNESS_PROVIDER_ID
    harnessModel: YOUR_HARNESS_MODEL_ID
```

**精选/智能筛选继续使用 Catpaw 的 Jev 判断接口**，在“精选设置”中配置。Jev 返回概率与评分，其协议不同于普通聊天模型，因此不把 Harness 文本模型冒充为 Jev。关注事项、筛选结果、反馈、取消与缓存均保留。

正文补全、媒体内容、社交线程、来源健康和微信登录沿用原有 Catpaw 服务。微信、付费 API、X 以及外部网站的在线可用性需要用户自己的账号和当前来源权限；本轮没有使用已有应用的账号或密钥。

## AI 工具与权限

默认提供 `catpaw_list_feeds`、`catpaw_search_articles`、`catpaw_read_article`。正文返回来源链接并可分页；AI 读取不会自动改变已读状态。

将 `allowAgentWrites` 设为 `true` 后，增加标记已读、切换收藏、添加/编辑订阅、创建分组以及刷新/历史补全工具。删除订阅工具仅在 Harness 的用户确认服务可用时注册，每次删除须获得当前会话的明确确认。取消或无法取得确认时保留数据。备份恢复、模型密钥和微信登录不作为 AI 工具暴露。

界面操作由登录 Harness 的用户发起，不受 AI 修改开关影响。抓取任务显示进度，取消一条 AI 抓取请求不会取消另一个客户端的任务；页面上的“取消任务”用于停止该阅读器的整体抓取队列。

## 开发与验证

```sh
npm run sync:catpaw -- /绝对路径/catpaw
npm run check
```

`vendor/catpaw/SOURCE.json` 记录导入提交、当时的工作区变更和每个文件的 SHA-256。原 Catpaw 仓库不被修改。构建将源码复制到 `.generated/` 后应用适配；受适配的原文结构发生变化时，构建会要求检查对应适配脚本。

| 位置 | 作用 |
| --- | --- |
| `src/client` | Harness 页面、阅读接口、文件上传下载和样式隔离 |
| `src/host` | Harness 插件、AI 工具、后台生命周期和模型转发 |
| `src/backend` | Catpaw 后台入口、调用校验、数据维护和原生窗口生命周期 |
| `scripts/adapt-*.mjs` | 原 Catpaw 任务取消及模型接入的构建适配 |
| `tests` | 使用真实 Electron 后台、SQLite、Harness 工具/模型运行器的隔离测试 |

运行记录见 [PLAN.md](PLAN.md) 和 [VALIDATION.md](VALIDATION.md)。自动测试用本地 RSS、动态网页和模型协议样本验证，不消耗真实模型额度；这些结果不代表真实账号已经完成在线验收。
