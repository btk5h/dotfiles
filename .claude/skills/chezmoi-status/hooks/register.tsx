import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DriftedFile, FileDecision, FileSummary, PackageDecision, PushState, Reconcile, Snapshot, Summary, Upstream } from '../types'
import { FILM_ROWS, FILM_TICK_MS, filmFrame, fishKind, randomSize } from './film'
import type { Mood, ReconcileStep, Scene } from './film'
import { addToPackages, firstLine, note, parseBrewDiff, parseRichDiff } from './reconcile'
import {
  DIRECTION_LABELS,
  FILE_OUTCOMES,
  PACKAGE_OUTCOMES,
  countBy,
  describeCounts,
  entryGlyph,
  formatTime,
  isEditedHere,
  isScript,
  moodOf,
  parseStatus,
  plural,
  repoBadges,
  statusBadges,
} from './status'

const PANE = 'chezmoi-status'
const POLL_MS = 60_000
const UPSTREAM_POLL_MS = 5 * 60_000
const UPSTREAM_TIMEOUT_MS = 20_000
const FETCHED_REF_PREFIX = 'refs/chezmoi-status/'
const MAX_DIFF_CHARS = 100_000

const snapshot = atom({ plugin: 'chezmoi-status', key: 'snapshot' } as const, null as Snapshot | null)
const summary = atom({ plugin: 'chezmoi-status', key: 'summary' } as const, null as Summary | null)
const upstream = atom({ plugin: 'chezmoi-status', key: 'upstream' } as const, null as Upstream | null)
const reconcile = atom({ plugin: 'chezmoi-status', key: 'reconcile' } as const, null as Reconcile | null)
const push = atom({ plugin: 'chezmoi-status', key: 'push' } as const, null as PushState | null)

const SUMMARY_SYSTEM = [
  'You summarize `chezmoi diff` output for the owner of a dotfiles repo.',
  'In the diff, `-` lines are what is on this machine now and `+` lines are what `chezmoi apply` would write from the repo.',
  'Write at most 6 terse markdown bullets, one per file or related group of files, saying in plain terms what applying would change.',
  'When a change looks like a local edit on this machine that the repo lacks, say so.',
  'No preamble, no headings.',
].join(' ')


const sha256 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const summarize = async ($: EngineInterface) => {
  const diff = await $.process.run(['chezmoi', 'diff', '--no-pager'], { timeoutMs: 60_000 })
  const diffHash = await sha256(diff.stdout)
  const previous = await read($, summary)
  if (previous?.diffHash === diffHash && previous.error === undefined) return

  await update($, summary, () => ({ text: previous?.text ?? '', diffHash, isLoading: true }))
  const prompt = diff.stdout.length > MAX_DIFF_CHARS
    ? `${diff.stdout.slice(0, MAX_DIFF_CHARS)}\n\n(diff truncated)`
    : diff.stdout
  const reply = await $.model.complete({
    model: 'haiku',
    system: SUMMARY_SYSTEM,
    prompt,
    maxTokens: 600,
    effort: 'low',
    timeoutMs: 60_000,
  })

  await update($, summary, () =>
    reply.isAnswered
      ? { text: reply.text.trim(), diffHash, isLoading: false }
      : { text: '', diffHash, isLoading: false, error: reply.reason },
  )
}

let statusCheck: Promise<number> | null = null
let isSummarizing = false

const checkStatus = ($: EngineInterface): Promise<number> => {
  statusCheck ??= (async () => {
    const status = await $.process.run(['chezmoi', 'status'], { timeoutMs: 60_000 })
    const checkedAt = await $.clock.now()
    if (status.exitCode !== 0) {
      const error = status.stderr.trim() || `chezmoi status exited ${status.exitCode}`
      await update($, snapshot, () => ({ entries: [], error, checkedAt }))
      return 0
    }
    const entries = parseStatus(status.stdout)
    await update($, snapshot, () => ({ entries, checkedAt }))
    return entries.length
  })().finally(() => {
    statusCheck = null
  })
  return statusCheck
}

const refresh = async ($: EngineInterface, { isOffline = true } = {}) => {
  const pending = await checkStatus($)
  await checkUpstream($, { isOffline })
  if (pending === 0) {
    await update($, summary, () => null)
    return
  }
  if (isSummarizing) return
  isSummarizing = true
  try {
    await summarize($)
  } finally {
    isSummarizing = false
  }
}

let lastRemote: { branch: string; sha: string } | null = null

