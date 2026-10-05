import { expect, mock, test } from 'claude-code/testing'

import { describe, filmFrame, randomSize } from '../hooks/film'
import { addToPackages, parseBrewDiff, parseRichDiff } from '../hooks/reconcile'
import { parseStatus } from '../hooks/status'

const PANE = {
  plugin: 'chezmoi-status',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'chezmoi-status',
  props: {
    title: 'chezmoi status',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const
const DESKTOP = { ...PANE, surface: 'desktop', viewport: { columns: 60, rows: 30, isFullscreen: true } } as const

const STATUS = ' M .config/fish/config.fish\n A .gitconfig\n'
const EDITED_STATUS = 'MM .config/fish/config.fish\n'
const DIFF = [
  'diff --git a/.config/fish/config.fish b/.config/fish/config.fish',
  '--- a/.config/fish/config.fish',
  '+++ b/.config/fish/config.fish',
  '@@ -1,2 +1,2 @@',
  '-set -gx EDITOR vim',
  '+set -gx EDITOR nvim',
].join('\n')
const BREW_DIFF = 'PROFILE: personal\nEXTRA FORMULA: swiftlint\nEXTRA CASK: zoom\nMISSING CASK: raycast\nSUMMARY: missing=1 extra=2 ignored=36\n'
const RICH_DIFF = [
  'SUMMARY: files=1 machine_newer=1 repo_newer=0 same_time=0 new_file=0',
  '=== .config/fish/config.fish (MACHINE_NEWER) ===',
  '@@ -1,2 +1,2 @@',
  '          # fish',
  '[MACHINE] set -gx EDITOR vim',
  '[REPO]    set -gx EDITOR nvim',
].join('\n')
const PACKAGES_YAML = [
  'packages:',
  '  taps:',
  '    common:',
  '      - hashicorp/tap',
  '    work: []',
  '  formulae:',
  '    common:',
  '      - bat',
  '      - fd',
  '    personal:',
  '      - helm',
  '  casks:',
  '    common:',
  '      - firefox',
].join('\n')
const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const REMOTE_SHA = 'a'.repeat(40)

const ran = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

type Repo = { isKnown?: boolean; status?: string; behind?: string; ahead?: string; porcelain?: string; isOnline?: boolean; bookmark?: string; richDiff?: string }

const answer = (argv: readonly string[], repo: Repo) => {
  const call = argv.join(' ')
  if (call === 'chezmoi status') return ran(repo.status ?? '')
  if (call === 'chezmoi source-path') return ran('/src\n')
  if (call === 'chezmoi target-path') return ran('/home\n')
  if (call.startsWith('chezmoi source-path /home/')) return ran(`/src/${argv[2]!.slice(6)}\n`)
  if (call.startsWith('chezmoi diff')) return ran(DIFF)
  if (call.endsWith('brew-diff.sh')) return ran(BREW_DIFF)
  if (call.endsWith('rich-diff.sh')) return ran(repo.richDiff ?? RICH_DIFF)
  if (call.includes('bookmark list main')) return ran(repo.bookmark ?? 'main: abc123 feat: something\n')
  if (argv[0] !== 'git') return ran('')
  if (call.includes('ls-remote')) return repo.isOnline === false ? ran('', 128) : ran(`ref: refs/heads/main\tHEAD\n${REMOTE_SHA}\tHEAD\n`)
  if (call.includes(`HEAD..${REMOTE_SHA}`)) return ran(repo.behind ?? '0\n')
  if (call.includes(`${REMOTE_SHA}..HEAD`)) return ran(repo.ahead ?? '0\n')
  if (call.includes('status --porcelain')) return ran(repo.porcelain ?? '')
  if (call.includes('cat-file')) return ran('', repo.isKnown === false ? 1 : 0)
  return ran('')
}

const summaryReply = async () => ({ value: { isAnswered: true as const, text: '- fish: EDITOR becomes nvim', usage: USAGE } })

test('parseStatus splits each line into its two-column code and path', async () => {
  const entries = parseStatus(STATUS)

  expect(entries).toEqual([
    { code: ' M', path: '.config/fish/config.fish' },
    { code: ' A', path: '.gitconfig' },
  ])
})

test('the header counts files to apply', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { status: STATUS }))
  on('model.complete', summaryReply)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const badge = await ui.find({ type: 'Text', text: '● 2 files to apply' })
  expect(badge).toBeDefined()
})

