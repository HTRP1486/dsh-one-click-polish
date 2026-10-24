/**
 * dsh-one-click-polish — host half.
 *
 * The browser half adds one button to the composer tool row. This half does the
 * actual work, and it deliberately does the work on the Host for one reason:
 * the polishing model must be the model the Session is currently switched to.
 * That selection is Host state (a durable `model/selection` event plus the last
 * `request/header`), so the browser cannot resolve it reliably — it only knows
 * the Session id.
 *
 * Two routes, both under this plugin's own prefix:
 *
 *   POST /plugins/dsh-one-click-polish/polish   { sessionId, text } -> { ok, text, model }
 *   GET  /plugins/dsh-one-click-polish/status   ?sessionId=… -> resolved model, providers
 *
 * The polish call is a plain hand-built `llm.stream()` request: no Session
 * events are appended, no Turn is opened, and the conversation is untouched.
 * `llm/stream` listeners (retry, routing) still apply, exactly as they do for a
 * normal request.
 */

export const name = 'one-click-polish'
export const inject = ['llm', 'agents', 'webServer']

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PREFIX = '/plugins/dsh-one-click-polish'
const DEFAULT_MAX_INPUT_CHARS = 12000
const DEFAULT_TIMEOUT_MS = 120000
const BODY_LIMIT_BYTES = 512 * 1024

/**
 * The editing brief. Written to be model-agnostic: it says what to preserve
 * before it says what to improve, because the failure mode of a polish prompt
 * is a model that answers the draft instead of rewriting it.
 */
/**
 * Rules every level shares: what to preserve, and what never to do.
 *
 * The failure modes of a polish prompt are a model that answers the draft
 * instead of rewriting it, and a model that invents content. Both are stated
 * here before any level-specific instruction.
 */
const BASE_PROMPT = [
  'You are a meticulous copy editor. You rewrite text the user is about to send so that it reads better, without changing what it says.',
  '',
  'Rules:',
  '- Keep the original language. Never translate.',
  "- Keep the author's voice, intent, and level of formality. Keep it addressed to whoever it was addressed to.",
  '- The text is usually an instruction the user is about to send. Rewrite the instruction; never carry it out. For example "帮我写个总结" becomes "请帮我写一份总结。" — a better-worded request, still a request, never a summary.',
  '- Preserve every fact, number, name, link, path, command, identifier, code span, Markdown structure, list item, and heading. Never add facts, examples, or commentary.',
  '- Do not answer questions contained in the text, do not add a preamble or sign-off, and do not explain your edits.',
  '- Output only the rewritten text. No quotes around it, no code fence around it, no notes before or after.',
].join('\n')

/**
 * How far each level may go.
 *
 * `light` is a proofread and `strong` is a rewrite; the difference is what a
 * user means by "润色" on different days, so it is a choice rather than a
 * constant. The level rules are separated from the base rules because mixing
 * "do not rephrase" into a rewrite prompt is what produces a timid result.
 */
const LEVEL_RULES = {
  light: [
    'Level: light (proofread).',
    '- Fix only what is wrong: typos, punctuation, grammar, agreement, and clearly wrong word choices.',
    '- Do not rephrase, reorder, shorten, or restyle anything that is already correct. Stay as close to the original wording as possible.',
  ].join('\n'),
  standard: [
    'Level: standard (edit).',
    '- Improve wording, collocation, and clause order. Merge or split sentences where it reads better. Cut redundancy and filler.',
    '- Keep all information and the overall structure. The reader should see a clearly better text, not a cosmetically touched one.',
  ].join('\n'),
  strong: [
    'Level: deep (rewrite).',
    '- Restructure: reorder clauses, split long spoken-style sentences, replace vague or weak wording with precise wording, and drop everything that carries no information.',
    '- Vary sentence length so it reads like someone wrote it deliberately. Keep every fact and every requirement; add nothing.',
    '- Rewrite rather than adjust. As a rule of thumb, more than a third of the words should change; if your draft still reads like the input with a few words swapped, redo it.',
    '- The result is expected to differ substantially from the original wording. That is the point of this level; do not hold back.',
  ].join('\n'),
}

const STRENGTHS = ['light', 'standard', 'strong']

function systemPrompt(strength, instruction) {
  const parts = [BASE_PROMPT, LEVEL_RULES[strength]]
  if (instruction !== '') parts.push(`Additional instruction from the user: ${instruction}`)
  return parts.join('\n\n')
}

/**
 * The second action: not a rewrite of the words, but of the *ask*.
 *
 * "帮我写一个登录功能" is a wish, not a brief. This turns it into the brief —
 * goal, features, flow, edge cases, acceptance — which is what makes the next
 * message to the model actually produce the thing the user pictured.
 */
const EXPAND_PROMPT = [
  'You take a short, half-formed request and turn it into what the person actually needs to move forward.',
  '',
  'The input is usually one sentence and usually ambiguous about what KIND of answer is wanted. "做个登录" could be a build task, a page design, a code sample, or a question about which approach to take. Getting that call right matters more than being thorough. Thoroughness applied to the wrong shape is noise.',
  '',
  '## Step 1 — name the shape, then commit to it',
  '',
  'Pick exactly one of these and write the reply in that form. Do not blend them:',
  '',
  '- **要造的** — they intend to build or commission it. Reply as a brief: what it is, what it must do, how it fails, how it is judged.',
  '- **要货的** — they want the artefact itself: a prompt, copy, a config block, a checklist, an outline, a sample. Produce the artefact, not a document about producing it.',
  '- **要判断的** — the sentence hides a choice (X 还是 Y, 能不能, 要不要). Reply with the options, the tradeoff, and a recommendation. A plan is the wrong answer here.',
  '- **要问的** — one missing fact makes every further word wasted. Ask that one question and stop. Do not pad it into a questionnaire.',
  '',
  'Your first line must say which shape you chose and why, in one sentence. If the request genuinely fits two shapes, say so and pick the likelier one.',
  '',
  '## Step 2 — write it in that shape',
  '',
  'Never default to the requirements-document skeleton. If you find yourself producing 现状 / 前提 / 开展 / 边界 / 验收 / 待确认 in that order, stop: that is a template, not a judgement. Equivalent headings dressed differently are the same failure.',
  '',
  'Shape-specific rules:',
  '',
  '- **要造的**: cover what it is for, what it must do concretely, how it behaves at the edges (empty, loading, failure, limits, permissions), and how someone knows it works. Use headings only if the subject has genuinely separate parts. A small utility gets prose and a short list, not eight sections.',
  '- **要货的**: give the thing. No preamble explaining what you are about to give. Structure follows the artefact — a prompt is written as a prompt, copy is written as copy.',
  '- **要判断的**: state the real tradeoff first, then the recommendation with its condition ("if X then A, if Y then B"). No implementation plan unless asked.',
  '- **要问的**: one question, plus at most one line on why it decides everything else.',
  '',
  '## Step 3 — do not invent scope',
  '',
  'This is the rule that gets broken most: do not decide, on your own, what is in and out of scope, and do not announce it as settled. If you write "不做注册、不做找回密码", you have made a product decision for someone who did not make it — write instead that those are open and what each would change.',
  '',
  'Same for technology, structure, data model, roles, and constraints. Raise them as the fork they are, never as a settled boundary.',
  '',
  '## Always',
  '',
  '- Keep the original language. Never translate.',
  '- Stay on the subject. Do not drift into a different product or bolt on unrelated features.',
  '- Be concrete about behaviour rather than generous about categories. "点提交后按钮转圈，重复点击被忽略" beats "提供良好的交互反馈".',
  '- Mark a gap as 待确认 only when it actually blocks the next step, and say what it decides. A list of eleven 待确认 items is a refusal dressed as diligence.',
  '- Never implement: no code, no file layout, no architecture diagram.',
  '- No preamble, no closing summary, no quotes around the reply.',
  '- Length follows the shape and the subject. Never pad; never truncate something that needs the room.',
].join('\n')

function expandPrompt(instruction) {
  return instruction === '' ? EXPAND_PROMPT : `${EXPAND_PROMPT}\n\nAdditional instruction from the user: ${instruction}`
}