const readRemote = async (git: (...args: string[]) => Promise<{ exitCode: number; stdout: string }>) => {
  const remote = await git('ls-remote', '--symref', 'origin', 'HEAD')
  const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(remote.stdout)?.[1]
  const sha = /^([0-9a-f]{40})\s+HEAD$/m.exec(remote.stdout)?.[1]
  return remote.exitCode === 0 && branch !== undefined && sha !== undefined ? { branch, sha } : null
}

const countCommits = async (git: (...args: string[]) => Promise<{ exitCode: number; stdout: string }>, range: string) => {
  const counted = await git('rev-list', '--count', range)
  return counted.exitCode === 0 ? Number(counted.stdout.trim()) : 0
}

const checkUpstream = async ($: EngineInterface, { isOffline = false } = {}) => {
  try {
    const { source } = await locate($)
    if (source === '') return
    const git = (...args: string[]) => $.process.run(['git', '-C', source, ...args], { timeoutMs: UPSTREAM_TIMEOUT_MS })

    let isReachable = true
    if (!isOffline || lastRemote === null) {
      const remote = await readRemote(git)
      isReachable = remote !== null
      lastRemote = remote ?? lastRemote
    }
    if (lastRemote === null) return
    const { branch, sha } = lastRemote

    const hasCommit = async () => (await git('cat-file', '-e', `${sha}^{commit}`)).exitCode === 0
    if (!isOffline && isReachable && !(await hasCommit())) {
      await git('fetch', '--no-tags', '--no-write-fetch-head', '--quiet', 'origin', `+refs/heads/${branch}:${FETCHED_REF_PREFIX}${branch}`)
    }
    const isFetched = await hasCommit()
    const behind = isFetched ? await countCommits(git, `HEAD..${sha}`) : null
    const ahead = await countCommits(git, `${isFetched ? sha : `refs/remotes/origin/${branch}`}..HEAD`)
    const isDirty = (await git('--no-optional-locks', 'status', '--porcelain')).stdout.trim() !== ''
    await update($, upstream, previous => ({ branch, ahead, behind, isDirty, isReachable: isOffline ? (previous?.isReachable ?? true) : isReachable }))
  } catch {
    return
  }
}

const film = {
  t: 0,
  columns: 0,
  scene: { mood: 'unknown', previous: 'unknown', start: 0, size: 1, kind: 0 } as Scene,
  pending: 0,
  reconcileStep: null as ReconcileStep | null,
  lastKey: '',
  isShowing: false,
  isBlitting: false,
  hasGraphics: true,
}

const castFilm = (mood: Mood, pending: number, reconcileStep: ReconcileStep | null) => {
  const before = film.pending
  film.pending = pending
  film.reconcileStep = reconcileStep
  if (mood === film.scene.mood) {
    if (mood === 'pending' && pending < before) film.scene = { ...film.scene, nudge: film.t }
    return
  }
  const from = film.scene
  const isHooked = from.mood === 'pending' || from.mood === 'behind' || from.mood === 'drift'
  const carried = isHooked ? { size: from.size, kind: from.kind } : { size: randomSize(film.t), kind: fishKind(film.t) }
  film.scene = { mood, previous: from.mood, start: film.t, ...carried }
}

const advanceFilm = async ($: EngineInterface) => {
  if (!film.isShowing || film.isBlitting) return
  film.isBlitting = true
  try {
    film.t += 1
    const frame = filmFrame(film.t, film.columns, film.scene, film.reconcileStep)
    if (frame.key === film.lastKey) return
    film.lastKey = frame.key
    const blitted = await $.ui.blit({ requestId: PANE, key: 'film', source: frame.source, columns: film.columns, rows: FILM_ROWS })
    if (blitted.deny === undefined) return
    film.lastKey = ''
    film.isShowing = false
    if (blitted.deny.includes('alt')) {
      film.hasGraphics = false
      $.ui.invalidate('ui.render')
    }
  } finally {
    film.isBlitting = false
  }
}

const COMMAND_TIMEOUT_MS = 120_000
const UNINSTALL_TIMEOUT_MS = 600_000
const LABEL_WIDTH = '[MACHINE] '.length

const paths = { source: null as string | null, home: null as string | null }

const locate = async ($: EngineInterface) => {
  paths.source ??= (await $.process.run(['chezmoi', 'source-path'])).stdout.trim()
  paths.home ??= (await $.process.run(['chezmoi', 'target-path'])).stdout.trim()
  return { source: paths.source, home: paths.home }
}

const setReconcile = ($: EngineInterface, change: (current: Reconcile) => Reconcile) =>
  update($, reconcile, current => (current === null ? null : change(current)))