test('each pending path is listed with a glyph for its change', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { status: STATUS }))
  on('model.complete', summaryReply)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const added = await ui.find({ type: 'Text', text: '+' })
  expect(added?.props.color).toBe('green')
})

test('refreshing shows the model summary in the pane', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { status: STATUS }))
  on('model.complete', summaryReply)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const summary = await ui.find({ type: 'Markdown' })
  expect(summary?.props.text).toBe('- fish: EDITOR becomes nvim')
})

test('a clean status shows an in-sync badge', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const badge = await ui.find({ type: 'Text', text: '✓ in sync' })
  expect(badge).toBeDefined()
})

test('the header flags files edited on this machine', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { status: EDITED_STATUS }))
  on('model.complete', summaryReply)
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const badge = await ui.find({ type: 'Text', text: '✎ 1 edited here' })
  expect(badge).toBeDefined()
})

test('the header shows how far the working copy is behind origin', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { behind: '2\n' }))
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const badge = await ui.find({ type: 'Text', text: '↓2' })
  expect(badge).toBeDefined()
})

test('the header counts commits that are not on origin', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { ahead: '1\n' }))
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const badge = await ui.find({ type: 'Text', text: '↑1' })
  expect(badge).toBeDefined()
})

test('the header notices uncommitted edits in the repo', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { porcelain: ' M CLAUDE.md\n' }))
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const badge = await ui.find({ type: 'Text', text: '± wip' })
  expect(badge).toBeDefined()
})

test('the header marks origin as offline when it cannot be reached', async ($, on) => {
  const clock = mock.clock(on)
  let isOnline = true
  on('process.run', async (_$, e) => answer(e.argv, { behind: '2\n', isOnline }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'refresh' })
  await clock.advance(1)
  isOnline = false

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const badge = await ui.find({ type: 'Text', text: 'offline' })
  expect(badge).toBeDefined()
})

test('an unreachable origin hides the stale behind count', async ($, on) => {
  const clock = mock.clock(on)
  let isOnline = true
  on('process.run', async (_$, e) => answer(e.argv, { behind: '2\n', isOnline }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'refresh' })
  await clock.advance(1)
  isOnline = false

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const badge = await ui.find({ type: 'Text', text: '↓2' })
  expect(badge).toBeUndefined()
})

test('a docked terminal pane shows the Clawd film as an image', async ($, on) => {
  mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))

  const ui = await $.ui.mount({ ...PANE, viewport: { columns: 60, rows: 30, isFullscreen: true } })

  const film = await ui.find({ type: 'Image', key: 'film' })
  expect(film).toBeDefined()
})

test('an inline pane leaves Clawd out', async ($, on) => {
  mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'inline' } })

  const clawd = await ui.find({ type: 'Client' })
  const film = await ui.find({ type: 'Image' })
  expect([clawd, film]).toEqual([undefined, undefined])
})

test('a docked desktop pane draws Clawd in text', async ($, on) => {
  mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))

  const ui = await $.ui.mount(DESKTOP)

  const clawdHead = await ui.find({ in: 'clawd', text: /▐▛███▜▌/ })
  expect(clawdHead).toBeDefined()
})

test('parseBrewDiff reads the profile, each missing package and each extra package', async () => {
  const parsed = parseBrewDiff(BREW_DIFF)

  expect(parsed).toEqual({
    profile: 'personal',
    missing: [{ kind: 'cask', name: 'raycast' }],
    packages: [
      { kind: 'formula', name: 'swiftlint', decision: null, scope: null },
      { kind: 'cask', name: 'zoom', decision: null, scope: null },
    ],
  })
})

test('parseRichDiff keeps each file with its direction and labelled lines', async () => {
  const files = parseRichDiff(RICH_DIFF)

  expect(files).toEqual([
    { path: '.config/fish/config.fish', direction: 'MACHINE_NEWER', preview: ['[MACHINE] set -gx EDITOR vim', '[REPO]    set -gx EDITOR nvim'], decision: null, summary: null },
  ])
})

test('addToPackages inserts a package in alphabetical order', async () => {
  const yaml = addToPackages(PACKAGES_YAML, 'formula', 'common', 'eza')

  expect(yaml).toContain('      - bat\n      - eza\n      - fd')
})

