# 提示词：dsh-one-click-polish 产品演示片

> 交给视频生成 AI 的完整任务书。
> 目标：45–50 秒产品演示短片，**真实 dsh 界面 + 鼠标交互 + 3D 运镜**，不是纯文字动画。

---

## 零、先读本文件附录里的真实源码

**在写任何代码之前，先读本文件末尾的三个附录。**

它们不是描述，是**从真实程序里导出来的源码**：

| 附录 | 内容 | 权威性 |
| --- | --- | --- |
| **附A** | dsh 本身的真实样式：完整色板 token + 布局规则 | 最高 |
| **附B** | 这个插件的真实样式：206 条规则 | 最高 |
| **附C** | 界面渲染逻辑：两个组件的真实源码 | 高 |

**附录优先于本提示词里的任何描述。**
文字描述和 CSS 冲突时，**以 CSS 为准**。

### 怎么用

1. **色值**：`dsh-ui-reference.css` 顶部的 `:root { --dsw-* }` 块就是真实色板。
   直接用其中的十六进制值，不要自己调色。
2. **控件尺寸**：`plugin-ui.css` 里的 `.dsh-op-btn` 等类给出真实高度、内边距、圆角。
   工具栏按钮是 `height: 28px`，不是随手定的。
3. **渲染逻辑**：`client.js` 里的 `PolishButton` / `ProgressPanel` / `ThinkWindow` 函数
   展示了真实界面的元素顺序、文案、状态判断。**照它渲染的样子拍。**

---

## 一、dsh 界面真实规格

### 配色（dark 模式）

从 `dsh-ui-reference.css` 解析出的实际值：

```css
--dsw-alias-bg-base:        #151517   /* 整个 app 底色 */
--dsw-specific-sidebar-fill:#1b1b1c   /* 左栏，比主背景略浅 */
--dsw-alias-bg-layer-1:     #232324   /* 卡片、面板 */
--dsw-alias-bg-layer-2:     #2c2c2e   /* 输入框底 */
--dsw-alias-bg-overlay:     #61666b   /* 浮窗 */
--dsw-alias-border-l1:      #ffffff0f /* 主边框，极淡 */
--dsw-alias-border-l2:      #ffffff1f /* 次边框 */
--dsw-alias-brand-primary:  #f9fafb   /* 近白 */
--dsw-alias-label-primary:  #f9fafb   /* 主文字 */
--dsw-alias-label-secondary:#cfd3d6   /* 次要文字 */
--dsw-alias-state-success-primary: #22c55e
--dsw-alias-state-warn-primary:    #f59e0b
--dsw-alias-state-error-primary:   #f25a5a
```

### ⚠️ 最重要的一条纠正

**dsh 深色模式下 `brand-primary` 是 `#f9fafb`（近白），不是蓝色。**

高亮、主按钮、选中态、焦点框全部用近白。上一版视频用了蓝色高亮，这是根本错误。

唯一出现蓝色系的地方是**助手头像的四角星图标**（约 `#4A6CF7`），那是品牌标识，不是交互色。

### 圆角（逐字使用）

```
--dsw-radius-xs:    4px
--dsw-radius-sm:    8px
--dsw-radius-md:    12px
--dsw-radius-lg:    16px
--dsw-radius-xl:    20px
--dsw-radius-panel: 28px   /* 设置面板、浮窗 */
```

输入框 **16px**，浮窗 **28px**。

### 阴影

```css
--dsw-elevation-prominent: var(--dsw-elevation-stroke), 0 3px 8px 0 #0000000a, 0 0 20px 0 #0000000d;
```

极轻。**不许加重阴影，不许加发光。**

### 界面结构（三栏）

```
┌────────────┬──────────────────────────────┬─────────┐
│  左栏       │        对话流                 │ 右栏    │
│ sidebar-fill│        自适应，内容居中        │ 可折叠  │
│            │      bg-base                 │         │
│ · deepseek │  [用户消息：右对齐气泡]        │         │
│   HARNESS  │                              │         │
│            │  [助手回复：左对齐，无气泡]     │         │
│ [+ 新会话]  │                              │         │
│            │                              │         │
│ · 插件     │                              │         │
│ · 自动化任务│                              │         │
│ · 更多     │                              │         │
│            │                              │         │
│ 工作区      │                              │         │
│ · desktop  │                              │         │
│ · Documents│   ┌──────────────────────┐   │         │
│            │   │  输入框（圆角 16px）   │   │         │
│ 会话列表    │   │  帮我润色：这个插件... │   │         │
│ · xxx      │   │                      │   │         │
│ · xxx      │   │ [+ 完全权限] 润色 深度 │   │         │
│            │   │            扩写  自动  │   │         │
│            │   └──────────────────────┘   │         │
│ bottom     │  [deepseek-v4.1-flash Max]   │         │
│ · 设置     │                              │         │
└────────────┴──────────────────────────────┴─────────┘
```

**真实细节**（必须表现，依据 `client.js` 与前端 CSS）：

| 元素 | 真实形态 |
| --- | --- |
| 左上角 | `deepseek` 字标 + `HARNESS` 小灰底徽章 |
| 新建 | 宽胶囊按钮占满左栏，居中 `+ 新会话` |
| 左栏导航 | 图标 + 文字，行高紧凑，无背景（hover 才极淡） |
| 工作区标题 | 小字，次要色 |
| 会话项 | 单行标题 + 右侧灰色时间戳 |
| **用户消息** | **右对齐，圆角气泡**，`bg-layer-1` 底 |
| **助手回复** | **左对齐，无气泡**，文字直接铺在 `bg-base` |
| 助手头像 | 小四角星图标 |
| 输入框 | **16px 圆角**，`bg-layer-2` 底，`border-l1` 边 |
| 工具栏按钮 | **28px 高**小胶囊（见 `plugin-ui.css` 的 `.dsh-op-btn`） |
| 右下角 | 模型名 `deepseek-v4.1-flash` + 思考档位 `Max` |
| 发送键 | 圆形，`brand`（近白）底，内有向上箭头 |

**禁止出现的**：

```
❌ 背景网格线
❌ 发光、光晕、霓虹
❌ 玻璃拟态
❌ 蓝色交互高亮
❌ 圆角气泡包住助手回复
❌ 没有左栏的浮动卡片
❌ 编造的 logo、进度条、统计数字
```

---

## 二、插件本身的真实界面

**这一节的权威来源是「附B」和「附C」。** 下面只是导读。

### 工具栏（插件加的四个，在输入框底部一行）

```
[ ⊕ 完全权限 ⌄ ]   润色   深度   扩写   自动
```

- `完全权限` 是 dsh 自带的权限选择器
- **`润色` `深度` `扩写` `自动` 是插件加的**
- 按钮样式见 `.dsh-op-btn`：`height:28px`、`padding:0 10px`、`gap:5px`、圆角 `8px`

### 润色档位

点 `深度` 胶囊循环切换：`轻度 → 标准 → 深度`。

### 自动驾驶面板（`.dsh-op-pop`）

```
自动驾驶
○ 循环几次结束      [ 5 ]
● 直到达成目标结束
目标：把登录功能做完，能跑通测试
[          启动          ]
```

样式：`bg-overlay`，`radius-panel` 28px 圆角，宽 288px，极轻阴影。

### 右侧思考窗（`.dsh-op-think`）

宽 **300px**，最高 420px，`radius-panel` 圆角：

```
自动思考                       12   —  ✕
──────────────────────────────────────
⟳ 思考 1    The draft asks for a login flow…
▸ read_file  读文件: src/auth.js
▸ 思考 2    需要先看现有鉴权结构。
● 已发送 1  先把 src/auth.js 的鉴权逻辑读一遍
```

- 行首标记：`⟳`（转圈，进行中）/ `▸`（折叠）/ `●`（绿点）
- 标签近白，工具行更暗（`label-secondary` 降透明度）
- `已发送` 行用绿色 `#22c55e`
- 标题栏右侧有计数胶囊 + `—` 折叠 + `✕` 关闭

### 状态四色（见 `plugin-ui.css` 的 `data-state` 规则）

| 按钮文字 | 颜色 | 含义 |
| --- | --- | --- |
| 🔵 转圈 + `自动 2/5` | `brand` 近白 | 正在跑 |
| 🟢 `已完成` | `#22c55e` | 跑满轮数或目标达成 |
| 🔴 `出错` | `#f25a5a` | 出错停下 |
| 🟡 `意外停止` | `#f59e0b` | 它自己停下 |
| 🟡 `已中断` | `#f59e0b` | 你手动停 |

---

## 三、硬约束

| 约束 | 要求 |
| --- | --- |
| **必须读那三份文件** | 不读就写代码 = 必错 |
| **不做纯文字片** | 主体是**真实 dsh 界面的 3D 空间** |
| **鼠标驱动** | 悬停、点击、按压（0.96 + 涟漪），光标滑入 |
| **一个形状贯穿** | 不硬切，同一元素变形，中间短模糊 |
| **镜头要推** | 焦点状态放大占满画面，不许留空 |
| **弹簧动效** | 闭环阻尼解析解，极轻过冲，禁弹跳 |
| **节奏跟音乐** | 约 120 BPM，先定歌再排戏 |
| **逐字使用真实色号圆角** | 见 `dsh-ui-reference.css` |

---

## 四、分镜（6 场，约 48 秒）

### 场景 1 · 0:00–0:07 — 界面进来

dsh 三栏**从下方浮入**，每个面板当 2px 挤出。

镜头：全景（窗口占 75%）→ 推近输入框。

输入框内已有粗糙草稿：

```
帮我润色：这个插件支持本地检索和联网
```

鼠标从右下进入 → 滑到 `润色` → 按钮**抬起**（`border-l2` 变亮）→ **按下**（0.96 + 近白涟漪）→ 松开。

**要点**：这一场必须让观众认出"这就是 dsh"。

---

### 场景 2 · 0:07–0:15 — 它在查

档位标签 `深度`。

`润色` 按钮**变形成进度胶囊**（宽度拉伸，圆角不变，内容换成转圈 + 检索中）。

胶囊**向下长成竖面板**（`bg-overlay` + 28px 圆角），三行真实滚动：

```
列目录：dsh-one-click-polish
读文件：README.md — 4.6 KB
搜索：cordis.patch.yml
```

每行右侧**滑入微缩图标**（文件夹/文件/齿轮）再淡出。

镜头：面板出现时推近占满画面。三行独立进出时序，旧行先退。

---

### 场景 3 · 0:15–0:23 — 写回来

面板**收拢**成胶囊 → 缩回按钮。

输入框文字**逐字替换**：

```
旧：帮我润色：这个插件支持本地检索和联网
新：这个插件同时支持本地文件检索与联网搜索。
```

旧字**左滑出 + 模糊**，新字**右滑入 + 清晰**，不重叠。

微交互：替换完成瞬间，输入框边缘一道**极细近白扫光**从左到右（0.4 秒）。

镜头：拉远露出完整输入框。

---

### 场景 4 · 0:23–0:32 — 一句话变一份活