const busy = async ($: EngineInterface, label: string, work: () => Promise<void>) => {
  const current = await read($, reconcile)
  if (current === null || current.busy !== null) return
  await setReconcile($, r => ({ ...r, busy: label, isConfirming: false }))
  try {
    await work()
  } catch (error) {
    await setReconcile($, r => ({ ...r, note: note(error instanceof Error ? error.message : String(error), 'error') }))
  } finally {
    await setReconcile($, r => ({ ...r, busy: null }))
  }
}

const loadFiles = async ($: EngineInterface) => {
  const { source, home } = await locate($)
  const diff = await $.process.run(['bash', `${source}/.claude/skills/reconcile/rich-diff.sh`], { timeoutMs: COMMAND_TIMEOUT_MS })
  const found = parseRichDiff(diff.stdout)
  const scripts = new Set((await read($, snapshot))?.entries.filter(isScript).map(entry => entry.path))
  const files: DriftedFile[] = []
  for (const file of found) {
    const sourceFile = await $.process.run(['chezmoi', 'source-path', `${home}/${file.path}`])
    files.push({ ...file, isTemplate: sourceFile.stdout.trim().endsWith('.tmpl'), isScript: scripts.has(file.path) })
  }
  await setReconcile($, r => ({ ...r, step: files.length > 0 ? 'files' : 'done', files, cursor: 0, note: null }))
}

const loadPackages = async ($: EngineInterface) => {
  const { source } = await locate($)
  const diff = await $.process.run(['bash', `${source}/.claude/skills/reconcile/brew-diff.sh`], { timeoutMs: COMMAND_TIMEOUT_MS })
  if (diff.exitCode === 1) {
    await setReconcile($, r => ({ ...r, note: note('Homebrew is not installed; skipping packages', 'warn') }))
    await loadFiles($)
    return
  }
  const { profile, missing, packages } = parseBrewDiff(diff.stdout)
  await setReconcile($, r => ({ ...r, step: 'packages', profile, missing, packages, cursor: 0 }))
  if (packages.length === 0) await loadFiles($)
}

const advance = async ($: EngineInterface, list: 'packages' | 'files') => {
  const current = await read($, reconcile)
  if (current === null) return
  const next = current.cursor + 1
  if (next < current[list].length) {
    await setReconcile($, r => ({ ...r, cursor: next }))
    return
  }
  if (list === 'packages') await loadFiles($)
  else await setReconcile($, r => ({ ...r, step: 'done' }))
}

const startReconcile = async ($: EngineInterface) => {
  await update($, reconcile, (): Reconcile => ({
    step: 'pull',
    busy: null,
    note: null,
    isBlocked: false,
    profile: 'common',
    missing: [],
    packages: [],
    files: [],
    cursor: 0,
    isConfirming: false,
  }))
}

const closeReconcile = ($: EngineInterface) => update($, reconcile, () => null)

const pullFromOrigin = ($: EngineInterface) =>
  busy($, 'jj git fetch', async () => {
    const { source } = await locate($)
    const jj = (...args: string[]) => $.process.run(['jj', '-R', source, ...args], { timeoutMs: COMMAND_TIMEOUT_MS })
    const fetched = await jj('git', 'fetch')
    if (fetched.exitCode !== 0) {
      await setReconcile($, r => ({ ...r, isBlocked: true, note: note(`fetch failed: ${firstLine(fetched)}`, 'error') }))
      return
    }
    const bookmark = await jj('bookmark', 'list', 'main')
    if (/conflict|\?\?/i.test(bookmark.stdout)) {
      await setReconcile($, r => ({ ...r, isBlocked: true, note: note('main diverged from origin', 'warn') }))
      return
    }
    await setReconcile($, r => ({ ...r, busy: 'jj rebase -b @ -d main' }))
    const rebased = await jj('rebase', '-b', '@', '-d', 'main')
    const conflicts = await jj('log', '-r', 'conflicts()', '--no-graph', '-T', 'change_id.short() ++ "\\n"')
    if (rebased.exitCode !== 0 || conflicts.stdout.trim() !== '') {
      const problem = rebased.exitCode !== 0 ? `rebase failed: ${firstLine(rebased)}` : 'rebase left conflicts'
      await setReconcile($, r => ({ ...r, isBlocked: true, note: note(problem, 'error') }))
      return
    }
    await setReconcile($, r => ({ ...r, note: note('up to date with origin'), busy: 'checking packages' }))
    await loadPackages($)
  })

const skipPull = ($: EngineInterface) =>
  busy($, 'checking packages', async () => {
    await setReconcile($, r => ({ ...r, isBlocked: false, note: null }))
    await loadPackages($)
  })