test('addToPackages files a package under the profile list', async () => {
  const yaml = addToPackages(PACKAGES_YAML, 'formula', 'personal', 'swiftlint')

  expect(yaml).toContain('    personal:\n      - helm\n      - swiftlint')
})

test('addToPackages fills an empty list', async () => {
  const yaml = addToPackages(PACKAGES_YAML, 'tap', 'work', 'acme/tap')

  expect(yaml).toContain('    work:\n      - acme/tap')
})

test('the reconcile button opens the pull step', async ($, on) => {
  mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'reconcile' })

  const pull = await ui.find({ key: 'reconcile-pull' })
  expect(pull).toBeDefined()
})

test('fetch and rebase runs jj before comparing packages', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  on('process.run', async (_$, e) => {
    calls.push(e.argv.join(' '))
    return answer(e.argv, {})
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })

  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  const jjCalls = calls.filter(call => call.startsWith('jj -R /src git fetch') || call.startsWith('jj -R /src rebase -b @ -d main'))
  expect(jjCalls).toEqual(['jj -R /src git fetch', 'jj -R /src rebase -b @ -d main'])
})

test('a diverged main stops the pull and offers Claude', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { bookmark: 'main (conflicted):\n  - abc\n  + def\n' }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })

  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  const ask = await ui.find({ key: 'reconcile-ask' })
  expect(ask).toBeDefined()
})

test('after pulling the first extra package is up for a decision', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })

  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  const name = await ui.find({ type: 'Text', text: 'swiftlint' })
  expect(name).toBeDefined()
})

test('ignoring a package appends it to .brew-ignored', async ($, on) => {
  const clock = mock.clock(on)
  const writes: { path: string; text: string }[] = []
  on('process.run', async (_$, e) => answer(e.argv, {}))
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ value: 'aom\n' }))
  on('fs.write', async (_$, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-ignore' })
  await clock.advance(1)

  expect(writes).toEqual([{ path: '/src/.brew-ignored', text: 'aom\nswiftlint\n' }])
})

test('uninstall asks for confirmation before running brew', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  on('process.run', async (_$, e) => {
    calls.push(e.argv.join(' '))
    return answer(e.argv, {})
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-uninstall' })

  const brewCalls = calls.filter(call => call.startsWith('brew uninstall'))
  const confirm = await ui.find({ key: 'reconcile-uninstall-yes' })
  expect([brewCalls, confirm === undefined]).toEqual([[], false])
})

test('confirming uninstall removes the formula', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  on('process.run', async (_$, e) => {
    calls.push(e.argv.join(' '))
    return answer(e.argv, {})
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile-uninstall' })

  await ui.press({ key: 'reconcile-uninstall-yes' })
  await clock.advance(1)

  expect(calls).toContain('brew uninstall swiftlint')
})

test('after the packages each drifted file shows both sides', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  const machine = await ui.find({ type: 'Text', text: /machine │ set -gx EDITOR vim/ })
  expect(machine).toBeDefined()
})

test('a machine-newer file suggests keeping the machine version', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  const keep = await ui.find({ key: 'reconcile-keep' })
  expect(keep?.props.variant).toBe('primary')
})

test('applying a file runs chezmoi apply on its path', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  on('process.run', async (_$, e) => {
    calls.push(e.argv.join(' '))
    return answer(e.argv, {})
  })
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-apply' })
  await clock.advance(1)

  expect(calls).toContain('chezmoi apply --force /home/.config/fish/config.fish')
})

test('merging a file hands it to Claude', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('process.run', async (_$, e) => answer(e.argv, {}))
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-merge' })
  await clock.advance(1)

  expect(prompts[0]).toContain('~/.config/fish/config.fish')
})

test('the last decision lands on a summary', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-skip' })
  await clock.advance(1)

  const summary = await ui.find({ type: 'Text', text: 'files: 1 skipped' })
  expect(summary).toBeDefined()
})

test('Done closes the wizard', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile-skip' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-close' })

  const reconcileButton = await ui.find({ key: 'reconcile' })
  expect(reconcileButton).toBeDefined()
})