输入框清空 → 鼠标点进去 → **快速打字**：

```
帮我写一个登录功能
```

打字骑 32 分音符。鼠标移到 `扩写` → 按下。

`扩写` 按钮**炸开成卡片**（按钮 → 横向拉伸 → 变高 → A4 文档卡），`bg-layer-1` + `radius-lg`：

```
要造的
· 做什么：账号密码登录
· 边缘：密码错误 / 账号不存在 / 重复注册
· 算做完：能登录、能登出、错误有提示
```

三节各占一拍，字**逐词落位**。

镜头：推近"要造的" → 拉远露出整卡。

---

### 场景 5 · 0:32–0:42 — 它自己往下走

卡片**折叠**成横条 → 滑到下方变成自动驾驶面板（`bg-overlay`，28px 圆角，288px）：

```
自动驾驶
○ 循环几次结束      [ 5 ]
● 直到达成目标结束
目标：把登录功能做完，能跑通测试
[          启动          ]
```

`启动` 是**近白实心**按钮，其余描边胶囊。

点 `启动` → 面板收成胶囊 → 转圈 + `自动 1/5`。

**关键**：胶囊**右滑出画面** → 镜头跟随，进入**右侧贴边思考窗**（300px，28px 圆角）：

```
自动思考                       12   —  ✕
──────────────────────────────────────
⟳ 思考 1    The draft asks for a login flow…
▸ read_file  读文件: src/auth.js
▸ 思考 2    需要先看现有鉴权结构。
● 已发送 1  先把 src/auth.js 的鉴权逻辑读一遍
```

行逐条追加，每条一声"嗒"。`已发送 1` 出现时绿色闪一次。

镜头：推近"已发送" → 慢拉远露出窗口在右缘。

**要点**：全片最有说服力的一段 —— AI 在自己推进。

---

### 场景 6 · 0:42–0:50 — 完成与签名

思考窗转圈**变形成绿色对勾**（圆环→勾，0.3s）。标题胶囊转绿 `#22c55e`，文字 `已完成`。

窗口**收拢**成小胶囊，落回输入框工具栏 `自动` 位置。

镜头快速拉远 → 完整三栏露出 → 界面**整体下滑出** → 只剩胶囊浮中央。

胶囊变 Logo：圆角矩形 → 方形 → 星形（三步 morph），最后一步落最重拍。

**签名**（居中）：

```
dsh-one-click-polish

一键润色 / 扩写 / 自动驾驶

npm i dsh-one-click-polish
```

第三行等宽字体，字符逐个弹簧落位。

**加一行更小的**：

```
https://github.com/HTRP1486/dsh-one-click-polish
```

声音：最后一声低频"踩"在最重拍，随后 1 秒静默。

如循环，最后一帧 = 第一帧（光标位置速度也要对上）。

---

## 五、音乐

约 120 BPM，build → drop → 收束，气质现代克制（参考 Linear / Vercel 发布片）。不要重复合成器循环。

| 段落 | 音乐 | 画面 |
| --- | --- | --- |
| 0:00–0:07 | 前奏稀疏 | 界面浮入、点击 |
| 0:07–0:15 | build 军鼓 | 检索滚动 |
| 0:15–0:23 | **drop** | 文字替换完成 |
| 0:23–0:32 | 主歌稳定 | 打字、卡片展开 |
| 0:32–0:42 | 次高点 | 自动驾驶跑起来 |
| 0:42–0:50 | 收束 + 最后一踩 | 完成、Logo、签名 |

音效（合成，按峰值对齐踢鼓）：悬停 30ms 气声 / 点击两声 / 面板摩擦 / 替换"刷" / 行落"嗒" / 完成"叮" / Logo 低频"踩"。

音量：不许盖过音乐，同拍不堆三个以上。

---

## 六、技术实现

一个 HTML 文件，样式全由 `seek(t)` 算。

- 禁 CSS transition / 禁定时器 / 禁帧间状态
- 弹簧用闭环阻尼阶跃响应解析解
- 需 T 时刻到位 → 提前一个回落时长发起
- 胶囊前后缘用不同弹簧产生拉伸
- 滚动数字用等宽数字 + 只做竖向裁剪
- 相机用 `perspective(1200px)` + `translateZ` + `scale`

**坑**：不要给相机缩放的元素加 `will-change`，文字会糊。

渲染：每拍一帧 → contact sheet 检查 → 转场 ±0.1s 检查 → **低速看动起来的草稿** → 全片 Playwright 子帧 + ffmpeg tmix 运动模糊 → 60fps H.264 → 逐秒 storyboard + 帧差扫描验证 MP4。

---

## 七、验收清单

拍完全部对照，任一不符就改：

**颜色与形状**
- [ ] 左栏 `#1b1b1c`，主背景 `#151517`（不是纯黑）
- [ ] 品牌高亮是**近白 `#f9fafb`**，不是蓝色
- [ ] 输入框圆角 **16px**，浮窗 **28px**
- [ ] 工具栏按钮 **28px 高**

**界面元素**
- [ ] `deepseek` + `HARNESS` 徽章
- [ ] `+ 新会话` 宽胶囊
- [ ] 工作区列表（desktop / Documents）
- [ ] 左下角设置入口
- [ ] 右下角 `deepseek-v4.1-flash` + `Max`
- [ ] 工具栏 `完全权限 | 润色 | 深度 | 扩写 | 自动`（顺序不能变）
- [ ] 用户消息**右对齐气泡**，助手回复**左对齐无气泡**

**插件界面**
- [ ] 思考窗 300px 宽，标题栏有计数 + `—` + `✕`
- [ ] 完成态是**绿色对勾 `#22c55e`**

**禁止项**
- [ ] 背景没有网格线、光晕、霓虹
- [ ] 没有玻璃拟态糊成一片

**结尾**
- [ ] 有 `npm i dsh-one-click-polish`
- [ ] 有 GitHub 地址

---

## 八、交付

```
deliver/
  dsh-one-click-polish-demo.mp4      成片 60fps
  storyboard.mp4                     逐秒 storyboard
  stills/                            6 张关键帧
  notes.md                           分镜表、DECISION、音频说明
```

`notes.md` 必须写清：

- 每场取景与关键交互
- **引用了附录里哪些真实规则**（哪一行 CSS 决定了哪个尺寸）
- 哪些是真实行为，哪些为片子简化（**不许虚构结果**）
- 所有创作决定，方便一票否决
- 音频是真听过还是只测过峰值

---

## 九、创作自由度

**你是导演。** 场景数、时长、运镜你定，可加删细节。

**唯一不可动的：**

1. **先读附录 A / B / C**
2. 逐字使用真实色号、圆角、尺寸
3. 鼠标驱动的真实界面演示
4. 一个形状贯穿
5. 3D 镜头推动
6. 结尾放安装命令和仓库地址

要改某一场的讲法，改，并在 `notes.md` 写清理由。


---

# 附A · dsh 真实样式

> 从 `dsh-web-frontend/dist/assets/index-*.css`（77 KB）与
> `dsh-client-ui-theme/lib/client.js` 提取。
> 上半部分是设计 token（已解析成十六进制），下半部分是真实布局规则。