const askAboutPull = ($: EngineInterface) =>
  $.prompt.submit({
    text: "The chezmoi-status reconcile could not bring the dotfiles repo up to date with origin. Look at `jj bookmark list main`, `jj log -r '::@ ~ ::main@origin'`, `jj log -r '::main@origin ~ ::@'` and any conflicts, explain what happened, and ask me how to proceed (rebase onto main@origin, merge, or pause).",
  })

const decidePackage = ($: EngineInterface, decision: PackageDecision, scope = 'common') =>
  busy($, decision === 'uninstalled' ? 'brew uninstall' : `${decision} package`, async () => {
    const current = await read($, reconcile)
    const item = current?.packages[current.cursor]
    if (!current || !item) return
    const { source } = await locate($)
    if (decision === 'added') {
      const file = `${source}/.chezmoidata/packages.yaml`
      await $.fs.write(file, addToPackages(await $.fs.read(file), item.kind, scope, item.name))
    }
    if (decision === 'ignored') {
      const file = `${source}/.brew-ignored`
      const existing = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
      await $.fs.write(file, `${existing}${existing === '' || existing.endsWith('\n') ? '' : '\n'}${item.name}\n`)
    }
    if (decision === 'uninstalled') {
      const argv = item.kind === 'tap' ? ['brew', 'untap', item.name] : item.kind === 'cask' ? ['brew', 'uninstall', '--cask', item.name] : ['brew', 'uninstall', item.name]
      const removed = await $.process.run(argv, { timeoutMs: UNINSTALL_TIMEOUT_MS })
      if (removed.exitCode !== 0) {
        await setReconcile($, r => ({ ...r, note: note(`${argv.join(' ')} failed: ${firstLine(removed)}`, 'error') }))
        return
      }
    }
    await setReconcile($, r => ({ ...r, note: null, packages: r.packages.map((one, i) => (i === r.cursor ? { ...one, decision, scope: decision === 'added' ? scope : null } : one)) }))
    await advance($, 'packages')
  })

const ignoreRemainingPackages = ($: EngineInterface) =>
  busy($, 'ignoring packages', async () => {
    const current = await read($, reconcile)
    if (!current) return
    const { source } = await locate($)
    const file = `${source}/.brew-ignored`
    const remaining = current.packages.slice(current.cursor)
    const existing = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
    const prefix = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`
    await $.fs.write(file, `${prefix}${remaining.map(one => `${one.name}\n`).join('')}`)
    await setReconcile($, r => ({ ...r, packages: r.packages.map((one, i) => (i >= r.cursor ? { ...one, decision: 'ignored' } : one)) }))
    await loadFiles($)
  })

const confirmUninstall = ($: EngineInterface) => setReconcile($, r => ({ ...r, isConfirming: true }))

const cancelUninstall = ($: EngineInterface) => setReconcile($, r => ({ ...r, isConfirming: false }))

const decideFile = ($: EngineInterface, decision: FileDecision) =>
  busy($, decision === 'applied' ? 'chezmoi apply' : decision === 'kept' ? 'chezmoi add' : 'next file', async () => {
    const current = await read($, reconcile)
    const file = current?.files[current.cursor]
    if (!current || !file) return
    const { home } = await locate($)
    const target = `${home}/${file.path}`
    const command = decision === 'applied' ? ['chezmoi', 'apply', '--force', target] : decision === 'kept' ? ['chezmoi', 'add', target] : null
    if (command) {
      const ran = await $.process.run(command, { timeoutMs: COMMAND_TIMEOUT_MS })
      if (ran.exitCode !== 0) {
        await setReconcile($, r => ({ ...r, note: note(`${command.slice(0, 2).join(' ')} failed: ${firstLine(ran)}`, 'error') }))
        return
      }
    }
    if (decision === 'merging') {
      const templateNote = file.isTemplate ? ', and keep the template expressions intact when editing the repo file' : ''
      await $.prompt.submit({
        text: `Help me merge ~/${file.path} with the chezmoi repo. Run the reconcile skill's rich-diff.sh for this path to see both sides${templateNote}. Ask whether the change should apply to all profiles or only the "${current.profile}" profile before editing.`,
      })
    }
    await setReconcile($, r => ({ ...r, note: null, files: r.files.map((one, i) => (i === r.cursor ? { ...one, decision } : one)) }))
    await advance($, 'files')
  })

const installMissing = ($: EngineInterface) =>
  busy($, 'running chezmoi scripts', async () => {
    const ran = await $.process.run(['chezmoi', 'apply', '--force', '--include', 'scripts'], { timeoutMs: UNINSTALL_TIMEOUT_MS })
    await setReconcile($, r => ({
      ...r,
      missing: ran.exitCode === 0 ? [] : r.missing,
      note: ran.exitCode === 0 ? note('missing packages installed') : note(`install failed: ${firstLine(ran)}`, 'error'),
    }))
  })