const SYNCED = { mood: 'sync', previous: 'unknown', start: 0, size: 2, kind: 0 } as const
const CASTING = { mood: 'pending', previous: 'sync', start: 0, size: 2, kind: 0 } as const
const BITING = { mood: 'behind', previous: 'sync', start: 0, size: 2, kind: 0 } as const
const CATCHING = { mood: 'pending', previous: 'behind', start: 0, size: 3, kind: 0 } as const
const NUDGED = { mood: 'pending', previous: 'behind', start: 0, size: 2, kind: 0, nudge: 30 } as const
const JUNKING = { mood: 'sync', previous: 'behind', start: 0, size: 2, kind: 0 } as const
const RELEASING = { mood: 'sync', previous: 'pending', start: 0, size: 2, kind: 0 } as const
const RELEASE_THEN_BITE = { mood: 'behind', previous: 'pending', start: 0, size: 2, kind: 0 } as const
const EDITED = { mood: 'drift', previous: 'sync', start: 0, size: 2, kind: 0 } as const
const RECONCILED = { mood: 'sync', previous: 'drift', start: 0, size: 2, kind: 0 } as const
const STORMING = { mood: 'error', previous: 'sync', start: 0, size: 2, kind: 0 } as const
const CLEARING = { mood: 'sync', previous: 'error', start: 0, size: 2, kind: 0 } as const
const UNPUSHED = { mood: 'ahead', previous: 'sync', start: 0, size: 2, kind: 0 } as const
const PUSHED = { mood: 'sync', previous: 'ahead', start: 0, size: 2, kind: 0 } as const


test('a film frame is a PNG of eight pixels per column and sixteen per row, seven rows tall', async () => {
  const frame = filmFrame(0, 50, SYNCED, null)

  const bytes = Uint8Array.from(atob(frame.source.png), ch => ch.charCodeAt(0))
  const header = new DataView(bytes.buffer)
  expect([header.getUint32(16), header.getUint32(20)]).toEqual([400, 112])
})

test('a film frame is a few kilobytes', async () => {
  const frame = filmFrame(0, 50, SYNCED, null)

  const kilobytes = (frame.source.png.length * 3) / 4 / 1024
  expect(kilobytes).toBeLessThan(16)
})

test('a film frame has a transparent background', async () => {
  const frame = filmFrame(0, 50, SYNCED, null)

  const bytes = Uint8Array.from(atob(frame.source.png), ch => ch.charCodeAt(0))
  const colorType = bytes[25]
  expect(colorType).toBe(6)
})

test('consecutive idle ticks share a frame', async () => {
  const first = filmFrame(0, 50, SYNCED, null)

  const next = filmFrame(1, 50, SYNCED, null)

  expect(next.key).toBe(first.key)
})

test('a fish jumps in the pond now and then while idle', async () => {
  const spec = describe(28, 50, SYNCED, null)

  expect(spec.fishing.flying?.what).toBe('fish')
})

test('falling behind main tugs the bobber under', async () => {
  const spec = describe(1, 50, BITING, null)

  expect(spec.fishing.bob).toBe(2)
})

test('a bite is never reeled in before rebasing', async () => {
  const spec = describe(300, 50, BITING, null)

  expect(spec.fishing.flying).toBeNull()
})

test('the bite raises one exclamation mark per size of the coming fish', async () => {
  const spec = describe(5, 50, BITING, null)

  expect(spec.alert?.count).toBe(BITING.size)
})

test('random catch sizes cover all three sizes', async () => {
  const sizes = new Set(Array.from({ length: 60 }, (_, seed) => randomSize(seed)))

  expect([...sizes].sort()).toEqual([1, 2, 3])
})

test('after a bite Clawd holds up a fish the size of the exclamation marks', async () => {
  const spec = describe(10, 50, CATCHING, null)

  expect(spec.fishing.held).toMatchObject({ what: 'fish', size: 3 })
})

test('holding up the catch raises both arms', async () => {
  const spec = describe(10, 50, CATCHING, null)

  expect(spec.clawd.arms).toBe('up')
})

test('a fetch with nothing to apply reels in junk', async () => {
  const spec = describe(10, 50, JUNKING, null)

  expect(spec.fishing.held?.what).toBe('junk')
})

test('Clawd sweats over the junk', async () => {
  const spec = describe(10, 50, JUNKING, null)

  expect(spec.clawd.isSweating).toBe(true)
})

test('Clawd throws the junk back into the pond', async () => {
  const spec = describe(24, 50, JUNKING, null)

  expect(spec.fishing.flying?.what).toBe('junk')
})