```css
/* ============================================================
   dsh real layout reference — extracted from the shipped app
   Source: dsh-web-frontend/dist/assets/index-*.css (77 KB)
   and dsh-client-ui-theme/lib/client.js (token definitions)
   ============================================================ */

/* ---------- design tokens ---------- */
:root {
  --dsw-font-family: var(--dsh-font-family-text,var(--dsh-font-family-text-default)), var(--dsh-font-family-text-default);
  --dsw-font-family-brand: \"Montserrat\", var(--dsh-font-family-text-default);
  --dsw-radius-xs: 4px;
  --dsw-radius-sm: 8px;
  --dsw-radius-md: 12px;
  --dsw-radius-lg: 16px;
  --dsw-radius-xl: 20px;
  --dsw-radius-panel: 28px;
  --dsw-alias-settings-card-fill: var(--dsw-alias-bg-layer-2);
  --dsw-alias-settings-card-stroke: var(--dsw-alias-border-l4);
  --dsw-corner-shape: superellipse(1.5);
  --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-950);
  --dsw-alias-bg-document-preview: var(--dsw-static-neutral-bluish-950);
  --dsw-alias-bg-document-selection: color-mix(in srgb, var(--dsw-static-blue-500) 40%, transparent);
  --dsw-alias-label-document-preview: var(--dsw-static-neutral-bluish-300);
  --dsw-alias-bg-layer-1: var(--dsw-static-neutral-bluish-875);
  --dsw-alias-bg-layer-2: var(--dsw-static-neutral-bluish-850);
  --dsw-alias-bg-layer-3: var(--dsw-static-neutral-bluish-800);
  --dsw-alias-bg-mask-1: #00000080;
  --dsw-alias-bg-mask-2: #0003;
  --dsw-alias-bg-mask-3: #0000007a;
  --dsw-alias-bg-mask-photo: #000000e0;
  --dsw-alias-bg-mask-drop: #272730b3;
  --dsw-alias-bg-module-platform: var(--dsw-static-neutral-bluish-800);
  --dsw-alias-bg-multi-select: var(--dsw-static-neutral-850);
  --dsw-alias-bg-overlay: var(--dsw-static-neutral-bluish-700);
  --dsw-alias-bg-skeleton: #ffffff14;
  --dsw-alias-border-inverted2: #ffffff14;
  --dsw-alias-border-inverted: #ffffff0f;
  --dsw-alias-border-l1: #ffffff0f;
  --dsw-alias-border-l2-darkmode-thin: #ffffff0f;
  --dsw-alias-border-l2: #ffffff1f;
  --dsw-alias-border-l3: #ffffff29;
  --dsw-alias-border-l4: #fff3;
  --dsw-alias-brand-primary-invert: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-brand-primary-new-colorprimary-new-color: var(--dsw-static-deepseek-450);
  --dsw-alias-brand-primary: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-brand-text: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-button-contrast-fill: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-button-elevated-fill: var(--dsw-static-neutral-bluish-750);
  --dsw-alias-button-floating-fill: var(--dsw-static-neutral-bluish-850);
  --dsw-alias-button-floating-hover: var(--dsw-static-neutral-bluish-800);
  --dsw-alias-button-ghost-active-border: var(--dsw-static-neutral-bluish-600);
  --dsw-alias-button-ghost-active-fill: var(--dsw-static-neutral-bluish-750);
  --dsw-alias-button-ghost-active-hover: var(--dsw-static-neutral-bluish-700);
  --dsw-alias-button-info-fill: var(--dsw-static-deepseek-400);
  --dsw-alias-button-info-hover: var(--dsw-static-deepseek-500);
  --dsw-alias-button-primary-dimmed: var(--dsw-static-neutral-bluish-750);
  --dsw-alias-button-primary-fill: var(--dsw-alias-brand-primary);
  --dsw-alias-button-primary-hover: var(--dsw-static-neutral-bluish-100);
  --dsw-alias-button-tool-bar-fill-invisible: #1f1f1f5c;
  --dsw-alias-button-tool-bar-fill: #54555780;
  --dsw-alias-button-tool-bar-hover: #54555799;
  --dsw-alias-interactive-bg-active: #ffffff24;
  --dsw-alias-interactive-bg-hover-accent: #ffffff3d;
  --dsw-alias-interactive-bg-hover-danger: #f25a5a26;
  --dsw-alias-interactive-bg-hover-solid: var(--dsw-static-neutral-bluish-800);
  --dsw-alias-interactive-bg-hover: #ffffff14;
  --dsw-alias-label-caption: var(--dsw-static-neutral-bluish-600);
  --dsw-alias-label-deep-diving: color-mix(in srgb, var(--dsw-static-deepseek-450) 55%, var(--dsw-static-neutral-bluish-400));
  --dsw-alias-label-deep-diving-shimmer: color-mix(in srgb, var(--dsw-static-blue-300) 65%, var(--dsw-static-deepseek-400));
  --dsw-alias-label-dimmed: var(--dsw-static-neutral-bluish-750);
  --dsw-alias-label-primary-bluish: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-label-primary-dimmed: var(--dsw-static-neutral-bluish-100);
  --dsw-alias-label-primary-foreground: var(--dsw-static-neutral-bluish-1000);
  --dsw-alias-label-primary-inverted: var(--dsw-static-neutral-bluish-800);
  --dsw-alias-label-primary: var(--dsw-static-neutral-bluish-50);
  --dsw-alias-label-secondary: var(--dsw-static-neutral-bluish-300);
  --dsw-alias-label-shimmer: color-mix(in srgb, var(--dsw-static-neutral-00) 45%, transparent);
  --dsw-alias-label-tertiary: var(--dsw-static-neutral-bluish-400);
  --dsw-alias-menu-icon: var(--dsw-alias-label-primary-dimmed);
  --dsw-alias-link: var(--dsw-static-deepseek-400);
  --dsw-alias-markdown-citation: var(--dsw-static-neutral-bluish-800);
  --dsw-alias-markdown-code-block-banner: var(--dsw-static-neutral-bluish-850);
  --dsw-alias-markdown-code-block: var(--dsw-static-neutral-bluish-900);
  --dsw-alias-markdown-code-segment-selected: var(--dsw-static-neutral-bluish-800);
  --dsw-alias-markdown-code-segment-unselected: var(--dsw-static-neutral-bluish-900);
  --dsw-alias-markdown-inline-code: var(--dsw-static-neutral-800);
  --dsw-alias-markdown-placeholder: var(--dsw-static-neutral-bluish-850);
  --dsw-alias-markdown-tag: var(--dsw-static-neutral-bluish-850);
  --dsw-alias-scrollbar-bg-l1: var(--dsw-static-neutral-700);
  --dsw-alias-scrollbar-bg-l2: var(--dsw-static-neutral-600);
  --dsw-alias-scrollbar-hover-l1: var(--dsw-static-neutral-600);
  --dsw-alias-scrollbar-hover-l2: var(--dsw-static-neutral-550);
  --dsw-alias-state-business-primary: var(--dsw-static-deepseek-400);
  --dsw-alias-state-business-tertiary: var(--dsw-static-deepseek-800);
  --dsw-alias-code-diff-added: var(--dsw-static-green-500-a12);
  --dsw-alias-code-diff-deleted: var(--dsw-static-red-400-a12);
  --dsw-alias-file-diff-added-bg: #1f3124;
  --dsw-alias-file-diff-added-gutter: #132016;
  --dsw-alias-file-diff-added-marker: #41c977;
  --dsw-alias-file-diff-deleted-bg: #3c1f1b;
  --dsw-alias-file-diff-deleted-gutter: #28130e;
  --dsw-alias-file-diff-deleted-marker: #fa423e;
  --dsw-alias-state-error-primary: var(--dsw-static-red-400);
  --dsw-alias-state-error-secondary: var(--dsw-static-red-400);
  --dsw-alias-state-idle-primary: var(--dsw-static-neutral-600);
  --dsw-alias-state-success-primary: var(--dsw-static-green-500);
  --dsw-alias-state-success-secondary: var(--dsw-static-green-400);
  --dsw-alias-state-success-tertiary: var(--dsw-static-green-900);
  --dsw-alias-state-warn-label: var(--dsw-static-amber-600);
  --dsw-alias-state-warn-primary: var(--dsw-static-amber-500);
  --dsw-alias-state-warn-secondary: var(--dsw-static-amber-400);
  --dsw-alias-state-warn-tertiary: var(--dsw-static-amber-900);
  --dsw-alias-switch-thumb: var(--dsw-static-neutral-bluish-400);
  --dsw-alias-toast-bg: var(--dsw-static-neutral-bluish-750);
  --dsw-alias-toast-label: var(--dsw-static-neutral-bluish-00);
  --dsw-alias-tooltip-bg: var(--dsw-static-neutral-bluish-750);
  --dsw-alias-tooltip-key-bg: color-mix(in srgb, var(--dsw-alias-tooltip-bg), white 18%);
  --dsw-alias-turn-trigger-bg: var(--dsw-alias-interactive-bg-hover);
  --dsw-alias-turn-trigger-bg-hover: var(--dsw-alias-interactive-bg-active);
  --dsw-specific-bubble-highlight: var(--dsw-static-neutral-bluish-750);
  --dsw-specific-bubble: var(--dsw-static-neutral-bluish-850);
  --dsw-specific-input-major: var(--dsw-static-neutral-bluish-850);
  --dsw-specific-login-input: var(--dsw-static-neutral-bluish-900);
  --dsw-menu-surface-fill: #43454a73;
  --dsw-alias-menu-group-header-fill: #303136f0;
  --dsw-specific-menu: #303136f0;
  --dsw-specific-selector: var(--dsw-static-neutral-bluish-800);
  --dsw-specific-sidebar-fill: var(--dsw-static-neutral-bluish-900);
  --dsw-specific-sidebar-nav-item-active-accent: var(--dsw-static-neutral-bluish-800);
  --dsw-specific-sidebar-nav-item-active: var(--dsw-static-neutral-bluish-750);
  --dsw-specific-sidebar-nav-item-hover: var(--dsw-static-neutral-bluish-850);
  --dsw-specific-tip: var(--dsw-static-neutral-bluish-800);
  --dsw-focus-ring-width: 2px;
  --dsw-focus-ring-color: transparent;
  --dsw-alias-onboarding-accent: #3964fe;
  --dsw-gradient-onboarding-violet-stops: #2a2fb6 33.102%, #8b76f6 50.954%, #c5c0ff 85.326%, #2a2fb6;
  --dsw-gradient-onboarding-blue-stops: #3964fe 18.75%, #398efe 51.78%, #6dccff 86.252%, #3964fe;
  --dsw-gradient-onboarding-cyan-stops: #0293b4 21.154%, #2dc8eb 50.954%, #aff0ff 85.326%, #0293b4;
  --dsw-alias-onboarding-card-fill: color-mix(in srgb, var(--dsw-static-neutral-bluish-850) 80%, transparent);
  --dsw-alias-onboarding-secondary-fill: #48494c;
  --dsw-alias-onboarding-checkbox-border: var(--dsw-alias-border-l2);
  --dsw-linear-gradient-think: linear-gradient(180deg, #151517 20.19%, #15151700 100%);
  --dsw-linear-think-select: linear-gradient(180deg, #232325 20.19%, #23232500 100%);
  --dsw-shadow-lv1: 0 2px 4px 0 #0000000d;
  --dsw-shadow-lv1-blur: 0 4px 12px 0 #00000005;
  --dsw-shadow-lv2: 0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a;
  --dsw-shadow-lv3: 0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l3);
  --dsw-mask-blur: none;
  --dsw-menu-backdrop-filter: blur(40px) saturate(150%);
  --dsw-elevation-stroke: 0 0 0 .5px var(--dsw-elevation-stroke-color);
  --dsw-elevation-panel: var(--dsw-elevation-stroke), 0 3px 8px 0 #00000008, 0 0 16px 0 #00000005;
  --dsw-elevation-prominent: var(--dsw-elevation-stroke), 0 3px 8px 0 #0000000a, 0 0 20px 0 #0000000d;
  --dsw-elevation-soft: var(--dsw-elevation-stroke), 0 4px 16px 0 #00000008, 0 0 24px 0 #00000008;
  --dsw-font-markdown-h1: 700 calc(21px + var(--dsh-content-font-delta)) / calc(30px + var(--dsh-content-font-delta)) var(--dsw-font-family);
  --dsw-font-markdown-h1-font-family: var(--dsw-font-family);
  --dsw-font-markdown-h1-font-weight: 700;
  --dsw-font-markdown-h1-line-height: calc(30px + var(--dsh-content-font-delta));
  --dsw-font-markdown-h1-font-size: calc(21px + var(--dsh-content-font-delta));
  --dsw-font-markdown-h1-font-style: normal;
  --dsw-font-markdown-h2: 700 calc(19px + var(--dsh-content-font-delta)) / calc(28px + var(--dsh-content-font-delta)) var(--dsw-font-family);
  --dsw-font-markdown-h2-font-family: var(--dsw-font-family);
  --dsw-font-markdown-h2-font-weight: 700;
  --dsw-font-markdown-h2-line-height: calc(28px + var(--dsh-content-font-delta));
  --dsw-font-markdown-h2-font-size: calc(19px + var(--dsh-content-font-delta));
  --dsw-font-markdown-h2-font-style: normal;
  --dsw-font-markdown-h3: 700 calc(18px + var(--dsh-content-font-delta)) / calc(26px + var(--dsh-content-font-delta)) var(--dsw-font-family);
  --dsw-font-markdown-h3-font-family: var(--dsw-font-family);
  --dsw-font-markdown-h3-font-weight: 700;
  --dsw-font-markdown-h3-line-height: calc(26px + var(--dsh-content-font-delta));
  --dsw-font-markdown-h3-font-size: calc(18px + var(--dsh-content-font-delta));
  --dsw-font-markdown-h3-font-style: normal;
  --dsw-font-markdown-h4: 600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family);
  --dsw-font-markdown-h4-font-family: var(--dsw-font-family);
  --dsw-font-markdown-h4-font-weight: 600;
  --dsw-font-markdown-h4-line-height: calc(24px + var(--dsh-content-font-delta));
  --dsw-font-markdown-h4-font-size: var(--dsh-content-font-size,14px);
  --dsw-font-markdown-h4-font-style: normal;
  --dsw-font-markdown-base: var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family);
  --dsw-font-markdown-base-font-family: var(--dsw-font-family);
  --dsw-font-markdown-base-font-weight: 400;
  --dsw-font-markdown-base-line-height: calc(24px + var(--dsh-content-font-delta));
  --dsw-font-markdown-base-font-size: var(--dsh-content-font-size,14px);
  --dsw-font-markdown-base-font-style: normal;
  --dsw-font-markdown-base-strong: 600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family);
  --dsw-font-markdown-base-strong-font-family: var(--dsw-font-family);
  --dsw-font-markdown-base-strong-font-weight: 600;
  --dsw-font-markdown-base-strong-line-height: calc(24px + var(--dsh-content-font-delta));
  --dsw-font-markdown-base-strong-font-size: var(--dsh-content-font-size,14px);
  --dsw-font-markdown-base-strong-font-style: normal;
  --dsw-font-markdown-base-italic: italic var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family);
  --dsw-font-markdown-base-italic-font-family: var(--dsw-font-family);
  --dsw-font-markdown-base-italic-font-weight: 400;
  --dsw-font-markdown-base-italic-line-height: calc(24px + var(--dsh-content-font-delta));
  --dsw-font-markdown-base-italic-font-size: var(--dsh-content-font-size,14px);
  --dsw-font-markdown-base-italic-font-style: italic;
  --dsw-font-markdown-base-strong-italic: italic 600 var(--dsh-content-font-size,14px) / calc(24px + var(--dsh-content-font-delta)) var(--dsw-font-family);
  --dsw-font-markdown-base-strong-italic-font-family: var(--dsw-font-family);
  --dsw-font-markdown-base-strong-italic-font-weight: 600;
  --dsw-font-markdown-base-strong-italic-line-height: calc(24px + var(--dsh-content-font-delta));
  --dsw-font-markdown-base-strong-italic-font-size: var(--dsh-content-font-size,14px);
  --dsw-font-markdown-base-strong-italic-font-style: italic;
  --dsw-font-markdown-table: var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) var(--dsw-font-family);
  --dsw-font-markdown-table-font-family: var(--dsw-font-family);
  --dsw-font-markdown-table-font-weight: 400;
  --dsw-font-markdown-table-line-height: calc(22px + var(--dsh-content-font-delta-secondary,0px));
  --dsw-font-markdown-table-font-size: var(--dsh-content-font-size-secondary,13px);
  --dsw-font-markdown-table-font-style: normal;
  --dsw-font-markdown-table-head: 500 var(--dsh-content-font-size-secondary,13px)/calc(22px + var(--dsh-content-font-delta-secondary,0px)) var(--dsw-font-family);
  --dsw-font-markdown-table-head-font-family: var(--dsw-font-family);
  --dsw-font-markdown-table-head-font-weight: 500;
  --dsw-font-markdown-table-head-line-height: calc(22px + var(--dsh-content-font-delta-secondary,0px));
  --dsw-font-markdown-table-head-font-size: var(--dsh-content-font-size-secondary,13px);
  --dsw-font-markdown-table-head-font-style: normal;
  --dsw-font-markdown-small: 12px/20px var(--dsw-font-family);
  --dsw-font-markdown-small-font-family: var(--dsw-font-family);
  --dsw-font-markdown-small-font-weight: 400;
  --dsw-font-markdown-small-line-height: 20px;
  --dsw-font-markdown-small-font-size: 12px;
  --dsw-font-markdown-small-font-style: normal;
  --dsw-font-markdown-small-strong: 600 12px/20px var(--dsw-font-family);
  --dsw-font-markdown-small-strong-font-family: var(--dsw-font-family);
  --dsw-font-markdown-small-strong-font-weight: 600;
  --dsw-font-markdown-small-strong-line-height: 20px;
  --dsw-font-markdown-small-strong-font-size: 12px;
  --dsw-font-markdown-small-strong-font-style: normal;
  --dsw-font-markdown-small-italic: italic 12px/20px var(--dsw-font-family);
  --dsw-font-markdown-small-italic-font-family: var(--dsw-font-family);
  --dsw-font-markdown-small-italic-font-weight: 400;
  --dsw-font-markdown-small-italic-line-height: 20px;
  --dsw-font-markdown-small-italic-font-size: 12px;
  --dsw-font-markdown-small-italic-font-style: italic;
  --dsw-font-markdown-small-strong-italic: italic 600 12px/20px var(--dsw-font-family);
  --dsw-font-markdown-small-strong-italic-font-family: var(--dsw-font-family);
  --dsw-font-markdown-small-strong-italic-font-weight: 600;
  --dsw-font-markdown-small-strong-italic-line-height: 20px;
  --dsw-font-markdown-small-strong-italic-font-size: 12px;
  --dsw-font-markdown-small-strong-italic-font-style: italic;
  --dsw-font-markdown-code: calc(12px + var(--dsh-code-font-delta)) / calc(19px + var(--dsh-code-font-delta)) var(--ds-font-family-code);
  --dsw-font-markdown-code-font-family: var(--ds-font-family-code);
  --dsw-font-markdown-code-font-weight: 400;
  --dsw-font-markdown-code-line-height: calc(19px + var(--dsh-code-font-delta));
  --dsw-font-markdown-code-font-size: calc(12px + var(--dsh-code-font-delta));
  --dsw-font-markdown-code-font-style: normal;
  --dsw-font-markdown-code-block: var(--dsh-code-font-size,11px) / calc(19px + var(--dsh-code-font-delta)) var(--ds-font-family-code);
  --dsw-font-markdown-code-block-font-family: var(--ds-font-family-code);
  --dsw-font-markdown-code-block-font-weight: 400;
  --dsw-font-markdown-code-block-line-height: calc(19px + var(--dsh-code-font-delta));
  --dsw-font-markdown-code-block-font-size: var(--dsh-code-font-size,11px);
  --dsw-font-markdown-code-block-font-style: normal;
  --dsw-font-markdown-code-block-small: var(--dsh-code-font-size,11px) / calc(16px + var(--dsh-code-font-delta)) var(--ds-font-family-code);
  --dsw-font-markdown-code-block-small-font-family: var(--ds-font-family-code);
  --dsw-font-markdown-code-block-small-font-weight: 400;
  --dsw-font-markdown-code-block-small-line-height: calc(16px + var(--dsh-code-font-delta));
  --dsw-font-markdown-code-block-small-font-size: var(--dsh-code-font-size,11px);
  --dsw-font-markdown-code-block-small-font-style: normal;
  --dsw-font-xl-24: 600 24px/32px var(--dsw-font-family);
  --dsw-font-xl-24-font-family: var(--dsw-font-family);
  --dsw-font-xl-24-font-weight: 600;
  --dsw-font-xl-24-line-height: 32px;
  --dsw-font-xl-24-font-size: 24px;
  --dsw-font-xl-24-font-style: normal;
  --dsw-font-l-20: 500 20px/28px var(--dsw-font-family);
  --dsw-font-l-20-font-family: var(--dsw-font-family);
  --dsw-font-l-20-font-weight: 500;
  --dsw-font-l-20-line-height: 28px;
  --dsw-font-l-20-font-size: 20px;
  --dsw-font-l-20-font-style: normal;
  --dsw-font-m-18: 500 16px/28px var(--dsw-font-family);
  --dsw-font-m-18-font-family: var(--dsw-font-family);
  --dsw-font-m-18-font-weight: 500;
  --dsw-font-m-18-line-height: 28px;
  --dsw-font-m-18-font-size: 16px;
  --dsw-font-m-18-font-style: normal;
  --dsw-font-base-16: 16px/24px var(--dsw-font-family);
  --dsw-font-base-16-font-family: var(--dsw-font-family);
  --dsw-font-base-16-font-weight: 400;
  --dsw-font-base-16-line-height: 24px;
  --dsw-font-base-16-font-size: 16px;
  --dsw-font-base-16-font-style: normal;
  --dsw-font-base-strong-16: 500 16px/24px var(--dsw-font-family);
  --dsw-font-base-strong-16-font-family: var(--dsw-font-family);
  --dsw-font-base-strong-16-font-weight: 500;
  --dsw-font-base-strong-16-line-height: 24px;
  --dsw-font-base-strong-16-font-size: 16px;
  --dsw-font-base-strong-16-font-style: normal;
  --dsw-font-s-14: 14px/22px var(--dsw-font-family);
  --dsw-font-s-14-font-family: var(--dsw-font-family);
  --dsw-font-s-14-font-weight: 400;
  --dsw-font-s-14-line-height: 22px;
  --dsw-font-s-14-font-size: 14px;
  --dsw-font-s-14-font-style: normal;
  --dsw-font-s-strong-14: 500 14px/22px var(--dsw-font-family);
  --dsw-font-s-strong-14-font-family: var(--dsw-font-family);
  --dsw-font-s-strong-14-font-weight: 500;
  --dsw-font-s-strong-14-line-height: 22px;
  --dsw-font-s-strong-14-font-size: 14px;
  --dsw-font-s-strong-14-font-style: normal;
  --dsw-font-xs-13: 13px/20px var(--dsw-font-family);
  --dsw-font-xs-13-font-family: var(--dsw-font-family);
  --dsw-font-xs-13-font-weight: 400;
  --dsw-font-xs-13-line-height: 20px;
  --dsw-font-xs-13-font-size: 13px;
  --dsw-font-xs-13-font-style: normal;
  --dsw-font-xs-strong-13: 500 13px/20px var(--dsw-font-family);
  --dsw-font-xs-strong-13-font-family: var(--dsw-font-family);
  --dsw-font-xs-strong-13-font-weight: 500;
  --dsw-font-xs-strong-13-line-height: 20px;
  --dsw-font-xs-strong-13-font-size: 13px;
  --dsw-font-xs-strong-13-font-style: normal;
  --dsw-font-xxs-12: 12px/18px var(--dsw-font-family);
  --dsw-font-xxs-12-font-family: var(--dsw-font-family);
  --dsw-font-xxs-12-font-weight: 400;
  --dsw-font-xxs-12-line-height: 18px;
  --dsw-font-xxs-12-font-size: 12px;
  --dsw-font-xxs-12-font-style: normal;
  --dsw-font-xxs-strong-12: 500 12px/18px var(--dsw-font-family);
  --dsw-font-xxs-strong-12-font-family: var(--dsw-font-family);
  --dsw-font-xxs-strong-12-font-weight: 500;
  --dsw-font-xxs-strong-12-line-height: 18px;
  --dsw-font-xxs-strong-12-font-size: 12px;
  --dsw-font-xxs-strong-12-font-style: normal;
  --dsw-font-xxxs-11: 11px/14px var(--dsw-font-family);
  --dsw-font-xxxs-11-font-family: var(--dsw-font-family);
  --dsw-font-xxxs-11-font-weight: 400;
  --dsw-font-xxxs-11-line-height: 14px;
  --dsw-font-xxxs-11-font-size: 11px;
  --dsw-font-xxxs-11-font-style: normal;
  --dsw-font-xxxs-strong-11: 500 11px/14px var(--dsw-font-family);
  --dsw-font-xxxs-strong-11-font-family: var(--dsw-font-family);
  --dsw-font-xxxs-strong-11-font-weight: 500;
  --dsw-font-xxxs-strong-11-line-height: 14px;
  --dsw-font-xxxs-strong-11-font-size: 11px;
  --dsw-font-xxxs-strong-11-font-style: normal;
}

/* ---------- layout rules (filtered) ---------- */
._header_k7ery_16 { display:flex;align-items:center;min-width:0 }
._header_k7ery_16[data-has-accessory] { gap:8px }
._header_k7ery_16[data-has-accessory] ._row_k7ery_26 { flex:0 1 auto }
._toolbar_1rv3m_63 { background:var(--dsw-alias-button-tool-bar-fill) }
._toolbar_1rv3m_63:hover:not(:disabled) { background:var(--dsw-alias-button-tool-bar-hover) }
._checkbox_1wz3s_1 input { flex:0 0 auto;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:inherit }
._checkbox_1wz3s_1 input:focus-visible { outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px }
._checkbox_1wz3s_1:has(input:disabled) { cursor:default;opacity:.5 }
._input_14sgc_25 { flex:1;min-width:0;border:none;outline:none;background:transparent;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary) }
._input_14sgc_25::placeholder { color:var(--dsw-alias-label-dimmed) }
._footer_4ub78_62 { flex:none;display:flex;flex-direction:column;margin-top:3px;padding-top:3px;border-top:.5px solid var(--dsw-alias-border-l2) }
._header_o6lrb_71 { display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px }
._footer_o6lrb_123 { display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px }
._acknowledgement_cjd8z_38 input { flex:none;width:16px;height:16px;margin:3px 0 0;accent-color:var(--dsw-alias-button-primary-fill);cursor:pointer }
._acknowledgement_cjd8z_38 input:focus-visible { outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px }
._acknowledgement_cjd8z_38 input:disabled { cursor:default }
._markdown_1ypvv_5 input[type=checkbox] { margin:0 8px 0 0;accent-color:var(--dsw-alias-label-secondary) }
._bubble_44yfq_1 { display:inline-flex;align-items:safe center;gap:8px;position:fixed;z-index:100;width:max-content;box-sizing:border-box;max-width:min(50vw,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:3px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:none;animation:_tooltip-in_44yfq_1 .15s var(--ds-ease-in-out) }
._bubble_44yfq_1[data-portal] { z-index:1100 }
._bubble_44yfq_1[data-pinned] { pointer-events:auto }
._bubble_44yfq_1[data-has-shortcut] { padding-inline-end:5px }
._bubble_44yfq_1[data-has-shortcut]:not(:has(._label_44yfq_30)) { padding:3px }
._bubble_44yfq_1[data-side=right],._bubble_44yfq_1[data-side=left] { transform:translateY(-50%) }
._bubble_44yfq_1[data-side=bottom] { transform:translate(-50%) }
._bubble_44yfq_1[data-side=top] { transform:translate(-50%,-100%) }
._bubble_44yfq_1[data-side=bottom][data-align=end] { transform:translate(-100%) }
._bubble_44yfq_1[data-side=top][data-align=end] { transform:translate(-100%,-100%) }
._bubble_44yfq_1 { animation:none }
._footer_ft7vz_16 { display:flex;align-items:center;gap:8px;padding-top:16px }
._input_bjqpo_107 { height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary) }
._input_bjqpo_107:focus-visible { outline:none;border-color:var(--dsw-alias-state-business-primary) }
._input_bjqpo_107:disabled { color:var(--dsw-alias-label-tertiary);cursor:default }
._input_bjqpo_107[aria-invalid=true] { border-color:var(--dsw-alias-state-error-primary) }
._header_8z71b_32 { display:flex;align-items:flex-start;gap:12px;margin-left:calc(-1 * var(--dsl-terminal-gutter));padding:9px 14px 9px var(--dsl-terminal-gutter);border-top-left-radius:var(--dsl-terminal-radius);border-top-right-radius:var(--dsl-terminal-radius);max-height:150px;overflow-y:auto }
._header_8z71b_32::-webkit-scrollbar-thumb { border:2px solid transparent;background-clip:padding-box;border-radius:var(--dsw-radius-sm) }
._header_8z71b_32::-webkit-scrollbar-track { margin:6px }
._block_8z71b_1[data-body] ._header_8z71b_32 { border-bottom:.5px solid var(--dsw-alias-border-l2) }
._header_1pq26_10 { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px 8px 22px;background:var(--dsl-code-block-background, var(--dsw-alias-markdown-code-block));border-top-left-radius:inherit;border-top-right-radius:inherit;color:var(--dsw-alias-label-secondary);font:11px/18px var(--dsw-font-family) }
._header_1u3n2_12 { display:flex;align-items:center;gap:12px;padding:9px 14px;background:var(--dsw-alias-markdown-code-block-banner);border-top-left-radius:var(--dsl-search-radius);border-top-right-radius:var(--dsl-search-radius) }
._fileHeader_1u3n2_66 { display:flex;align-items:baseline;gap:8px;width:100%;min-height:var(--dsl-search-line-height);padding:0 14px;border:none;background-color:transparent;cursor:pointer;font:inherit;text-align:left }
._tabCell_6nhg2_142[data-dockkit-host=dock][data-dockkit-column="0"]>._tabHost_6nhg2_162 { border-left:.5px solid var(--dsw-alias-border-l4) }
._tabHostHeader_6nhg2_177 { flex:none }
._stripTabs_6nhg2_257[data-dockkit-strip-scroll=end] { mask-image:linear-gradient(to right,black calc(100% - 24px),transparent) }
._stripTabs_6nhg2_257[data-dockkit-strip-scroll=start] { mask-image:linear-gradient(to right,transparent,black 24px) }
._stripTabs_6nhg2_257[data-dockkit-strip-scroll="start end"] { mask-image:linear-gradient(to right,transparent,black 24px,black calc(100% - 24px),transparent) }
._tabTitle_6nhg2_389[data-dockkit-tab-clipped] { mask-image:linear-gradient(to right,black calc(100% - 16px),transparent) }
._tab_6nhg2_134._tabQuiet_6nhg2_488 ._tabTitle_6nhg2_389[data-dockkit-tab-clipped] { mask-image:linear-gradient(to right,black calc(100% - 16px),transparent) }
._dockScrim_6nhg2_599 { position:absolute;inset:0;z-index:10;pointer-events:none;background:color-mix(in srgb,var(--dsw-alias-bg-base) 72%,transparent);backdrop-filter:blur(6px);animation:_dockScrimIn_6nhg2_1 .14s ease-out }
._dockHint_6nhg2_601 { position:absolute;z-index:10;display:flex;box-sizing:border-box;padding:8px;pointer-events:none }
._dockHint_6nhg2_601[data-dockkit-dock-zone=center] { inset:0 }
._dockHint_6nhg2_601[data-dockkit-dock-zone=left] { top:0;bottom:0;left:0;width:40% }
._dockHint_6nhg2_601[data-dockkit-dock-zone=right] { top:0;right:0;bottom:0;width:40% }
[data-dockkit-drop-zones=horizontal] ._dockHint_6nhg2_601[data-dockkit-dock-zone=left] { width:50%;padding-right:4px }
[data-dockkit-drop-zones=horizontal] ._dockHint_6nhg2_601[data-dockkit-dock-zone=right] { width:50%;padding-left:4px }
._dockHintCard_6nhg2_606 { display:flex;flex:1 1 auto;flex-direction:column;gap:8px;align-items:center;justify-content:center;min-width:0;min-height:0;padding:12px;overflow:hidden;color:var(--dsw-alias-label-tertiary);border:1.5px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);transition:color .12s ease-out,background-color .12s ease-out,border-color .12s ease-out;animation:_dockHintIn_6nhg2_1 .14s ease-out }
._dockHint_6nhg2_601[data-dockkit-drop-active] ._dockHintCard_6nhg2_606 { color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color) 8%,transparent);border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color) }
._dockHintCard_6nhg2_606 svg { flex:none;width:20px;height:20px }
._dockHintLabel_6nhg2_694 { max-width:100%;overflow:hidden;font-size:var(--dsh-content-font-size-secondary, 13px);font-weight:500;line-height:1.4;white-space:nowrap;text-overflow:ellipsis }
._dockHint_6nhg2_601[data-dockkit-dock-zone=top] { top:0;right:0;left:0;height:40% }
._dockHint_6nhg2_601[data-dockkit-dock-zone=bottom] { right:0;bottom:0;left:0;height:40% }
._floatHeader_6nhg2_773 { cursor:move;user-select:none }
._dockGlyph_6nhg2_790 { transform:scaleX(-1) }
html[data-platform=darwin] :is(button,a,input,select,textarea,summary,[contenteditable=true],[tabindex],[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=checkbox],[role=radio],[role=switch],[role=slider],[role=combobox],[role=textbox]) { -webkit-app-region:no-drag }
button,input,select,textarea { font-family:inherit }

/* filtered rules kept: 64 */
```