const FILE_SUMMARY_SYSTEM = [
  'You explain one drifted dotfile to its owner, who must choose between applying the repo version and keeping the version on this machine.',
  'Lines labelled [MACHINE] exist only on this machine, lines labelled [REPO] only in the repo, and unlabelled lines are shared context.',
  'In at most two short sentences, say in plain terms what actually differs. Do not repeat the labels or the file name.',
].join(' ')

const setFileSummary = ($: EngineInterface, path: string, summary: FileSummary) =>
  setReconcile($, r => ({ ...r, files: r.files.map(one => (one.path === path ? { ...one, summary } : one)) }))

const isPackageScript = (file: DriftedFile) => file.isScript && file.path.endsWith('install-packages.sh')

const summarizeCurrentFile = async ($: EngineInterface) => {
  const current = await read($, reconcile)
  const file = current?.step === 'files' ? current.files[current.cursor] : undefined
  if (!file || file.summary !== null || isPackageScript(file)) return
  await setFileSummary($, file.path, { text: '', isLoading: true })
  try {
    const { source, home } = await locate($)
    const diff = await $.process.run(['bash', `${source}/.claude/skills/reconcile/rich-diff.sh`, `${home}/${file.path}`], {
      timeoutMs: COMMAND_TIMEOUT_MS,
    })
    const reply = await $.model.complete({
      model: 'haiku',
      system: FILE_SUMMARY_SYSTEM,
      prompt: diff.stdout.slice(0, MAX_DIFF_CHARS),
      maxTokens: 200,
      effort: 'low',
      timeoutMs: 30_000,
    })
    await setFileSummary($, file.path, reply.isAnswered ? { text: reply.text.trim(), isLoading: false } : { text: '', isLoading: false, error: reply.reason })
  } catch (error) {
    await setFileSummary($, file.path, { text: '', isLoading: false, error: error instanceof Error ? error.message : String(error) })
  }
}

const later = ($: EngineInterface, work: () => Promise<unknown>) => {
  $.clock.after(1, () => void work())
}

const refreshSoon = ($: EngineInterface) => later($, () => refresh($, { isOffline: false }))

const reconcilePull = ($: EngineInterface) =>
  later($, async () => {
    await pullFromOrigin($)
    await refresh($)
    await summarizeCurrentFile($)
  })

const reconcileSkipPull = ($: EngineInterface) =>
  later($, async () => {
    await skipPull($)
    await summarizeCurrentFile($)
  })

const reconcilePackage = ($: EngineInterface, decision: PackageDecision, scope?: string) =>
  later($, async () => {
    await decidePackage($, decision, scope)
    await refresh($)
    await summarizeCurrentFile($)
  })

const reconcileIgnoreRest = ($: EngineInterface) =>
  later($, async () => {
    await ignoreRemainingPackages($)
    await refresh($)
    await summarizeCurrentFile($)
  })

const reconcileFile = ($: EngineInterface, decision: FileDecision) =>
  later($, async () => {
    await decideFile($, decision)
    await refresh($)
    await summarizeCurrentFile($)
  })

const reconcileInstall = ($: EngineInterface) =>
  later($, async () => {
    await installMissing($)
    await refresh($)
  })

const pushMain = ($: EngineInterface) =>
  later($, async () => {
    if ((await read($, push))?.busy) return
    await update($, push, () => ({ busy: 'jj bookmark set main -r @-', note: null }))
    const { source } = await locate($)
    const jj = (...args: string[]) => $.process.run(['jj', '-R', source, ...args], { timeoutMs: COMMAND_TIMEOUT_MS })
    const moved = await jj('bookmark', 'set', 'main', '-r', '@-')
    if (moved.exitCode !== 0) {
      await update($, push, () => ({ busy: null, note: note(`couldn't move main: ${firstLine(moved)}`, 'error') }))
      return
    }
    await update($, push, () => ({ busy: 'jj git push', note: null }))
    const pushed = await jj('git', 'push', '--bookmark', 'main')
    await update($, push, () => ({ busy: null, note: pushed.exitCode === 0 ? note('pushed main to origin') : note(`push failed: ${firstLine(pushed)}`, 'error') }))
    await refresh($, { isOffline: false })
  })

