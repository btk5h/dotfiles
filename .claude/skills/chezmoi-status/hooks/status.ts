import type { FileDirection, Snapshot, StatusEntry, Upstream } from '../types'
import type { Mood } from './film'

export const parseStatus = (stdout: string): StatusEntry[] =>
  stdout
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => ({ code: line.slice(0, 2), path: line.slice(3) }))

export const isScript = (entry: StatusEntry) => entry.code.includes('R')
export const isEditedHere = (entry: StatusEntry) => entry.code[0] !== ' '

export const isBehind = (up: Upstream | null) => up !== null && up.isReachable && (up.behind === null || up.behind > 0)
const hasUnpushed = (up: Upstream | null) => up !== null && (up.ahead > 0 || up.isDirty)

export const moodOf = (current: Snapshot | null, up: Upstream | null): Mood => {
  if (current === null) return 'unknown'
  if (current.error !== undefined) return 'error'
  if (current.entries.some(isEditedHere)) return 'drift'
  if (current.entries.length > 0) return 'pending'
  if (isBehind(up)) return 'behind'
  return hasUnpushed(up) ? 'ahead' : 'sync'
}

export const formatTime = (epochMs: number) => {
  const date = new Date(epochMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export type Badge = { text: string; color?: string; isDim?: boolean; isBold?: boolean }

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const statusBadges = (current: Snapshot | null): Badge[] => {
  if (current === null) return [{ text: '… checking', isDim: true }]
  if (current.error !== undefined) return [{ text: '✗ status failed', color: 'red', isBold: true }]
  const edited = current.entries.filter(isEditedHere).length
  const scripts = current.entries.filter(isScript).length
  const files = current.entries.length - scripts
  if (current.entries.length === 0) return [{ text: '✓ in sync', color: 'green', isBold: true }]
  const pending = [files > 0 ? plural(files, 'file') : '', scripts > 0 ? plural(scripts, 'script') : ''].filter(Boolean).join(' · ')
  return [
    ...(edited > 0 ? [{ text: `✎ ${edited} edited here`, color: 'yellow', isBold: true }] : []),
    { text: `● ${pending} to apply`, color: 'yellow', isBold: edited === 0 },
  ]
}

export const repoBadges = (up: Upstream | null): Badge[] => {
  if (up === null) return []
  const marks: Badge[] = [
    ...(isBehind(up) ? [{ text: `↓${up.behind ?? '?'}`, color: 'yellow' }] : []),
    ...(up.ahead > 0 ? [{ text: `↑${up.ahead}`, color: 'cyan' }] : []),
    ...(up.isDirty ? [{ text: '± wip', color: 'cyan' }] : []),
    ...(!up.isReachable ? [{ text: 'offline', isDim: true }] : []),
  ]
  return [{ text: `${up.branch}${marks.length === 0 ? ' ✓' : ''}`, isDim: true }, ...marks]
}

const ENTRY_GLYPHS: Record<string, Badge> = {
  A: { text: '+', color: 'green' },
  D: { text: '−', color: 'red' },
  M: { text: '~', color: 'yellow' },
  R: { text: '▶', color: 'cyan' },
}

export const entryGlyph = (entry: StatusEntry): Badge => ENTRY_GLYPHS[entry.code.trim().slice(-1)] ?? { text: '·', isDim: true }

export const DIRECTION_LABELS: Record<FileDirection, string> = {
  REPO_NEWER: 'repo is newer',
  MACHINE_NEWER: 'machine is newer',
  SAME_TIME: 'same age',
  NEW_FILE: 'new file',
}

export const FILE_OUTCOMES: Record<string, string> = { applied: 'applied', kept: 'kept from machine', merging: 'sent to Claude', skipped: 'skipped' }
export const PACKAGE_OUTCOMES: Record<string, string> = { added: 'added', ignored: 'ignored', uninstalled: 'uninstalled', skipped: 'skipped' }

export const countBy = (values: (string | null)[]) =>
  values.reduce<Record<string, number>>((counts, value) => (value === null ? counts : { ...counts, [value]: (counts[value] ?? 0) + 1 }), {})

export const describeCounts = (counts: Record<string, number>, labels: Record<string, string>) =>
  Object.entries(labels)
    .filter(([key]) => (counts[key] ?? 0) > 0)
    .map(([key, label]) => `${counts[key]} ${label}`)
    .join(' · ')