// ─────────────────────────────────────────────────────────────────────────────
// small helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Read a non-negative integer from plugin config, falling back on nonsense. */
function positiveInt(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

/** Message text of anything thrown. */
function textOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function sendJson(res, status, value) {
  // A client that gave up (or a webview that dropped the connection) must not
  // turn a late write into an unhandled rejection.
  if (res.writableEnded === true || res.destroyed === true) return
  let body
  try {
    body = Buffer.from(JSON.stringify(value), 'utf8')
  } catch {
    body = Buffer.from('{"ok":false,"error":"response is not serializable"}', 'utf8')
    status = 500
  }
  try {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(body)
  } catch { /* the socket is gone; nothing left to report to */ }
}

/** Buffer one JSON request body, refusing anything over the limit. */
async function readJson(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Reject a request that another site made from the user's browser.
 *
 * The page itself is same-origin, so a browser sends `Origin` on the POST; a
 * foreign page's Origin does not match the Host header. A `null` origin is the
 * desktop webview's own file/document context and is allowed.
 */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// which model is this session on?
// ─────────────────────────────────────────────────────────────────────────────

function isRoute(value) {
  return value !== null
    && typeof value === 'object'
    && typeof value.provider === 'string' && value.provider !== ''
    && typeof value.model === 'string' && value.model !== ''
}

/** Detach a provider/model/reasoning triple from whatever carried it. */
function routeOf(value) {
  return {
    provider: value.provider,
    model: value.model,
    ...(typeof value.reasoningEffort === 'string' && value.reasoningEffort !== ''
      ? { reasoningEffort: value.reasoningEffort }
      : {}),
  }
}

/**
 * Resolve the model this Session would use for its next request.
 *
 * Order of truth:
 *   1. the newest `model/selection` or `request/header` event in the log — the
 *      composer's model picker appends `model/selection`, so a switch made but
 *      not yet sent is already visible here;
 *   2. the profile's default model, when the Session is not live.
 *
 * @returns a detached `{ provider, model, reasoningEffort? }`, or undefined.
 */
function resolveSelection(ctx, agent) {
  const session = agent?.session
  if (session !== undefined) {
    try {
      const events = session.snapshotEvents()
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event.type === 'model/selection' && isRoute(event.data)) return routeOf(event.data)
        if (event.type === 'request/header') {
          const config = event.data?.header?.config
          if (isRoute(config)) return routeOf(config)
        }
      }
    } catch {
      // A session mid-restore can refuse a log read; the default model below is
      // a better answer than a 500.
    }
    try {
      const header = session.requestHeader()?.config
      if (isRoute(header)) return routeOf(header)
    } catch {
      // Same reasoning as above.
    }
  }
  const fallback = ctx.get('agentDefaultModel')?.currentSelection?.()
  return isRoute(fallback) ? routeOf(fallback) : undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// the polish call
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip one fence a model wrapped the whole answer in.
 *
 * Only when the input was not itself fenced: a fenced draft legitimately starts
 * and ends with a fence, and unwrapping that would delete the user's own code
 * block markers.
 */
function unwrapFence(output, input) {
  if (/^\s*```/.test(input)) return output
  const match = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(output)
  return match === null ? output : match[1].trim()
}

/**
 * One model call, text in, text out.
 *
 * `llm.stream` is the documented hand-built entry point: the request is not
 * marked as loop-built, so no listener assumes it can be reconstructed from a
 * Session log, and nothing is appended to the Session.
 */
async function runModel(ctx, selection, input, system, signal) {
  const options = {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
    system,
    signal,
  }

  const once = async () => {
    let output = ''
    let finish
    for await (const chunk of ctx.llm.stream(options)) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text
      else if (chunk?.type === 'finish') finish = chunk.reason
    }
    return { output, finish }
  }

  let { output, finish } = await once()
  // Providers occasionally answer with reasoning only. One retry is cheap next
  // to losing the whole click, and it is only done when the stream itself
  // reported success.
  if (output.trim() === '' && finish?.kind === 'stop') {
    ;({ output, finish } = await once())
  }

  // Adapter failures arrive as a terminal chunk, not as a throw.
  if (finish?.kind === 'aborted') throw new Error('润色请求已中止（超时或被取消）')
  if (finish?.kind === 'error') throw new Error(finish.failure?.message ?? '模型调用失败')

  const polished = unwrapFence(output.trim(), input).trim()
  if (polished === '') throw new Error('模型没有返回任何文本')
  return polished
}

// ─────────────────────────────────────────────────────────────────────────────
// routes
// ─────────────────────────────────────────────────────────────────────────────

async function polishRoute(ctx, settings, req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, code: 'method', error: 'POST only' })
    return
  }
  if (!sameOrigin(req)) {
    sendJson(res, 403, { ok: false, code: 'origin', error: 'cross-origin request refused' })
    return
  }

  const body = await readJson(req, BODY_LIMIT_BYTES)
  const input = typeof body?.text === 'string' ? body.text : ''
  if (input.trim() === '') {
    sendJson(res, 400, { ok: false, code: 'empty', error: '没有可润色的内容' })
    return
  }
  if (input.length > settings.maxInputChars) {
    sendJson(res, 413, {
      ok: false,
      code: 'too-long',
      error: `内容过长（${input.length} 字符），一次最多润色 ${settings.maxInputChars} 字符`,
    })
    return
  }

  const agent = typeof body?.sessionId === 'string' && body.sessionId !== ''
    ? ctx.agents.get(body.sessionId)
    : undefined
  const selection = settings.modelSource === 'fixed' && settings.provider !== '' && settings.model !== ''
    ? {
      provider: settings.provider,
      model: settings.model,
      ...(settings.reasoningEffort === '' ? {} : { reasoningEffort: settings.reasoningEffort }),
    }
    : resolveSelection(ctx, agent)
  if (selection === undefined) {
    sendJson(res, 409, { ok: false, code: 'no-model', error: '当前会话没有可用的模型，请先在输入框里选一个模型' })
    return
  }
  const strength = STRENGTHS.includes(body?.strength) ? body.strength : settings.defaultStrength
  const mode = body?.mode === 'expand' ? 'expand' : 'polish'
  const research = RESEARCH[strength] ?? 'none'
  const requestId = typeof body?.requestId === 'string' && body.requestId !== '' ? body.requestId : null
  const job = requestId === null ? null : createJob(requestId, mode, research, typeof body?.sessionId === 'string' ? body.sessionId : '')

  const controller = new AbortController()
  // The budget covers the rewrite only. The lookup runs under its own, shorter
  // deadline inside explore(), so a slow search can never eat the time the model
  // needs to actually answer.
  const budgetMs = settings.timeoutMs + (research === 'none' ? 0 : MAX_EXPLORE_MS)
  const timer = setTimeout(() => controller.abort(), budgetMs)
  const model = `${selection.provider}/${selection.model}`
  // Run the work detached from the HTTP response.
  //
  // A desktop webview can drop a request that stays silent for a minute even
  // though the Host is still working, so the browser gets an immediate 202 and
  // collects the outcome from the job table instead of holding one long
  // connection. That is the difference between "expand hangs" and "expand takes
  // a minute but always arrives".
  if (job !== null) {
    job.model = model
    job.result = null
    void (async () => {
      try {
        const text = await produceRewrite(ctx, settings, mode, strength, research, input, agent, job, selection, controller)
        job.result = { ok: true, text, model, mode, strength, research, context: job.contextChars ?? 0 }
        job.done = true
      } catch (error) {
        job.error = textOf(error)
        job.done = true
        for (const step of job.steps) {
          if (step.state === 'running') step.state = 'error'
        }
      } finally {
        clearTimeout(timer)
        // Keep the finished row briefly so a late poll still finds it.
        setTimeout(() => { jobs.delete(job.id) }, 120000)
      }
    })()
    sendJson(res, 202, { ok: true, accepted: true, requestId: job.id })
    return
  }

  try {
    const text = await produceRewrite(ctx, settings, mode, strength, research, input, agent, job, selection, controller)
    sendJson(res, 200, { ok: true, text, model, mode, strength, research })
  } catch (error) {
    sendJson(res, 502, { ok: false, code: 'llm', error: textOf(error), model })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The whole rewrite: optional lookup, then the model call.
 *
 * Shared by the synchronous path (no request id) and the detached job path, so
 * the two cannot drift.
 */
async function produceRewrite(ctx, settings, mode, strength, research, input, agent, job, selection, controller) {
  const findings = research === 'none'
    ? ''
    : await explore(ctx, selection, input, research, job, agent, controller.signal)
  markStep(job, 'explore', findings === '' ? 'skipped' : 'done',
    findings === '' ? '没有找到相关资料' : `${findings.length} 字资料`)
  markStep(job, 'rewrite', 'running')

  const base = mode === 'expand' ? expandPrompt(settings.instruction) : systemPrompt(strength, settings.instruction)
  // Expansion is about the conversation's subject, so it gets the recent
  // transcript whether or not a lookup ran: "帮我写个登录功能" means something
  // different in a billing tool than in a chat app.
  const transcript = mode === 'expand' && agent !== undefined ? transcriptOf(agent.session).text : ''
  const hasTranscript = transcript !== '' && !transcript.startsWith('(')
  if (job !== null) job.contextChars = hasTranscript ? transcript.length : 0
  const parts = [base]
  if (hasTranscript) parts.push(CONTEXT_NOTE, `对话历史:\n${transcript}`)
  if (findings !== '') parts.push(RESEARCH_NOTE, `参考资料（AI 检索所得）:\n${findings}`)
  const system = parts.join('\n\n')

  const text = await runModel(ctx, selection, input, system, controller.signal)
  markStep(job, 'rewrite', 'done')
  return text
}

async function statusRoute(ctx, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const sessionId = url.searchParams.get('sessionId') ?? undefined
  const agent = sessionId === undefined ? undefined : ctx.agents.get(sessionId)
  const selection = resolveSelection(ctx, agent)
  let providers = []
  try {
    providers = ctx.llm.listProviders().map(provider => provider.id)
  } catch {
    providers = []
  }
  sendJson(res, 200, {
    ok: true,
    plugin: 'dsh-one-click-polish',
    session: sessionId ?? null,
    agent: agent !== undefined,
    model: selection ?? null,
    providers,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// research depth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the chip's three levels mean: how far the rewrite may look before it
 * starts writing.
 *
 *   light    — the draft alone (a pure polish)
 *   standard — plus the workspace: matching files, read for the lines that touch
 *              the draft's subject
 *   strong   — plus the web: a search that resolves names, versions, and the
 *              other things a draft leaves vague
 */
const RESEARCH = { light: 'none', standard: 'local', strong: 'web' }

/**
 * Names that must never be opened or quoted, whatever the working directory is.
 *
 * The workspace root is whatever the user happened to open a session on — here it
 * was `D:\Documents`, which contains cookies, chat databases and unrelated
 * repositories. A copy editor has no business reading any of that, so the guard
 * is by name rather than by trusting the directory.
 */
// Matched against the whole name: `auth` and `session` are common enough that a
// substring rule would hide ordinary documents like `author.md`.
const SENSITIVE_FILE = /(^(cookies?|credential|login|logins|secrets?|token|tokens|password|passwd|session|auth|keychain|wallet|seed)([._-].*)?$)|(\.env$|\.netrc$|\.git-credentials$)|(^id_(rsa|dsa|ed25519))|(cookies?\.(txt|json)$)|(credentials?\.(json|ya?ml)$)/i
const SENSITIVE_DIR = /^(node_modules|\.git|\.ssh|\.aws|\.gnupg|wechat files|wechat|tencent files|appdata|\.config|\.cache|\.vscode|\.idea|logins?|wxid.*)$/i

/** True when a path names something the explorer must not touch. */
function isSensitive(name) {
  return SENSITIVE_FILE.test(name) || SENSITIVE_DIR.test(name)
}

/** Roots the explorer may read: the project, and this DSH profile. */
function allowedRoots(ctx, agent) {
  const roots = []
  // Optional service access on purpose: the plugin must not refuse to start just
  // because a profile has no working-directory service.
  const directories = ctx.get('workingDirectory')
  if (agent !== undefined && directories !== undefined) {
    try {
      roots.push(directories.get(agent.session))
    } catch { /* a session that has no directory yet */ }
  }
  const profile = profileDir()
  if (profile !== null) roots.push(profile)
  return roots.filter(root => typeof root === 'string' && root !== '')
}

/**
 * This profile's directory.
 *
 * `DSH_PROFILE_DIR` is set for shell tool calls, not for the desktop host, so
 * the working directory of the host process is the fallback — and it is only
 * trusted when it actually looks like a profile.
 */
function profileDir() {
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  try {
    const cwd = process.cwd()
    return existsSync(join(cwd, 'cordis.patch.yml')) ? cwd : null
  } catch {
    return null
  }
}

/**
 * True when `child` is `parent` or lives under it (case-insensitive on Windows).
 *
 * `..` segments are collapsed first: the guard compares the *resolved* location,
 * not the spelling, so a path like `project/../../secrets` cannot pass by
 * string-matching a prefix.
 */
function sameOrInside(child, parent) {
  const norm = value => {
    const parts = []
    for (const segment of value.replace(/\\/g, '/').split('/')) {
      if (segment === '' || segment === '.') continue
      if (segment === '..') {
        parts.pop()
        continue
      }
      parts.push(segment.toLowerCase())
    }
    return parts.join('/')
  }
  const left = norm(child)
  const right = norm(parent)
  return left === right || left.startsWith(`${right}/`)
}

/** Resolve a model-supplied path, refusing anything outside the allowed roots. */
async function resolveAllowed(fs, roots, path, signal) {
  if (fs === undefined || typeof path !== 'string' || path.trim() === '') return null
  // Refuse on the requested spelling before touching the disk, then again on the
  // resolved location: a symlink or a `..` segment must not walk into a private
  // corner of the workspace either.
  if (path.split(/[\\/]/).some(segment => segment !== '' && segment !== '.' && isSensitive(segment))) return null
  let target
  try {
    target = await fs.resolve(path, { cwd: roots[0], signal })
  } catch {
    return null
  }
  const display = target.displayPath ?? path
  if (display.split(/[\\/]/).some(segment => segment !== '' && isSensitive(segment))) return null
  return roots.some(root => sameOrInside(display, root)) ? target : null
}

const TEXT_FILE = /\.(md|markdown|txt|ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|py|go|rs|java|kt|css|scss|html|vue|svelte|sh|ps1)$/i
const SKIP_DIR = /^(node_modules|\.git|dist|build|out|\.cache|target|vendor|\.next|coverage)$/i

/**
 * Walk the allowed roots for a literal string.
 *
 * Bounded on purpose — 400 files, 200 KB each, 20 hits — because this runs
 * inside a click and an unbounded walk of a home directory is a hang, not a
 * feature.
 */
async function searchContent(fs, roots, query, signal) {
  const needle = query.toLowerCase()
  const hits = []
  let files = 0
  const stack = [...roots]
  while (stack.length > 0 && files < 400 && hits.length < 20) {
    const dir = stack.pop()
    let entries
    try {
      const target = await fs.resolve(dir, { signal })
      entries = await fs.listDir(target, signal)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (hits.length >= 20 || files >= 400) break
      if (isSensitive(entry.name)) continue
      if (entry.type === 'directory') {
        if (!SKIP_DIR.test(entry.name)) stack.push(entry.target.displayPath ?? entry.name)
        continue
      }
      if (entry.type !== 'file' || !TEXT_FILE.test(entry.name)) continue
      files += 1
      try {
        const content = await fs.readText(entry.target, signal)
        if (typeof content !== 'string' || content.length > 200000) continue
        const lines = content.split(/\r?\n/)
        for (let index = 0; index < lines.length && hits.length < 20; index += 1) {
          if (!lines[index].toLowerCase().includes(needle)) continue
          hits.push(`${entry.target.displayPath ?? entry.name}:${index + 1}: ${lines[index].trim().slice(0, 160)}`)
        }
      } catch { /* binary or unreadable */ }
    }
  }
  return hits
}

// ─────────────────────────────────────────────────────────────────────────────
// search engines (script-driven, no DSH web service)
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SEARCH_TIMEOUT_MS = 15000

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? ' ')
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** One bounded GET with a browser-ish UA; the caller's signal still wins. */
async function fetchText(url, signal, headers = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  const relay = () => controller.abort()
  if (signal !== undefined) signal.addEventListener('abort', relay)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': UA,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        ...headers,
      },
    })
    return { ok: response.ok, status: response.status, text: await response.text() }
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', relay)
  }
}

/** Bing's organic results: `<li class="b_algo">` with an `<h2><a>` and a `<p>`. */
function parseBing(html) {
  const results = []
  for (const block of html.split('<li class="b_algo"').slice(1, 9)) {
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (link === null) continue
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block)
    const url = decodeEntities(link[1])
    if (!/^https?:/i.test(url)) continue
    results.push({
      title: stripTags(link[2]).slice(0, 140),
      url,
      snippet: snippet === null ? '' : stripTags(snippet[1]).slice(0, 260),
    })
  }
  return results
}

/**
 * Baidu's organic results.
 *
 * Baidu answers a plain script with a human-verification page on some networks;
 * that is reported as `blocked` rather than as "no results", so the model knows
 * to fall back instead of concluding the web has nothing.
 */
function parseBaidu(html) {
  if (html.includes('安全验证') || html.includes('wappass') || html.length < 5000) {
    return { blocked: true, results: [] }
  }
  const results = []
  for (const block of html.split('<div class="result').slice(1, 9)) {
    const link = /<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (link === null) continue
    const snippet = /(?:c-abstract|content-right_)[^>]*>([\s\S]*?)<\/(?:div|span)>/.exec(block)
    const url = decodeEntities(link[1])
    if (!/^https?:/i.test(url)) continue
    results.push({
      title: stripTags(link[2]).slice(0, 140),
      url,
      snippet: snippet === null ? '' : stripTags(snippet[1]).slice(0, 260),
    })
  }
  return { blocked: false, results }
}

async function searchBing(query, signal) {
  const { text, status } = await fetchText(`https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans`, signal)
  const results = parseBing(text)
  return { results, note: results.length === 0 ? `必应没有解析到结果（HTTP ${status}）` : '' }
}

async function searchBaidu(query, signal) {
  const { text, status } = await fetchText(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`, signal)
  const parsed = parseBaidu(text)
  if (parsed.blocked) return { results: [], note: '百度返回了人机验证页，已跳过' }
  return { results: parsed.results, note: parsed.results.length === 0 ? `百度没有解析到结果（HTTP ${status}）` : '' }
}

/** GitHub's REST search: repositories, which is what "有没有相关插件" means. */
async function searchGithub(query, signal) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5&sort=stars&order=desc`
  const { text, ok, status } = await fetchText(url, signal, { accept: 'application/vnd.github+json' })
  if (!ok) return { results: [], note: `GitHub API HTTP ${status}` }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { results: [], note: 'GitHub 返回的不是 JSON' }
  }
  const items = Array.isArray(data?.items) ? data.items : []
  return {
    results: items.map(item => ({
      title: `${item.full_name} ★${item.stargazers_count ?? 0}`,
      url: item.html_url,
      snippet: `${item.description ?? ''}${item.language ? ` · ${item.language}` : ''}`.trim(),
    })),
    note: items.length === 0 ? 'GitHub 没有匹配的仓库' : '',
  }
}

/**
 * Douyin itself is a signed, script-rendered app: a plain GET returns a shell
 * with no results, so it is deliberately not an engine here.
 */

const ENGINES = ['auto', 'bing', 'baidu', 'github']

/** Run one engine, or the three-way default, and render it as tool text. */
async function runWebSearch(args, signal) {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (query === '') return { text: '搜索词为空', summary: '空搜索' }
  const engine = ENGINES.includes(args.engine) ? args.engine : 'auto'

  const parts = []
  try {
    if (engine === 'auto') {
      // All three at once: they answer different halves of a question (repos vs.
      // pages), and the slowest one should not delay the other two.
      const settled = await Promise.all([
        searchBing(query, signal).catch(error => ({ results: [], note: textOf(error) })),
        searchBaidu(query, signal).catch(error => ({ results: [], note: textOf(error) })),
        searchGithub(query, signal).catch(error => ({ results: [], note: textOf(error) })),
      ])
      const seen = new Set()
      let count = 0
      for (const [name, outcome] of [['必应', settled[0]], ['百度', settled[1]], ['GitHub', settled[2]]]) {
        const fresh = outcome.results.filter(item => {
          const key = item.url.replace(/\/+$/, '')
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        if (fresh.length === 0) {
          if (outcome.note !== '') parts.push(`【${name}】${outcome.note}`)
          continue
        }
        parts.push(`【${name}】`)
        for (const item of fresh) {
          if (count >= 10) break
          parts.push(renderResult(item))
          count += 1
        }
      }
    } else {
      const outcome = engine === 'github'
        ? await searchGithub(query, signal)
        : engine === 'baidu'
          ? await searchBaidu(query, signal)
          : await searchBing(query, signal)
      if (outcome.results.length > 0) {
        for (const item of outcome.results.slice(0, 6)) parts.push(renderResult(item))
      } else {
        parts.push(outcome.note === '' ? '没有结果' : outcome.note)
      }
    }
  } catch (error) {
    return { text: `联网检索失败：${textOf(error)}`, summary: '联网失败' }
  }

  return {
    text: parts.join('\n') || '没有结果',
    summary: `联网[${engine}]：${query.slice(0, 20)}`,
  }
}

function renderResult(item) {
  return `- ${item.title} — ${item.url}${item.snippet ? `\n  ${item.snippet}` : ''}`
}
/** The tool surface the explorer sees. Depth decides whether the web is there. */
function explorerTools(research) {
  const tools = [
    {
      name: 'list_dir',
      description: '列出目录下的条目。路径可以是绝对路径，或相对项目工作目录。',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径' } }, required: ['path'] },
    },
    {
      name: 'read_file',
      description: '读取一个文本文件。大文件用 offset/limit 按行读（默认从头读 200 行，最多 400 行）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          offset: { type: 'number', description: '起始行，从 1 开始' },
          limit: { type: 'number', description: '读取行数' },
        },
        required: ['path'],
      },
    },
    {
      name: 'search_files',
      description: '按文件名或路径模糊查找文件（编辑器 @ 索引），适合找插件、文档、配置。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '文件名片段' } }, required: ['query'] },
    },
    {
      name: 'search_content',
      description: '在项目与 DSH 配置目录里按内容搜索一个字符串，返回 file:line 命中行。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '要搜索的字面串' } }, required: ['query'] },
    },
  ]
  if (research === 'web') {
    tools.push({
      name: 'web_search',
      description: '联网搜索。engine 可选：auto（默认，必应+百度+GitHub 同时查）、github（仓库/插件）、bing（通用网页）、baidu（中文网页）。用于查清草稿里含糊的名字、版本、行为。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索词' },
          engine: { type: 'string', enum: ENGINES, description: '用哪个搜索引擎，默认 auto' },
        },
        required: ['query'],
      },
    })
  }
  return tools
}

function parseArgs(raw) {
  try {
    const value = JSON.parse(typeof raw === 'string' && raw !== '' ? raw : '{}')
    return value !== null && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/** Run one tool call, returning the text to feed back plus a one-line label. */
async function runTool(ctx, agent, roots, call, signal) {
  const args = parseArgs(call.arguments)
  const fs = ctx.get('fs')

  if (call.name === 'web_search') {
    return runWebSearch(args, signal)
  }

  if (roots.length === 0) return { text: '没有可读的本地目录（缺少工作目录与 DSH 配置目录）', summary: '无本地目录' }

  if (call.name === 'search_files') {
    const references = ctx.get('fileReferences')
    const query = typeof args.query === 'string' ? args.query : ''
    if (references === undefined || agent === undefined) return { text: '文件索引不可用', summary: '索引不可用' }
    try {
      const found = await references.list(agent, query, signal)
      const lines = found.slice(0, 30).map(item => `${item.kind === 'directory' ? 'd' : '-'} ${item.path}`)
      return { text: lines.join('\n') || '(没有匹配)', summary: `找文件：${query.slice(0, 20)}` }
    } catch (error) {
      return { text: `文件索引失败：${textOf(error)}`, summary: '索引失败' }
    }
  }

  if (call.name === 'list_dir') {
    const target = await resolveAllowed(fs, roots, args.path, signal)
    if (target === null) return { text: '路径不在允许范围内（只允许项目目录与 DSH 配置目录）', summary: '越界' }
    try {
      const entries = await fs.listDir(target, signal)
      // Names the explorer has no business reporting are hidden rather than
      // listed: the model cannot ask about what it never saw.
      const visible = entries.filter(entry => !isSensitive(entry.name))
      const hidden = entries.length - visible.length
      const lines = visible.slice(0, 80).map(entry => `${entry.type === 'directory' ? 'd' : '-'} ${entry.name}`)
      if (hidden > 0) lines.push(`(${hidden} 个条目不显示)`)
      return { text: lines.join('\n') || '(空目录)', summary: `列目录：${String(args.path).slice(0, 24)}` }
    } catch (error) {
      return { text: `列目录失败：${textOf(error)}`, summary: '列目录失败' }
    }
  }

  if (call.name === 'read_file') {
    const target = await resolveAllowed(fs, roots, args.path, signal)
    if (target === null) return { text: '路径不在允许范围内（只允许项目目录与 DSH 配置目录）', summary: '越界' }
    try {
      const content = await fs.readText(target, signal)
      const lines = String(content).split(/\r?\n/)
      const offset = Math.max(1, Number(args.offset) || 1)
      const limit = Math.min(400, Math.max(1, Number(args.limit) || 200))
      const end = Math.min(lines.length, offset - 1 + limit)
      const slice = lines.slice(offset - 1, end).join('\n').slice(0, 6000)
      return {
        text: `(${lines.length} 行，显示 ${offset}-${end})\n${slice}`,
        summary: `读文件：${String(args.path).slice(0, 24)}`,
      }
    } catch (error) {
      return { text: `读取失败：${textOf(error)}`, summary: '读文件失败' }
    }
  }

  if (call.name === 'search_content') {
    const query = typeof args.query === 'string' ? args.query : ''
    if (query.trim() === '') return { text: '搜索词为空', summary: '空搜索' }
    try {
      const hits = await searchContent(fs, roots, query, signal)
      return { text: hits.join('\n') || '(没有命中)', summary: `搜内容：${query.slice(0, 20)}` }
    } catch (error) {
      return { text: `内容搜索失败：${textOf(error)}`, summary: '搜索失败' }
    }
  }

  return { text: `未知工具：${call.name}`, summary: '未知工具' }
}

const EXPLORE_SYSTEM = [
  '你是一个只读的资料检索智能体，正在为一次改写做准备。用户会给你即将发送的草稿。',
  '',
  '你能看到用户的机器（项目工作目录、DSH 配置目录里的插件与文档）和公开网络。任务是找到能让草稿更具体、或能澄清其中含糊之处的材料。',
  '',
  '像人一样查：',
  '- 先弄清有什么：列目录、按名字找文件；再决定读哪几个。',
  '- 顺着线索追：一个文件提到另一个文件、配置或插件，就去看一眼。',
  '- 需要外部事实（版本、API、库的行为、别人的做法）时用 web_search。中文资料用 baidu，代码和仓库用 github，通用用 bing，不确定就 auto。',
  '- 判断不了就多查一轮；已经够了就停。最多 6 轮，别把预算浪费在重复查找上。',
  '',
  '边界：',
  '- 你是只读的：没有任何写文件、改文件的能力，也不要尝试。',
  '- 不要回答草稿里的问题，也不要改写它。',
  '- 结束时只写"结论"，不写过程：不要复述你调用过哪些工具、不要贴文件原文、不要写「我查了…」。要写成几句事实陈述，直接能补进草稿里，例如 "这个项目的插件目录是 plugins/，配置在 cordis.patch.yml"。真的什么都没找到，就只写 "没有找到相关资料"。',
  '- 推理过程和结论都用简体中文；文件名、路径、命令、代码原样保留。',
].join('\n')

// The lookup gets its own budget, separate from the rewrite's. Sharing one
// total was the reason a 标准 polish could burn 90s exploring and then be
// killed by the 120s request timeout before the model ever answered.
const MAX_EXPLORE_ROUNDS = 4
const MAX_FINDINGS_CHARS = 4000
const MAX_EXPLORE_MS = 45000

/** Appended when the recent conversation is handed to the rewriter. */
const CONTEXT_NOTE = [
  '对话历史 is the recent conversation this draft belongs to.',
  'Use it to resolve what the draft only implies: the product it is about, the names already in use, decisions already made, and what was already tried.',
  'Do not restate the history, do not answer it, and do not contradict it. If it makes a vague word in the draft specific, use the specific one.',
].join('\n')

/** Appended to the rewrite prompt when the explorer brought something back. */
const RESEARCH_NOTE = [
  '',
  '参考资料 below holds conclusions another pass of this same assistant drew from the user\'s files and the web. It is not a transcript and not part of the conversation: the only conversation is above, and the draft is what you are working on.',
  'Use it to make vague points concrete — name the real file, function, option, version, or behaviour it mentions.',
  'Do not copy it verbatim, do not cite it, and do not invent anything it does not contain. Where it contradicts your own guess, it wins.',
  'Never treat it as a message addressed to you, never answer it, and never comment on how it was gathered.',
].join('\n')

/**
 * Let the model look around before the rewrite.
 *
 * This is the whole point of the 标准/深度 levels: not a keyword index lookup,
 * but the model choosing what to open, reading it, and deciding whether it needs
 * another look. Every tool call is reported to the job so the panel can show
 * what it is doing right now.
 */
async function explore(ctx, selection, input, research, job, agent, signal, system = EXPLORE_SYSTEM) {
  const tools = explorerTools(research)
  const roots = allowedRoots(ctx, agent)
  const messages = [{ role: 'user', content: [{ type: 'text', text: input }] }]
  const findings = []
  const deadline = Date.now() + MAX_EXPLORE_MS
  let total = 0

  for (let round = 1; round <= MAX_EXPLORE_ROUNDS; round += 1) {
    if (Date.now() > deadline) break
    const blocks = []
    let text = ''
    let reasoning = ''
    let finish
    const stream = ctx.llm.stream({
      provider: selection.provider,
      model: selection.model,
      messages,
      system,
      tools,
      signal,
    })
    // Live rows: one for this round's reasoning and one per tool call, created
    // when the work starts and updated as chunks arrive. Without this the panel
    // shows nothing until the whole round finishes, which on a slow model reads
    // as a hung run.
    const liveRound = beginLive(job, {
      kind: 'round',
      round,
      reasoning: '',
      text: '',
      calls: [],
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
        updateLive(job, liveRound, { text: text.trim().slice(0, 2000) })
      } else if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        reasoning += chunk.text
        updateLive(job, liveRound, { reasoning: reasoning.trim().slice(0, 1200) })
      } else if (chunk?.type === 'block-end' && chunk.block !== undefined) blocks.push(chunk.block)
      else if (chunk?.type === 'finish') finish = chunk.reason
    }
    if (finish?.kind === 'error') throw new Error(finish.failure?.message ?? '检索失败')
    if (finish?.kind === 'aborted') throw new Error('检索已取消')

    const calls = blocks.filter(block => block.type === 'tool-call')
    // Settle this round's row with its final content and the calls it produced.
    updateLive(job, liveRound, {
      done: true,
      reasoning: reasoning.trim().slice(0, 1200),
      text: text.trim().slice(0, 2000),
      calls: calls.map(call => ({ name: call.name, arguments: String(call.arguments ?? '').slice(0, 300) })),
    })
    if (calls.length === 0) {
      // The model stopped calling tools. If it also wrote nothing, its turn ended
      // without a conclusion — treating that as an answer would hand the caller an
      // empty string and, for the driver, silently end the run. Nudge it once.
      if (text.trim() === '' && reasoning.trim() !== '' && round < MAX_EXPLORE_ROUNDS) {
        messages.push({
          id: `explore-${round}`,
          role: 'assistant',
          content: blocks.length > 0 ? blocks : [{ type: 'text', text: reasoning.trim().slice(0, 500) }],
          source: { kind: 'model', provider: selection.provider, model: selection.model },
        })
        messages.push({
          id: `explore-${round}-nudge`,
          role: 'user',
          content: [{ type: 'text', text: '你的上一条回复只有思考、没有正文。请直接写出结论正文。' }],
        })
        continue
      }
      if (text.trim() !== '') findings.push(text.trim())
      break
    }

    messages.push({
      id: `explore-${round}`,
      role: 'assistant',
      content: blocks,
      source: { kind: 'model', provider: selection.provider, model: selection.model },
    })
    for (const call of calls) {
      // The row appears the moment the call starts, so a slow file read or web
      // search is visible as work in progress rather than as a stalled window.
      const row = beginLive(job, {
        kind: 'tool',
        round,
        name: call.name,
        summary: '运行中…',
        text: String(call.arguments ?? '').slice(0, 300),
      })
      markStep(job, 'explore', 'running', `调用 ${call.name}`)
      const result = await runTool(ctx, agent, roots, call, signal)
      markStep(job, 'explore', 'running', result.summary)
      updateLive(job, row, {
        done: true,
        summary: result.summary,
        text: String(result.text ?? '').slice(0, 600),
      })
      total += result.text.length
      messages.push({
        id: `explore-${round}-${call.id}`,
        role: 'tool',
        toolCallId: call.id,
        source: { kind: 'tool', callId: call.id },
        content: [{ type: 'text', text: result.text.slice(0, 2000) }],
      })
      if (total > MAX_FINDINGS_CHARS || Date.now() > deadline) break
    }
    if (total > MAX_FINDINGS_CHARS || Date.now() > deadline) break
  }

  // A round that ran out of budget mid-tool-call exits the loop without ever
  // reaching the point where a conclusion is written, so `findings` came back
  // empty and the driver above read that as "no next message" and stopped the
  // whole autopilot. Ask once more with tools withheld, which forces prose.
  if (findings.length === 0 || findings.join('').trim() === '') {
    try {
      let finalText = ''
      const closing = ctx.llm.stream({
        provider: selection.provider,
        model: selection.model,
        messages: [
          ...messages,
          {
            id: 'explore-final',
            role: 'user',
            content: [{ type: 'text', text: '不要再调用任何工具。现在把你的结论直接写出来。' }],
          },
        ],
        system,
        // No tools: the model has to answer in text instead of searching more.
        signal,
      })
      for await (const chunk of closing) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') finalText += chunk.text
      }
      if (finalText.trim() !== '') findings.push(finalText.trim())
    } catch { /* the caller still gets whatever the rounds produced */ }
  }

  // Only what the model wrote in its closing turn is carried forward. Dumping raw
  // tool output into the rewrite prompt is what made the rewriter believe it had
  // been handed a tool log from another conversation instead of a draft.
  return findings.join('\n\n').slice(0, MAX_FINDINGS_CHARS)
}

/** Temporary truth probe: what the Host actually has for agent and directory. */
async function diagRoute(ctx, req, res) {
  const ids = []
  let roots = []
  let error = null
  try {
    for (const agent of ctx.agents.list()) ids.push(String(agent.id))
    roots = ctx.agents.roots().map(agent => String(agent.id))
  } catch (failure) {
    error = textOf(failure)
  }
  let cwdSample = null
  try {
    const first = ctx.agents.list()[0]
    const directories = ctx.get('workingDirectory')
    if (first !== undefined && directories !== undefined) cwdSample = directories.get(first.session)
  } catch (failure) {
    cwdSample = `error: ${textOf(failure)}`
  }
  let baseDir = null
  try {
    baseDir = typeof ctx.baseDir === 'string' ? ctx.baseDir : null
  } catch {
    baseDir = 'unavailable'
  }
  sendJson(res, 200, {
    ok: true,
    agents: ids,
    roots,
    error,
    cwdSample,
    profileDir: process.env.DSH_PROFILE_DIR ?? null,
    baseDir,
    processCwd: process.cwd(),
    searchRoots: allowedRoots(ctx, ctx.agents.list()[0]),
    // Whether the browser half is actually in the composed boot graph. A blank
    // settings page with a working Host is usually a client entry that never made
    // it into the graph, or one whose bundle URL 404s.
    client: (() => {
      const modules = ctx.get('clientModules')
      if (modules === undefined) return { available: false }
      try {
        const graph = modules.graph()
        return {
          available: true,
          rev: graph.rev,
          total: graph.entries.length,
          mine: graph.entries
            .filter(entry => String(entry.id).includes('one-click-polish'))
            .map(entry => ({ id: entry.id, url: entry.url, rev: entry.rev })),
        }
      } catch (failure) {
        return { available: true, error: textOf(failure) }
      }
    })(),
    transcript: (() => {
      const first = ctx.agents.list()[0]
      if (first === undefined) return null
      try {
        const all = first.session.deriveMessages()
        const snapshot = first.session.snapshotEvents()
        return {
          messages: all.length,
          roles: all.slice(-6).map(message => message.role),
          events: snapshot.length,
          rendered: transcriptOf(first.session),
        }
      } catch (failure) {
        return { error: textOf(failure) }
      }
    })(),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// progress jobs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One job per request, keyed by the id the browser generated.
 *
 * A single POST cannot report progress, so the browser polls this table while
 * the request runs. Entries are tiny, capped, and worthless once the response
 * lands; nothing here outlives the request by more than a couple of minutes.
 */
const jobs = new Map()
const JOB_LIMIT = 24

function jobSteps(research) {
  const steps = []
  // Light is a plain rewrite: the model never looks anything up, so no lookup
  // step exists to show.
  if (research !== 'none') steps.push({ key: 'explore', state: 'pending', detail: '' })
  steps.push({ key: 'rewrite', state: 'pending', detail: '' })
  return steps
}

function createJob(id, mode, research, sessionId) {
  const job = {
    id,
    mode,
    research,
    steps: jobSteps(research),
    done: false,
    error: null,
    // The finished payload, for the polling client. Absent while running.
    result: null,
    model: '',
    contextChars: 0,
    // What the model reasoned and every tool it called, in order. Bounded so a
    // long run cannot grow without limit.
    trace: [],
    // Which session this belongs to, so every traced step can be archived.
    sessionId: typeof sessionId === 'string' ? sessionId : '',
    at: Date.now(),
  }
  jobs.set(id, job)
  while (jobs.size > JOB_LIMIT) jobs.delete(jobs.keys().next().value)
  return job
}

const TRACE_LIMIT = 120

/** Append one step of the model's work to the job's visible trace. */
function trace(job, entry) {
  if (job === null) return
  job.trace.push({ ...entry, at: Date.now() })
  if (job.trace.length > TRACE_LIMIT) job.trace.shift()
  // The live trace belongs to one run and dies with the process. The log is what
  // the settings page reads afterwards, so the same entry is archived per session.
  if (typeof job.sessionId === 'string' && job.sessionId !== '') {
    appendLog(job.sessionId, { run: job.id, ...entry })
  }
}

/**
 * Start a row that will be filled in while the model is still streaming.
 *
 * Returns the row's index in the trace array. The archive copy is written once,
 * when the row settles, so a streaming run does not rewrite the log file on every
 * token.
 */
function beginLive(job, entry) {
  if (job === null) return -1
  job.trace.push({ ...entry, at: Date.now(), live: true })
  if (job.trace.length > TRACE_LIMIT) job.trace.shift()
  return job.trace.length - 1
}

/** Patch a live row in place; the poller sees it on its next tick. */
function updateLive(job, index, patch) {
  if (job === null || index < 0 || index >= job.trace.length) return
  const row = job.trace[index]
  if (row === undefined || row.live !== true) return
  Object.assign(row, patch)
  if (patch.done === true) {
    row.live = false
    // Archive the finished row once, not once per token.
    if (typeof job.sessionId === 'string' && job.sessionId !== '') {
      const { live, done, ...rest } = row
      appendLog(job.sessionId, { run: job.id, ...rest })
    }
  }
}

function markStep(job, key, state, detail) {
  if (job === null) return
  const step = job.steps.find(item => item.key === key)
  if (step === undefined) return
  step.state = state
  if (detail !== undefined) step.detail = detail
}

async function progressRoute(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const job = jobs.get(url.searchParams.get('id') ?? '')
  if (job === undefined) {
    sendJson(res, 200, { ok: true, job: null })
    return
  }
  sendJson(res, 200, {
    ok: true,
    job: {
      id: job.id,
      mode: job.mode,
      research: job.research,
      done: job.done,
      error: job.error,
      steps: job.steps.map(step => ({ ...step })),
      // What the model reasoned and called, so the panel can show the process
      // rather than only the outcome.
      trace: job.trace.slice(-60),
      // The finished payload travels with the poll, so the browser never has to
      // hold one long request open.
      result: job.done === true && job.error === null ? job.result : null,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// diagnostics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Last N client reports, in memory only.
 *
 * The button runs in the browser, where this Host cannot see its console, so
 * the browser half posts each step of a click here. That answers "did the click
 * run, and where did it stop" without a devtools session.
 */
const diagnostics = []

function recordDiagnostic(entry) {
  diagnostics.push(entry)
  if (diagnostics.length > 80) diagnostics.shift()
}

async function logRoute(req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, { ok: true, entries: diagnostics })
    return
  }
  const body = await readJson(req, 64 * 1024)
  recordDiagnostic({ at: new Date().toISOString(), ...body })
  sendJson(res, 200, { ok: true })
}

// ─────────────────────────────────────────────────────────────────────────────
// settings
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize the row config into the shape the routes read. */
function readSettings(config) {
  return {
    modelSource: config?.modelSource === 'fixed' ? 'fixed' : 'follow',
    provider: typeof config?.provider === 'string' ? config.provider : '',
    model: typeof config?.model === 'string' ? config.model : '',
    reasoningEffort: typeof config?.reasoningEffort === 'string' ? config.reasoningEffort : '',
    maxInputChars: positiveInt(config?.maxInputChars, DEFAULT_MAX_INPUT_CHARS),
    timeoutMs: positiveInt(config?.timeoutMs, DEFAULT_TIMEOUT_MS),
    instruction: typeof config?.instruction === 'string' ? config.instruction.trim() : '',
    defaultStrength: STRENGTHS.includes(config?.defaultStrength) ? config.defaultStrength : 'strong',
    autoMode: config?.autoMode === 'goal' ? 'goal' : 'rounds',
    autoRounds: Math.min(MAX_AUTOPILOT_ROUNDS, positiveInt(config?.autoRounds, 5)),
    autoGoal: typeof config?.autoGoal === 'string' ? config.autoGoal.slice(0, 500) : '',
    autoResearch: ['none', 'local', 'web'].includes(config?.autoResearch) ? config.autoResearch : 'local',
  }
}

/**
 * The models this DSH can actually route to, grouped by provider.
 *
 * `listModels` is adapter-owned and may interrogate an endpoint, so each
 * provider gets a deadline and the whole set runs in parallel: one slow
 * provider must not make the settings page hang.
 */
const CATALOG_TTL_MS = 60000
let catalogCache = { at: 0, value: null }

function withTimeout(promise, ms) {
  let timer = null
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(null), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    // Without clearing this, a fast provider would leave one timer per call
    // alive for the full deadline.
    if (timer !== null) clearTimeout(timer)
  })
}

async function loadCatalog(ctx) {
  if (catalogCache.value !== null && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value
  const providers = ctx.llm.listProviders()
  const groups = await Promise.all(providers.map(async provider => {
    const models = await withTimeout(ctx.llm.listModels(provider.id).catch(() => []), 3000)
    return {
      provider: provider.id,
      name: provider.name ?? provider.id,
      models: (models ?? []).map(model => ({ id: model.id, name: model.name ?? model.id })),
    }
  }))
  const value = groups.filter(group => group.models.length > 0)
  catalogCache = { at: Date.now(), value }
  return value
}

/**
 * Write the choice into this plugin's row in the profile patch layer.
 *
 * The patch is the documented home for a plugin's tunables and survives
 * upgrades, so the selection outlives a restart. Without a configuration
 * editor the choice still applies to the running process; the response says
 * so rather than pretending it was saved.
 */
async function persistSettings(ctx, next) {
  const entry = ctx.fiber?.entry
  const editor = ctx.get('configEditor')
  if (entry === undefined || editor === undefined) return { persisted: false, reason: 'no-config-editor' }
  try {
    await editor.edit(entry, current => ({
      ...current,
      modelSource: next.modelSource,
      provider: next.provider,
      model: next.model,
      reasoningEffort: next.reasoningEffort,
      defaultStrength: next.defaultStrength,
      autoMode: next.autoMode,
      autoRounds: next.autoRounds,
      autoGoal: next.autoGoal,
      autoResearch: next.autoResearch,
    }))
    return { persisted: true }
  } catch (error) {
    return { persisted: false, reason: textOf(error) }
  }
}

async function settingsRoute(ctx, settings, req, res) {
  if (req.method === 'GET') {
    const catalog = await loadCatalog(ctx)
    sendJson(res, 200, {
      ok: true,
      settings: {
        modelSource: settings.modelSource,
        provider: settings.provider,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        defaultStrength: settings.defaultStrength,
        autoMode: settings.autoMode,
        autoRounds: settings.autoRounds,
        autoGoal: settings.autoGoal,
        autoResearch: settings.autoResearch,
      },
      catalog,
      canPersist: ctx.fiber?.entry !== undefined && ctx.get('configEditor') !== undefined,
    })
    return
  }

  const body = await readJson(req, 64 * 1024)
  const next = {
    modelSource: body?.modelSource === 'fixed' ? 'fixed' : 'follow',
    provider: typeof body?.provider === 'string' ? body.provider : '',
    model: typeof body?.model === 'string' ? body.model : '',
    reasoningEffort: typeof body?.reasoningEffort === 'string' ? body.reasoningEffort : '',
    defaultStrength: STRENGTHS.includes(body?.defaultStrength) ? body.defaultStrength : settings.defaultStrength,
    autoMode: body?.autoMode === 'goal' ? 'goal' : (body?.autoMode === 'rounds' ? 'rounds' : settings.autoMode),
    autoRounds: Math.min(MAX_AUTOPILOT_ROUNDS, positiveInt(body?.autoRounds, settings.autoRounds)),
    autoGoal: typeof body?.autoGoal === 'string' ? body.autoGoal.slice(0, 500) : settings.autoGoal,
    autoResearch: ['none', 'local', 'web'].includes(body?.autoResearch) ? body.autoResearch : settings.autoResearch,
  }
  if (next.modelSource === 'fixed' && (next.provider === '' || next.model === '')) {
    sendJson(res, 400, { ok: false, code: 'no-model', error: '选择了固定模型，但没有指定具体模型' })
    return
  }
  Object.assign(settings, next)
  const saved = await persistSettings(ctx, next)
  sendJson(res, 200, { ok: true, settings: { ...next }, ...saved })
}

/**
 * Which reasoning efforts one model actually accepts.
 *
 * Asked per model rather than shipped with the catalog: this profile lists 700+
 * models, and effort support is adapter-resolved metadata, not catalog data. A
 * model without reasoning answers with an empty list, and that is what lets the
 * settings page hide the control instead of offering efforts the adapter would
 * reject at dispatch.
 */
async function effortsRoute(ctx, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const provider = url.searchParams.get('provider') ?? ''
  const model = url.searchParams.get('model') ?? ''
  if (provider === '' || model === '') {
    sendJson(res, 400, { ok: false, error: 'provider and model are required' })
    return
  }
  try {
    const info = await ctx.llm.resolveModelInfo(provider, model)
    const efforts = (info?.reasoning?.efforts ?? []).map(effort => ({
      id: String(effort.id),
      name: effort.name ?? String(effort.id),
      ...(effort.description === undefined ? {} : { description: effort.description }),
    }))
    sendJson(res, 200, {
      ok: true,
      efforts,
      defaultEffort: info?.reasoning?.defaultEffort === undefined ? null : String(info.reasoning.defaultEffort),
    })
  } catch (error) {
    // A model whose adapter refuses resolution simply has no effort control.
    sendJson(res, 200, { ok: true, efforts: [], defaultEffort: null, error: textOf(error) })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// autopilot persistence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where an interrupted autopilot run is remembered.
 *
 * A pilot lives in memory and dies with the Host process, so switching windows
 * survives it but a restart does not. This file is the restart boundary: it
 * holds enough to offer the run back, and never enough to resume by itself —
 * launching an agent that spends quota the moment DSH opens is not something a
 * crash recovery should ever do unattended.
 */
function pilotFile() {
  const dir = profileDir()
  return dir === null ? null : join(dir, '.one-click-polish-autopilot.json')
}

function readPilotRecords() {
  const file = pilotFile()
  if (file === null || !existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writePilotRecords(records) {
  const file = pilotFile()
  if (file === null) return
  try {
    writeFileSync(file, JSON.stringify(records, null, 2), 'utf8')
  } catch { /* a read-only profile keeps the feature, just not across restarts */ }
}

/** Remember a run that is still in flight, so a restart can offer it back. */
function rememberPilot(pilot) {
  const records = readPilotRecords()
  records[pilot.sessionId] = {
    mode: pilot.mode,
    rounds: pilot.rounds,
    goal: pilot.goal,
    research: pilot.research,
    round: pilot.round,
    limitMs: pilot.limitMs,
    startedAt: pilot.startedAt,
    lastPrompt: pilot.lastPrompt,
    savedAt: new Date().toISOString(),
  }
  writePilotRecords(records)
}

/** Drop the record for one session (the driver finished or was stopped). */
function forgetPilot(sessionId) {
  const records = readPilotRecords()
  if (records[sessionId] === undefined) return
  delete records[sessionId]
  writePilotRecords(records)
}

const RESUMABLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Runs a previous Host process left unfinished, for sessions that are live now.
 *
 * Offered, not started: the browser shows them and one click resumes.
 */
function resumablePilots(ctx) {
  const records = readPilotRecords()
  const now = Date.now()
  const out = []
  let dirty = false
  for (const [sessionId, record] of Object.entries(records)) {
    const savedAt = Date.parse(record?.savedAt ?? '')
    if (!Number.isFinite(savedAt) || now - savedAt > RESUMABLE_MAX_AGE_MS) {
      delete records[sessionId]
      dirty = true
      continue
    }
    if (ctx.agents.get(sessionId) === undefined) continue
    out.push({
      sessionId,
      mode: record.mode,
      rounds: record.rounds,
      goal: record.goal,
      research: record.research,
      round: record.round ?? 0,
      limitMs: record.limitMs ?? 0,
      startedAt: record.startedAt ?? 0,
      lastPrompt: record.lastPrompt ?? '',
      savedAt: record.savedAt,
    })  }
  if (dirty) writePilotRecords(records)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// autopilot run log (per session, persisted)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One record per finished or interrupted autopilot round, kept per session.
 *
 * The live job table only holds the current run, and it is gone the moment the
 * Host restarts. This file is the archive behind the settings page: what the
 * driver read, which files it opened, and every message it sent.
 */
const LOG_LIMIT_PER_SESSION = 400

function logFile() {
  const dir = profileDir()
  return dir === null ? null : join(dir, '.one-click-polish-log.json')
}

function readLogs() {
  const file = logFile()
  if (file === null || !existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLogs(logs) {
  const file = logFile()
  if (file === null) return
  try {
    writeFileSync(file, JSON.stringify(logs), 'utf8')
  } catch { /* a read-only profile keeps the feature, just not across restarts */ }
}

/** Append one entry to a session's log, trimming the oldest. */
function appendLog(sessionId, entry) {
  const logs = readLogs()
  const list = Array.isArray(logs[sessionId]) ? logs[sessionId] : []
  list.push({ at: new Date().toISOString(), ...entry })
  logs[sessionId] = list.slice(-LOG_LIMIT_PER_SESSION)
  writeLogs(logs)
}

/** Read one session's log, newest last. */
function readSessionLog(sessionId) {
  const logs = readLogs()
  return Array.isArray(logs[sessionId]) ? logs[sessionId] : []
}

/** Sessions that have any log, with a one-line summary for the picker. */
function listLoggedSessions(ctx) {
  const logs = readLogs()
  const out = []
  for (const [sessionId, entries] of Object.entries(logs)) {
    if (!Array.isArray(entries) || entries.length === 0) continue
    const sent = entries.filter(entry => entry.kind === 'sent').length
    const files = new Set()
    for (const entry of entries) {
      if (entry.kind === 'tool' && typeof entry.summary === 'string') files.add(entry.summary)
    }
    out.push({
      sessionId,
      entries: entries.length,
      sent,
      files: files.size,
      first: entries[0]?.at ?? null,
      last: entries[entries.length - 1]?.at ?? null,
      alive: ctx.agents.get(sessionId) !== undefined,
    })
  }
  out.sort((left, right) => String(right.last).localeCompare(String(left.last)))
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// autopilot: an AI that writes the next prompt and sends it
// ─────────────────────────────────────────────────────────────────────────────
// autopilot: an AI that writes the next prompt and sends it
// ─────────────────────────────────────────────────────────────────────────────

const DRIVER_SYSTEM = [
  '你是一个任务驱动智能体。你看一段对话和一个目标，然后决定下一步让助手做什么。',
  '',
  '输出规则（只输出其中一种，不要解释）：',
  '- 目标已经达成，或对话已经没有必要继续：只输出一行 `DONE`。',
  '- 否则：输出下一条要发给助手的用户消息正文。不要加"下一步："之类的前缀，不要加引号。',
  '',
  '写消息时：',
  '- 具体、可执行，一次只推进一件事。',
  '- 接着对话里已经做到的地方往下走，不要重复已完成的步骤。',
  '- 助手答偏了或卡住了，就指出问题并给更明确的指令。',
  '- 需要事实（文件在哪、某个 API 怎么用）时先用工具查，不要猜。',
  '',
  '语言：你的推理过程和要发出去的消息都用简体中文，即使对话或代码里出现英文也一样。文件名、路径、命令、代码原样保留，不要翻译。',
].join('\n')

const MAX_AUTOPILOT_ROUNDS = 50

/**
 * How long one round may wait for the assistant to finish the previous message.
 *
 * A long turn (a big refactor, a web search) is normal, but waiting forever makes
 * the autopilot indistinguishable from a hung one: this ceiling turns that into a
 * stated stop with a reason the panel can show.
 */
const MAX_IDLE_WAIT_MS = 5 * 60 * 1000

/** One driver per Session; the state is what the toolbar polls. */
const pilots = new Map()

function pilotOf(sessionId) {
  const existing = pilots.get(sessionId)
  if (existing !== undefined) return existing
  const fresh = {
    sessionId,
    enabled: false,
    // The key this pilot is filed under. Checkpoints are written per session, so
    // without it `rememberPilot` would file every run under `undefined`.
    sessionId,
    mode: 'rounds',
    rounds: 5,
    goal: '',
    research: 'local',
    round: 0,
    // Wall-clock budget in milliseconds; 0 means "no time limit".
    limitMs: 0,
    startedAt: 0,
    state: 'idle',
    // Why the last run ended, so the panel can say it instead of just "off".
    stopReason: null,
    lastPrompt: '',
    error: null,
    /** Guards against a second driver for the same session. */
    running: false,
  }
  pilots.set(sessionId, fresh)
  return fresh
}

/**
 * Recent conversation, rendered for the driver: role plus a trimmed text.
 *
 * Scans backwards and keeps the newest user/assistant messages, skipping tool
 * traffic: a busy turn is mostly tool calls and tool results, so a plain "last
 * N entries" window is often 90% tool noise and reads as an empty conversation.
 */
/**
 * The conversation as the driver should see it.
 *
 * Three separate cuts used to stack up — the newest 16 messages, 700 characters
 * each, then 4000 for the whole transcript — so arming the autopilot halfway
 * through a long conversation silently dropped its beginning, and the driver
 * decided "the next step" without knowing what the first half had already done.
 *
 * Now the budget is spent where it matters: the most recent turns keep their full
 * text, and everything older survives as a compressed tail of one-liners. When
 * even that does not fit, the oldest goes first and the transcript says how much
 * it had to drop instead of pretending the conversation started mid-sentence.
 */
function transcriptOf(session, options = {}) {
  const recentCount = options.recent ?? 24
  const olderCount = options.older ?? 40
  const totalChars = options.chars ?? 12000
  const perRecent = options.perRecent ?? 1200
  const perOlder = options.perOlder ?? 240

  let messages = []
  try {
    messages = session.deriveMessages()
  } catch {
    return { text: '(无法读取对话历史)', count: 0, dropped: 0 }
  }

  // Every usable turn, oldest first.
  const turns = []
  for (const message of messages) {
    const who = message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : null
    if (who === null) continue
    const text = (message.content ?? [])
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text === '') continue
    turns.push({ who, text })
  }
  if (turns.length === 0) return { text: '(对话还是空的)', count: 0, dropped: 0 }

  const recent = turns.slice(-recentCount)
  const older = turns.slice(0, Math.max(0, turns.length - recentCount))

  let used = 0
  let dropped = 0
  // Recent turns keep their text, and they are spent first — they are what the
  // driver is deciding the next step *from*.
  const keptRecent = []
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const turn = recent[index]
    const text = turn.text.slice(0, perRecent)
    const line = `${turn.who}：${text}`
    if (used + line.length > totalChars && keptRecent.length > 0) break
    keptRecent.push(line)
    used += line.length
  }
  keptRecent.reverse()

  // Older turns are context, not content: one compressed line each. They are read
  // oldest-first, because the beginning of a conversation is what a driver armed
  // halfway through most needs — what was the original ask. The middle is what
  // gets dropped, and the transcript says so.
  const keptOlder = []
  for (const turn of older) {
    const head = turn.text.slice(0, perOlder)
    const line = `${turn.who}：${head}${turn.text.length > perOlder ? '…' : ''}`
    if (used + line.length > totalChars) { dropped += 1; continue }
    keptOlder.push(line)
    used += line.length
  }

  const parts = []
  if (keptOlder.length > 0) {
    parts.push('[更早的对话（压缩）]', keptOlder.join('\n'), '')
  }
  if (dropped > 0) parts.push(`[中间省略了 ${dropped} 条较早的消息]`, '')
  parts.push(keptRecent.join('\n\n'))

  return { text: parts.join('\n').trim(), count: turns.length, dropped }
}

/** Seconds the provider asked us to wait, when the failure was a rate limit. */
function retryAfterOf(message) {
  if (!/429|rate limit|too many requests/i.test(message)) return null
  const match = /retry in (\d+)\s*s|retry_after["'\s:]+(\d+)/i.exec(message)
  const seconds = match === null ? 20 : Number(match[1] ?? match[2])
  return Math.min(120, Math.max(5, seconds)) * 1000
}

/**
 * Ask the driver for the next message, riding out a rate limit.
 *
 * A 429 here means the provider is busy, not that the loop is broken: waiting
 * the interval it asked for and trying again is what a person would do. Anything
 * else (or a third failure) is a real error and ends the pilot.
 */
async function composeNextPromptRetrying(ctx, agent, selection, pilot, job, signal) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await composeNextPrompt(ctx, agent, selection, pilot, job, signal)
    } catch (error) {
      lastError = error
      const wait = retryAfterOf(textOf(error))
      if (wait === null || attempt === 2) throw error
      pilot.state = 'waiting'
      await new Promise(resolve => setTimeout(resolve, wait))
      if (!pilot.enabled) throw new Error('已结束')
      pilot.state = 'thinking'
    }
  }
  throw lastError
}

/** Ask the driver for the next message, letting it look things up first. */
async function composeNextPrompt(ctx, agent, selection, pilot, job, signal) {
  const goal = pilot.goal === '' ? '（没有写明确目标，按对话的自然下一步推进）' : pilot.goal
  const transcript = transcriptOf(agent.session)
  // Keep what the driver actually saw, so the panel can show it. The transcript
  // already bounded itself, so this only caps what the panel renders.
  pilot.context = {
    messages: transcript.count,
    chars: transcript.text.length,
    dropped: transcript.dropped ?? 0,
    text: transcript.text.slice(0, 6000),
  }
  const input = [
    `目标：${goal}`,
    `已经自动推进了 ${pilot.round} 轮。`,
    pilot.mode === 'rounds'
      ? `最多 ${pilot.rounds} 轮，现在要决定第 ${pilot.round + 1} 轮；目标提前达成就直接输出 DONE。`
      : '没有轮数上限，目标达成就输出 DONE。',
    '',
    '对话历史：',
    transcript.text,
    '',
    '现在决定下一步：目标达成输出 DONE，否则输出下一条用户消息。',
  ].join('\n')

  const answer = await explore(ctx, selection, input, pilot.research, job, agent, signal, DRIVER_SYSTEM)
  const text = answer.trim()
  if (/^DONE\b/i.test(text)) return { done: true, text: '' }
  return { done: false, text: text === '' ? '' : text }
}

/**
 * Drive one session until it stops.
 *
 * Runs detached from the HTTP request that armed it: the caller gets the state
 * immediately and polls it. Every stop path (rounds reached, goal reported,
 * user toggled off, error) leaves the pilot disabled, so a stale driver can
 * never keep sending messages.
 */
async function drivePilot(ctx, sessionId, agentRef, pilot) {
  // Two drivers for one session would each send a prompt per round, doubling the
  // pace and interleaving two unrelated plans. A start request that arrives while
  // a driver is already running reuses it instead of forking a second one.
  if (pilot.running === true) return
  pilot.running = true
  const job = createJob(`autopilot-${sessionId}`, 'polish', pilot.research === 'none' ? 'none' : pilot.research, sessionId)
  // A resumed run keeps the clock it already spent; a fresh one starts now.
  if (!(pilot.startedAt > 0)) pilot.startedAt = Date.now()
  /** Wall-clock budget spent; checked before each round so a round never half-runs. */
  const outOfTime = () => pilot.limitMs > 0 && Date.now() - pilot.startedAt >= pilot.limitMs
  /**
   * The live agent for this session.
   *
   * Switching conversations can dispose and re-create the agent behind this
   * loop's back, and a stale reference then waits forever or throws — which is
   * what made a run look "paused" the moment the user opened another chat. The
   * loop therefore looks the agent up by session id every round instead of
   * holding the instance it started with.
   *
   * The agent may also be briefly absent while that switch happens, so waiting a
   * moment beats treating it as a failure.
   */
  const waitForAgent = async (timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const current = ctx.agents.get(sessionId)
      if (current !== undefined) return current
      await new Promise(resolve => setTimeout(resolve, 500))
      if (!pilot.enabled) return undefined
    }
    return undefined
  }
  try {
    while (pilot.enabled) {
      let agent = ctx.agents.get(sessionId)
      if (agent === undefined) {
        pilot.state = 'waiting'
        agent = await waitForAgent()
        if (agent === undefined) {
          if (pilot.enabled) {
            pilot.state = 'orphaned'
            pilot.stopReason = 'session-gone'
          }
          break
        }
      }
      // The assistant may still be answering the previous message. Say so, and put a
      // ceiling on the wait: an assistant stuck in a very long turn would otherwise
      // look like a dead autopilot, because the loop can do nothing until it idles.
      pilot.state = 'waiting'
      const idleDeadline = Date.now() + MAX_IDLE_WAIT_MS
      let idle = false
      while (pilot.enabled && Date.now() < idleDeadline) {
        idle = await Promise.race([
          agent.whenIdle().then(() => true),
          new Promise(resolve => setTimeout(() => resolve(false), 5000)),
        ])
        if (idle) break
      }
      if (!pilot.enabled) break
      if (!idle) {
        pilot.state = 'waiting'
        pilot.stopReason = 'busy'
        pilot.error = '助手一直在处理上一条消息，自动驾驶先停下；等它空下来再点「自动」继续'
        break
      }
      if (!pilot.enabled) break
      if (outOfTime()) {
        pilot.state = 'timeout'
        pilot.stopReason = 'time'
        break
      }
      if (pilot.mode === 'rounds' && pilot.round >= pilot.rounds) {
        pilot.state = 'done'
        pilot.stopReason = 'rounds'
        break
      }
      pilot.state = 'thinking'
      const selection = resolveSelection(ctx, agent)
      if (selection === undefined) throw new Error('这个会话没有可用模型')
      const next = await composeNextPromptRetrying(ctx, agent, selection, pilot, job, new AbortController().signal)
      if (!pilot.enabled) break
      if (next.done === true) {
        pilot.state = 'achieved'
        pilot.stopReason = 'goal'
        break
      }
      // An empty answer is usually a hiccup, not a decision: the model thought
      // about it and produced no body (a truncated turn, a stray stop token). It
      // used to end the run right there, which is why the autopilot seemed to
      // switch itself off after thinking for a while. Ask again before giving up.
      if (next.text === '') {
        pilot.emptyStreak = (pilot.emptyStreak ?? 0) + 1
        if (pilot.emptyStreak <= 2) {
          pilot.state = 'thinking'
          continue
        }
        pilot.state = 'empty'
        pilot.stopReason = 'empty'
        pilot.error = '驱动 AI 连续返回空消息'
        break
      }
      pilot.emptyStreak = 0
      pilot.round += 1
      pilot.lastPrompt = next.text
      pilot.state = 'sent'
      // Keep the driver's own decision visible: which round, and the message it
      // chose to send.
      trace(job, { kind: 'sent', round: pilot.round, text: next.text.slice(0, 1500) })
      // Checkpoint after every round: a crash here must not lose the count.
      rememberPilot(pilot)
      // Send it; the top of the loop waits for the assistant to finish before the
      // next decision, so the driver always plans from an up-to-date transcript.
      agent.followup({
        id: `autopilot-${Date.now().toString(36)}-${pilot.round}`,
        role: 'user',
        content: [{ type: 'text', text: next.text }],
        source: { kind: 'user' },
      })
    }
  } catch (error) {
    pilot.error = textOf(error)
    pilot.state = 'error'
    pilot.stopReason = 'error'
  } finally {
    pilot.enabled = false
    pilot.running = false
    if (pilot.state === 'running') pilot.state = 'stopped'
    // No recorded reason means the user paused the loop, which is exactly the case
    // that must stay resumable; every other exit already named its reason.
    if (pilot.stopReason === null || pilot.stopReason === undefined) pilot.stopReason = 'stopped'
    // Keep the checkpoint when the run was paused rather than completed: a stop by
    // the user, a park on a busy assistant, or a driver that produced nothing are
    // all states worth resuming. Reaching the goal or the round cap is an ending.
    const resumable = pilot.stopReason === 'stopped'
      || pilot.stopReason === 'interrupted'
      || pilot.stopReason === 'busy'
      // An empty answer stopped the loop mid-work, not at the end of it: the rounds
      // it already spent still count if the user retries.
      || pilot.stopReason === 'empty'
    if (resumable) rememberPilot(pilot)
    else forgetPilot(sessionId)
    // Diagnosable after the fact: the checkpoint file is the only state a resume
    // depends on, so which way this branch went is worth seeing in the log.
    if (typeof pilot.sessionId === 'string' && pilot.sessionId !== '') {
      appendLog(pilot.sessionId, {
        run: job?.id ?? '',
        kind: 'conclusion',
        text: `pilot 结束：stopReason=${String(pilot.stopReason)} state=${String(pilot.state)} 可续跑=${resumable}`,
      })
    }
  }
}

async function autopilotRoute(ctx, settings, req, res) {
  if (req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // Something a previous Host process left unfinished, offered not started.
    if (url.searchParams.get('resumable') === '1') {
      sendJson(res, 200, { ok: true, resumable: resumablePilots(ctx) })
      return
    }
    const pilot = pilots.get(url.searchParams.get('sessionId') ?? '')
    if (pilot === undefined) {
      sendJson(res, 200, { ok: true, pilot: null })
      return
    }
    // The transcript is only sent when asked for: it is a few KB and the panel
    // polls this route every couple of seconds.
    const detail = url.searchParams.get('detail') === '1'
    const { context, ...rest } = pilot
    sendJson(res, 200, {
      ok: true,
      pilot: {
        ...rest,
        context: context === undefined ? null : { messages: context.messages, chars: context.chars },
      },
      ...(detail ? { contextText: context?.text ?? '(还没有读取过对话)' } : {}),
    })
    return
  }

  const body = await readJson(req, 64 * 1024)
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  const agent = ctx.agents.get(sessionId)
  if (agent === undefined) {
    sendJson(res, 409, { ok: false, error: '找不到这个会话' })
    return
  }
  const pilot = pilotOf(sessionId)

  // Interrupt cancels the assistant's current turn but leaves the loop armed, so
  // the driver re-plans and sends a better prompt instead of stopping.
  if (body?.action === 'interrupt') {
    try {
      agent.cancel({ kind: 'user' })
      sendJson(res, 200, { ok: true, pilot })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: textOf(error), pilot })
    }
    return
  }

  if (body?.enabled !== true) {
    // The user asked it to stop, which is a different fact from the driver running
    // out of things to say: record which one happened.
    const wasRunning = pilot.enabled === true
    pilot.enabled = false
    pilot.state = 'stopped'
    if (wasRunning) pilot.stopReason = 'interrupted'
    pilot.stopReason = pilot.stopReason ?? 'stopped'
    // `clear` is the explicit "forget this run": it drops the checkpoint and the
    // pilot, so the button returns to a plain grey idle.
    if (body?.clear === true) {
      forgetPilot(sessionId)
      pilots.delete(sessionId)
      sendJson(res, 200, { ok: true, pilot: null })
      return
    }
    // A plain stop is a pause, not an ending: keep the checkpoint so 「继续」 can
    // pick up at the round it reached instead of starting over.
    rememberPilot(pilot)
    sendJson(res, 200, { ok: true, pilot })
    return
  }

  pilot.mode = body?.mode === 'goal' ? 'goal' : 'rounds'
  pilot.rounds = Math.min(MAX_AUTOPILOT_ROUNDS, Math.max(1, Number(body?.rounds) || settings.autoRounds))
  pilot.goal = typeof body?.goal === 'string' ? body.goal.slice(0, 500) : settings.autoGoal
  pilot.research = RESEARCH[body?.strength] ?? settings.autoResearch
  // Wall-clock cap in minutes; 0 or nonsense means "no time limit". The ceiling is
  // a day: an autopilot that keeps sending messages for longer than that is not
  // something this control should quietly allow.
  const minutes = Math.round(Number(body?.limitMinutes))
  pilot.limitMs = Number.isFinite(minutes) && minutes > 0
    ? Math.min(24 * 60, Math.max(1, minutes)) * 60_000
    : 0
  pilot.round = 0
  // A fresh pilot always starts its own clock; only a real resume may inherit one.
  pilot.startedAt = 0
  // Resuming keeps the count and the clock a crashed run already spent.
  if (body?.resume === true) {
    const record = readPilotRecords()[sessionId]
    if (record !== undefined) {
      if (Number.isFinite(Number(record.round))) pilot.round = Number(record.round)
      if (Number.isFinite(Number(record.limitMs))) pilot.limitMs = Number(record.limitMs)
      if (Number.isFinite(Number(record.startedAt))) pilot.startedAt = Number(record.startedAt)
    }
  }
  pilot.error = null
  // A new run drops the previous outcome, or the button would keep reporting the
  // old one while the loop is running again.
  pilot.stopReason = null
  pilot.emptyStreak = 0
  pilot.lastPrompt = ''
  pilot.enabled = true
  pilot.state = 'running'
  sendJson(res, 200, { ok: true, pilot })
  void drivePilot(ctx, sessionId, agent, pilot)
}

// ─────────────────────────────────────────────────────────────────────────────
// run log route
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET …/runs                      sessions that have a log, newest first
 * GET …/runs?sessionId=<id>       that session's entries, oldest first
 * GET …/runs?sessionId=<id>&after keep only entries newer than this ISO time
 *
 * The archive is what survives a restart, so the panel can scroll back through
 * what the driver read and sent after the run itself is long gone.
 */
async function runsRoute(ctx, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const sessionId = url.searchParams.get('sessionId')
  if (sessionId === null || sessionId === '') {
    sendJson(res, 200, { ok: true, sessions: listLoggedSessions(ctx) })
    return
  }
  const after = url.searchParams.get('after')
  let entries = readSessionLog(sessionId)
  if (after !== null && after !== '') entries = entries.filter(entry => String(entry.at) > after)
  sendJson(res, 200, { ok: true, sessionId, entries })
}

// ─────────────────────────────────────────────────────────────────────────────
// plugin entry
// ─────────────────────────────────────────────────────────────────────────────
export function apply(ctx, config) {
  const settings = readSettings(config)
  const server = ctx.webServer

  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${PREFIX}/status`,
    handler: (req, res) => statusRoute(ctx, req, res)
      .catch(error => sendJson(res, 500, { ok: false, error: textOf(error) })),
  }), 'one-click-polish: status route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${PREFIX}/polish`,
    handler: (req, res) => polishRoute(ctx, settings, req, res)
      .catch(error => sendJson(res, 500, { ok: false, error: textOf(error) })),
  }), 'one-click-polish: polish route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${PREFIX}/log`,
    handler: (req, res) => logRoute(req, res)
      .catch(error => sendJson(res, 500, { ok: false, error: textOf(error) })),
  }), 'one-click-polish: log route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${PREFIX}/settings`,
    handler: (req, res) => settingsRoute(ctx, settings, req, res)
      .catch(error => sendJson(res, 500, { ok: false, error: textOf(error) })),
  }), 'one-click-polish: settings route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${PREFIX}/efforts`,
    handler: (req, res) => effortsRoute(ctx, req, res)
      .catch(error => sendJson(res, 500, { ok: false, error: textOf(error) })),
  }), 'one-click-polish: efforts route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${PREFIX}/diag`,
    handler: (req, res) => diagRoute(ctx, req, res)
      .catch(error => sendJson(res, 500, { ok: false, error: textOf(error) })),
  }), 'one-click-polish: diag route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${PREFIX}/progress`,
    handler: (req, res) => progressRoute(req, res)
      .catch(error => sendJson(res, 500, { ok: false, error: textOf(error) })),
  }), 'one-click-polish: progress route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${PREFIX}/runs`,
    handler: (req, res) => runsRoute(ctx, req, res)
      .catch(error => sendJson(res, 500, { ok: false, error: textOf(error) })),
  }), 'one-click-polish: run log route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${PREFIX}/autopilot`,
    handler: (req, res) => autopilotRoute(ctx, settings, req, res)
      .catch(error => sendJson(res, 500, { ok: false, error: textOf(error) })),
  }), 'one-click-polish: autopilot route')
}