const commitAndPush = ($: EngineInterface) =>
  later($, async () => {
    const { source } = await locate($)
    await $.prompt.submit({
      text: `Commit and push the unpushed work in my chezmoi repo at ${source}. Review the diff for secrets first, describe it following my commit conventions (split it if it spans more than one logical change), then move the main bookmark to the new commit and push it.`,
    })
  })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chezmoi-status',
      description: 'Show chezmoi status and an AI summary of the pending diff in a pane',
    })
    void $.ui.open({ id: PANE, title: 'chezmoi status' })
    $.clock.every(POLL_MS, () => void refresh($))
    $.clock.every(FILM_TICK_MS, () => void advanceFilm($))
    $.clock.every(UPSTREAM_POLL_MS, () => void refresh($, { isOffline: false }))
    $.clock.after(1, () => void refresh($, { isOffline: false }))

    return next(e)
  })

  on('command.run', { command: 'chezmoi-status' }, async $ => {
    await $.ui.open({ id: PANE, title: 'chezmoi status' })
    refreshSoon($)

    return { text: 'chezmoi status pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    $.clock.after(1, () => void refresh($))

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = elements
    const current = await read($, snapshot)
    const currentSummary = await read($, summary)
    const currentUpstream = await read($, upstream)
    const wizard = await read($, reconcile)
    const isDocked = e.props.placement === 'dock'
    const filmColumns = Math.min(255, e.props.bodyColumns)
    film.isShowing = isDocked && film.hasGraphics && e.surface === 'terminal' && filmColumns > 0
    film.columns = filmColumns
    castFilm(moodOf(current, currentUpstream), current?.entries.length ?? 0, wizard?.step ?? null)
    const frame = film.isShowing ? filmFrame(film.t, filmColumns, film.scene, film.reconcileStep) : null
    film.lastKey = frame?.key ?? ''

    const clawd =
      frame && 'Image' in elements ? (
        <elements.Image key="film" source={frame.source} columns={filmColumns} rows={FILM_ROWS} alt="Clawd fishing by the pond" />
      ) : isDocked && 'Client' in elements ? (
        <elements.Client key="clawd" module="./clawd.tsx" props={{ scene: film.scene, reconcileStep: film.reconcileStep }} height={FILM_ROWS} />
      ) : null

    const badges = [...statusBadges(current), ...repoBadges(currentUpstream)]
    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {badges.map(badge => (
            <Text color={badge.color} dimColor={badge.isDim} bold={badge.isBold}>
              {badge.text}
            </Text>
          ))}
        </Box>
        <Box flexDirection="row" gap={1}>
          {current && <Text dimColor>{formatTime(current.checkedAt)}</Text>}
          <Button key="refresh" hotkey="r" plain onPress={() => refreshSoon($)}>
            ↻
          </Button>
        </Box>
      </Box>
    )

    const pushing = await read($, push)
    const unpushed = currentUpstream && currentUpstream.isReachable ? currentUpstream : null
    const pushAction = unpushed?.isDirty ? (
      <Button key="commit-push" hotkey="p" onPress={() => commitAndPush($)}>
        Commit & push with Claude
      </Button>
    ) : unpushed && unpushed.ahead > 0 ? (
      <Button key="push" hotkey="p" onPress={() => pushMain($)}>
        {`Push ${plural(unpushed.ahead, 'commit')}`}
      </Button>
    ) : null

    const reconcileButton = wizard === null && (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="reconcile" hotkey="c" onPress={() => startReconcile($)}>
            Reconcile
          </Button>
          {pushing?.busy ? <Text dimColor>⋯ {pushing.busy}</Text> : pushAction}
        </Box>
        {pushing?.note && <Text color={pushing.note.tone === 'error' ? 'red' : 'green'}>{pushing.note.text}</Text>}
      </Box>
    )

    const statusList = current && current.entries.length > 0 && (
      <Box flexDirection="column">
        {current.entries.map(entry => {
          const glyph = entryGlyph(entry)
          return (
            <Box flexDirection="row" gap={1}>
              <Text color={glyph.color} bold>
                {glyph.text}
              </Text>
              <Text wrap="truncate-start">{entry.path}</Text>
              {isEditedHere(entry) && <Text color="yellow">✎ edited here</Text>}
            </Box>
          )
        })}
      </Box>
    )

    const summaryView = currentSummary && (
      <Box flexDirection="column">
        <Text dimColor>✦ summary</Text>
        {currentSummary.isLoading && currentSummary.text === '' && <Text dimColor>summarizing…</Text>}
        {currentSummary.error !== undefined && <Text color="red">summary failed: {currentSummary.error}</Text>}
        {currentSummary.text !== '' && <Markdown text={currentSummary.text} dimColor={currentSummary.isLoading} />}
      </Box>
    )

    const step = (label: string, index: number) => {
      const order = ['pull', 'packages', 'files', 'done']
      const at = wizard ? order.indexOf(wizard.step) : 0
      return (
        <Text bold={index === at} dimColor={index !== at} color={index < at ? 'green' : undefined}>
          {index < at ? `✓ ${label}` : label}
        </Text>
      )
    }

    const choices = (items: { key: string; label: string; hotkey: string; isSuggested?: boolean; onPress: () => unknown }[]) => (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {items.map(item => (
          <Button key={item.key} hotkey={item.hotkey} variant={item.isSuggested ? 'primary' : 'secondary'} onPress={item.onPress}>
            {item.label}
          </Button>
        ))}
      </Box>
    )

    const wizardBody = (() => {
      if (wizard === null) return null
      if (wizard.busy !== null) return <Text dimColor>⋯ {wizard.busy}</Text>

      if (wizard.step === 'pull') {
        return (
          <Box flexDirection="column">
            <Text dimColor>Move your work onto the latest main from origin.</Text>
            {wizard.isBlocked
              ? choices([
                  { key: 'reconcile-ask', label: 'Ask Claude', hotkey: 'a', isSuggested: true, onPress: () => askAboutPull($) },
                  { key: 'reconcile-skip', label: 'Skip', hotkey: 's', onPress: () => reconcileSkipPull($) },
                ])
              : choices([
                  { key: 'reconcile-pull', label: 'Rebase onto main', hotkey: 'b', isSuggested: true, onPress: () => reconcilePull($) },
                  { key: 'reconcile-skip', label: 'Skip', hotkey: 's', onPress: () => reconcileSkipPull($) },
                ])}
          </Box>
        )
      }

      if (wizard.step === 'packages') {
        const item = wizard.packages[wizard.cursor]
        if (!item) return null
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{item.kind}</Text>
              <Text bold>{item.name}</Text>
              <Text dimColor>
                installed, not in the repo · {wizard.cursor + 1}/{wizard.packages.length}
              </Text>
            </Box>
            {wizard.isConfirming
              ? choices([
                  { key: 'reconcile-uninstall-yes', label: `Uninstall ${item.name}`, hotkey: 'y', onPress: () => reconcilePackage($, 'uninstalled') },
                  { key: 'reconcile-uninstall-no', label: 'Cancel', hotkey: 'n', isSuggested: true, onPress: () => cancelUninstall($) },
                ])
              : choices([
                  { key: 'reconcile-add-common', label: 'Add for all', hotkey: 'a', onPress: () => reconcilePackage($, 'added', 'common') },
                  ...(wizard.profile !== 'common'
                    ? [{ key: 'reconcile-add-profile', label: `Add for ${wizard.profile}`, hotkey: 'p', onPress: () => reconcilePackage($, 'added', wizard.profile) }]
                    : []),
                  { key: 'reconcile-ignore', label: 'Ignore', hotkey: 'i', onPress: () => reconcilePackage($, 'ignored') },
                  { key: 'reconcile-uninstall', label: 'Uninstall', hotkey: 'u', onPress: () => confirmUninstall($) },
                  { key: 'reconcile-skip', label: 'Skip', hotkey: 's', onPress: () => reconcilePackage($, 'skipped') },
                  ...(wizard.packages.length - wizard.cursor > 1
                    ? [{ key: 'reconcile-ignore-rest', label: 'Ignore rest', hotkey: 'g', onPress: () => reconcileIgnoreRest($) }]
                    : []),
                ])}
          </Box>
        )
      }

      if (wizard.step === 'files') {
        const file = wizard.files[wizard.cursor]
        if (!file) return null
        const declared = wizard.packages.filter(item => item.decision === 'added')
        const packageLines = [
          wizard.missing.length > 0 ? `installs ${wizard.missing.map(ref => ref.name).join(', ')}` : '',
          declared.length > 0 ? `newly declared, already installed: ${declared.map(item => `${item.name} (${item.scope === 'common' ? 'all' : item.scope})`).join(', ')}` : '',
        ].filter(Boolean)
        const summaryLine = isPackageScript(file) ? null : file.summary === null || file.summary.isLoading ? (
          <Text dimColor>✦ summarizing…</Text>
        ) : file.summary.error !== undefined ? (
          <Text dimColor>✦ no summary ({file.summary.error})</Text>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Text color="magenta">✦</Text>
            <Text>{file.summary.text}</Text>
          </Box>
        )
        return (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" gap={1}>
              <Text bold wrap="truncate-start">
                {file.isScript ? file.path.replace(/^\.chezmoiscripts\//, '') : `~/${file.path}`}
              </Text>
              <Text dimColor>
                {file.isScript ? 'script · runs on the next apply' : DIRECTION_LABELS[file.direction]}
                {file.isTemplate && !file.isScript ? ' · template' : ''} · {wizard.cursor + 1}/{wizard.files.length}
              </Text>
            </Box>
            {isPackageScript(file) ? (
              <Box flexDirection="column">
                {(packageLines.length > 0 ? packageLines : ['the package list changed; nothing new to install']).map(line => (
                  <Text color="cyan">{`📦 ${line}`}</Text>
                ))}
              </Box>
            ) : (
              <Box flexDirection="column">
                {file.preview.map(line => {
                  const isMachine = line.startsWith('[MACHINE]')
                  return (
                    <Text color={isMachine ? 'cyan' : 'yellow'} wrap="truncate-end">
                      {isMachine ? 'machine │' : 'repo    │'}
                      {` ${line.slice(LABEL_WIDTH)}`}
                    </Text>
                  )
                })}
              </Box>
            )}
            {file.isScript
              ? choices([
                  { key: 'reconcile-apply', label: 'Run script', hotkey: 'a', isSuggested: true, onPress: () => reconcileFile($, 'applied') },
                  { key: 'reconcile-skip', label: 'Skip', hotkey: 's', onPress: () => reconcileFile($, 'skipped') },
                ])
              : choices([
                  { key: 'reconcile-apply', label: 'Apply repo', hotkey: 'a', isSuggested: file.direction === 'REPO_NEWER', onPress: () => reconcileFile($, 'applied') },
                  ...(file.isTemplate
                    ? []
                    : [{ key: 'reconcile-keep', label: 'Keep machine', hotkey: 'k', isSuggested: file.direction === 'MACHINE_NEWER', onPress: () => reconcileFile($, 'kept') }]),
                  {
                    key: 'reconcile-merge',
                    label: 'Merge with Claude',
                    hotkey: 'm',
                    isSuggested: file.isTemplate && file.direction === 'MACHINE_NEWER',
                    onPress: () => reconcileFile($, 'merging'),
                  },
                  { key: 'reconcile-skip', label: 'Skip', hotkey: 's', onPress: () => reconcileFile($, 'skipped') },
                ])}
            {summaryLine}
          </Box>
        )
      }

      const filesDone = countBy(wizard.files.map(file => file.decision))
      const packagesDone = countBy(wizard.packages.map(item => item.decision))
      const isRepoChanged = (filesDone.kept ?? 0) + (packagesDone.added ?? 0) + (packagesDone.ignored ?? 0) > 0
      return (
        <Box flexDirection="column">
          <Text>{wizard.files.length > 0 ? `files: ${describeCounts(filesDone, FILE_OUTCOMES)}` : 'files: nothing to reconcile'}</Text>
          {wizard.packages.length > 0 && <Text>{`packages: ${describeCounts(packagesDone, PACKAGE_OUTCOMES)}`}</Text>}
          {isRepoChanged && <Text color="cyan">The repo changed; commit it with jj when you're happy.</Text>}
          {choices([
            ...(wizard.missing.length > 0
              ? [{ key: 'reconcile-install', label: `Install ${wizard.missing.map(ref => ref.name).join(', ')}`, hotkey: 'i', onPress: () => reconcileInstall($) }]
              : []),
            { key: 'reconcile-close', label: 'Done', hotkey: 'd', isSuggested: true, onPress: () => closeReconcile($) },
          ])}
        </Box>
      )
    })()

    const wizardView = wizard && (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={1}>
            <Text bold>Reconcile</Text>
            {step('rebase', 0)}
            <Text dimColor>›</Text>
            {step('packages', 1)}
            <Text dimColor>›</Text>
            {step('files', 2)}
            <Text dimColor>›</Text>
            {step('done', 3)}
          </Box>
          {wizard.step !== 'done' && wizard.busy === null && (
            <Button key="reconcile-cancel" hotkey="x" plain onPress={() => closeReconcile($)}>
              ✕
            </Button>
          )}
        </Box>
        {wizard.step === 'packages' && wizard.missing.length > 0 && (
          <Text dimColor>{`${plural(wizard.missing.length, 'missing package')} will install on the next apply`}</Text>
        )}
        {wizardBody}
        {wizard.note && (
          <Text color={wizard.note.tone === 'error' ? 'red' : wizard.note.tone === 'warn' ? 'yellow' : 'green'}>{wizard.note.text}</Text>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {clawd}
        {header}
        {reconcileButton}
        {current?.error !== undefined && (
          <Text color="red" wrap="truncate-end">
            {current.error}
          </Text>
        )}
        {wizardView ?? statusList}
        {wizard === null && summaryView}
      </Box>
    )
  })
}