---

# 附B · 插件真实样式

> 从 `client.js` 的 CSS 模板字面量原样导出，**206 条规则**。
> 工具栏按钮、档位胶囊、自动驾驶面板、思考窗、状态四色全在这里。

```css

.dsh-op-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;
  border:none;border-radius:999px;flex:none;white-space:nowrap;cursor:pointer;
  background:var(--dsw-specific-selector,var(--dsw-alias-bg-layer-2));
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px}
.dsh-op-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-bg-layer-1));
  color:var(--dsw-alias-label-primary)}
.dsh-op-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-op-btn:disabled{opacity:.55;cursor:default}
.dsh-op-btn[data-state="done"][data-active="true"]{color:var(--dsw-alias-state-success-primary)}
.dsh-op-btn[data-state="unchanged"][data-active="true"]{color:var(--dsw-alias-state-warn-primary)}
.dsh-op-btn[data-state="error"][data-active="true"]{color:var(--dsw-alias-state-error-primary)}
/* The autopilot button keeps its outcome visible after the run ends: a finished
   loop is a fact about the session, not something to hide the moment it stops. */
.dsh-op-btn[data-mode="auto"][data-state="done"]{color:var(--dsw-alias-state-success-primary)}
.dsh-op-btn[data-mode="auto"][data-state="error"]{color:var(--dsw-alias-state-error-primary)}
.dsh-op-btn[data-mode="auto"][data-state="stopped"]{color:var(--dsw-alias-state-warn-primary)}
.dsh-op-btn[data-mode="auto"][data-state="running"]{color:var(--dsw-alias-brand-primary)}
.dsh-op-icon{width:14px;height:14px;flex:none;display:block}
.dsh-op-icon[data-spin="true"]{animation:dsh-op-spin 1s linear infinite}
@keyframes dsh-op-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dsh-op-icon[data-spin="true"]{animation:none}}
.dsh-op-group{display:inline-flex;align-items:center;gap:4px;flex:none}
.dsh-op-level{height:28px;padding:0 8px;border-radius:999px;flex:none;cursor:pointer;
  background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;
  border:1px solid var(--dsw-alias-border-l1)}
.dsh-op-level:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dsh-op-level:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-op-page{padding:20px 24px 32px;max-width:720px;color:var(--dsw-alias-label-primary)}
.dsh-op-head{margin-bottom:18px}
.dsh-op-h2{margin:0 0 4px;font-size:17px;font-weight:600;line-height:26px;letter-spacing:-.01em}
.dsh-op-sub{margin:0;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:20px}
/* Version line: this plugin's own update affordance. dsh's plugin page only
   computes installTarget for bundles in its official catalogue, so a third-party
   plugin has no update button there. */
.dsh-op-version{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:9px;
  font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.dsh-op-versionNow{font-variant-numeric:tabular-nums;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;
  background:var(--dsw-alias-bg-base);border-radius:999px;padding:1px 8px;
  color:var(--dsw-alias-label-primary)}
.dsh-op-versionNew{display:flex;flex-wrap:wrap;align-items:center;gap:8px;
  font-size:11.5px;color:var(--dsw-alias-state-warn-primary)}
.dsh-op-versionBad{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));opacity:.8}
/* The manual update instruction: present when a newer version exists, quiet enough
   not to compete with the version numbers themselves. */
.dsh-op-versionHint{flex:1 1 100%;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-secondary);opacity:.85}
/* The busy-wait line: a live counter, so it is monospaced and does not reflow as
   the seconds tick, and it holds a fixed height so the panel does not jump. */
.dsh-op-waiting{font-variant-numeric:tabular-nums;min-height:17px}
.dsh-op-card{display:flex;flex-direction:column;gap:2px;padding:2px 16px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);
  border-radius:14px}
.dsh-op-card+.dsh-op-card{margin-top:14px}
.dsh-op-cardTitle{padding:14px 0 2px;font-size:11px;font-weight:600;line-height:16px;
  letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.dsh-op-field{padding:13px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-op-cardTitle+.dsh-op-field{border-top:none}
.dsh-op-field:first-child{border-top:none}
.dsh-op-label{font-size:13px;font-weight:500;line-height:20px;margin-bottom:9px}
.dsh-op-choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:8px}
.dsh-op-radio{position:relative;display:flex;align-items:flex-start;gap:8px;padding:10px 12px;
  font-size:13px;line-height:18px;cursor:pointer;user-select:none;
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;
  background:var(--dsw-alias-bg-base);transition:border-color .12s,background .12s}
.dsh-op-radio:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-op-radio:has(input:checked){border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.dsh-op-radio:has(input:focus-visible){outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-op-radio input{position:absolute;opacity:0;pointer-events:none}
.dsh-op-radioMark{flex:0 0 16px;width:16px;height:16px;margin-top:1px;border-radius:50%;
  border:1.5px solid var(--dsw-alias-border-l2);display:grid;place-items:center;
  transition:border-color .16s ease}
.dsh-op-radioDot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary);
  transform:scale(0);transition:transform .18s cubic-bezier(.22,1,.36,1)}
.dsh-op-radio:has(input:checked) .dsh-op-radioMark{border-color:var(--dsw-alias-brand-primary)}
.dsh-op-radio:has(input:checked) .dsh-op-radioDot{transform:scale(1)}
@media (prefers-reduced-motion:reduce){.dsh-op-radioDot{transition:none}}
.dsh-op-radioText{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-op-radioTitle{font-weight:500}
.dsh-op-radioNote{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-op-radio--time{margin-top:2px;padding:8px 12px;align-items:center}
/* A slider switch: the marker travels instead of blinking on. Used wherever a row
   turns a behaviour on rather than picking one of several. */
.dsh-op-switch{position:relative;display:flex;align-items:center;gap:9px;padding:9px 12px;
  font-size:13px;line-height:18px;cursor:pointer;user-select:none;
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;
  background:var(--dsw-alias-bg-base);transition:border-color .16s,background .16s}
.dsh-op-switch:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-op-switch:has(input:checked){border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-bg-layer-2)}
.dsh-op-switch:has(input:focus-visible){outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-op-switch input{position:absolute;opacity:0;pointer-events:none}
.dsh-op-switchTrack{flex:0 0 32px;width:32px;height:18px;border-radius:999px;position:relative;
  /* Off must still be legible on a dark panel: the track sits a step above the row
     background and keeps an inner edge, so the whole switch reads as a control
     rather than a dark smudge. */
  background:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));
  box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);
  transition:background .18s ease,box-shadow .18s ease}
.dsh-op-switchThumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
  /* Off: a light thumb on the muted track, so the control never sinks into the
     panel. On: the same thumb rides the brand-coloured track. */
  background:var(--dsw-alias-label-primary);
  box-shadow:0 1px 2px rgba(0,0,0,.35);
  transform:translateX(0);transition:transform .2s cubic-bezier(.22,1,.36,1),background .18s}
.dsh-op-switch:has(input:checked) .dsh-op-switchTrack{
  background:var(--dsw-alias-brand-primary);box-shadow:none}
.dsh-op-switch:has(input:checked) .dsh-op-switchThumb{transform:translateX(14px);
  background:#fff}
@media (prefers-reduced-motion:reduce){
  .dsh-op-switchTrack,.dsh-op-switchThumb{transition:none}
}
.dsh-op-switchText{flex:1;min-width:0}
.dsh-op-hint{margin:9px 0 0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.dsh-op-hint--error{color:var(--dsw-alias-state-error-primary)}
/* A failure can be a long multi-line string: keep it readable and bounded instead
   of stretching the panel. */
.dsh-op-hint--block{white-space:pre-wrap;word-break:break-word;max-height:140px;
  overflow-y:auto;user-select:text}
.dsh-op-hint--inline{margin:0;flex:none}
.dsh-op-select{min-width:300px;max-width:100%;height:34px;padding:0 10px;border-radius:9px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;
  transition:border-color .12s}
.dsh-op-select:hover{border-color:var(--dsw-alias-label-secondary)}
.dsh-op-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-op-inline{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsh-op-inline .dsh-op-select{min-width:0;flex:1 1 160px}
.dsh-op-input{box-sizing:border-box;height:34px;padding:0 10px;border-radius:9px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;
  transition:border-color .12s}
.dsh-op-input:hover{border-color:var(--dsw-alias-label-secondary)}
.dsh-op-input--narrow{width:72px;flex:none;text-align:center}
.dsh-op-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-op-textarea{display:block;width:100%;min-height:60px;height:auto;padding:9px 10px;
  line-height:19px;resize:vertical;margin-top:9px;font:inherit;font-size:13px}
.dsh-op-picker{position:relative;min-width:0;max-width:100%}
.dsh-op-trigger{display:flex;align-items:center;gap:8px;height:34px;max-width:460px;min-width:280px;
  padding:0 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font:inherit;font-size:13px;line-height:20px;cursor:pointer;text-align:left;
  transition:border-color .12s,background .12s}
.dsh-op-trigger:hover{border-color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-interactive-bg-hover)}
.dsh-op-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-op-triggerLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-op-chevron{flex:none;color:var(--dsw-alias-label-secondary);transition:transform .12s}
.dsh-op-trigger[aria-expanded="true"] .dsh-op-chevron{transform:rotate(180deg)}
.dsh-op-menu{position:absolute;z-index:1100;top:calc(100% + 4px);left:0;width:min(460px,86vw);
  max-height:min(360px,60vh);display:flex;flex-direction:column;padding:4px;overflow:hidden;
  border-radius:var(--dsw-radius-panel);border:.5px solid var(--dsw-alias-border-l2);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}
.dsh-op-searchRow{position:relative;flex:none;margin:2px 0 4px}
.dsh-op-search{box-sizing:border-box;width:100%;height:30px;padding:5px 30px 5px 9px;
  border:none;border-radius:var(--dsw-radius-md,10px);background:transparent;color:inherit;
  font:inherit;font-size:12.5px;line-height:18px;outline:none}
.dsh-op-search::placeholder{color:var(--dsw-alias-label-secondary);opacity:.75}
.dsh-op-search:focus{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-op-clear{position:absolute;top:50%;right:4px;transform:translateY(-50%);width:22px;height:22px;
  display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:50%;
  background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-op-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-op-groups{min-height:0;overflow-y:auto}
.dsh-op-groupHead{position:sticky;top:0;z-index:1;padding:7px 9px 4px;font-size:11px;line-height:16px;
  letter-spacing:.04em;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.dsh-op-option{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-height:34px;
  padding:6px 9px;border:none;border-radius:var(--dsw-radius-md,10px);background:transparent;
  color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;
  text-align:left;cursor:pointer}
.dsh-op-option:hover,.dsh-op-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
.dsh-op-option[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
.dsh-op-optionName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-op-optionId{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-op-check{flex:0 0 14px;display:grid;place-items:center;color:var(--dsw-alias-brand-primary)}
.dsh-op-more{padding:2px 9px 9px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-op-menu--narrow{width:min(240px,80vw);max-height:min(320px,50vh)}
.dsh-op-trigger--short{min-width:170px;max-width:240px}
.dsh-op-option--effort{min-height:38px;font-size:14px}
.dsh-op-empty{padding:12px 9px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-op-status{min-height:20px;padding:10px 0;font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px}
.dsh-op-status[data-state="saved"]{color:var(--dsw-alias-state-success-primary)}
.dsh-op-status[data-state="warn"]{color:var(--dsw-alias-state-warn-primary)}
.dsh-op-status[data-state="error"]{color:var(--dsw-alias-state-error-primary)}
.dsh-op-status[data-state="dirty"]{color:var(--dsw-alias-state-warn-primary)}
.dsh-op-link{border:none;background:none;padding:0;margin-left:8px;
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dsh-op-link:hover:not(:disabled){color:var(--dsw-alias-label-primary);text-decoration:underline}
.dsh-op-link:disabled{opacity:.4;cursor:default}
.dsh-op-footer{display:flex;align-items:center;gap:12px;padding:14px 0 4px;margin-top:14px;
  border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-op-footer .dsh-op-status{flex:1;padding:0;min-height:0}
.dsh-op-save{min-width:88px;height:34px;padding:0 20px;border:none;border-radius:9px;cursor:pointer;
  background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);
  font:inherit;font-size:13px;font-weight:500;line-height:20px;
  transition:opacity .12s,transform .06s}
.dsh-op-save:not(:disabled):hover{opacity:.85}
.dsh-op-save:not(:disabled):active{transform:scale(.985)}
.dsh-op-save:disabled{opacity:1;cursor:default;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsh-op-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2000;
  display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:var(--dsw-radius-panel);
  background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:20px;pointer-events:none}
.dsh-op-toast svg{flex:none;color:var(--dsw-alias-state-success-primary)}
.dsh-op-status[data-state="dirty"]{color:var(--dsw-alias-state-warn-primary)}
.dsh-op-job{position:fixed;top:12px;left:12px;z-index:1500;width:300px;box-sizing:border-box;
  padding:12px 14px;border-radius:var(--dsw-radius-panel);pointer-events:auto;
  background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);
  font-size:12px;line-height:18px}
.dsh-op-job--mini{width:auto;max-width:260px;padding:6px 12px;border-radius:999px;
  display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12px}
.dsh-op-job--mini[data-state="done"]{color:var(--dsw-alias-state-success-primary)}
.dsh-op-job--mini[data-state="error"]{color:var(--dsw-alias-state-error-primary)}
.dsh-op-jobMiniText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-op-jobHead{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dsh-op-jobTitle{flex:1;font-size:13px;font-weight:500}
.dsh-op-job[data-state="error"] .dsh-op-jobTitle{color:var(--dsw-alias-state-error-primary)}
.dsh-op-job[data-state="done"] .dsh-op-jobTitle{color:var(--dsw-alias-state-success-primary)}
.dsh-op-jobHide{border:none;background:transparent;color:var(--dsw-alias-label-secondary);
  cursor:pointer;font-size:14px;line-height:1;padding:2px 6px;border-radius:6px}
.dsh-op-jobHide:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-op-jobBar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-bottom:10px}
.dsh-op-jobFill{height:100%;background:var(--dsw-alias-brand-primary);transition:width .3s ease}
.dsh-op-jobSteps{display:flex;flex-direction:column;gap:6px}
.dsh-op-jobStep{display:flex;align-items:baseline;gap:6px;color:var(--dsw-alias-label-secondary)}
.dsh-op-jobStep[data-state="done"],.dsh-op-jobStep[data-state="running"]{color:var(--dsw-alias-label-primary)}
.dsh-op-jobStep[data-state="error"]{color:var(--dsw-alias-state-error-primary)}
.dsh-op-jobDot{flex:none;width:14px;text-align:center;font-size:11px}
.dsh-op-jobText{flex:none}
.dsh-op-jobDetail{margin-left:auto;max-width:55%;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-op-jobError{margin-top:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary)}
.dsh-op-auto{position:relative;display:inline-flex;flex:none}
.dsh-op-pop{position:absolute;bottom:calc(100% + 8px);right:0;z-index:1200;width:288px;
  display:flex;flex-direction:column;gap:8px;padding:8px;border-radius:var(--dsw-radius-panel);
  border:.5px solid var(--dsw-alias-border-l2);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);
  color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;
  /* Opens upward from the button it belongs to, so the panel reads as attached. */
  transform-origin:bottom right;
  animation:dsh-op-pop-in .17s cubic-bezier(.22,1,.36,1) both}
@keyframes dsh-op-pop-in{
  from{opacity:0;transform:translateY(6px) scale(.97)}
  to{opacity:1;transform:translateY(0) scale(1)}
}
@media (prefers-reduced-motion:reduce){.dsh-op-pop{animation:none}}
.dsh-op-popTitle{font-size:13px;font-weight:500;line-height:20px}
.dsh-op-btn--danger{color:var(--dsw-alias-state-error-primary)}
.dsh-op-btn--wide{width:100%;justify-content:center;margin-top:2px}
.dsh-op-pre{margin:0;max-height:180px;overflow:auto;padding:8px;border-radius:8px;
  background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-word}
.dsh-op-trace{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;
  padding:6px;border-radius:8px;background:var(--dsw-alias-bg-base);
  border:1px solid var(--dsw-alias-border-l1)}
.dsh-op-traceRow{display:flex;flex-direction:column;gap:1px;font-size:11px;line-height:15px;
  color:var(--dsw-alias-label-secondary)}
.dsh-op-traceTag{font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-op-traceRow[data-kind="tool"] .dsh-op-traceTag{color:var(--dsw-alias-brand-primary)}
.dsh-op-traceRow[data-kind="sent"] .dsh-op-traceTag{color:var(--dsw-alias-state-success-primary)}
.dsh-op-traceRow[data-kind="conclusion"] .dsh-op-traceTag{color:var(--dsw-alias-state-warn-primary)}
.dsh-op-traceText{white-space:pre-wrap;word-break:break-word;opacity:.9}
.dsh-op-think{position:fixed;top:64px;right:16px;z-index:1400;width:300px;max-width:38vw;
  max-height:min(420px,60vh);display:flex;flex-direction:column;border-radius:var(--dsw-radius-panel);
  background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);
  font-size:12px;line-height:17px;overflow:hidden;
  /* Slides in from the right edge instead of appearing whole, and collapses with
     a height transition so opening and folding both read as the same object. */
  animation:dsh-op-think-in .2s cubic-bezier(.22,1,.36,1) both;
  transition:max-height .18s ease}
@keyframes dsh-op-think-in{
  from{opacity:0;transform:translateX(18px) scale(.985)}
  to{opacity:1;transform:translateX(0) scale(1)}
}
@media (prefers-reduced-motion:reduce){
  .dsh-op-think{animation:none;transition:none}
}
/* Folded: only the header bar remains, and the body scrolls away instead of being
   torn off, so the same element appears to shrink. */
.dsh-op-think[data-collapsed="true"]{max-height:38px}
.dsh-op-think[data-collapsed="true"] .dsh-op-thinkBodyScroll{
  opacity:0;transform:translateY(-4px);pointer-events:none}
.dsh-op-thinkBodyScroll{transition:opacity .16s ease,transform .16s ease}
.dsh-op-thinkHead{display:flex;align-items:center;gap:8px;padding:9px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.dsh-op-thinkTitle{font-size:12.5px;font-weight:600;flex:1;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-op-thinkCount{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-base);border-radius:999px;padding:1px 7px}
.dsh-op-thinkBtn{flex:none;width:22px;height:22px;border:none;border-radius:6px;cursor:pointer;
  background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;
  display:grid;place-items:center}
.dsh-op-thinkBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-op-thinkBodyScroll{flex:1;min-height:0;overflow-y:auto;padding:8px 10px;
  display:flex;flex-direction:column;gap:9px}
.dsh-op-thinkRow{display:flex;flex-direction:column;gap:2px}
.dsh-op-thinkRow[data-foldable="true"]{cursor:pointer;border-radius:6px;padding:2px 4px;margin:-2px -4px}
.dsh-op-thinkRow[data-foldable="true"]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-op-thinkCaret{flex:none;font-size:9px;line-height:1;color:var(--dsw-alias-label-secondary);
  width:9px;text-align:center}
/* The live marker is the same turning arc DSH uses for its own running work. */
.dsh-op-thinkRow[data-live="true"] .dsh-op-icon{width:9px;height:9px;flex:none;
  color:var(--dsw-alias-label-secondary)}
.dsh-op-thinkRow[data-live="true"] .dsh-op-thinkTag{color:var(--dsw-alias-label-primary)}
.dsh-op-thinkRow[data-foldable="true"][data-open="false"] .dsh-op-thinkBody{display:none}
.dsh-op-thinkMeta{display:flex;align-items:baseline;gap:6px}
/* Reasoning is the part worth reading, so it takes the brightest label. Tool
   calls are machinery: they sit a step down in tone and never compete with the
   thinking above them. */
.dsh-op-thinkTag{font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-op-thinkRow[data-kind="tool"] .dsh-op-thinkTag{
  color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-weight:500}
.dsh-op-thinkRow[data-kind="tool"] .dsh-op-thinkBody{opacity:.72}
.dsh-op-thinkRow[data-kind="sent"] .dsh-op-thinkTag{color:var(--dsw-alias-state-success-primary)}
.dsh-op-thinkRow[data-kind="conclusion"] .dsh-op-thinkTag{color:var(--dsw-alias-state-warn-primary)}
/* A folded row's first line, so the list stays scannable without expanding. */
.dsh-op-thinkPeek{flex:1;min-width:0;margin-left:6px;font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));opacity:.85;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-op-thinkTime{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.8;
  flex:none}
.dsh-op-thinkBody{white-space:pre-wrap;word-break:break-word;font-size:11.5px;line-height:16px;
  color:var(--dsw-alias-label-secondary)}
.dsh-op-runs{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.dsh-op-runRow{display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;
  border-radius:8px;border:1px solid var(--dsw-alias-border-l1);cursor:pointer;text-align:left;
  background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:12px}
.dsh-op-runRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-op-runRow[data-active="true"]{border-color:var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-bg-layer-2)}
.dsh-op-runId{font-weight:600;font-family:ui-monospace,monospace;font-size:11.5px}
.dsh-op-runMeta{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-op-runLog{display:flex;flex-direction:column;gap:9px;max-height:340px;overflow-y:auto;
  margin-top:8px;padding:8px;border-radius:8px;background:var(--dsw-alias-bg-base);
  border:1px solid var(--dsw-alias-border-l1)}
.dsh-op-resume{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px;
  border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);
  border:1px solid var(--dsw-alias-border-l1)}
.dsh-op-resume .dsh-op-hint{margin:0;flex:1 1 100%;color:var(--dsw-alias-label-primary)}
.dsh-op-modal{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;
  background:rgba(0,0,0,.45);padding:24px}
.dsh-op-modalCard{box-sizing:border-box;width:min(440px,92vw);padding:20px;border-radius:var(--dsw-radius-panel);
  display:flex;flex-direction:column;gap:10px;
  background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}
.dsh-op-modalCard .dsh-op-sub{margin:0;font-size:13px;line-height:20px}
```