test('after the junk Clawd goes back to idling', async () => {
  const spec = describe(40, 50, JUNKING, null)

  expect([spec.fishing.held, spec.fishing.flying]).toEqual([null, null])
})

test('applying tosses the held fish back', async () => {
  const spec = describe(5, 50, RELEASING, null)

  expect(spec.fishing.flying?.what).toBe('fish')
})

test('after the release Clawd goes back to idling', async () => {
  const spec = describe(20, 50, RELEASING, null)

  expect([spec.fishing.held, spec.fishing.flying]).toEqual([null, null])
})

test('a new bite waits for the held fish to be released', async () => {
  const spec = describe(5, 50, RELEASE_THEN_BITE, null)

  expect([spec.fishing.flying?.what, spec.alert]).toEqual(['fish', null])
})

test('the new bite starts once the fish is back in the pond', async () => {
  const spec = describe(20, 50, RELEASE_THEN_BITE, null)

  expect(spec.alert?.count).toBe(RELEASE_THEN_BITE.size)
})

test('edits made here tug the bobber like a bite', async () => {
  const spec = describe(1, 50, EDITED, null)

  expect(spec.fishing.bob).toBe(2)
})

test('edits made here raise exclamation marks', async () => {
  const spec = describe(5, 50, EDITED, null)

  expect(spec.alert?.count).toBe(EDITED.size)
})

test('after reconciling edits the fish goes back in the pond', async () => {
  const spec = describe(26, 50, RECONCILED, null)

  expect(spec.fishing.flying?.what).toBe('fish')
})

test('a bite on edits made here is reeled straight in when changes remain', async () => {
  const spec = describe(3, 50, { ...CATCHING, previous: 'drift' }, null)

  expect(spec.fishing.flying?.what).toBe('fish')
})

test('the storm props the rod while Clawd holds an umbrella', async () => {
  const spec = describe(5, 50, STORMING, null)

  expect([spec.fishing.isPropped, spec.clawd.hasUmbrella]).toEqual([true, true])
})

test('the rain repeats every eight ticks', async () => {
  const first = describe(40, 50, STORMING, null)

  const later = describe(64, 50, STORMING, null)

  expect(later.rain).toBe(first.rain)
})

test('the storm eases into a drizzle as it clears', async () => {
  const spec = describe(2, 50, CLEARING, null)

  expect(spec.isDrizzle).toBe(true)
})

test('the umbrella comes down once the storm clears', async () => {
  const spec = describe(7, 50, CLEARING, null)

  expect([spec.clawd.hasUmbrella, spec.bubble?.text]).toEqual([false, 'clearing up!'])
})

test('unpushed commits send a bottle out on the pond', async () => {
  const spec = describe(30, 50, UNPUSHED, null)

  expect(spec.bottle?.isUpright).toBe(false)
})

test('pushing sails the bottle away', async () => {
  const spec = describe(3, 50, PUSHED, null)

  expect(spec.bubble?.text).toBe('bon voyage!')
})

test('the bottle is gone once it has sailed', async () => {
  const spec = describe(20, 50, PUSHED, null)

  expect(spec.bottle).toBeNull()
})

test('a commit on origin this repo has not seen is fetched into a private ref', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  on('process.run', async (_$, e) => {
    calls.push(e.argv.join(' '))
    return answer(e.argv, { isKnown: false })
  })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  expect(calls).toContain('git -C /src fetch --no-tags --no-write-fetch-head --quiet origin +refs/heads/main:refs/chezmoi-status/main')
})

test('a commit on origin this repo already has is not fetched again', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  on('process.run', async (_$, e) => {
    calls.push(e.argv.join(' '))
    return answer(e.argv, { isKnown: true })
  })
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const fetches = calls.filter(call => call.includes(' fetch '))
  expect(fetches).toEqual([])
})

test('the reconcile button sits on its own row below the header', async ($, on) => {
  mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  const ui = await $.ui.mount(PANE)

  const tree = (await ui.drawn()) as { children?: unknown[] }

  const rowOf = (key: string) => (tree.children ?? []).findIndex(child => JSON.stringify(child).includes(`"key":"${key}"`))
  expect(rowOf('reconcile')).toBe(rowOf('refresh') + 1)
})

test('each drifted file gets an AI summary above its diff', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'This machine still uses vim as the editor; the repo switched to nvim.', usage: USAGE } }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  const summary = await ui.find({ type: 'Text', text: /repo switched to nvim/ })
  expect(summary).toBeDefined()
})

