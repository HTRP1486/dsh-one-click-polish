/**
 * dsh-one-click-polish — browser half.
 *
 * Contributes one thing to the web shell: a small "润色" pill at the left of the
 * composer tool row (`conversation.input.left`). One click takes the current
 * draft, asks the Host to rewrite it, and puts the result back into the draft.
 *
 * Why the Host does the call: the model has to be the one the Session is
 * switched to, and that selection lives in Host state. The button therefore only
 * sends `{ sessionId, text }` and receives the finished text — no streaming, no
 * partial writes, so the editor is never left holding half a sentence.
 *
 * The button reads and writes the draft through the composer's own provide
 * channel (`useInput` / `inputActions`), never through the DOM: the draft is
 * owned by the shell's Lexical editor and its chip semantics.
 *
 * Hand-written ModuleLoader bundle: no build step, no dependency beyond the
 * `react` the shell already provides, and every colour comes from a theme
 * variable so the button follows light/dark and the host's accent.
 */
window.__ModuleLoader__.load({
  id: 'dsh-one-click-polish',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NAME = 'dsh-one-click-polish'
    const NS = 'oneClickPolish'
    const CSS_ID = 'dsh-one-click-polish-style'
    const ENDPOINT = (() => {
      // Relative against document.baseURI so a deployment under a sub-path works.
      try { return new URL('plugins/dsh-one-click-polish/polish', document.baseURI).pathname }
      catch { return '/plugins/dsh-one-click-polish/polish' }
    })()
    const LOG = ENDPOINT.replace(/\/polish$/, '/log')
    const SETTINGS = ENDPOINT.replace(/\/polish$/, '/settings')
    const EFFORTS = ENDPOINT.replace(/\/polish$/, '/efforts')
    const PROGRESS = ENDPOINT.replace(/\/polish$/, '/progress')
    const PILOT = ENDPOINT.replace(/\/polish$/, '/autopilot')
    const RUNS = ENDPOINT.replace(/\/polish$/, '/runs')
    const VERSION = ENDPOINT.replace(/\/polish$/, '/version')

    /** The in-flight request, so the panel can cancel it. */
    let activeAbort = null

    /**
     * Report one step to the Host's in-memory log.
     *
     * The button lives in a browser this Host cannot inspect, so a click that
     * does nothing leaves no trace anywhere. These reports are the trace; they
     * never block the click and never surface to the user.
     */
    function report(event, extra) {
      try {
        fetch(LOG, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event, ...extra }),
          keepalive: true,
        }).catch(() => {})
      } catch { /* a missing log route must never break the button */ }
    }

    const STRENGTHS = ['light', 'standard', 'strong']
    const STRENGTH_KEY = 'dsh-one-click-polish:strength'

    /** The remembered strength, so the choice survives a reload. */
    function readStrength() {
      try {
        const stored = window.localStorage.getItem(STRENGTH_KEY)
        return STRENGTHS.includes(stored) ? stored : 'strong'
      } catch { return 'strong' }
    }

    // ── job store ───────────────────────────────────────────────────────────
    /**
     * One job at a time — the toolbar runs one action — shared between the
     * button that starts it and the floating panel that watches it.
     *
     * A single POST cannot report progress, so the panel polls the Host's job
     * table while the request is in flight. `null` means no panel at all.
     */
    /** Right-hand thinking window: open state and the session it follows. */
    /** Expand result card: one at a time, rendered by the frame-wide overlay. */
    let expandCardState = null
    const expandCardListeners = new Set()

    function publishExpandCard(next) {
      expandCardState = next
      for (const listener of expandCardListeners) listener()
    }

    function useExpandCard() {
      const [value, setValue] = useState(expandCardState)
      useEffect(() => {
        const listener = () => setValue(expandCardState)
        expandCardListeners.add(listener)
        listener()
        return () => { expandCardListeners.delete(listener) }
      }, [])
      return value
    }

    let thinkState = { open: false, sessionId: null }
    const thinkListeners = new Set()

    function publishThink(next) {
      thinkState = next
      for (const listener of thinkListeners) listener()
    }

    function useThink() {
      const [value, setValue] = useState(thinkState)
      useEffect(() => {
        const listener = () => setValue(thinkState)
        thinkListeners.add(listener)
        listener()
        return () => { thinkListeners.delete(listener) }
      }, [])
      return value
    }
    let jobState = null
    const jobListeners = new Set()
    /**
     * The autopilot confirmation is a frame-wide overlay, not a child of the
     * composer. Rendered inside the conversation scroll container, a
     * position: fixed backdrop is trapped by an ancestor's transform and ends up
     * covering the whole app instead of just the screen — which also swallowed
     * clicks meant for the harness's own question card. Its state therefore
     * lives here, and it renders in shell.overlay.
     */
    let confirmState = null
    const confirmListeners = new Set()

    function publishConfirm(next) {
      confirmState = next
      for (const listener of confirmListeners) listener()
    }

    function useConfirm() {
      const [value, setValue] = useState(confirmState)
      useEffect(() => {
        const listener = () => setValue(confirmState)
        confirmListeners.add(listener)
        listener()
        return () => { confirmListeners.delete(listener) }
      }, [])
      return value
    }


    function publishJob(next) {
      jobState = next
      for (const listener of jobListeners) listener()
    }

    function useJob() {
      const [value, setValue] = useState(jobState)
      useEffect(() => {
        const listener = () => setValue(jobState)
        jobListeners.add(listener)
        listener()
        return () => { jobListeners.delete(listener) }
      }, [])
      return value
    }

    /**
     * Wait for an accepted job's result by polling.
     *
     * The request that started the work has already returned, so the browser is
     * free to lose it — every poll is a fresh, cheap request. This is what keeps
     * a two-minute expansion from dying halfway through.
     */
    async function awaitJobResult(id, abort, timeoutMs = 300000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (abort !== undefined && abort.signal.aborted) throw new Error('已取消')
        await new Promise(resolve => setTimeout(resolve, 700))
        let payload
        try {
          const response = await fetch(`${PROGRESS}?id=${encodeURIComponent(id)}`)
          payload = await response.json()
        } catch {
          continue
        }
        const job = payload?.job
        if (job === null || job === undefined) return null
        if (job.done === true) {
          if (typeof job.error === 'string' && job.error !== '') return { ok: false, error: job.error }
          return job.result ?? { ok: false, error: '任务结束了但没有结果' }
        }
      }
      return { ok: false, error: '任务超时' }
    }

    /** Poll one job until the Host reports it done; returns a stop function. */
    function watchJob(id) {
      let stopped = false
      const tick = async () => {
        if (stopped) return
        try {
          const response = await fetch(`${PROGRESS}?id=${encodeURIComponent(id)}`)
          const payload = await response.json().catch(() => null)
          const job = payload?.job
          if (job !== null && job !== undefined && jobState !== null && jobState.id === id) {
            publishJob({ ...jobState, steps: job.steps, done: job.done, error: job.error })
            if (job.done === true) {
              stopped = true
              return
            }
          }
        } catch { /* transient; keep polling */ }
        if (!stopped) setTimeout(tick, 400)
      }
      tick()
      return () => { stopped = true }
    }

    function glyphOf(state) {
      if (state === 'done') return '✓'
      if (state === 'running') return '◐'
      if (state === 'skipped') return '–'
      if (state === 'error') return '!'
      return '○'
    }

    // ── copy ────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        'button': '润色',
        hint: '一键润色输入框里的内容（用当前会话选择的模型，资料深度看右边的胶囊）',
        expand: '扩写',
        'expand.hint': '把一句话扩写成完整需求：目标 / 功能点 / 流程 / 边界 / 验收标准',
        'working.expand': '扩写中…',
        'done.expand': '已扩写',
        working: '润色中…',
        done: '已润色',
        unchanged: '无需修改',
        failed: '润色失败',
        'error.empty': '输入框是空的，没有可润色的内容',
        'error.claimed': '这是命令消息，不能整段润色',
        'error.refs': '内容里有 @ 引用，润色会丢掉它们，请先移除再润色',
        'error.changed': '润色期间草稿被改动了，结果已丢弃',
        'error.emptyResult': '模型没有返回文本',
        'error.unavailable': '当前输入框不支持写回',
        'error.network': '无法连接 DSH 本地服务',
        'level.light': '轻度',
        'level.standard': '标准',
        'level.strong': '深度',
        'level.hint': '资料深度：轻度=只润色 / 标准=查本地文件 / 深度=本地+联网。点一下切换。',
        'job.title.polish': '润色中',
        'job.title.expand': '扩写中',
        'job.done': '完成',
        'job.expanding': '扩写中',
        'job.polishing': '润色中',
        'job.label': '润色步骤',
        'job.failed': '失败',
        'job.hide': '收起',
        'job.cancel': '取消这次操作',
        'job.expand': '展开进度',
        'job.step.keywords': '提取关键词',
        'job.step.explore': 'AI 检索资料',
        'auto.off': '自动',
        'auto.on': '自动',
        'auto.hint': '让 AI 自己写下一步提示词并继续推进；轮数、目标在设置页配置。再点一次停止。',
        'auto.title': '自动驾驶',
        'auto.mode.rounds': '循环几次结束',
        'auto.mode.goal': '直到达成目标结束',
        'auto.goal.placeholder': '目标（可选）：写清楚要达成什么，达成后自动停；不填就只看轮数',
        'auto.start': '启动',
        'auto.starting': '正在启动…',
        'auto.warn.title': '确认启动自动驾驶？',
        'auto.warn.body': '启动后 AI 会自动往这个会话里发送消息：读对话 → 写下一步提示词 → 发给助手，一轮接一轮。它会消耗模型额度，也可能做出你没想到的改动。随时可以中断或结束循环。',
        'auto.warn.cancel': '再想想',
        'auto.warn.confirm': '确认启动',
        'auto.interrupt': '跳过这一轮',
        'auto.interrupt.hint': '取消助手正在做的这一轮，循环继续，它会重新判断下一步。',
        'auto.stop.hint': '整个自动驾驶停下。之后可以从这里继续。',
        'auto.stop': '停止自动',
        'auto.running': '运行中',
        'auto.context': '上下文',
        'auto.context.messages': '条消息',
        'auto.context.chars': '字',
        'auto.context.show': '查看驱动 AI 读到的上下文',
        'auto.context.dropped': '压缩省略',
        'auto.context.droppedUnit': '条',
        'auto.stop.rounds': '已跑满设定的轮数，自动结束。',
        'auto.stop.time': '到了设定的时长上限，自动结束。',
        'auto.stop.goal': '驱动 AI 判断目标已达成，提前收工。',
        'auto.stop.empty': '驱动 AI 想不出下一步了（连续返回空消息），已自行停下。点「继续」可以再试。',
        'auto.stop.error': '运行中出错，已停止。',
        'auto.stop.session-gone': '会话已关闭，自动结束。',
        'auto.stop.busy': '助手还在处理上一条消息，先停下了。',
        'auto.phase.done': '已完成',
        'auto.phase.error': '出错',
        'auto.phase.stopped': '意外停止',
        'auto.phase.interrupted': '已停止',
        'auto.waiting': '等待助手完成上一轮',
        'auto.waitingOn': '等待助手完成：',
        'auto.seconds': ' 秒',
        'settings.idleWait': '等待助手完成上一轮的上限',
        'settings.idleWait.hint': '自动驾驶要发下一条时，如果助手还在处理，它会等。超过这个上限就先停下，点「继续」可以接着来。长会话需要更长的时间。',
        'settings.idleWait.unit': '分钟',
        'version.current': '当前版本',
        'version.latest': '已是最新',
        'version.newest': 'npm 上有',
        'version.checking': '检查更新中…',
        'version.unknown': '查不到最新版本',
        'version.how': '怎么更新',
        'version.recheck': '重新检查',
        'version.updateHint': '卸载后按包名重装即可更新（dsh 不为第三方插件提供更新按钮）',
        'expand.card.title': '扩写结果',
        'expand.card.apply': '写入输入框',
        'expand.card.discard': '丢弃',
        'settings.explore': '检索预算',
        'settings.explore.hint': '标准/深度润色时会先查资料。这是查资料总共能用多久、最多查几轮。查完后再改写，两者互不占用。',
        'settings.explore.unit': '秒',
        'settings.explore.rounds': '轮',
        'settings.rewriteBudget': '改写预算',
        'settings.rewriteBudget.hint': '模型写答案这一步最多等多久。给得太短，长草稿会来不及。',
        'auto.stop.interrupted': '你点了停止，可以从这里继续。',
        'auto.phase.hint': '点一下看详情',
        'auto.restart': '重新开始',
        'auto.clear': '清除状态',
        'auto.trace.show': '查看思考与调用',
        'auto.trace.hide': '收起思考与调用',
        'auto.trace.empty': '这个对话还没有自动运行记录。点「自动」并启动后，这里会实时显示它的思考和工具调用。',
        'auto.trace.think': '思考',
        'auto.trace.sent': '已发送',
        'auto.trace.conclusion': '结论',
        'auto.trace.dock': '在右侧显示',
        'auto.trace.undock': '关闭右侧窗口',
        'auto.trace.title': '自动思考',
        'auto.trace.collapse': '收起',
        'auto.trace.expand': '展开',
        'auto.trace.close': '关闭',
        'auto.trace.failed': '读取日志失败',
        'runs.title': '自动运行日志',
        'runs.hint': '每个对话的自动驾驶记录：它读了哪些文件、调用了什么、发了什么。按会话归档，重启后仍在。',
        'runs.empty': '还没有任何自动运行记录',
        'runs.sent': '条已发送',
        'runs.entries': '条记录',
        'runs.alive': '会话在运行',
        'settings.renderFailed': '这个页面渲染出错',
        'auto.resume.found': '上次中断的自动运行',
        'auto.resume.action': '从中断处继续',
        'auto.resume.discard': '丢弃',
        'auto.limit': '限制运行时间',
        'auto.hours': '小时',
        'auto.minutesUnit': '分钟',
        'auto.elapsed': '已跑',
        'auto.minutes': ' 分钟',
        'job.step.local': '查找本地文件',
        'job.step.web': '联网检索',
        'job.step.rewrite': '重写',
        'settings.nav': '润色 / 扩写',
        'settings.title': '润色 / 扩写',
        'settings.sub': '润色力度直接在输入框工具栏的档位胶囊上切换，这里只管模型。',
        'settings.group.model': '模型',
        'settings.follow.note': '随对话切换',
        'settings.fixed.note': '始终用同一个',
        'settings.source': '模型来源',
        'settings.follow': '跟随当前对话',
        'settings.follow.hint': '用输入框模型选择器里当前选中的模型，切换即生效。',
        'settings.fixed': '固定模型',
        'settings.fixed.hint': '不管对话里选了什么，都固定用下面这个模型。',
        'settings.model': '模型',
        'settings.model.none': '未选择模型',
        'settings.model.search': '搜索模型或供应商…',
        'settings.model.clear': '清空搜索',
        'settings.model.noMatch': '没有匹配的模型',
        'settings.model.more': '还有 {n} 个，输入关键词搜索',
        'settings.effort': '思考程度',
        'settings.effort.default': '默认',
        'settings.effort.hint': '按当前模型实际支持的档位生成，不支持的档位不会出现；换模型时会自动回落。',
        'settings.strength': '默认力度',
        'settings.loading': '加载中…',
        'settings.save': '保存',
        'settings.discard': '撤销修改',
        'settings.dirty': '有未保存的修改',
        'settings.saveOk': '保存成功',
        'settings.saving': '保存中…',
        'settings.saved': '已保存',
        'settings.saveFailed': '保存失败',
        'settings.loadFailed': '加载设置失败',
        'settings.memoryOnly': '已生效，但没写进 profile 配置，重启后会恢复',
        'settings.retry': '重试',
        'settings.noCatalog': '没有取到可用模型列表',
        'settings.auto': '自动驾驶',
        'settings.auto.mode': '停止条件',
        'settings.auto.rounds': '循环轮数',
        'settings.auto.goal': '目标',
        'settings.auto.research': '自动检索',
        'settings.auto.hint': '工具栏的「自动」按钮按这里的配置推进：AI 会读对话、写下一步提示词并发给助手。改完记得保存。',
        'settings.auto.mode.rounds': '循环 N 轮后停止',
        'settings.auto.mode.goal': '达成目标后结束',
        'settings.auto.research.none': '不查资料',
        'settings.auto.research.local': '查本地',
        'settings.auto.research.web': '本地 + 联网',
        'settings.auto.goal.placeholder': '例如：把这个插件的 README 改到可以直接发布',
      },
      en: {
        button: 'Polish',
        hint: 'Polish the draft with the model this session is switched to',
        expand: 'Expand',
        'expand.hint': 'Turn a one-line wish into a task brief: goal, features, flow, edge cases, acceptance',
        'working.expand': 'Expanding…',
        'done.expand': 'Expanded',
        working: 'Polishing…',
        done: 'Polished',
        unchanged: 'No change needed',
        failed: 'Failed',
        'error.empty': 'The composer is empty — nothing to polish',
        'error.claimed': 'This is a command message; it cannot be polished as a whole',
        'error.refs': 'The draft contains @ references, which polishing would drop. Remove them first.',
        'error.changed': 'The draft changed while polishing; the result was discarded',
        'error.emptyResult': 'The model returned no text',
        'error.unavailable': 'This composer cannot accept a rewritten draft',
        'error.network': 'Cannot reach the local DSH service',
        'level.light': 'Light',
        'level.standard': 'Standard',
        'level.strong': 'Deep',
        'level.hint': 'Research depth: Light = draft only / Standard = local files / Deep = local + web. Click to cycle.',
        'job.title.polish': 'Polishing',
        'job.title.expand': 'Expanding',
        'job.done': 'Done',
        'job.expanding': 'Expanding',
        'job.polishing': 'Polishing',
        'job.label': 'Polish steps',
        'job.failed': 'Failed',
        'job.hide': 'Collapse',
        'job.cancel': 'Cancel this run',
        'job.expand': 'Show progress',
        'job.step.keywords': 'Extract keywords',
        'job.step.explore': 'AI research',
        'auto.off': 'Auto',
        'auto.on': 'Auto',
        'auto.hint': 'Let the AI write the next prompt and keep going. Click to configure.',
        'auto.title': 'Autopilot',
        'auto.mode.rounds': 'Stop after N rounds',
        'auto.mode.goal': 'Stop when the goal is met',
        'auto.goal.placeholder': 'Goal (optional): say what "done" means and it stops there; leave empty to just run the rounds',
        'auto.start': 'Start',
        'auto.starting': 'Starting…',
        'auto.warn.title': 'Start autopilot?',
        'auto.warn.body': 'The AI will send messages into this conversation by itself: read the history, write the next prompt, send it, round after round. It spends model quota and may change things you did not expect. You can interrupt or end the loop at any time.',
        'auto.warn.cancel': 'Not now',
        'auto.warn.confirm': 'Start',
        'auto.interrupt': 'Skip this round',
        'auto.interrupt.hint': 'Cancel the turn the assistant is running. The loop stays alive and re-plans the next step.',
        'auto.stop.hint': 'End the autopilot. You can continue from here afterwards.',
        'auto.stop': 'Stop autopilot',
        'auto.running': 'Running',
        'auto.context': 'Context',
        'auto.context.messages': 'messages',
        'auto.context.chars': 'chars',
        'auto.context.show': 'Show what the driver read',
        'auto.context.dropped': 'compressed',
        'auto.context.droppedUnit': 'messages',
        'auto.stop.rounds': 'Stopped: the configured round count was reached.',
        'auto.stop.time': 'Stopped: the time limit was reached.',
        'auto.stop.goal': 'Stopped early: the driver judged the goal met.',
        'auto.stop.empty': 'The driver could not think of a next step (two empty replies in a row). Continue to retry.',
        'auto.stop.error': 'Stopped after an error.',
        'auto.stop.session-gone': 'Stopped: the session is gone.',
        'auto.stop.busy': 'Stopped: the assistant was still busy with the previous message.',
        'auto.phase.done': 'Done',
        'auto.phase.error': 'Failed',
        'auto.phase.stopped': 'Stopped',
        'auto.phase.interrupted': 'Stopped',
        'auto.waiting': 'Waiting for the assistant to finish its turn',
        'auto.waitingOn': 'Waiting for the assistant: ',
        'auto.seconds': 's',
        'settings.idleWait': 'How long to wait for the assistant',
        'settings.idleWait.hint': 'When the loop is ready to send but the assistant is still working, it waits. Past this limit it parks, and Continue picks it up again. Long conversations need more time.',
        'settings.idleWait.unit': 'minutes',
        'version.current': 'Version',
        'version.latest': 'Up to date',
        'version.newest': 'npm has',
        'version.checking': 'Checking for updates…',
        'version.unknown': 'Cannot reach npm',
        'version.how': 'How to update',
        'version.recheck': 'Check again',
        'version.updateHint': 'Uninstall and install by package name to update (dsh offers no update button for third-party plugins)',
        'expand.card.title': 'Expanded brief',
        'expand.card.apply': 'Put in composer',
        'expand.card.discard': 'Discard',
        'settings.explore': 'Lookup budget',
        'settings.explore.hint': 'A standard or deep polish looks things up first. This is how long that may take in total, and how many rounds it may spend. The rewrite runs separately with its own budget.',
        'settings.explore.unit': 's',
        'settings.explore.rounds': 'rounds',
        'settings.rewriteBudget': 'Rewrite budget',
        'settings.rewriteBudget.hint': 'How long the model may take to write the answer. Too short and a long draft will not finish.',
        'auto.stop.interrupted': 'You stopped it. Continue picks up here.',
        'auto.phase.hint': 'Click for details',
        'auto.restart': 'Run again',
        'auto.clear': 'Clear status',
        'auto.trace.show': 'Show reasoning and calls',
        'auto.trace.hide': 'Hide reasoning and calls',
        'auto.trace.empty': 'No autopilot run in this conversation yet. Start one from Auto, and its reasoning and tool calls appear here live.',
        'auto.trace.think': 'Thinking',
        'auto.trace.sent': 'Sent',
        'auto.trace.conclusion': 'Conclusion',
        'auto.trace.dock': 'Show on the right',
        'auto.trace.undock': 'Close the right window',
        'auto.trace.title': 'Autopilot thinking',
        'auto.trace.collapse': 'Collapse',
        'auto.trace.expand': 'Expand',
        'auto.trace.close': 'Close',
        'auto.trace.failed': 'Could not read the log',
        'runs.title': 'Autopilot run log',
        'runs.hint': 'Per conversation: which files the driver read, what it called, and what it sent. Archived by session, so it survives a restart.',
        'runs.empty': 'No autopilot run recorded yet',
        'runs.sent': 'sent',
        'runs.entries': 'entries',
        'runs.alive': 'session live',
        'settings.renderFailed': 'This page failed to render',
        'auto.resume.found': 'Interrupted run from last time',
        'auto.resume.action': 'Resume where it stopped',
        'auto.resume.discard': 'Discard',
        'auto.limit': 'Time limit',
        'auto.hours': 'h',
        'auto.minutesUnit': 'min',
        'auto.elapsed': 'elapsed',
        'auto.minutes': ' min',
        'job.step.local': 'Search local files',
        'job.step.web': 'Search the web',
        'job.step.rewrite': 'Rewrite',
        'settings.nav': 'Polish / Expand',
        'settings.title': 'Polish / Expand',
        'settings.sub': 'Polish strength is switched from the level chip in the composer toolbar; this page only covers the model.',
        'settings.group.model': 'Model',
        'settings.follow.note': 'Follows the conversation',
        'settings.fixed.note': 'Always the same one',
        'settings.source': 'Model source',
        'settings.follow': 'Follow this conversation',
        'settings.follow.hint': 'Use the model currently selected in the composer; switching takes effect immediately.',
        'settings.fixed': 'Fixed model',
        'settings.fixed.hint': 'Always use the model below, whatever the conversation is switched to.',
        'settings.model': 'Model',
        'settings.model.none': 'No model selected',
        'settings.model.search': 'Search models or providers…',
        'settings.model.clear': 'Clear search',
        'settings.model.noMatch': 'No matching model',
        'settings.model.more': '{n} more — type to search',
        'settings.effort': 'Reasoning effort',
        'settings.effort.default': 'Default',
        'settings.effort.hint': 'Options come from what this model actually supports; switching models falls back automatically.',
        'settings.strength': 'Default strength',
        'settings.loading': 'Loading…',
        'settings.save': 'Save',
        'settings.discard': 'Discard changes',
        'settings.dirty': 'Unsaved changes',
        'settings.saveOk': 'Saved',
        'settings.saving': 'Saving…',
        'settings.saved': 'Saved',
        'settings.saveFailed': 'Save failed',
        'settings.loadFailed': 'Could not load settings',
        'settings.memoryOnly': 'Applied, but not written to the profile config; it resets on restart',
        'settings.retry': 'Retry',
        'settings.noCatalog': 'No models were listed',
        'settings.auto': 'Autopilot',
        'settings.auto.mode': 'Stop condition',
        'settings.auto.rounds': 'Rounds',
        'settings.auto.goal': 'Goal',
        'settings.auto.research': 'Research',
        'settings.auto.hint': 'The Auto button in the toolbar uses these settings: the AI reads the conversation, writes the next prompt, and sends it. Save after editing.',
        'settings.auto.mode.rounds': 'Stop after N rounds',
        'settings.auto.mode.goal': 'Stop when the goal is met',
        'settings.auto.research.none': 'No research',
        'settings.auto.research.local': 'Local only',
        'settings.auto.research.web': 'Local + web',
        'settings.auto.goal.placeholder': 'e.g. bring this plugin README to publishable quality',
      },
    }

    // ── styles ──────────────────────────────────────────────────────────────
    // Geometry and colour follow the composer's own 28px round controls
    // (RlGAzG_add): a pill keeps the label readable while staying in that row.
    const CSS = `
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
/* Expand result card: centred above the composer, wide enough for prose, with
   the body scrolling instead of the card growing past the viewport. */

/* Step rows inside the conversation turn: they read as part of the reply, so no
   card, no shadow — just a small head and one row per step. */
.dsh-op-steps{margin:10px 0 2px;padding:0;font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-secondary)}
.dsh-op-stepsHead{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.dsh-op-stepsTitle{font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-op-stepsSpin{display:inline-block;animation:dsh-op-spin 1s linear infinite}
.dsh-op-stepRow{display:flex;align-items:baseline;gap:7px;padding:1px 0}
.dsh-op-stepRow[data-state="done"],.dsh-op-stepRow[data-state="running"]{
  color:var(--dsw-alias-label-primary)}
.dsh-op-stepRow[data-state="error"]{color:var(--dsw-alias-state-error-primary)}
.dsh-op-stepDot{flex:none;width:12px;text-align:center;font-size:11px}
.dsh-op-stepText{flex:none}
.dsh-op-stepDetail{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;opacity:.75}
.dsh-op-stepError{margin-top:6px;font-size:11px;color:var(--dsw-alias-state-error-primary)}
@media (prefers-reduced-motion:reduce){.dsh-op-stepsSpin{animation:none}}
.dsh-op-expand{position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:1450;
  width:min(560px,calc(100vw - 64px));max-height:min(420px,55vh);display:flex;flex-direction:column;
  border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-1);
  border:.5px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-prominent);
  color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:19px;
  animation:dsh-op-pop-in .17s cubic-bezier(.22,1,.36,1) both}
.dsh-op-expandHead{display:flex;align-items:center;gap:8px;padding:10px 12px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-op-expandTitle{flex:1;font-size:13px;font-weight:600}
.dsh-op-expandBody{flex:1;min-height:0;overflow-y:auto;padding:12px;
  white-space:pre-wrap;word-break:break-word;user-select:text}
.dsh-op-expandFoot{display:flex;align-items:center;gap:8px;padding:10px 12px;flex:none;
  border-top:1px solid var(--dsw-alias-border-l1)}
@media (prefers-reduced-motion:reduce){.dsh-op-expand{animation:none}}
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
/* Top-right, not top-left: the left column is dsh's own sidebar (brand, new
   session, workspaces, session list) and a 300px panel anchored at left:12px covered
   its upper half — the progress window hid the navigation it was reporting about.
   Right of the content column is empty until the thinking window appears, and the
   two stack cleanly: 12px vs 64px from the same edge. */
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
`

    // ── icons ───────────────────────────────────────────────────────────────
    const WandIcon = () => h('svg', {
      className: 'dsh-op-icon',
      viewBox: '0 0 16 16',
      'aria-hidden': true,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    h('path', { d: 'M9.2 3.4 12.6 6.8 5.4 14H2v-3.4z' }),
    h('path', { d: 'M8.1 4.5 11.5 7.9' }),
    h('path', { d: 'M12.9 2.1l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4L11 4l1.4-.5z' }))

    const SpinnerIcon = () => h('svg', {
      className: 'dsh-op-icon',
      'data-spin': 'true',
      viewBox: '0 0 16 16',
      'aria-hidden': true,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
    },
    h('path', { d: 'M8 1.6a6.4 6.4 0 1 0 6.4 6.4', opacity: 0.9 }))

    const CheckIcon = () => h('svg', {
      className: 'dsh-op-icon',
      viewBox: '0 0 16 16',
      'aria-hidden': true,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }, h('path', { d: 'M3 8.6 6.3 12 13 4.6' }))

    const ExpandIcon = () => h('svg', {
      className: 'dsh-op-icon',
      viewBox: '0 0 16 16',
      'aria-hidden': true,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    h('path', { d: 'M3.6 1.8h8.8v12.4H3.6z', opacity: 0.9 }),
    h('path', { d: 'M5.8 5h4.4M5.8 7.6h4.4M5.8 10.2h2.6' }))

    const LoopIcon = () => h('svg', {
      className: 'dsh-op-icon',
      viewBox: '0 0 16 16',
      'aria-hidden': true,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    h('path', { d: 'M13.2 6.2A5.4 5.4 0 0 0 3.4 5.1' }),
    h('path', { d: 'M2.8 9.8a5.4 5.4 0 0 0 9.8 1.1' }),
    h('path', { d: 'M13.4 2.6v3.8h-3.8M2.6 13.4V9.6h3.8' }))

    // ── the controls ────────────────────────────────────────────────────────
    /**
     * Two actions over the same draft: 润色 rewrites what is there, 扩写 turns a
     * one-line wish into the task brief it should have been.
     *
     * @param props - the composer slot's standard provide channel plus the bound
     *   translate thunk this plugin passes in.
     */
    function PolishButton({ useInput, inputActions, sessionId, t }) {
      const draft = useInput(state => state.draft)
      const claimed = useInput(state => state.claim !== undefined)
      const referenceCount = useInput(state => state.occurrences.length)

      const [phase, setPhase] = useState('idle')     // idle | running | done | unchanged | error
      const [running, setRunning] = useState(null)   // 'polish' | 'expand'
      const [lastMode, setLastMode] = useState('polish')
      const [notice, setNotice] = useState('')
      const [strength, setStrength] = useState(readStrength)
      const [pilot, setPilot] = useState(null)
      const [autoOpen, setAutoOpen] = useState(false)
      const [autoDraft, setAutoDraft] = useState({ mode: 'rounds', rounds: 5, goal: '', limitMinutes: 0 })
      const [autoDetail, setAutoDetail] = useState(null)
      const [autoTrace, setAutoTrace] = useState(null)
      const [resumable, setResumable] = useState(null)
      const [starting, setStarting] = useState(false)
      // Expand result shown as a card before it replaces the draft.
      const expandCard = useExpandCard()
      const think = useThink()
      const pilotTimer = useRef(null)

      // Follow the conversation the user is looking at. The window captures a
      // session when it opens, so switching chats left it anchored to the old one;
      // the composer always knows which session is current, so it retargets the
      // open window instead of making the user close and reopen it.
      useEffect(() => {
        if (thinkState.open !== true) return
        // No session bound yet (a brand-new composer): leave the window as it is.
        if (sessionId === undefined || sessionId === null || String(sessionId) === '') return
        const current = String(sessionId)
        if (thinkState.sessionId === current) return
        report('think-retarget', { from: thinkState.sessionId, to: current })
        publishThink({ open: true, sessionId: current })
      }, [sessionId, think.open, think.sessionId])

      const cycleStrength = useCallback(() => {
        setStrength(previous => {
          const next = STRENGTHS[(STRENGTHS.indexOf(previous) + 1) % STRENGTHS.length]
          try { window.localStorage.setItem(STRENGTH_KEY, next) } catch { /* private mode */ }
          report('strength', { next })
          return next
        })
      }, [])

      // Read the live draft inside the click handler without re-creating it on
      // every keystroke, and use the same ref to detect an edit that landed
      // while the request was in flight.
      const draftRef = useRef(draft)
      draftRef.current = draft
      const busyRef = useRef(false)
      const resetTimer = useRef(null)

      const clearTimer = () => {
        if (resetTimer.current !== null) {
          clearTimeout(resetTimer.current)
          resetTimer.current = null
        }
      }

      useEffect(() => clearTimer, [])

      const flash = useCallback((nextPhase, message, mode) => {
        clearTimer()
        setPhase(nextPhase)
        setNotice(message)
        setLastMode(mode)
        resetTimer.current = setTimeout(() => {
          resetTimer.current = null
          setPhase('idle')
          setNotice('')
        }, nextPhase === 'error' ? 6000 : 2400)
      }, [])

      // Keep the button honest across conversation switches: the slot unmounts
      // when the user leaves a session, so without this the panel would reopen
      // on a run that is still going and claim it is off.
      const autoRef = useRef(null)
      useEffect(() => {
        let cancelled = false
        const load = async () => {
          try {
            const response = await fetch(`${PILOT}?sessionId=${encodeURIComponent(String(sessionId))}`)
            const next = (await response.json())?.pilot
            if (!cancelled && next !== undefined) setPilot(next)
          } catch { /* the button stays off until the panel is opened */ }
        }
        load()
        return () => { cancelled = true }
      }, [sessionId])

      // Clicking anywhere outside the panel, or pressing Escape, closes it. The
      // panel lives in the composer, so leaving it open while the user clicks
      // into the editor is the wrong default.
      useEffect(() => {
        if (!autoOpen) return undefined
        const onDown = (event) => {
          // While the confirmation overlay is up it owns the interaction, so an
          // outside click must not dismiss the panel underneath it as well.
          if (confirmState !== null) return
          if (autoRef.current !== null && event.target instanceof Node && !autoRef.current.contains(event.target)) {
            setAutoOpen(false)
          }
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (confirmState !== null) {
            publishConfirm(null)
            return
          }
          setAutoOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [autoOpen, confirmState !== null])

      // Poll the driver while it is armed: the Host stops it on its own when the
      // goal is met or the round budget runs out, and the button has to follow.
      useEffect(() => {
        if (pilot === null || pilot.enabled !== true) return undefined
        let cancelled = false
        const tick = async () => {
          try {
            const response = await fetch(`${PILOT}?sessionId=${encodeURIComponent(String(sessionId))}`)
            const next = (await response.json())?.pilot
            if (!cancelled && next !== undefined && next !== null) setPilot(next)
          } catch { /* transient */ }
          if (!cancelled) pilotTimer.current = setTimeout(tick, 2500)
        }
        tick()
        return () => {
          cancelled = true
          if (pilotTimer.current !== null) clearTimeout(pilotTimer.current)
        }
      }, [pilot?.enabled, sessionId])

      /** Open the panel; a fresh start loads the saved defaults into the draft. */
      const openPilot = useCallback(async () => {
        setAutoOpen(true)
        publishConfirm(null)
        if (pilot !== null && pilot.enabled === true) return
        // Pick up a previous run's outcome, so a failure is visible instead of
        // looking like nothing happened.
        try {
          const state = await fetch(`${PILOT}?sessionId=${encodeURIComponent(String(sessionId))}`)
          const previous = (await state.json())?.pilot
          if (previous !== null && previous !== undefined) setPilot(previous)
        } catch { /* the panel still opens */ }
        // A run the last Host process left unfinished is offered, never started.
        try {
          const response = await fetch(`${PILOT}?resumable=1`)
          const list = (await response.json())?.resumable ?? []
          setResumable(list.find(entry => entry.sessionId === String(sessionId)) ?? null)
        } catch { /* nothing to offer */ }
        try {
          const response = await fetch(SETTINGS)
          const config = (await response.json())?.settings ?? {}
          // The panel is the only place autopilot is configured; the saved values
          // just seed it so a repeat run does not retype the same goal.
          setAutoDraft({
            mode: config.autoMode === 'goal' ? 'goal' : 'rounds',
            rounds: config.autoRounds ?? 5,
            goal: config.autoGoal ?? '',
            limitMinutes: 0,
          })
        } catch { /* keep whatever the draft already holds */ }
      }, [pilot])

      const startPilot = useCallback(async () => {
        setStarting(true)
        try {
          const response = await fetch(PILOT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sessionId: String(sessionId),
              enabled: true,
              mode: autoDraft.mode,
              rounds: autoDraft.rounds,
              goal: autoDraft.goal,
              limitMinutes: autoDraft.limitMinutes ?? 0,
              strength,
            }),
          })
          const payload = await response.json()
          if (payload?.ok === true) {
            setPilot(payload.pilot)
            publishConfirm(null)
            setAutoOpen(false)
            // Remember what was just chosen, so the next open starts from it.
            fetch(SETTINGS, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                ...((await (await fetch(SETTINGS)).json())?.settings ?? {}),
                autoMode: autoDraft.mode,
                autoRounds: autoDraft.rounds,
                autoGoal: autoDraft.goal,
              }),
            }).catch(() => {})
          } else {
            flash('error', String(payload?.error ?? '无法启动自动模式'), 'polish')
          }
        } catch (error) {
          flash('error', String(error?.message ?? error), 'polish')
        } finally {
          setStarting(false)
        }
      }, [autoDraft, sessionId, strength, flash])

      const stopPilot = useCallback(async () => {
        await fetch(PILOT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: String(sessionId), enabled: false }),
        }).catch(() => {})
        setPilot(previous => (previous === null ? null : { ...previous, enabled: false, state: 'stopped' }))
        setAutoOpen(false)
      }, [sessionId])

      const interruptPilot = useCallback(async () => {
        await fetch(PILOT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: String(sessionId), action: 'interrupt' }),
        }).catch(() => {})
      }, [sessionId])

      useEffect(() => {
        report('mount', {
          session: String(sessionId),
          hasUseInput: typeof useInput,
          hasActions: inputActions === undefined ? 'undefined' : typeof inputActions.setDraft,
          draftLen: typeof draft === 'string' ? draft.length : -1,
          claimed,
          refs: referenceCount,
        })
      }, [])

      const run = useCallback(async (mode) => {
        report('click', {
          mode,
          busy: busyRef.current,
          draftLen: typeof draftRef.current === 'string' ? draftRef.current.length : -1,
          claimed,
          refs: referenceCount,
          hasActions: inputActions === undefined ? 'undefined' : typeof inputActions.setDraft,
          strength,
        })
        if (busyRef.current) { report('skip', { reason: 'busy' }); return }
        const source = draftRef.current
        if (typeof source !== 'string' || source.trim() === '') { flash('error', t('error.empty'), mode); return }
        if (claimed) { flash('error', t('error.claimed'), mode); return }
        if (referenceCount > 0) { flash('error', t('error.refs'), mode); return }
        if (inputActions === undefined || typeof inputActions.setDraft !== 'function') {
          flash('error', t('error.unavailable'), mode)
          return
        }

        busyRef.current = true
        clearTimer()
        setPhase('running')
        setRunning(mode)
        setLastMode(mode)
        setNotice(mode === 'expand' ? t('working.expand') : t('working'))
        const requestId = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
        publishJob({ id: requestId, mode, steps: [], done: false, error: null, collapsed: false })
        const stopWatch = watchJob(requestId)
        const abort = typeof AbortController === 'function' ? new AbortController() : undefined
        activeAbort = abort ?? null
        // Expansion produces far more text than a rewrite, so it gets more room.
        const abortTimer = abort === undefined ? null : setTimeout(() => abort.abort(), mode === 'expand' ? 240000 : 135000)
        try {
          let response
          report('fetch', { mode, url: ENDPOINT, len: source.length, text: source.slice(0, 120) })
          try {
            response = await fetch(ENDPOINT, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId: String(sessionId), text: source, strength, mode, requestId }),
              ...(abort === undefined ? {} : { signal: abort.signal }),
            })
          } catch (networkError) {
            report('fetch-failed', { message: String(networkError?.message ?? networkError) })
            throw new Error(`${t('error.network')}: ${String(networkError?.message ?? networkError)}`)
          }
          let payload = await response.json().catch(() => null)
          report('response', {
            status: response.status,
            ok: payload?.ok === true,
            error: payload?.error,
            len: typeof payload?.text === 'string' ? payload.text.length : -1,
            text: typeof payload?.text === 'string' ? payload.text.slice(0, 120) : null,
          })
          // The Host accepted the job and will finish it on its own; a webview
          // may drop a silent request, so the outcome is collected by polling
          // instead of being carried on this connection.
          if (response.status === 202 && payload?.accepted === true) {
            payload = await awaitJobResult(requestId, abort)
          }
          if (!payload || payload.ok !== true) {
            throw new Error(typeof payload?.error === 'string' && payload.error !== ''
              ? payload.error
              : `HTTP ${response.status}`)
          }
          const next = typeof payload.text === 'string' ? payload.text : ''
          if (next.trim() === '') throw new Error(t('error.emptyResult'))
          if (draftRef.current !== source) { report('stale', {}); flash('error', t('error.changed'), mode); return }
          // A rewrite that changed nothing is a real outcome, not a no-op: say so
          // instead of leaving the composer looking untouched.
          if (next.trim() === source.trim()) {
            report('unchanged', { mode, len: next.length })
            flash('unchanged', t('unchanged'), mode)
            return
          }
          report('setDraft', { mode, len: next.length })
            // An expansion is several paragraphs; dropping it straight into the
            // composer hides what it actually wrote. Show it, let the user apply.
            if (mode === 'expand') {
              publishExpandCard({ text: next, source, at: Date.now() })
              flash('done', t('done.expand'), mode)
              return
            }
          inputActions.setDraft(next)
          setTimeout(() => report('after', {
            draftLen: typeof draftRef.current === 'string' ? draftRef.current.length : -1,
            expected: next.length,
            applied: draftRef.current === next,
          }), 600)
          flash('done', mode === 'expand' ? t('done.expand') : t('done'), mode)
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn('[one-click-polish]', error)
          report('error', { mode, message: String(error?.message ?? error) })
          if (jobState !== null && jobState.id === requestId) {
            publishJob({ ...jobState, error: String(error?.message ?? error) })
          }
          flash('error', String(error?.message ?? error), mode)
        } finally {
          if (abortTimer !== null) clearTimeout(abortTimer)
          if (activeAbort === abort) activeAbort = null
          stopWatch()
          busyRef.current = false
          setRunning(null)
          // Close the panel out: a success fades quickly, a failure stays long
          // enough to be read.
          if (jobState !== null && jobState.id === requestId) {
            const failed = jobState.error !== null && jobState.error !== undefined
            publishJob({ ...jobState, done: true })
            setTimeout(() => {
              if (jobState !== null && jobState.id === requestId) publishJob(null)
            }, failed ? 7000 : 1800)
          }
        }
      }, [claimed, referenceCount, inputActions, sessionId, t, flash, strength])

      const busy = phase === 'running'

      /** Label for one action: its own progress while running, its own result after. */
      const labelFor = (mode) => {
        const idle = mode === 'expand' ? t('expand') : t('button')
        if (phase === 'running') return running === mode ? (mode === 'expand' ? t('working.expand') : t('working')) : idle
        if (lastMode !== mode) return idle
        if (phase === 'done') return mode === 'expand' ? t('done.expand') : t('done')
        if (phase === 'unchanged') return t('unchanged')
        if (phase === 'error') return t('failed')
        return idle
      }

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
      const autoPhase = (() => {
        if (pilot === null) return 'idle'
        if (pilot.enabled === true) return 'running'
        const reason = typeof pilot.stopReason === 'string' ? pilot.stopReason : ''
        if (reason === 'error') return 'error'
        if (reason === 'rounds' || reason === 'goal') return 'done'
        if (reason === '' ) return 'idle'
        return 'stopped'
      })()

      const autoLabel = (() => {
        if (autoPhase === 'running') {
          return `${t('auto.on')} ${pilot.round ?? 0}/${pilot.mode === 'goal' ? '∞' : (pilot.rounds ?? 5)}`
        }
        if (autoPhase === 'done') return t('auto.phase.done')
        if (autoPhase === 'error') return t('auto.phase.error')
        // A user stop and a driver that fell over are both "not running any more",
        // but only one of them is the user's own doing.
        if (autoPhase === 'stopped') {
          return pilot?.stopReason === 'interrupted' ? t('auto.phase.interrupted') : t('auto.phase.stopped')
        }
        return t('auto.off')
      })()

      const autoTitle = (() => {
        if (autoPhase === 'running') return t('auto.hint')
        if (autoPhase === 'idle') return t('auto.hint')
        const reason = typeof pilot?.stopReason === 'string' ? pilot.stopReason : ''
        const detail = reason === '' ? '' : t(`auto.stop.${reason}`)
        // After a run ends the tooltip carries the reason, and a failure carries
        // the message too: those are exactly what the user wants before clicking.
        const extra = typeof pilot?.error === 'string' && pilot.error !== '' ? ` · ${pilot.error}` : ''
        return `${detail}${extra} · ${t('auto.phase.hint')}`
      })()

      const iconFor = (mode) => {
        if (phase === 'running' && running === mode) return h(SpinnerIcon)
        if (phase === 'done' && lastMode === mode) return h(CheckIcon)
        return mode === 'expand' ? h(ExpandIcon) : h(WandIcon)
      }

      const buttonFor = (mode) => h('button', {
        type: 'button',
        className: mode === 'expand' ? 'dsh-op-btn dsh-op-btn--expand' : 'dsh-op-btn',
        'data-state': phase,
        'data-mode': mode,
        // Only the action that produced this result wears its colour; the other
        // button must not look like it succeeded.
        'data-active': lastMode === mode && phase !== 'idle' && phase !== 'running' ? 'true' : 'false',
        'data-plugin': NAME,
        title: notice === '' ? (mode === 'expand' ? t('expand.hint') : t('hint')) : notice,
        'aria-label': notice === '' ? (mode === 'expand' ? t('expand.hint') : t('hint')) : notice,
        'aria-busy': busy && running === mode ? 'true' : 'false',
        disabled: busy,
        // Keep the caret in the editor: the click must not blur the composer.
        onMouseDown: event => event.preventDefault(),
        onClick: () => run(mode),
      }, iconFor(mode), h('span', null, labelFor(mode)))

      return h('div', { className: 'dsh-op-group' },
        buttonFor('polish'),
        h('button', {
          type: 'button',
          className: 'dsh-op-level',
          'data-level': strength,
          'data-plugin': NAME,
          title: t('level.hint'),
          'aria-label': t('level.hint'),
          onMouseDown: event => event.preventDefault(),
          onClick: cycleStrength,
        }, t(`level.${strength}`)),
        buttonFor('expand'),
        h('div', { className: 'dsh-op-auto', ref: autoRef },
          h('button', {
            type: 'button',
            className: 'dsh-op-btn',
            'data-mode': 'auto',
            // Four states, so the button itself reports how the last run ended.
            'data-state': autoPhase,
            'data-active': autoPhase === 'idle' ? 'false' : 'true',
            'aria-pressed': pilot !== null && pilot.enabled === true ? 'true' : 'false',
            'aria-expanded': autoOpen ? 'true' : 'false',
            title: autoTitle,
            'aria-label': autoTitle,
            onMouseDown: event => event.preventDefault(),
            onClick: () => {
              // The same button closes the panel it opened. After a run ends, the
              // first click opens the panel, which names the reason and offers the
              // start control again.
              if (autoOpen) {
                setAutoOpen(false)
                publishConfirm(null)
                return
              }
              openPilot()
            },
          }, h(autoPhase === 'running' ? SpinnerIcon : LoopIcon), h('span', null, autoLabel)),
          autoOpen
            ? h('div', { className: 'dsh-op-pop' },
              autoPhase !== 'idle'
                ? h(React.Fragment, null,
                  h('div', { className: 'dsh-op-popTitle' },
                    autoPhase === 'running'
                      ? `${t('auto.running')} ${pilot.round ?? 0}/${pilot.mode === 'goal' ? '∞' : (pilot.rounds ?? 5)}${pilot.limitMs > 0 ? ` · ${t('auto.elapsed')} ${Math.max(0, Math.round((Date.now() - (pilot.startedAt ?? Date.now())) / 60000))}${t('auto.minutes')}` : ''}`
                      // A finished run states its outcome here, which is the whole
                      // point of clicking a coloured button.
                      : `${autoLabel} · ${pilot.round ?? 0}/${pilot.mode === 'goal' ? '∞' : (pilot.rounds ?? 5)}`),
                  // While it is parked on a busy assistant, show the wait ticking
                  // instead of leaving a still panel that reads as a hang.
                  autoPhase === 'running' && Number(pilot?.waitingSince) > 0
                    ? h('div', { className: 'dsh-op-hint dsh-op-waiting' },
                      // What it is waiting on, then how long it has waited: the name
                      // tells the user whether this is a ten-second or ten-minute wait.
                      typeof pilot?.waitingOn === 'string' && pilot.waitingOn !== ''
                        ? `${t('auto.waitingOn')}${pilot.waitingOn} · `
                        : `${t('auto.waiting')} · `,
                      `${Math.max(0, Math.round((Date.now() - Number(pilot.waitingSince)) / 1000))}${t('auto.seconds')}`,
                      Number(pilot.waitingBudgetMs) > 0
                        ? ` / ${Math.round(Number(pilot.waitingBudgetMs) / 60000)}${t('auto.minutes')}`
                        : '')
                    : null,
                  pilot.context !== null && pilot.context !== undefined
                    ? h('div', { className: 'dsh-op-hint' },
                      `${t('auto.context')}：${pilot.context.messages} ${t('auto.context.messages')} / ${pilot.context.chars} ${t('auto.context.chars')}`,
                      // Say when the transcript had to compress: a driver that lost
                      // part of the conversation should not look like one that saw
                      // all of it.
                      pilot.context.dropped > 0
                        ? ` · ${t('auto.context.dropped')} ${pilot.context.dropped} ${t('auto.context.droppedUnit')}`
                        : '')
                    : null,
                  pilot.lastPrompt ? h('p', { className: 'dsh-op-hint' }, pilot.lastPrompt.slice(0, 120)) : null,
                  h('button', {
                    type: 'button',
                    className: 'dsh-op-link',
                    onClick: async () => {
                      try {
                        const response = await fetch(`${PILOT}?sessionId=${encodeURIComponent(String(sessionId))}&detail=1`)
                        const payload = await response.json()
                        setAutoDetail(payload?.contextText ?? '(没有)')
                      } catch {
                        setAutoDetail('(读取失败)')
                      }
                    },
                  }, t('auto.context.show')),
                  autoDetail === null
                    ? null
                    : h('pre', { className: 'dsh-op-pre' }, autoDetail),
                  h('button', {
                    type: 'button',
                    className: 'dsh-op-link',
                    onClick: async () => {
                      if (autoTrace !== null) { setAutoTrace(null); return }
                      try {
                        // The driver's work is recorded on the job named after
                        // the session, which is what `trace` reads.
                        const response = await fetch(`${PROGRESS}?id=${encodeURIComponent(`autopilot-${String(sessionId)}`)}`)
                        const payload = await response.json()
                        setAutoTrace(payload?.job?.trace ?? [])
                      } catch {
                        setAutoTrace([])
                      }
                    },
                  }, autoTrace === null ? t('auto.trace.show') : t('auto.trace.hide')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-op-link',
                    onClick: () => {
                      // Dock the live view on the right; the inline list above is
                      // for a quick look, this is for watching a long run.
                      if (thinkState.open === true) {
                        publishThink({ open: false, sessionId: null })
                        return
                      }
                      publishThink({ open: true, sessionId: String(sessionId) })
                      setAutoOpen(false)
                    },
                  }, think.open === true ? t('auto.trace.undock') : t('auto.trace.dock')),
                  autoTrace === null
                    ? null
                    : h('div', { className: 'dsh-op-trace' },
                      autoTrace.length === 0
                        ? h('div', { className: 'dsh-op-hint' }, t('auto.trace.empty'))
                        : autoTrace.map((entry, index) => h('div', {
                          key: index,
                          className: 'dsh-op-traceRow',
                          'data-kind': entry.kind,
                        },
                        h('span', { className: 'dsh-op-traceTag' },
                          entry.kind === 'round'
                            ? `${t('auto.trace.think')} ${entry.round}`
                            : entry.kind === 'tool'
                              ? entry.name
                              : entry.kind === 'sent'
                                ? `${t('auto.trace.sent')} ${entry.round}`
                                : t('auto.trace.conclusion')),
                        h('span', { className: 'dsh-op-traceText' },
                          entry.kind === 'tool'
                            ? `${entry.summary ?? ''}${entry.text ? ` — ${entry.text}` : ''}`.slice(0, 300)
                            : (entry.reasoning || entry.text || '').slice(0, 400))))),
                  h('div', { className: 'dsh-op-inline' },
                    autoPhase === 'running'
                      ? h(React.Fragment, null,
                        // The labels alone cannot carry the difference: one cancels a
                        // single assistant turn and lets the loop re-plan, the other
                        // ends the autopilot. The title says which.
                        h('button', {
                          type: 'button',
                          className: 'dsh-op-btn',
                          title: t('auto.interrupt.hint'),
                          onClick: interruptPilot,
                        }, t('auto.interrupt')),
                        h('button', {
                          type: 'button',
                          className: 'dsh-op-btn dsh-op-btn--danger',
                          title: t('auto.stop.hint'),
                          onClick: stopPilot,
                        }, t('auto.stop')))
                      // An interrupted run resumes where it stopped, keeping the
                      // rounds it already spent; only an interrupted-to-completion
                      // (done or error) needs a fresh start.
                      : h(React.Fragment, null,
                        h('button', {
                          type: 'button',
                          className: 'dsh-op-btn dsh-op-btn--wide',
                          onClick: () => {
                            // Resume keeps the count and the clock; the Host reads
                            // the checkpoint it stored for this session.
                            void fetch(PILOT, {
                              method: 'POST',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({
                                sessionId: String(sessionId),
                                enabled: true,
                                resume: true,
                                mode: autoDraft.mode,
                                rounds: autoDraft.rounds,
                                goal: autoDraft.goal,
                                limitMinutes: autoDraft.limitMinutes,
                                strength,
                              }),
                            }).then(async response => {
                              const payload = await response.json()
                              if (payload?.ok === true) {
                                setPilot(payload.pilot)
                                setAutoOpen(false)
                              }
                            }).catch(() => {})
                          },
                        }, autoPhase === 'stopped' ? t('auto.resume.action') : t('auto.restart')),
                        h('button', {
                          type: 'button',
                          className: 'dsh-op-link',
                          onClick: () => {
                            // Clear the finished state so the button returns to grey.
                            void fetch(PILOT, {
                              method: 'POST',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({ sessionId: String(sessionId), enabled: false, clear: true }),
                            }).catch(() => {})
                            setPilot(null)
                            setAutoOpen(false)
                          },
                        }, t('auto.clear')))))
                : h(React.Fragment, null,
                  h('div', { className: 'dsh-op-popTitle' }, t('auto.title')),
                  resumable !== null && resumable !== undefined && (pilot === null || pilot.enabled !== true)
                    ? h('div', { className: 'dsh-op-resume' },
                      h('p', { className: 'dsh-op-hint' },
                        `${t('auto.resume.found')}：${resumable.round}/${resumable.mode === 'goal' ? '∞' : resumable.rounds}`),
                      h('button', {
                        type: 'button',
                        className: 'dsh-op-btn',
                        onClick: async () => {
                          await fetch(PILOT, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                              sessionId: String(sessionId),
                              enabled: true,
                              resume: true,
                              mode: resumable.mode,
                              rounds: resumable.rounds,
                              goal: resumable.goal,
                              strength,
                            }),
                          }).then(async response => {
                            const payload = await response.json()
                            if (payload?.ok === true) {
                              setPilot(payload.pilot)
                              setResumable(null)
                              setAutoOpen(false)
                            }
                          }).catch(() => {})
                        },
                      }, t('auto.resume.action')),
                      h('button', {
                        type: 'button',
                        className: 'dsh-op-link',
                        onClick: async () => {
                          await fetch(PILOT, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ sessionId: String(sessionId), enabled: false }),
                          }).catch(() => {})
                          setResumable(null)
                        },
                      }, t('auto.resume.discard')))
                    : null,
                  pilot !== null && typeof pilot.error === 'string' && pilot.error !== ''
                    ? h('p', { className: 'dsh-op-hint dsh-op-hint--error dsh-op-hint--block' }, pilot.error)
                    : null,
                  // Why the last run ended. Without this a run that stops on its own
                  // looks like it switched itself off for no reason.
                  pilot !== null && pilot.enabled !== true
                    && typeof pilot.stopReason === 'string' && pilot.stopReason !== ''
                    ? h('p', { className: 'dsh-op-hint' }, t(`auto.stop.${pilot.stopReason}`))
                    : null,
                  h('label', { className: 'dsh-op-radio' },
                    h('input', {
                      type: 'radio',
                      name: 'dsh-op-auto-mode',
                      value: 'rounds',
                      checked: autoDraft.mode === 'rounds',
                      onChange: () => setAutoDraft({ ...autoDraft, mode: 'rounds' }),
                    }),
                    h('span', null, t('auto.mode.rounds'))),
                  autoDraft.mode === 'rounds'
                    ? h('input', {
                      className: 'dsh-op-input dsh-op-input--narrow',
                      type: 'number',
                      min: 1,
                      max: 50,
                      value: autoDraft.rounds,
                      onChange: event => setAutoDraft({
                        ...autoDraft,
                        rounds: Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                      }),
                    })
                    : null,
                  h('label', { className: 'dsh-op-switch' },
                    h('input', {
                      type: 'checkbox',
                      checked: (autoDraft.limitMinutes ?? 0) > 0,
                      onChange: event => setAutoDraft({
                        ...autoDraft,
                        limitMinutes: event.target.checked ? 30 : 0,
                      }),
                    }),
                    h('span', { className: 'dsh-op-switchTrack', 'aria-hidden': 'true' },
                      h('span', { className: 'dsh-op-switchThumb' })),
                    h('span', { className: 'dsh-op-switchText' }, t('auto.limit'))),
                  (autoDraft.limitMinutes ?? 0) > 0
                    ? h('div', { className: 'dsh-op-inline' },
                      h('input', {
                        className: 'dsh-op-input dsh-op-input--narrow',
                        type: 'number',
                        min: 0,
                        max: 24,
                        value: Math.floor((autoDraft.limitMinutes ?? 0) / 60),
                        onChange: event => {
                          const hours = Math.max(0, Math.min(24, Number(event.target.value) || 0))
                          const rest = (autoDraft.limitMinutes ?? 0) % 60
                          setAutoDraft({ ...autoDraft, limitMinutes: hours * 60 + rest })
                        },
                      }),
                      h('span', { className: 'dsh-op-hint dsh-op-hint--inline' }, t('auto.hours')),
                      h('input', {
                        className: 'dsh-op-input dsh-op-input--narrow',
                        type: 'number',
                        min: 0,
                        max: 59,
                        value: (autoDraft.limitMinutes ?? 0) % 60,
                        onChange: event => {
                          const rest = Math.max(0, Math.min(59, Number(event.target.value) || 0))
                          const hours = Math.floor((autoDraft.limitMinutes ?? 0) / 60)
                          setAutoDraft({ ...autoDraft, limitMinutes: hours * 60 + rest })
                        },
                      }),
                      h('span', { className: 'dsh-op-hint dsh-op-hint--inline' }, t('auto.minutesUnit')))
                    : null,
                  h('label', { className: 'dsh-op-radio' },
                    h('input', {
                      type: 'radio',
                      name: 'dsh-op-auto-mode',
                      value: 'goal',
                      checked: autoDraft.mode === 'goal',
                      onChange: () => setAutoDraft({ ...autoDraft, mode: 'goal' }),
                    }),
                    h('span', null, t('auto.mode.goal'))),
                  h('textarea', {
                    className: 'dsh-op-input dsh-op-textarea',
                    rows: 2,
                    placeholder: t('auto.goal.placeholder'),
                    value: autoDraft.goal,
                    onChange: event => setAutoDraft({ ...autoDraft, goal: event.target.value }),
                  }),
                  h('button', {
                    type: 'button',
                    className: 'dsh-op-btn dsh-op-btn--wide',
                    onClick: () => {
                      if (thinkState.open === true) {
                        publishThink({ open: false, sessionId: null })
                        return
                      }
                      publishThink({ open: true, sessionId: String(sessionId) })
                      setAutoOpen(false)
                    },
                  }, think.open === true ? t('auto.trace.undock') : t('auto.trace.dock')),
                  h('button', {
                    type: 'button',
                    className: 'dsh-op-save',
                    disabled: starting,
                    onClick: () => {
                      // Hand the dialog to the frame-wide overlay.
                      publishConfirm({
                        title: t('auto.warn.title'),
                        body: t('auto.warn.body'),
                        confirmLabel: t('auto.warn.confirm'),
                        cancelLabel: t('auto.warn.cancel'),
                        onConfirm: startPilot,
                      })
                      setAutoOpen(false)
                    },
                  }, starting ? t('auto.starting') : t('auto.start'))))
            : null))
    }

    // ── expand result card ─────────────────────────────────────────────────
    /**
     * What 扩写 produced, shown before it touches the draft.
     *
     * Polishing rewrites one line in place, so overwriting the composer is the whole
     * point. Expanding turns a wish into several paragraphs, and dropping that into
     * the composer hides both what it wrote and the fact that it discarded the wish.
     * The card gives the user a look and an explicit 写入 step.
     */
    function ExpandCard({ t, inputActions }) {
      const card = useExpandCard()
      if (card === null) return null
      const apply = () => {
        inputActions.setDraft(card.text)
        publishExpandCard(null)
      }
      return h('div', { className: 'dsh-op-expand' },
        h('div', { className: 'dsh-op-expandHead' },
          h('span', { className: 'dsh-op-expandTitle' }, t('expand.card.title')),
          h('button', {
            type: 'button',
            className: 'dsh-op-thinkBtn',
            title: t('expand.card.discard'),
            onClick: () => publishExpandCard(null),
          }, '✕')),
        h('div', { className: 'dsh-op-expandBody' }, card.text),
        h('div', { className: 'dsh-op-expandFoot' },
          h('button', { type: 'button', className: 'dsh-op-save', onClick: apply },
            t('expand.card.apply')),
          h('button', {
            type: 'button',
            className: 'dsh-op-link',
            onClick: () => publishExpandCard(null),
          }, t('expand.card.discard'))))
    }
    // ── in-conversation step rows ───────────────────────────────────────────
    /**
     * The job's steps, drawn at the end of the current turn.
     *
     * dsh renders its own tool calls as chat nodes, and a plugin cannot borrow that
     * renderer without shadowing it. `conversation.chat.turnTail` is an additive
     * list with no replace risk, so the steps land where the reader already is
     * instead of in a floating panel over the sidebar.
     */
    function TurnSteps({ t }) {
      const job = useJob()
      if (job === null || Array.isArray(job.steps) === false || job.steps.length === 0) return null
      // The job carries `done` and `error`; a running state is the absence of both.
      const failed = job.error !== null && job.error !== undefined
      const finished = job.done === true
      const mode = job.mode === 'expand' ? 'expand' : 'polish'
      const label = finished
        ? (failed ? t('job.failed') : t('job.done'))
        : t(mode === 'expand' ? 'job.expanding' : 'job.polishing')
      return h('div', { className: 'dsh-op-steps' },
        h('div', { className: 'dsh-op-stepsHead' },
          h('span', { className: 'dsh-op-stepsTitle' }, label),
          finished ? null : h('span', { className: 'dsh-op-stepsSpin' }, '⟳')),
        job.steps.map((step, index) => h('div', {
          key: String(index),
          className: 'dsh-op-stepRow',
          'data-state': step.state ?? 'running',
        },
        h('span', { className: 'dsh-op-stepDot' },
          step.state === 'done' ? '✓' : step.state === 'error' ? '✕' : '◐'),
        h('span', { className: 'dsh-op-stepText' }, step.text ?? ''),
        step.detail === undefined ? null
          : h('span', { className: 'dsh-op-stepDetail' }, step.detail))),
        failed ? h('div', { className: 'dsh-op-stepError' }, String(job.error)) : null)
    }
    // ── progress panel ──────────────────────────────────────────────────────
    /**

    // ── right-hand thinking window ──────────────────────────────────────────
    /**
     * A docked panel on the right showing the driver's reasoning and tool calls
     * as they happen, with the room to scroll back through earlier rounds.
     *
     * It lives in `shell.overlay` rather than the right sidebar: the sidebar's
     * `sidebar.right.pane.tab` seat needs a full tab lifecycle (content id, title
     * chip, menu rows) for what is really a read-only monitor, and this window has
     * to be usable at any width.
     */
    function ThinkWindow({ t }) {
      const think = useThink()
      const [entries, setEntries] = useState([])
      const [status, setStatus] = useState('idle')
      const [collapsed, setCollapsed] = useState(false)
      const bodyRef = useRef(null)
      const pinnedRef = useRef(true)
      // Which tool rows the user opened. A mutable set plus a tick keeps the list
      // cheap: hundreds of rows must not each own a piece of React state.
      const openRowsRef = useRef(new Set())
      const openRows = openRowsRef.current
      const [, setFoldTick] = useState(0)

      // Follow the session's live run while the window is open. Only this
      // conversation's own log is shown: an empty list is the honest state for a
      // chat that has not run the autopilot yet.
      useEffect(() => {
        if (think.open !== true || think.sessionId === null) return undefined
        let cancelled = false
        const tick = async () => {
          try {
            const response = await fetch(`${RUNS}?sessionId=${encodeURIComponent(think.sessionId)}`)
            const payload = await response.json()
            if (cancelled) return
            // This conversation's own log, nothing borrowed from another one: an
            // empty list means this chat has not run the autopilot yet.
            const list = Array.isArray(payload?.entries) ? payload.entries : []
            setEntries(list.slice(-300))
            setStatus('ready')
          } catch {
            if (!cancelled) setStatus('error')
          }
          // Half-second polling: a streaming row should look like it is moving.
          if (!cancelled) setTimeout(tick, 500)
        }
        tick()
        return () => { cancelled = true }
      }, [think.open, think.sessionId])

      // Keep the newest entry in view unless the user scrolled up to read.
      useEffect(() => {
        const node = bodyRef.current
        if (node === null || pinnedRef.current !== true) return
        node.scrollTop = node.scrollHeight
      }, [entries.length, collapsed])

      const onScroll = () => {
        const node = bodyRef.current
        if (node === null) return
        pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
      }

      if (think.open !== true) return null

      const rows = entries.map((entry, index) => {
        const kind = entry.kind
        const tag = kind === 'round'
          ? `${t('auto.trace.think')} ${entry.round ?? ''}`
          : kind === 'tool'
            ? (entry.name ?? 'tool')
            : kind === 'sent'
              ? `${t('auto.trace.sent')} ${entry.round ?? ''}`
              : t('auto.trace.conclusion')
        const body = kind === 'tool'
          ? `${entry.summary ?? ''}${entry.text ? ` — ${entry.text}` : ''}`
          : (entry.reasoning || entry.text || '')

        // Two things fold: long tool rows (noise) and reasoning rows (long
        // paragraphs worth skimming past). A live row never folds — the point of
        // watching a run is seeing the text arrive.
        const live = entry.live === true
        const long = String(body).length > 60
        const foldable = !live && long && (kind === 'tool' || kind === 'round')
        // Both kinds start folded, so a long run reads as one line per step and
        // opens only where the user wants detail. `openRows` holds what was opened.
        const toggled = openRows.has(index)
        const open = toggled
        return h('div', {
          key: index,
          className: 'dsh-op-thinkRow',
          'data-kind': kind,
          'data-live': live ? 'true' : 'false',
          'data-foldable': foldable ? 'true' : 'false',
          'data-open': foldable && open ? 'true' : 'false',
          onClick: foldable
            ? () => {
              if (openRows.has(index)) openRows.delete(index)
              else openRows.add(index)
              setFoldTick(value => value + 1)
            }
            : undefined,
        },
        h('div', { className: 'dsh-op-thinkMeta' },
          // Working state wears the same turning arc DSH uses for its own runs.
          live
            ? h(SpinnerIcon)
            : foldable
              ? h('span', { className: 'dsh-op-thinkCaret', 'aria-hidden': 'true' }, open ? '▾' : '▸')
              : null,
          h('span', { className: 'dsh-op-thinkTag' }, tag),
          // A folded row still shows its first line, so a collapsed run is readable
          // at a glance instead of a column of bare labels.
          foldable && !open
            ? h('span', { className: 'dsh-op-thinkPeek' }, String(body).replace(/\s+/g, ' ').slice(0, 80))
            : null,
          entry.at === undefined ? null : h('span', { className: 'dsh-op-thinkTime' }, String(entry.at).slice(11, 19))),
        h('div', { className: 'dsh-op-thinkBody' },
          foldable && !open ? '' : String(body).slice(0, 1500)))
      })

      return h('div', { className: 'dsh-op-think', 'data-collapsed': collapsed ? 'true' : 'false' },
        h('div', { className: 'dsh-op-thinkHead' },
          h('span', { className: 'dsh-op-thinkTitle' }, t('auto.trace.title')),
          h('span', { className: 'dsh-op-thinkCount' }, `${rows.length}`),
          h('button', {
            type: 'button',
            className: 'dsh-op-thinkBtn',
            title: collapsed ? t('auto.trace.expand') : t('auto.trace.collapse'),
            onClick: () => setCollapsed(previous => !previous),
          }, collapsed ? '▢' : '—'),
          h('button', {
            type: 'button',
            className: 'dsh-op-thinkBtn',
            title: t('auto.trace.close'),
            onClick: () => publishThink({ open: false, sessionId: null }),
          }, '✕')),
        collapsed
          ? null
          : h('div', {
            ref: bodyRef,
            className: 'dsh-op-thinkBodyScroll',
            onScroll,
          },
          status === 'error'
            ? h('div', { className: 'dsh-op-hint dsh-op-hint--error' }, t('auto.trace.failed'))
            : rows.length === 0
              ? h('div', { className: 'dsh-op-hint' }, t('auto.trace.empty'))
              : rows))
    }

    // ── model picker ────────────────────────────────────────────────────────
    /**
     * A model picker shaped like the composer's own model switcher: a 28px
     * trigger with a chevron, and a menu surface with a search row, provider
     * headings and a check on the current choice.
     *
     * Two deliberate differences from the composer control: the menu is
     * absolutely positioned inside this page (no portal, so it cannot escape the
     * settings panel), and a catalog of 700+ models renders at most a slice per
     * provider until the user types — searching always covers everything.
     */
    const SLICE_PER_GROUP = 20
    const MAX_SEARCH_PER_GROUP = 60

    function ModelPicker({ catalog, provider, model, onChange, t }) {
      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      const rootRef = useRef(null)
      const searchRef = useRef(null)

      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
            setOpen(false)
            setQuery('')
          }
        }
        const onKey = (event) => {
          if (event.key === 'Escape') { setOpen(false); setQuery('') }
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      useEffect(() => {
        if (open && searchRef.current !== null) searchRef.current.focus()
      }, [open])

      const needle = query.trim().toLowerCase()
      const groups = needle === ''
        ? catalog.map(group => ({
          ...group,
          models: group.models.slice(0, SLICE_PER_GROUP),
          more: Math.max(0, group.models.length - SLICE_PER_GROUP),
        }))
        : catalog.map(group => {
          const providerHit = group.provider.toLowerCase().includes(needle)
            || String(group.name).toLowerCase().includes(needle)
          const hits = providerHit
            ? group.models
            : group.models.filter(item => item.id.toLowerCase().includes(needle)
              || String(item.name).toLowerCase().includes(needle))
          return { ...group, models: hits.slice(0, MAX_SEARCH_PER_GROUP), more: Math.max(0, hits.length - MAX_SEARCH_PER_GROUP) }
        }).filter(group => group.models.length > 0)

      const current = provider === '' ? null : `${provider}/${model}`

      const options = groups.map(group => {
        const items = group.models.map(item => {
          const value = `${group.provider}/${item.id}`
          const selected = value === current
          return h('button', {
            key: value,
            type: 'button',
            className: 'dsh-op-option',
            role: 'option',
            'aria-selected': selected ? 'true' : 'false',
            onClick: () => {
              onChange(group.provider, item.id)
              setOpen(false)
              setQuery('')
            },
          },
          h('span', { className: 'dsh-op-optionName' }, item.name === item.id ? item.id : item.name),
          item.name === item.id ? null : h('span', { className: 'dsh-op-optionId' }, item.id),
          h('span', { className: 'dsh-op-check' }, selected
            ? h('svg', {
              viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true,
              fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
              strokeLinecap: 'round', strokeLinejoin: 'round',
            }, h('path', { d: 'M3 8.6 6.3 12 13 4.6' }))
            : null))
        })
        const more = group.more > 0
          ? h('div', { className: 'dsh-op-more' }, t('settings.model.more').replace('{n}', String(group.more)))
          : null
        return h('div', { key: group.provider },
          h('div', { className: 'dsh-op-groupHead' }, group.name),
          items,
          more)
      })

      const trigger = h('button', {
        type: 'button',
        className: 'dsh-op-trigger',
        'aria-haspopup': 'listbox',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => setOpen(previous => !previous),
      },
      h('span', { className: 'dsh-op-triggerLabel' }, current ?? t('settings.model.none')),
      h('svg', {
        className: 'dsh-op-chevron',
        viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', { d: 'M4 6.4 8 10.4 12 6.4' })))

      const clearButton = query === ''
        ? null
        : h('button', {
          type: 'button',
          className: 'dsh-op-clear',
          'aria-label': t('settings.model.clear'),
          onClick: () => {
            setQuery('')
            if (searchRef.current !== null) searchRef.current.focus()
          },
        }, h('svg', {
          viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        }, h('path', { d: 'M4 4l8 8M12 4l-8 8' })))

      const menu = h('div', { className: 'dsh-op-menu', role: 'listbox' },
        h('div', { className: 'dsh-op-searchRow' },
          h('input', {
            ref: searchRef,
            className: 'dsh-op-search',
            type: 'text',
            role: 'searchbox',
            placeholder: t('settings.model.search'),
            value: query,
            onChange: event => setQuery(event.target.value),
          }),
          clearButton),
        h('div', { className: 'dsh-op-groups' },
          options.length === 0
            ? h('div', { className: 'dsh-op-empty' }, t('settings.model.noMatch'))
            : options))

      return h('div', { className: 'dsh-op-picker', ref: rootRef }, trigger, open ? menu : null)
    }

    // ── effort picker ───────────────────────────────────────────────────────
    /**
     * The 思考程度 menu, shaped like the one in the composer's model switcher:
     * one row per choice with a check on the current one.
     *
     * The option list is whatever the adapter reports for the selected model,
     * plus 默认. A model with no reasoning gets no control at all, and a stored
     * effort the new model cannot honour is dropped rather than sent and
     * rejected at dispatch.
     */
    function EffortPicker({ efforts, value, onChange, t }) {
      const [open, setOpen] = useState(false)
      const rootRef = useRef(null)

      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
            setOpen(false)
          }
        }
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      const options = [{ id: '', name: t('settings.effort.default') }, ...efforts]
      const current = options.find(option => option.id === value) ?? options[0]

      return h('div', { className: 'dsh-op-picker', ref: rootRef },
        h('button', {
          type: 'button',
          className: 'dsh-op-trigger dsh-op-trigger--short',
          'aria-haspopup': 'listbox',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => setOpen(previous => !previous),
        },
        h('span', { className: 'dsh-op-triggerLabel' }, current.name),
        h('svg', {
          className: 'dsh-op-chevron',
          viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        }, h('path', { d: 'M4 6.4 8 10.4 12 6.4' }))),
        open
          ? h('div', { className: 'dsh-op-menu dsh-op-menu--narrow', role: 'listbox' },
            options.map(option => h('button', {
              key: option.id === '' ? '__default' : option.id,
              type: 'button',
              className: 'dsh-op-option dsh-op-option--effort',
              role: 'option',
              'aria-selected': option.id === value ? 'true' : 'false',
              onClick: () => { onChange(option.id); setOpen(false) },
            },
            h('span', { className: 'dsh-op-optionName' }, option.name),
            h('span', { className: 'dsh-op-check' }, option.id === value
              ? h('svg', {
                viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true,
                fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
                strokeLinecap: 'round', strokeLinejoin: 'round',
              }, h('path', { d: 'M3 8.6 6.3 12 13 4.6' }))
              : null))))
          : null)
    }

    // ── settings page ───────────────────────────────────────────────────────
    /**
     * Settings → 润色 / 扩写.
     *
     * Two choices: where the model comes from (this conversation's selection, or
     * one fixed model picked from the routes this DSH can actually serve), and
     * the default strength.
     *
     * Edits are staged in `form` and written only by 保存 — nothing is sent while
     * the user is still moving between options, and 撤销修改 puts the draft back
     * to exactly what the Host has stored.
     */
    function SettingsPage({ t }) {
      const [status, setStatus] = useState('loading')
      const [error, setError] = useState('')
      const [catalog, setCatalog] = useState([])
      const [saved, setSaved] = useState(null)   // what the Host has stored
      const [form, setForm] = useState(null)     // what the user is editing
      const [efforts, setEfforts] = useState({ state: 'idle', list: [], defaultEffort: null })
      const [saveState, setSaveState] = useState({ state: 'idle', message: '' })
      // null while the first lookup is in flight; afterwards { current, latest, error }
      const [version, setVersion] = useState(null)
      const [runs, setRuns] = useState([])
      const [runsPick, setRunsPick] = useState(null)
      const [runEntries, setRunEntries] = useState([])
      // Folded tool rows in the log view: one set per rendered session, reset when
      // another session is opened.
      const runOpenRef = useRef(new Set())
      const runOpen = runOpenRef.current
      const [, setRunFoldTick] = useState(0)
      const [toast, setToast] = useState(null)
      const toastTimer = useRef(null)

      /** A short-lived confirmation, so a save is acknowledged where the eye is. */
      const showToast = (message) => {
        if (toastTimer.current !== null) clearTimeout(toastTimer.current)
        setToast(message)
        toastTimer.current = setTimeout(() => {
          toastTimer.current = null
          setToast(null)
        }, 2600)
      }

      useEffect(() => () => {
        if (toastTimer.current !== null) clearTimeout(toastTimer.current)
      }, [])

      const load = useCallback(async () => {
        setStatus('loading')
        setError('')
        try {
          const response = await fetch(SETTINGS)
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.ok !== true) {
            throw new Error(payload?.error || `HTTP ${response.status}`)
          }
          setCatalog(Array.isArray(payload.catalog) ? payload.catalog : [])
          setSaved(payload.settings)
          setForm(payload.settings)
          setSaveState({ state: 'idle', message: '' })
          setStatus('ready')
        } catch (failure) {
          const message = String(failure?.message ?? failure)
          setError(message)
          setStatus('error')
          // A failed settings load leaves the page almost empty, so record why in
          // the Host's diagnostic log, which is reachable without devtools.
          report('settings-load-failed', { message, url: SETTINGS })
        }
      }, [])

      useEffect(() => { load() }, [load])

      /** Read this plugin's version against npm. Cached on the Host for 10 minutes. */
      const checkVersion = useCallback(async (force) => {
        try {
          const response = await fetch(force === true ? `${VERSION}?refresh=1` : VERSION)
          const payload = await response.json()
          if (payload?.ok !== true) throw new Error(payload?.error ?? 'HTTP error')
          setVersion({
            current: typeof payload.current === 'string' ? payload.current : '',
            latest: typeof payload.latest === 'string' ? payload.latest : null,
            error: typeof payload.error === 'string' ? payload.error : null,
          })
        } catch (failure) {
          setVersion({ current: '', latest: null, error: String(failure?.message ?? failure) })
        }
      }, [])

      useEffect(() => { void checkVersion(false) }, [checkVersion])

      /** Sessions that have an archived run, newest first. */
      const loadRuns = useCallback(async () => {
        try {
          const response = await fetch(RUNS)
          const payload = await response.json()
          setRuns(Array.isArray(payload?.sessions) ? payload.sessions : [])
        } catch { /* the section stays empty */ }
      }, [])

      const loadRun = useCallback(async (sessionId) => {
        setRunsPick(sessionId)
        // A different session means a different list: folded rows from the last
        // one must not carry over as spurious open indices. Clear in place — the
        // renderer holds this same Set.
        runOpen.clear()
        setRunFoldTick(value => value + 1)
        try {
          const response = await fetch(`${RUNS}?sessionId=${encodeURIComponent(sessionId)}`)
          const payload = await response.json()
          setRunEntries(Array.isArray(payload?.entries) ? payload.entries.slice(-400) : [])
        } catch {
          setRunEntries([])
        }
      }, [])

      useEffect(() => { loadRuns() }, [loadRuns])

      /** Write the staged draft. The only path that changes stored settings. */
      const save = useCallback(async () => {
        if (form === null) return
        setSaveState({ state: 'saving', message: t('settings.saving') })
        try {
          const response = await fetch(SETTINGS, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(form),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.ok !== true) {
            throw new Error(payload?.error || `HTTP ${response.status}`)
          }
          const persisted = payload.persisted !== false
          const stored = payload.settings ?? form
          setSaved(stored)
          setForm(stored)
          setSaveState({
            state: persisted ? 'saved' : 'warn',
            message: persisted ? t('settings.saved') : t('settings.memoryOnly'),
          })
          showToast(persisted ? t('settings.saveOk') : t('settings.memoryOnly'))
        } catch (failure) {
          setSaveState({
            state: 'error',
            message: `${t('settings.saveFailed')}: ${String(failure?.message ?? failure)}`,
          })
        }
      }, [form, t])

      // Ask the adapter which efforts this exact model accepts. The control
      // follows the model, not the plugin: a model without reasoning gets no
      // control, and a saved effort it cannot honour is dropped instead of
      // being sent and rejected at dispatch.
      useEffect(() => {
        if (form === null || form.modelSource !== 'fixed' || form.provider === '' || form.model === '') return undefined
        let cancelled = false
        setEfforts(previous => ({ ...previous, state: 'loading' }))
        const url = `${EFFORTS}?provider=${encodeURIComponent(form.provider)}&model=${encodeURIComponent(form.model)}`
        fetch(url)
          .then(response => response.json())
          .then(payload => {
            if (cancelled) return
            const list = Array.isArray(payload?.efforts) ? payload.efforts : []
            setEfforts({ state: 'ready', list, defaultEffort: payload?.defaultEffort ?? null })
            // The staged effort belonged to the previous model. Drop it from the
            // draft when this one cannot honour it; nothing is written until the
            // user saves.
            if (form.reasoningEffort !== '' && !list.some(item => item.id === form.reasoningEffort)) {
              setForm(previous => (previous === null ? previous : { ...previous, reasoningEffort: '' }))
            }
          })
          .catch(() => {
            if (!cancelled) setEfforts({ state: 'ready', list: [], defaultEffort: null })
          })
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [form?.provider, form?.model, form?.modelSource])

      if (status === 'loading') {
        return h('div', { className: 'dsh-op-page' }, h('p', { className: 'dsh-op-sub' }, t('settings.loading')))
      }
      if (status === 'error' || form === null) {
        return h('div', { className: 'dsh-op-page' },
          h('p', { className: 'dsh-op-sub' }, `${t('settings.loadFailed')}: ${error}`),
          h('button', { type: 'button', className: 'dsh-op-link', onClick: load }, t('settings.retry')))
      }

      /** Staged changes, compared field by field against what the Host stored. */
      const dirty = form !== null && saved !== null && (
        form.modelSource !== saved.modelSource
        || form.provider !== saved.provider
        || form.model !== saved.model
        || (form.reasoningEffort ?? '') !== (saved.reasoningEffort ?? '')
        || form.defaultStrength !== saved.defaultStrength
        || (form.idleWaitMs ?? 0) !== (saved.idleWaitMs ?? 0)
        || (form.exploreMs ?? 0) !== (saved.exploreMs ?? 0)
        || (form.exploreRounds ?? 0) !== (saved.exploreRounds ?? 0)
        || (form.timeoutMs ?? 0) !== (saved.timeoutMs ?? 0)
      )

      /** Switching to a fixed model needs a concrete one; default to the first. */
      const chooseSource = (source) => {
        if (source === form.modelSource) return
        if (source === 'fixed' && (form.provider === '' || form.model === '')) {
          const first = catalog.find(group => group.models.length > 0)
          if (first === undefined) {
            setSaveState({ state: 'error', message: t('settings.noCatalog') })
            return
          }
          setForm({ ...form, modelSource: 'fixed', provider: first.provider, model: first.models[0].id, reasoningEffort: '' })
          return
        }
        setForm({ ...form, modelSource: source })
      }

      /**
       * One choice card. The real input stays in the DOM for the keyboard and
       * screen reader; the visible marker is drawn from `:has(input:checked)`.
       */
      const radio = (value, title, note) => h('label', { className: 'dsh-op-radio' },
        h('input', {
          type: 'radio',
          name: 'dsh-op-model-source',
          value,
          checked: form.modelSource === value,
          onChange: () => chooseSource(value),
        }),
        h('span', { className: 'dsh-op-radioMark', 'aria-hidden': 'true' },
          h('span', { className: 'dsh-op-radioDot' })),
        h('span', { className: 'dsh-op-radioText' },
          h('span', { className: 'dsh-op-radioTitle' }, title),
          note === undefined ? null : h('span', { className: 'dsh-op-radioNote' }, note)))

      const pageBody = h('div', { className: 'dsh-op-page' },
        h('div', { className: 'dsh-op-head' },
          h('h2', { className: 'dsh-op-h2' }, t('settings.title')),
          h('p', { className: 'dsh-op-sub' }, t('settings.sub')),
          // `version` is null until the lookup resolves, so every read of it has to
          // go through a fallback. Reading `.current` straight off null threw during
          // render and took the whole settings page down with it.
          h('div', { className: 'dsh-op-version' },
            h('span', { className: 'dsh-op-versionNow' },
              `${t('version.current')} ${typeof version?.current === 'string' && version.current !== '' ? version.current : '?'}`),
            version === null
              ? h('span', { className: 'dsh-op-hint dsh-op-hint--inline' }, t('version.checking'))
              : version.error !== null && version.error !== undefined && version.error !== ''
                ? h('span', { className: 'dsh-op-versionBad' },
                  `${t('version.unknown')} · ${version.error}`)
                : version.latest === null || version.latest === undefined
                  ? h('span', { className: 'dsh-op-hint dsh-op-hint--inline' }, t('version.unknown'))
                  : version.latest !== version.current
                    ? h('div', { className: 'dsh-op-versionNew' },
                      h('span', null, `${t('version.newest')} ${version.latest}`),
                      h('a', {
                        className: 'dsh-op-link',
                        href: 'https://www.npmjs.com/package/dsh-one-click-polish',
                        target: '_blank',
                        rel: 'noreferrer',
                      }, t('version.how')),
                      h('button', {
                        type: 'button',
                        className: 'dsh-op-link',
                        onClick: () => { void checkVersion(true) },
                      }, t('version.recheck')),
                      // dsh derives installTarget only from its official catalogue, so a
                      // third-party plugin has no update button. State the manual step
                      // rather than leaving the user to wonder where one is.
                      h('span', { className: 'dsh-op-versionHint' }, t('version.updateHint')))
                    : h('span', { className: 'dsh-op-hint dsh-op-hint--inline' }, t('version.latest')))),
        h('div', { className: 'dsh-op-card' },
          h('div', { className: 'dsh-op-cardTitle' }, t('settings.group.model')),
          h('div', { className: 'dsh-op-field' },
            h('div', { className: 'dsh-op-label' }, t('settings.source')),
            h('div', { className: 'dsh-op-choices' },
              radio('follow', t('settings.follow'), t('settings.follow.note')),
              radio('fixed', t('settings.fixed'), t('settings.fixed.note'))),
            h('p', { className: 'dsh-op-hint' },
              form.modelSource === 'follow' ? t('settings.follow.hint') : t('settings.fixed.hint'))),
          form.modelSource === 'fixed'
            ? h('div', { className: 'dsh-op-field' },
              h('div', { className: 'dsh-op-label' }, t('settings.model')),
              h(ModelPicker, {
                catalog,
                provider: form.provider,
                model: form.model,
                t,
                onChange: (nextProvider, nextModel) => setForm({
                  ...form,
                  provider: nextProvider,
                  model: nextModel,
                  reasoningEffort: '',
                }),
              }))
            : null,
          form.modelSource === 'fixed' && efforts.list.length > 0
            ? h('div', { className: 'dsh-op-field' },
              h('div', { className: 'dsh-op-label' }, t('settings.effort')),
              h(EffortPicker, {
                efforts: efforts.list,
                value: form.reasoningEffort ?? '',
                t,
                onChange: next => setForm({ ...form, reasoningEffort: next }),
              }),
              h('p', { className: 'dsh-op-hint' }, t('settings.effort.hint')))
            : null,
          h('div', { className: 'dsh-op-field' },
            h('div', { className: 'dsh-op-label' }, t('settings.idleWait')),
            h('p', { className: 'dsh-op-hint' }, t('settings.idleWait.hint')),
            h('div', { className: 'dsh-op-inline' },
              h('input', {
                className: 'dsh-op-input dsh-op-input--narrow',
                type: 'number',
                min: 1,
                max: 60,
                value: Math.round((form.idleWaitMs ?? 300000) / 60000),
                onChange: event => setForm({
                  ...form,
                  // Stored in milliseconds; the input speaks minutes.
                  idleWaitMs: Math.max(1, Math.min(60, Number(event.target.value) || 5)) * 60000,
                }),
              }),
              h('span', { className: 'dsh-op-hint' }, t('settings.idleWait.unit')))),
          // The two budgets behind a 标准/深度 polish: the lookup gets its own
          // deadline so a slow search cannot consume the time the model needs to
          // write the answer.
          h('div', { className: 'dsh-op-field' },
            h('div', { className: 'dsh-op-label' }, t('settings.explore')),
            h('p', { className: 'dsh-op-hint' }, t('settings.explore.hint')),
            h('div', { className: 'dsh-op-inline' },
              h('input', {
                className: 'dsh-op-input dsh-op-input--narrow',
                type: 'number',
                min: 5,
                max: 300,
                value: Math.round((form.exploreMs ?? 45000) / 1000),
                onChange: event => setForm({
                  ...form,
                  exploreMs: Math.max(5, Math.min(300, Number(event.target.value) || 45)) * 1000,
                }),
              }),
              h('span', { className: 'dsh-op-hint' }, t('settings.explore.unit')),
              h('input', {
                className: 'dsh-op-input dsh-op-input--narrow',
                type: 'number',
                min: 1,
                max: 10,
                value: form.exploreRounds ?? 4,
                onChange: event => setForm({
                  ...form,
                  exploreRounds: Math.max(1, Math.min(10, Number(event.target.value) || 4)),
                }),
              }),
              h('span', { className: 'dsh-op-hint' }, t('settings.explore.rounds')))),
          h('div', { className: 'dsh-op-field' },
            h('div', { className: 'dsh-op-label' }, t('settings.rewriteBudget')),
            h('p', { className: 'dsh-op-hint' }, t('settings.rewriteBudget.hint')),
            h('div', { className: 'dsh-op-inline' },
              h('input', {
                className: 'dsh-op-input dsh-op-input--narrow',
                type: 'number',
                min: 20,
                max: 900,
                value: Math.round((form.timeoutMs ?? 120000) / 1000),
                onChange: event => setForm({
                  ...form,
                  timeoutMs: Math.max(20, Math.min(900, Number(event.target.value) || 120)) * 1000,
                }),
              }),
              h('span', { className: 'dsh-op-hint' }, t('settings.explore.unit')))),
          h('div', { className: 'dsh-op-field' },
            h('div', { className: 'dsh-op-label' }, t('runs.title')),
            h('p', { className: 'dsh-op-hint' }, t('runs.hint')),
            runs.length === 0
              ? h('div', { className: 'dsh-op-hint' }, t('runs.empty'))
              : h('div', { className: 'dsh-op-runs' },
                runs.map(entry => h('button', {
                  key: entry.sessionId,
                  type: 'button',
                  className: 'dsh-op-runRow',
                  'data-active': runsPick === entry.sessionId ? 'true' : 'false',
                  onClick: () => loadRun(entry.sessionId),
                },
                h('span', { className: 'dsh-op-runId' }, entry.sessionId.replace(/^session-/, '').slice(0, 8)),
                h('span', { className: 'dsh-op-runMeta' },
                  `${entry.sent} ${t('runs.sent')} · ${entry.entries} ${t('runs.entries')}${entry.alive ? ` · ${t('runs.alive')}` : ''}`)))),
            runsPick === null
              ? null
              : h('div', { className: 'dsh-op-runLog' },
                runEntries.length === 0
                  ? h('div', { className: 'dsh-op-hint' }, t('auto.trace.empty'))
                  : runEntries.map((entry, index) => {
                    const kind = entry.kind
                    const tag = kind === 'round'
                      ? `${t('auto.trace.think')} ${entry.round ?? ''}`
                      : kind === 'tool'
                        ? (entry.name ?? 'tool')
                        : kind === 'sent'
                          ? `${t('auto.trace.sent')} ${entry.round ?? ''}`
                          : t('auto.trace.conclusion')
                    const text = kind === 'tool'
                      ? `${entry.summary ?? ''}${entry.text ? ` — ${entry.text}` : ''}`
                      : (entry.reasoning || entry.text || '')
                    // Same rule as the window: long tool rows and long reasoning
                    // both start folded, so the log reads as one line per step.
                    const long = String(text).length > 60
                    const foldable = long && (kind === 'tool' || kind === 'round')
                    const open = runOpen.has(index)
                    return h('div', {
                      key: index,
                      className: 'dsh-op-thinkRow',
                      'data-kind': kind,
                      'data-foldable': foldable ? 'true' : 'false',
                      'data-open': foldable && open ? 'true' : 'false',
                      onClick: foldable
                        ? () => {
                          if (runOpen.has(index)) runOpen.delete(index)
                          else runOpen.add(index)
                          setRunFoldTick(value => value + 1)
                        }
                        : undefined,
                    },
                    h('div', { className: 'dsh-op-thinkMeta' },
                      foldable
                        ? h('span', { className: 'dsh-op-thinkCaret', 'aria-hidden': 'true' }, open ? '▾' : '▸')
                        : null,
                      h('span', { className: 'dsh-op-thinkTag' }, tag),
                      foldable && !open
                        ? h('span', { className: 'dsh-op-thinkPeek' }, String(text).replace(/\s+/g, ' ').slice(0, 80))
                        : null,
                      h('span', { className: 'dsh-op-thinkTime' }, String(entry.at ?? '').slice(5, 19))),
                    h('div', { className: 'dsh-op-thinkBody' },
                      foldable && !open ? '' : String(text).slice(0, 1000)))
                  })))),
          h('div', { className: 'dsh-op-footer' },
            h('button', {
              type: 'button',
              className: 'dsh-op-save',
              disabled: !dirty || saveState.state === 'saving',
              onClick: save,
            }, t('settings.save')),
            h('button', {
              type: 'button',
              className: 'dsh-op-link',
              disabled: !dirty || saveState.state === 'saving',
              onClick: () => { setForm(saved); setSaveState({ state: 'idle', message: '' }) },
            }, t('settings.discard')),
            h('span', {
              className: 'dsh-op-status',
              'data-state': dirty ? 'dirty' : saveState.state,
            }, dirty ? t('settings.dirty') : saveState.message)),
        toast === null
          ? null
          : h('div', { className: 'dsh-op-toast', role: 'status', 'aria-live': 'polite' },
            h('svg', {
              viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true,
              fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
              strokeLinecap: 'round', strokeLinejoin: 'round',
            }, h('path', { d: 'M3 8.6 6.3 12 13 4.6' })),
            h('span', null, toast)))
      try {
        return pageBody
      } catch (failure) {
        return h('div', { className: 'dsh-op-page' },
          h('p', { className: 'dsh-op-sub dsh-op-hint--error' },
            `${t('settings.renderFailed')}: ${String(failure?.message ?? failure)}`))
      }
    }

    // ── plugin ──────────────────────────────────────────────────────────────
    const inject = ['slots', 'locale']

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'one-click-polish: dictionaries')

      ctx.effect(() => {
        // HMR re-applies `apply`; keying the <style> by id keeps one live copy.
        document.getElementById(CSS_ID)?.remove()
        const style = document.createElement('style')
        style.id = CSS_ID
        style.setAttribute('data-plugin', NAME)
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'one-click-polish: styles')

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'one-click-polish',
        order: 10,
      }, props => h(PolishButton, { ...props, t })))

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'one-click-polish',
        // Sits after the harness's own sections so a plugin page does not outrank
        // them in the settings list.
        order: 37,
        label: () => t('settings.nav'),
      }, props => h(SettingsPage, { ...props, t })))


      // Steps belong in the conversation, not in a panel over the sidebar.
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: 'one-click-polish-steps',
        order: 40,
        label: () => t('job.label'),
      }, props => h(TurnSteps, { ...props, t })))
      // The thinking window is the autopilot monitor; it stays in the overlay.
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'one-click-polish-think',
        order: 21,
      }, props => h(ThinkWindow, { ...props, t })))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = NAME
    return module.exports
  },
})