---

# 附C · 真实组件源码

> 从 `client.js` 提取。**只保留构建界面的部分**：元素顺序、`className`、文案、状态条件。
> 数据请求和副作用已删掉，它们不影响画面。
>
> **照这里渲染出来的样子拍。**

## `PolishButton` 的渲染骨架

> 原组件 40848 字节，这里只保留**构建界面**的行（约 26%），去掉数据请求与副作用。

```js


        report('think-retarget', { from: thinkState.sessionId, to: current })

          report('strength', { next })

      /** Open the panel; a fresh start loads the saved defaults into the draft. */

        report('mount', {

        report('click', {
        if (busyRef.current) { report('skip', { reason: 'busy' }); return }
        if (typeof source !== 'string' || source.trim() === '') { flash('error', t('error.empty'), mode); return }
        if (claimed) { flash('error', t('error.claimed'), mode); return }
        if (referenceCount > 0) { flash('error', t('error.refs'), mode); return }
          flash('error', t('error.unavailable'), mode)

        setNotice(mode === 'expand' ? t('working.expand') : t('working'))
          report('fetch', { mode, url: ENDPOINT, len: source.length, text: source.slice(0, 120) })
            report('fetch-failed', { message: String(networkError?.message ?? networkError) })
            throw new Error(`${t('error.network')}: ${String(networkError?.message ?? networkError)}`)
          report('response', {
          if (next.trim() === '') throw new Error(t('error.emptyResult'))
          if (draftRef.current !== source) { report('stale', {}); flash('error', t('error.changed'), mode); return }
            report('unchanged', { mode, len: next.length })
            flash('unchanged', t('unchanged'), mode)
          report('setDraft', { mode, len: next.length })
          setTimeout(() => report('after', {
          flash('done', mode === 'expand' ? t('done.expand') : t('done'), mode)
          report('error', { mode, message: String(error?.message ?? error) })

      /** Label for one action: its own progress while running, its own result after. */
        const idle = mode === 'expand' ? t('expand') : t('button')
        if (phase === 'running') return running === mode ? (mode === 'expand' ? t('working.expand') : t('working')) : idle
        if (phase === 'done') return mode === 'expand' ? t('done.expand') : t('done')
        if (phase === 'unchanged') return t('unchanged')
        if (phase === 'error') return t('failed')

      /**
       * What the auto button reports about the last run.
       *
       * running  the loop is alive
       * done     it finished with rounds or a met goal
       * error    it died on something
       * stopped  it was interrupted, or it parked waiting on a busy assistant
       * idle     nothing has run in this session
       *
       * The colour on the button is the only always-visible signal that a
       * long-running loop is over, so each outcome gets its own state instead of
       * collapsing back to the same grey idle button.
       */

          return `${t('auto.on')} ${pilot.round ?? 0}/${pilot.mode === 'goal' ? '∞' : (pilot.rounds ?? 5)}`
        if (autoPhase === 'done') return t('auto.phase.done')
        if (autoPhase === 'error') return t('auto.phase.error')
          return pilot?.stopReason === 'interrupted' ? t('auto.phase.interrupted') : t('auto.phase.stopped')
        return t('auto.off')

        if (autoPhase === 'running') return t('auto.hint')
        if (autoPhase === 'idle') return t('auto.hint')
        return `${detail}${extra} · ${t('auto.phase.hint')}`

        if (phase === 'running' && running === mode) return h(SpinnerIcon)
        if (phase === 'done' && lastMode === mode) return h(CheckIcon)
        return mode === 'expand' ? h(ExpandIcon) : h(WandIcon)

      const buttonFor = (mode) => h('button', {
        className: mode === 'expand' ? 'dsh-op-btn dsh-op-btn--expand' : 'dsh-op-btn',
        title: notice === '' ? (mode === 'expand' ? t('expand.hint') : t('hint')) : notice,
        'aria-label': notice === '' ? (mode === 'expand' ? t('expand.hint') : t('hint')) : notice,
      }, iconFor(mode), h('span', null, labelFor(mode)))

      return h('div', { className: 'dsh-op-group' },
        h('button', {
          className: 'dsh-op-level',
          title: t('level.hint'),
          'aria-label': t('level.hint'),
        h('div', { className: 'dsh-op-auto', ref: autoRef },
          h('button', {
            className: 'dsh-op-btn',
          }, h(autoPhase === 'running' ? SpinnerIcon : LoopIcon), h('span', null, autoLabel)),
            ? h('div', { className: 'dsh-op-pop' },
                ? h(React.Fragment, null,
                  h('div', { className: 'dsh-op-popTitle' },
                      ? `${t('auto.running')} ${pilot.round ?? 0}/${pilot.mode === 'goal' ? '∞' : (pilot.rounds ?? 5)}${pilot.limitMs > 0 ? ` · ${t('auto.elapsed')} ${Math.max(0, Math.round((Date.now() - (pilot.startedAt ?? Date.now())) / 60000))}${t('auto.minutes')}` : ''}`
                    ? h('div', { className: 'dsh-op-hint dsh-op-waiting' },
                        ? `${t('auto.waitingOn')}${pilot.waitingOn} · `
                        : `${t('auto.waiting')} · `,
                      `${Math.max(0, Math.round((Date.now() - Number(pilot.waitingSince)) / 1000))}${t('auto.seconds')}`,
                        ? ` / ${Math.round(Number(pilot.waitingBudgetMs) / 60000)}${t('auto.minutes')}`
                    ? h('div', { className: 'dsh-op-hint' },
                      `${t('auto.context')}：${pilot.context.messages} ${t('auto.context.messages')} / ${pilot.context.chars} ${t('auto.context.chars')}`,
                        ? ` · ${t('auto.context.dropped')} ${pilot.context.dropped} ${t('auto.context.droppedUnit')}`
                  pilot.lastPrompt ? h('p', { className: 'dsh-op-hint' }, pilot.lastPrompt.slice(0, 120)) : null,
                  h('button', {
                    className: 'dsh-op-link',
                  }, t('auto.context.show')),
                    : h('pre', { className: 'dsh-op-pre' }, autoDetail),
                  h('button', {
                    className: 'dsh-op-link',
                  }, autoTrace === null ? t('auto.trace.show') : t('auto.trace.hide')),
                  h('button', {
                    className: 'dsh-op-link',
                  }, think.open === true ? t('auto.trace.undock') : t('auto.trace.dock')),
                    : h('div', { className: 'dsh-op-trace' },
                        ? h('div', { className: 'dsh-op-hint' }, t('auto.trace.empty'))
                        : autoTrace.map((entry, index) => h('div', {
                          className: 'dsh-op-traceRow',
                        h('span', { className: 'dsh-op-traceTag' },
                            ? `${t('auto.trace.think')} ${entry.round}`
                                ? `${t('auto.trace.sent')} ${entry.round}`
                                : t('auto.trace.conclusion')),
                        h('span', { className: 'dsh-op-traceText' },
                  h('div', { className: 'dsh-op-inline' },
                      ? h(React.Fragment, null,
                        h('button', {
                          className: 'dsh-op-btn',
                          title: t('auto.interrupt.hint'),
                        }, t('auto.interrupt')),
                        h('button', {
                          className: 'dsh-op-btn dsh-op-btn--danger',
                          title: t('auto.stop.hint'),
                        }, t('auto.stop')))
                      : h(React.Fragment, null,
                        h('button', {
                          className: 'dsh-op-btn dsh-op-btn--wide',
                        }, autoPhase === 'stopped' ? t('auto.resume.action') : t('auto.restart')),
                        h('button', {
                          className: 'dsh-op-link',
                        }, t('auto.clear')))))
                : h(React.Fragment, null,
                  h('div', { className: 'dsh-op-popTitle' }, t('auto.title')),
                    ? h('div', { className: 'dsh-op-resume' },
                      h('p', { className: 'dsh-op-hint' },
                        `${t('auto.resume.found')}：${resumable.round}/${resumable.mode === 'goal' ? '∞' : resumable.rounds}`),
                      h('button', {
                        className: 'dsh-op-btn',
                      }, t('auto.resume.action')),
                      h('button', {
                        className: 'dsh-op-link',
                      }, t('auto.resume.discard')))
                    ? h('p', { className: 'dsh-op-hint dsh-op-hint--error dsh-op-hint--block' }, pilot.error)
                    ? h('p', { className: 'dsh-op-hint' }, t(`auto.stop.${pilot.stopReason}`))
                  h('label', { className: 'dsh-op-radio' },
                    h('input', {
                    h('span', null, t('auto.mode.rounds'))),
                    ? h('input', {
                      className: 'dsh-op-input dsh-op-input--narrow',
                  h('label', { className: 'dsh-op-switch' },
                    h('input', {
                    h('span', { className: 'dsh-op-switchTrack', 'aria-hidden': 'true' },
                      h('span', { className: 'dsh-op-switchThumb' })),
                    h('span', { className: 'dsh-op-switchText' }, t('auto.limit'))),
                    ? h('div', { className: 'dsh-op-inline' },
                      h('input', {
                        className: 'dsh-op-input dsh-op-input--narrow',
                      h('span', { className: 'dsh-op-hint dsh-op-hint--inline' }, t('auto.hours')),
                      h('input', {
                        className: 'dsh-op-input dsh-op-input--narrow',
                      h('span', { className: 'dsh-op-hint dsh-op-hint--inline' }, t('auto.minutesUnit')))
                  h('label', { className: 'dsh-op-radio' },
                    h('input', {
                    h('span', null, t('auto.mode.goal'))),
                  h('textarea', {
                    className: 'dsh-op-input dsh-op-textarea',
                    placeholder: t('auto.goal.placeholder'),
                  h('button', {
                    className: 'dsh-op-btn dsh-op-btn--wide',
                  }, think.open === true ? t('auto.trace.undock') : t('auto.trace.dock')),
                  h('button', {
                    className: 'dsh-op-save',
                        title: t('auto.warn.title'),
                        body: t('auto.warn.body'),
                        confirmLabel: t('auto.warn.confirm'),
                        cancelLabel: t('auto.warn.cancel'),
                  }, starting ? t('auto.starting') : t('auto.start'))))
```