test('the file summary is based on that file alone', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  on('process.run', async (_$, e) => {
    calls.push(e.argv.join(' '))
    return answer(e.argv, {})
  })
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'ok', usage: USAGE } }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  expect(calls).toContain('bash /src/.claude/skills/reconcile/rich-diff.sh /home/.config/fish/config.fish')
})

const SCRIPT_STATUS = ' R .chezmoiscripts/install-packages.sh\n'
const SCRIPT_DIFF = [
  'SUMMARY: files=1 machine_newer=0 repo_newer=0 same_time=0 new_file=1',
  '=== .chezmoiscripts/install-packages.sh (NEW_FILE) ===',
  '[REPO]    #!/bin/bash',
  '[REPO]    brew install raycast',
].join('\n')

test('the file summary sits below the buttons', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  on('model.complete', async () => ({ value: { isAnswered: true as const, text: 'The repo switched the editor to nvim.', usage: USAGE } }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.indexOf('"key":"reconcile-skip"')).toBeLessThan(drawn.indexOf('switched the editor'))
})

test('the package script lists what it will install instead of its diff', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { status: SCRIPT_STATUS, richDiff: SCRIPT_DIFF }))
  on('model.complete', summaryReply)
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'refresh' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  const installs = await ui.find({ type: 'Text', text: '📦 installs raycast' })
  expect(installs).toBeDefined()
})

test('the package script is not sent to the model', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('process.run', async (_$, e) => answer(e.argv, { status: SCRIPT_STATUS, richDiff: SCRIPT_DIFF }))
  on('model.complete', async (_$, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true as const, text: 'ok', usage: USAGE } }
  })
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'refresh' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  expect(prompts.filter(prompt => prompt.includes('install-packages'))).toEqual([])
})

test('a script offers Run script and Skip only', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { status: SCRIPT_STATUS, richDiff: SCRIPT_DIFF }))
  on('model.complete', summaryReply)
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'refresh' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  const keep = await ui.find({ key: 'reconcile-keep' })
  const merge = await ui.find({ key: 'reconcile-merge' })
  const run = await ui.find({ key: 'reconcile-apply' })
  expect([keep, merge, run?.props.label]).toEqual([undefined, undefined, 'Run script'])
})

test('running the package script applies only that script', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  on('process.run', async (_$, e) => {
    calls.push(e.argv.join(' '))
    return answer(e.argv, { status: SCRIPT_STATUS, richDiff: SCRIPT_DIFF })
  })
  on('model.complete', summaryReply)
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'refresh' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile' })
  await ui.press({ key: 'reconcile-pull' })
  await clock.advance(1)
  await ui.press({ key: 'reconcile-ignore-rest' })
  await clock.advance(1)

  await ui.press({ key: 'reconcile-apply' })
  await clock.advance(1)

  expect(calls).toContain('chezmoi apply --force /home/.chezmoiscripts/install-packages.sh')
})

test('a slow button returns before its commands run, so the press never outlives its budget', async ($, on) => {
  mock.clock(on)
  const calls: string[] = []
  on('process.run', async (_$, e) => {
    calls.push(e.argv.join(' '))
    return answer(e.argv, {})
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'reconcile' })

  await ui.press({ key: 'reconcile-pull' })

  const jjCalls = calls.filter(call => call.startsWith('jj '))
  expect(jjCalls).toEqual([])
})

const BITE_LINES = ["something's biting!", 'got a nibble!', 'easy… easy…', 'reel it in?', "that's a big one!"]

test('the text film greets a synced repo', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  const ui = await $.ui.mount(DESKTOP)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const greeting = await ui.find({ in: 'clawd', text: /tight lines!/ })
  expect(greeting).toBeDefined()
})

test('the text film shows a bite when files were edited here', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { status: EDITED_STATUS }))
  on('model.complete', summaryReply)
  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  await ui.advance(2000)

  const marks = await ui.find({ in: 'clawd', text: /!/ })
  expect(marks).toBeDefined()
})

test('a bite gets an excited fishing line', async () => {
  const spec = describe(20, 50, BITING, null)

  expect(BITE_LINES).toContain(spec.bubble?.text)
})

test('the biggest bite opens with a big-fish line', async () => {
  const spec = describe(5, 50, { ...BITING, size: 3 }, null)

  expect(spec.bubble?.text).toBe("that's a big one!")
})

