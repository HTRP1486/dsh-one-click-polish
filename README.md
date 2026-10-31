# 一键润色 / 扩写 / 自动驾驶 · One-click polish, expand and autopilot for DSH

[![npm](https://img.shields.io/npm/v/dsh-one-click-polish?label=npm)](https://www.npmjs.com/package/dsh-one-click-polish)
[![license](https://img.shields.io/npm/l/dsh-one-click-polish)](LICENSE)
[![dsh plugin](https://img.shields.io/badge/dsh-plugin-4a6cf7)](https://github.com/HTRP1486/dsh-one-click-polish)

给 **DeepSeek Harness（dsh）** 桌面端的输入框加三个动作：**润色**、**扩写**、**自动驾驶**。所有模型调用都用**你当前会话正在用的那个模型**，结果直接写回输入框。

A **DeepSeek Harness (dsh)** plugin that adds polish / expand / autopilot to the composer. It rewrites your draft with the model the session is already switched to, turns a one-line wish into a workable brief, or drives a goal round after round by writing and sending the next prompt itself.

- 润色 · **Polish**：按需检索（本地文件 / 联网，两个开关独立）后重写草稿
- 扩写 · **Expand**：把一句话扩写成能直接开工的需求说明或成品
- 自动驾驶 · **Autopilot**：让 AI 读对话、写下一步提示词、发给助手，一轮接一轮推进到你设定的目标

安装 · Install：

```
dsh-one-click-polish
```

装好之后，输入框左下角多一排按钮 · The composer gains a row of buttons：

```
[+ 完全权限]  润色   扩写   自动
```

> 关键词 · Keywords：`dsh` `dsh-plugin` `deepseek-harness` `deepseek` `polish` `proofread` `rewrite` `expand` `autopilot` `loop` `composer` `润色` `扩写` `自动驾驶` `智能体`

---

## 需要什么

| 项 | 要求 |
| --- | --- |
| dsh | 桌面端（Web UI），带 `settings.section` / `conversation.input.left` / `shell.overlay` 槽位 |
| Node | ≥ 20 |
| 模型 | 会话里能正常发消息即可；润色用的就是这个模型 |

没有额外依赖，不需要 API key——插件借的是 dsh 已经配好的模型通道。

**关于思考过程**：只有**会输出思维链的模型**才会有逐字思考动画。不支持推理的模型（例如 `deepseek-v4.1-flash`）不会产生思考文本，面板会改为显示正在调用哪个工具和已用秒数。

## 安装

两种来源，功能完全一样：

| 来源 | 填什么 | 更新按钮 |
| --- | --- | --- |
| **npm** | `dsh-one-click-polish` | ✅ 有「可更新」 |
| GitHub | `https://github.com/HTRP1486/dsh-one-click-polish` | ❌ 只能看提交 |

### 方式一：npm（推荐）

打开 dsh → 设置 → 插件 → 添加插件，输入框里就填**包名**：

```
dsh-one-click-polish
```

不用加 `npm:` 前缀，也不用加版本号（默认装 `latest`）。

命令行等价写法：

```bash
dsh plugin --profile <你的 profile 名> install dsh-one-click-polish
```

**为什么推荐这个**：有明确的版本号，插件列表里能看到「卸载」，设置页里能看到「当前版本 / npm 上有新版」。

> ⚠️ dsh 的「更新」按钮只对**官方目录里的 bundle** 生效 —— 它用 `installTarget` 与官方清单比对，第三方插件永远拿不到。所以第三方插件更新一律是「卸载 → 按包名重装」。

> ⚠️ 如果装上去的版本比 npm 上的旧，是 pnpm 的 `minimumReleaseAge` 供应链策略在拦：发布时间未满观察期的版本不会被自动安装。把包名加进 profile 的 `pnpm-workspace.yaml`：
>
> ```yaml
> minimumReleaseAgeExclude:
>   - dsh-one-click-polish
> ```

### 方式二：GitHub

输入框里填仓库地址：

```
https://github.com/HTRP1486/dsh-one-click-polish
```

等价写法都行：

```
https://github.com/HTRP1486/dsh-one-click-polish
https://github.com/HTRP1486/dsh-one-click-polish.git
github:HTRP1486/dsh-one-click-polish
```

**末尾不要加斜杠**。加了会报 `a URL must point at a git repository or a tarball` —— dsh 的判断规则是 `^https?://主机/用户/仓库(.git)?$`，最后一段不允许出现 `/`。

**为什么用它**：跟最新提交走，不用等发版。但没有「可更新」按钮——想更新就是重装一次（`remove` 后 `install`）。

### 其他方式

| 方式 | 做法 |
| --- | --- |
| 本地目录 | target 填仓库的**绝对路径**，如 `C:\code\dsh-one-click-polish`。改代码即时生效，适合开发 |
| Release 包 | 从 [Releases](https://github.com/HTRP1486/dsh-one-click-polish/releases) 下 `.tgz`，target 填该文件的绝对路径 |
| **插件市场索引** | 见下方「插件市场」 |

### 插件市场

仓库根目录有一份 `market-index.json`，是 dsh 插件市场的**格式 1 索引**。把它加进市场的索引源，就能在「Discover」里看到这个插件并一键安装：

```
https://raw.githubusercontent.com/HTRP1486/dsh-one-click-polish/main/market-index.json
```

加进市场后，插件以中英文标题、描述、分类和关键词列出，点一下即装。

### 三种方式怎么选

```
只想用        → npm
要用最新代码   → GitHub
自己在改它     → 本地目录（link）
```

装完**重启 dsh**。判断是否成功：输入框左下角出现 `润色 | 扩写 | 自动`，设置里多出「润色 / 扩写」一页。

### 版本号

四处保持同步，每次发布一起改：

| 位置 | 当前 |
| --- | --- |
| `package.json` 的 `version` | `1.9.5` |
| npm 的 `latest` 标签 | `1.9.5` |
| GitHub 的 tag | `v1.9.5` |
| GitHub 的 Release（含 tgz） | `v1.9.5` |

发版一条命令：

```powershell
$env:GITHUB_TOKEN = 'ghp_...'   # 只勾 repo 权限就够，可设 7 天过期
.\release.ps1
```

`release.ps1` 会先做检查（工作区干净 / tag 未占用 / npm 上没有这个版本 / 两个文件语法 / 无 BOM / 仓库里没有运行时文件），再推送、打 tag、发 npm、建 Release 并上传同一份 tgz。`-DryRun` 只检查不发布。

`release.sh` 是同功能的 bash 版，给装了 bash 的机器用；本机只有 WSL 占位程序，跑不了。

token 从 `GITHUB_TOKEN` 环境变量读，不走命令行参数——参数会进 shell 历史，也会出现在进程列表里。

### 装不上时

| 报错 | 原因 |
| --- | --- |
| `a URL must point at a git repository or a tarball` | 地址末尾多了斜杠，或不是 `.tgz` 结尾 |
| `a local path must be absolute` | 填了相对路径或 `./xxx` |
| `unmet DSH version requirement` | 你的 dsh 版本低于插件要求 |
| 装的是旧版本 | pnpm `minimumReleaseAge` 观察期，见上方豁免写法 |
| 装完没生效 | 没重启。改 profile 的 bundles 后必须重启，刷新页面不够 |

## 用法

### 润色

打字 → 点 `润色` → 输入框上方出现过程面板 → 草稿被重写并写回。

**检索由两个开关决定**（设置 → 润色 / 扩写），默认都开，互不影响：

| 开关 | 开 | 关 |
| --- | --- | --- |
| 本地文件检索 | AI 翻项目目录和 dsh 配置目录，找相关文件 | 不查本地 |
| 联网搜索 | 必应 / 百度 / GitHub 检索 | 不联网 |

两个都关就纯改写草稿，不发任何检索请求。

检索不是关键词匹配：Host 把 `list_dir` / `read_file` / `search_files` / `search_content` / `web_search` 交给模型，由它自己决定查什么、要不要再追一轮。轮数、检索时长、改写时长都能在设置里调。**只读**，越出项目目录与 dsh 配置目录的路径会被拒绝。

改动前后可以对比：草稿被覆盖，`Ctrl+Z` 能撤回。

#### 过程面板

面板固定在输入框上方，**尺寸固定**（宽 ≤ 480px，高 348px），不会随进度跳动：

```
润色中                     12s    ✕
─────────────────────────────────
○ 本地检索
   正在调用 list_dir · 列目录：Documents
○ 联网搜索
○ 润色重写
```

- **三行任务**：本地检索 / 联网搜索 / 润色重写。关掉的开关显示为「已跳过」
- **每行预留两行思考空间**，没有内容也占位，所以行位置固定
- **逐字出现**：文字一批批到达，游标一点点推进（落后越多走得越快），不会整段砸下来
- **模糊渐清晰**：最新 9 个字符带模糊→清晰的过渡，跟着逐字走
- **两行上滚**：思考区固定两行，超出部分向上滑出，最新的永远在底部
- **计时**：标题右侧的秒数一直在走，长时间无输出也能看出没卡死
- **没有思维链的模型**：改为显示正在调用哪个工具，或「正在检索资料…」

**切换对话会自动取消**润色和扩写——它们属于发起时的那份草稿，草稿已经不在屏幕上了。自动驾驶不受影响，继续跑。

### 扩写

输入一句粗需求，例如 `帮我写一个登录功能`，点 `扩写`。

它先**判断你要的是哪一种**，再按那种形态写，第一行会说明它的判断：

| 形态 | 什么时候 | 输出 |
| --- | --- | --- |
| 要造的 | 你打算做或让别人做 | 需求说明：做什么、边缘怎么表现、怎么算做完 |
| 要货的 | 你想要成品本身 | 直接给成品（提示词 / 文案 / 模板 / 清单），提示词可直接粘贴，主题已填好 |
| 要判断的 | 句子里藏着一个选择 | 摆出取舍 + 带条件的建议，不给方案书 |

**它不会反问你。** 缺信息就按最可能的假设写完整答案，只在开头用一行标注 `我按「X」理解，要改说一声。`——因为扩写结果会写回输入框当草稿，如果产出的是一句提问，你按回车就等于把问题发给助手了。

它**不会替你决定范围**——不会自己宣布「不做注册、不做找回密码」，而是把这类分叉摆出来、说清楚每个选择会改变什么。它会读完整的对话历史（最近的对话保留全文，更早的压缩成一行摘要），所以知道你在做什么产品、哪些决策已经定了。

### 自动驾驶

点 `自动` 弹出面板：

```
自动驾驶
○ 循环几次结束      [ 5 ]
☑ 限制运行时间      [ 0 ] 小时  [ 30 ] 分钟
○ 直到达成目标结束

目标（可选）：写清楚要达成什么，达成后自动停；不填就只看轮数
[                                    ]

[ 启动 ]
```

点启动 → **确认弹窗** → 才真正开始（它会以你的身份往会话里发消息，所以先问一次）。运行中再点 `自动`：

```
运行中 3/5 · 已跑 12 分钟
上下文：8 条消息 / 1300 字
查看驱动 AI 读到的上下文

[ 中断 ]  [ 结束循环 ]
```

- **中断**：掐掉当前这一轮，循环继续，它会重新判断再发一条
- **结束循环**：整个关掉
- 轮数用尽 / 时间到 / 目标达成 / 出错 / 你点停 —— 五种情况都会立刻停机

停止条件可以叠加：`循环 5 次 + 填个目标` = 最多 5 轮，做完了提前收工。

**和润色互斥**：润色或扩写正在跑时，`自动` 按钮仍可点开面板，但「启动」是灰的，面板里会写一行「润色/扩写正在进行，完成后即可启动」。两个写入者同时改同一段草稿会互相覆盖。

**它读到的对话你能看见**：面板里的「查看驱动 AI 读到的上下文」会显示这一轮实际传给驱动 AI 的对话全文。

**它的思考和调用也能看见**：面板里的「查看思考与调用」会列出每一轮的推理、它调用了哪个工具、参数是什么、返回了什么，以及最终发给助手的那条消息。按类型上色：

```
思考 1      The draft is vague. I should look at the project directory…
list_dir    - index.js  - client.js  - locale
search_files  - dsh-one-click-polish  - cordis.patch.yml
思考 2       Likely a DSH plugin. Let me check the config directory…
已发送 1     请把这句话改得更正式：…
```

这份记录来自自动驾驶自己的任务（`GET …/progress?id=autopilot-<sessionId>`），**只包含自动驾驶的行**——会话日志是共享的，润色/扩写也会往里写，监视窗按 `run` 前缀把它们滤掉了。

**右侧贴边窗口**：点「在右侧显示」，思考窗会滑入屏幕右缘，跟着当前对话实时刷新（每 500ms 一轮），可以上下翻、折叠、关闭。切到别的对话时它会自己跟过去；那个对话没有记录时就是空的。思考文本同样逐字出现。

**按钮会报告上一次怎么结束的**：

| 按钮 | 含义 |
| --- | --- |
| 🔵 转圈 `自动 2/5` | 正在跑 |
| 🟢 `已完成` | 跑满轮数，或驱动 AI 判断目标达成 |
| 🔴 `出错` | 出错停下，点开能看到错误全文 |
| 🟡 `意外停止` | 它自己停下了：想不出下一步、助手一直在忙、或到了时长上限 |
| 🟡 `已中断` | 你手动停的 |

点开按钮能看到为什么停、读了哪些文件、完整思考记录，底部有「从中断处继续」（停下的情况）或「重新开始」+「清除状态」。

**设置页有每个对话的自动运行日志**：它读了哪些文件、调用了什么、发了什么，按会话归档，重启后仍在。长工具行和长思考行默认收起，点一下展开，收起时保留首行预览。

## 换窗口 / 重启 会怎样

| 场景 | 结果 |
| --- | --- |
| 切会话、切标签、最小化 | 自动驾驶继续跑（在 Host 进程里）；润色/扩写会被取消 |
| 切走再回来 | 自动驾驶继续跑，按钮上轮数跟着涨 |
| 重启 dsh | 不自动跑，面板里给「从中断处继续」按钮，点了才续 |

每轮都会把进度写进 profile 目录的 `.one-click-polish-autopilot.json`，重启后据此提供恢复入口。正常结束会自动清掉。

## 设置

**设置 → 润色 / 扩写**：

| 项 | 说明 |
| --- | --- |
| 模型来源 | `跟随当前对话`（默认）用输入框里选中的模型；`固定模型` 始终用指定那个 |
| 模型 | 选 `固定模型` 后出现，带搜索的下拉框，按供应商分组 |
| 思考程度 | 照 dsh 的 `Default / Low / High / Max` 做，**选项按该模型实际支持的档位生成**，不支持就整栏隐藏；换模型时旧档位自动回落 |
| 本地文件检索 | 润色/扩写时是否翻项目目录找相关文件，默认开 |
| 联网搜索 | 是否联网检索，默认开 |
| 等待助手完成上一轮的上限 | 自动驾驶要发下一条时助手仍在忙，等多久放弃。默认 5 分钟，可到 60 |
| 检索预算 | 查资料总共能用多久、最多几轮（5–300 秒 / 1–10 轮） |
| 改写预算 | 模型写答案这一步最多等多久（20–900 秒） |
| 自动运行日志 | 每个对话的自动驾驶记录，按会话归档 |

改动先留在页面上，点 `保存` 才写入，`撤销修改` 回到上次保存的状态。

打开这一页时会**强制刷新一次版本号**（绕过 Host 的 10 分钟缓存），所以「npm 上有新版」永远是最新的。

### 设置存在哪

写进 profile 目录的 `.one-click-polish-settings.json`，读取时**覆盖** `cordis.patch.yml` 里的 `config`，所以改了就会生效、重启也还在。

> 为什么不用 dsh 的配置写入：dsh 保存后会重新组合配置再比对，在这个 profile 上那个校验始终不通过，会报 `Configuration for "one-click-polish" is overridden by a home patch or command-line overlay` 并丢掉改动。文件层是自己的存储，不受它影响。

## 配置

也可以在 profile 的 `cordis.patch.yml` 里给这行写 `config`（当默认值用；设置页保存的值优先级更高）：

```yaml
- id: one-click-polish
  config:
    modelSource: follow        # follow | fixed
    provider: ''               # modelSource 为 fixed 时必填
    model: ''
    reasoningEffort: ''        # '' = 默认；否则必须是该模型支持的档位
    useLocalLookup: true       # 本地文件检索
    useWebSearch: true         # 联网搜索
    maxInputChars: 12000       # 单次输入字符上限
    timeoutMs: 120000          # 单次改写预算
    exploreMs: 45000           # 检索预算
    exploreRounds: 4           # 最多检索几轮
    idleWaitMs: 300000         # 等助手空下来的上限
    instruction: ''            # 追加给模型的额外要求
```

## 原理

- **模型解析**在 Host 侧：会话日志里最新的 `model/selection` → 最近一次 `request/header` → profile 默认模型。所以模型选择器切到哪个就用哪个，切了还没发消息也认得。
- **润色 / 扩写**是手工构造的 `llm.stream()`：不写会话日志、不开 Turn、不动对话历史，只借一次模型能力。
- **长任务用 202 + 轮询**：桌面 webview 会掐断长时间静默的请求，所以 `POST …/polish` 立刻返回 202，浏览器轮询 `GET …/progress` 取结果。
- **自动驾驶**用 `agent.followup()` 往会话里追加用户消息并唤醒，用 `await agent.whenIdle()` 等这一轮跑完。每轮按 session id 重新取 agent，所以切换会话销毁重建 agent 也不影响。
- **面板渲染**在 `shell.overlay` 槽位（`conversation.chat.node` 的 key 已被占满，不能借用）。行位置靠固定高度 + 每行预留两行思考来稳定；逐字和滚动都是客户端动画，不影响请求。

## HTTP 接口

都在 `/plugins/dsh-one-click-polish` 下：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/polish` | 提交润色/扩写任务，返回 202 + requestId |
| GET | `/progress?id=` | 轮询任务状态与结果 |
| GET/POST | `/settings` | 读/写设置与模型目录 |
| GET | `/version` | 当前版本与 npm 最新版（`?refresh=1` 绕过缓存） |
| GET | `/efforts?provider=&model=` | 某模型支持的思考档位 |
| GET/POST | `/autopilot` | 读/写自动驾驶状态，`?resumable=1` 列可恢复的运行 |
| GET | `/runs` | 按会话归档的自动运行日志；`?sessionId=` 取某会话 |
| POST | `/translate` | 把思考文本翻成中文（必应 / 谷歌，失败返回原文） |
| GET | `/status` | 当前会话解析到的模型 |
| GET | `/diag` | 排查用：会话、目录、上下文快照 |

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半身：模型解析、检索、改写、轮询任务、自动驾驶驱动 |
| `client.js` | 浏览器半身：工具栏按钮组、过程面板、右侧思考窗、设置页、确认框 |
| `cordis.patch.yml` | 插件行声明（不写 `config`，让设置页拥有配置） |
| `locale/*.json` | 插件管理页的标题与描述 |
| `market-index.json` | 插件市场索引 |
| `release.ps1` / `release.sh` | 发版：检查 → 推送 → npm → GitHub Release |
| `TESTING.md` | 测试纪律：自动驾驶会真往会话里发消息，不能拿真实对话试 |

## 出问题怎么查

**按钮没出现**

1. 确认插件真的加载了：设置 → 插件 里能看到 `dsh-one-click-polish`
2. 重启 dsh（改 `package.json` 的 bundles 后必须重启，刷新页面不够）
3. 打开 `http://127.0.0.1:<dsh 端口>/plugins/dsh-one-click-polish/status`，返回 `{"ok":true,...}` 就是活着

**按钮出现了但点了没反应**

打开同一端口下的 `/diag`，看 `processCwd` 和 `profileDir`。如果 `profileDir` 是空的，说明插件认不出 profile 目录（判断依据是那个目录里要有 `cordis.patch.yml`，且不含 `package.json` + `client.js`）。

**面板看起来卡住**

看标题右侧的秒数：

- **秒数在走** → 没卡，在等检索或模型。检索最长可以跑到「检索预算」那么多秒，没有思维链的模型期间没有文字可显示
- **秒数停住** → 真卡了。润色有 135 秒超时、扩写 240 秒，到点会报错并关闭面板

**润色一直转圈不结束**

设置页把「检索预算」和「改写预算」调大。联网检索在慢网络下很容易吃满预算。

**自动驾驶自己停了**

按钮颜色会告诉你原因，点开有全文：

| 颜色 | 原因 |
| --- | --- |
| 🟡 意外停止 | 驱动 AI 想不出下一步 / 助手一直在忙（超过等待上限）/ 到了时长上限 |
| 🟠 已中断 | 你自己点的 |
| 🔴 出错 | 具体错误在面板里，红字 |
| 🟢 已完成 | 跑满轮数或目标达成 |

停下不等于失败：底部有「从中断处继续」，从已跑的轮数接着来。

**自动驾驶点「启动」没反应**

会先弹确认框。如果确认框没出现，说明 `shell.overlay` 里的确认框注册没激活（React 遇到渲染异常会停用整个注册）——`Ctrl+F5` 强刷一次，还不行就重启 dsh。

**扩写结果里出现提问**

1.9.5 之前提示词里有一个「要问的」形状，产出就是一句提问。现在已删除，并且规定不许以提问结尾。升级到 1.9.5 以上。

**想复盘它做了什么**

设置 → 润色 / 扩写 → 自动运行日志，按会话列出每一次运行：读了哪些文件、调用了什么工具、发了什么消息。或者面板里点「查看思考与调用」。

**看到的上下文不完整**

长对话会被压缩：最近的保留全文，更早的压成一行摘要，中间放不下的丢掉并标注「中间省略了 N 条」。面板上会显示「压缩省略 N 条」。想让它看更多，就在目标里写得具体一点。

## 隐私

- 插件**只读**本地文件。越出项目工作目录和 dsh 配置目录的路径会被拒绝。
- 敏感文件名和目录**一律不读不列**：cookie、凭据、`id_rsa`、`.env`、微信 / QQ 数据目录、`node_modules`、`.git` 等。
- 自动驾驶每轮的推理、工具调用、发出的消息会写到 profile 目录下的 `.one-click-polish-log.json`，**按会话归档**；设置项写在 `.one-click-polish-settings.json`；自动驾驶进度写在 `.one-click-polish-autopilot.json`。这些文件只在你的机器上，不会上传。不想要就删掉。
- 插件不会把运行时数据写进自己的源码目录。

## 许可

MIT