## `ThinkWindow` 的渲染骨架

> 原组件 6314 字节，这里只保留**构建界面**的行（约 25%），去掉数据请求与副作用。

```js


          ? `${t('auto.trace.think')} ${entry.round ?? ''}`
              ? `${t('auto.trace.sent')} ${entry.round ?? ''}`
              : t('auto.trace.conclusion')

        return h('div', {
          className: 'dsh-op-thinkRow',
        h('div', { className: 'dsh-op-thinkMeta' },
            ? h(SpinnerIcon)
              ? h('span', { className: 'dsh-op-thinkCaret', 'aria-hidden': 'true' }, open ? '▾' : '▸')
          h('span', { className: 'dsh-op-thinkTag' }, tag),
            ? h('span', { className: 'dsh-op-thinkPeek' }, String(body).replace(/\s+/g, ' ').slice(0, 80))
          entry.at === undefined ? null : h('span', { className: 'dsh-op-thinkTime' }, String(entry.at).slice(11, 19))),
        h('div', { className: 'dsh-op-thinkBody' },

      return h('div', { className: 'dsh-op-think', 'data-collapsed': collapsed ? 'true' : 'false' },
        h('div', { className: 'dsh-op-thinkHead' },
          h('span', { className: 'dsh-op-thinkTitle' }, t('auto.trace.title')),
          h('span', { className: 'dsh-op-thinkCount' }, `${rows.length}`),
          h('button', {
            className: 'dsh-op-thinkBtn',
            title: collapsed ? t('auto.trace.expand') : t('auto.trace.collapse'),
          h('button', {
            className: 'dsh-op-thinkBtn',
            title: t('auto.trace.close'),
          : h('div', {
            className: 'dsh-op-thinkBodyScroll',
            ? h('div', { className: 'dsh-op-hint dsh-op-hint--error' }, t('auto.trace.failed'))
              ? h('div', { className: 'dsh-op-hint' }, t('auto.trace.empty'))
```

## 档位常量

```js
const STRENGTHS = ['light', 'standard', 'strong']
const STRENGTH_KEY = 'dsh-one-click-polish:strength'
```

---

# 附D · 词表

| 界面上的中文原文 | 英文对照 |
| --- | --- |
| 润色 / 深度 / 扩写 / 自动 | Polish / Depth / Expand / Auto |
| 新会话 | New session |
| 完全权限 | Full access |
| 自动驾驶 | Autopilot |
| 循环几次结束 | End after N rounds |
| 直到达成目标结束 | Until the goal is met |
| 启动 | Start |
| 中断 | Skip this round |
| 停止自动 | Stop autopilot |
| 已完成 / 出错 / 意外停止 / 已中断 | Done / Error / Stopped / Interrupted |
| 自动思考 | Autopilot thinking |
| 思考 / 已发送 / 结论 | Thinking / Sent / Conclusion |
| 从中断处继续 | Continue |
| 清除状态 | Clear status |

**界面上的中文照原样渲染，不要翻译成英文。**