test('holding the catch, Clawd shows it off', async () => {
  const spec = describe(10, 50, CATCHING, null)

  expect(spec.bubble?.text).toBe('what a catch!')
})

test('the lines about the catch rotate', async () => {
  const first = describe(10, 50, CATCHING, null)

  const later = describe(40, 50, CATCHING, null)

  expect(later.bubble?.text).not.toBe(first.bubble?.text)
})

test('local changes cast, bite and land a fish within three seconds', async () => {
  const spec = describe(30, 50, CASTING, null)

  expect(spec.fishing.held?.what).toBe('fish')
})

test('Clawd keeps holding the catch until it is applied', async () => {
  const spec = describe(600, 50, CATCHING, null)

  expect(spec.fishing.held?.what).toBe('fish')
})

test('applying some of the files cheers that more is on the line', async () => {
  const spec = describe(35, 50, NUDGED, null)

  expect(spec.bubble?.text).toBe('still more on the line!')
})

test('the cheer for a partial apply passes', async () => {
  const spec = describe(60, 50, NUDGED, null)

  expect(spec.bubble?.text).not.toBe('still more on the line!')
})

test('reconciling edits made here reels in a fish', async () => {
  const spec = describe(10, 50, RECONCILED, null)

  expect([spec.fishing.held?.what, spec.bubble?.text]).toEqual(['fish', 'got it!'])
})

test('unpushed work sends out a message in a bottle', async () => {
  const spec = describe(14, 50, UNPUSHED, null)

  expect(spec.bubble?.text).toBe('message in a bottle')
})

test('once the bottle has drifted out Clawd goes back to idling', async () => {
  const spec = describe(6 + 8 + 20 + 5, 50, UNPUSHED, null)

  expect([spec.bottle === null, spec.bubble]).toEqual([false, null])
})

test('while reconciling Clawd talks about the current step', async () => {
  const spec = describe(10, 50, SYNCED, 'packages')

  expect(['checking the tackle box…', 'sorting the lures', 'need more bait?']).toContain(spec.bubble?.text)
})

test('the reconciling lines rotate', async () => {
  const first = describe(10, 50, SYNCED, 'files')

  const later = describe(40, 50, SYNCED, 'files')

  expect(later.bubble?.text).not.toBe(first.bubble?.text)
})

test('Clawd never says a command', async () => {
  const scenes = [SYNCED, CASTING, BITING, CATCHING, NUDGED, JUNKING, RELEASING, EDITED, RECONCILED, STORMING, CLEARING, UNPUSHED, PUSHED]
  const steps = [null, 'pull', 'packages', 'files', 'done'] as const

  const lines = scenes.flatMap(scene => steps.flatMap(step => Array.from({ length: 300 }, (_, t) => describe(t, 50, scene, step).bubble?.text ?? '')))

  expect(lines.filter(line => /jj|chezmoi|reconcile|commit|push|apply|file/i.test(line))).toEqual([])
})

test('unpushed commits offer a push button', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, { ahead: '2\n' }))
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const button = await ui.find({ key: 'push' })
  expect(button?.props.label).toBe('Push 2 commits')
})

test('pushing moves main to the working copy parent and pushes it', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  on('process.run', async (_$, e) => {
    calls.push(e.argv.join(' '))
    return answer(e.argv, { ahead: '2\n' })
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  await ui.press({ key: 'push' })
  await clock.advance(1)

  const jjCalls = calls.filter(call => call.startsWith('jj '))
  expect(jjCalls).toEqual(['jj -R /src bookmark set main -r @-', 'jj -R /src git push --bookmark main'])
})

test('uncommitted edits offer to commit and push with Claude', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('process.run', async (_$, e) => answer(e.argv, { porcelain: ' M CLAUDE.md\n' }))
  on('prompt.submit', async (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  await ui.press({ key: 'commit-push' })
  await clock.advance(1)

  expect(prompts[0]).toContain('Review the diff for secrets first')
})

test('a fully pushed repo offers no push action', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', async (_$, e) => answer(e.argv, {}))
  const ui = await $.ui.mount(PANE)

  await ui.press({ key: 'refresh' })
  await clock.advance(1)

  const actions = [await ui.find({ key: 'push' }), await ui.find({ key: 'commit-push' })]
  expect(actions).toEqual([undefined, undefined])
})
