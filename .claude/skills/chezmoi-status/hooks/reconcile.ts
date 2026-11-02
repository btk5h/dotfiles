import type { DriftedDefault, DriftedFile, ExtraPackage, FileDirection, PackageKind, PackageRef } from '../types'

const PREVIEW_LINES = 6
const SECTIONS: Record<PackageKind, string> = { tap: 'taps', formula: 'formulae', cask: 'casks' }

type Run = { exitCode: number; stdout: string; stderr: string }

export const firstLine = (run: Run) => (run.stderr.trim() || run.stdout.trim()).split('\n')[0] ?? ''

export const note = (text: string, tone: 'ok' | 'warn' | 'error' = 'ok') => ({ text, tone })

export const parseBrewDiff = (stdout: string) => {
  const profile = /^PROFILE: (\S+)/m.exec(stdout)?.[1] ?? 'common'
  const refs = (label: string) =>
    [...stdout.matchAll(new RegExp(`^${label} (TAP|FORMULA|CASK): (\\S+)$`, 'gm'))].map(match => ({ kind: match[1]!.toLowerCase() as PackageKind, name: match[2]! }))
  const missing: PackageRef[] = refs('MISSING')
  const packages: ExtraPackage[] = refs('EXTRA').map(ref => ({ ...ref, decision: null, scope: null }))
  return { profile, missing, packages }
}

export const parseRichDiff = (stdout: string): Omit<DriftedFile, 'isTemplate' | 'isScript'>[] => {
  const files: Omit<DriftedFile, 'isTemplate' | 'isScript'>[] = []
  for (const line of stdout.split('\n')) {
    const header = /^=== (.+) \((REPO_NEWER|MACHINE_NEWER|SAME_TIME|NEW_FILE)\) ===$/.exec(line)
    if (header) {
      files.push({ path: header[1]!, direction: header[2] as FileDirection, preview: [], decision: null, summary: null })
      continue
    }
    const current = files[files.length - 1]
    if (current && /^\[(MACHINE|REPO)\]/.test(line) && current.preview.length < PREVIEW_LINES) current.preview.push(line)
  }
  return files
}

export const addToPackages = (yaml: string, kind: PackageKind, key: string, name: string): string => {
  const lines = yaml.split('\n')
  const section = lines.findIndex(line => line === `  ${SECTIONS[kind]}:`)
  if (section === -1) throw new Error(`packages.yaml has no ${SECTIONS[kind]} section`)
  let end = section + 1
  while (end < lines.length && (lines[end]!.startsWith('    ') || lines[end]!.trim() === '')) end++
  const list = lines.findIndex((line, i) => i > section && i < end && (line === `    ${key}:` || line === `    ${key}: []`))
  if (list === -1) throw new Error(`packages.yaml has no ${SECTIONS[kind]}.${key} list`)
  if (lines[list] === `    ${key}: []`) {
    lines.splice(list, 1, `    ${key}:`, `      - ${name}`)
    return lines.join('\n')
  }
  let at = list + 1
  while (at < end && lines[at]!.startsWith('      - ') && lines[at]!.slice(8) < name) at++
  lines.splice(at, 0, `      - ${name}`)
  return lines.join('\n')
}


export const parseDefaultsDiff = (stdout: string): DriftedDefault[] =>
  [...stdout.matchAll(/^DRIFT (-currentHost )?(\S+) (\S+) \[(\w+)\]: machine=(.*) repo=(.*)$/gm)].map(match => ({
    domain: match[2]!,
    key: match[3]!,
    type: match[4]!,
    machine: match[5] === '<unset>' ? null : match[5]!,
    repo: match[6]!,
    isCurrentHost: match[1] !== undefined,
    decision: null,
  }))

const PLAIN_SCALAR = /^[A-Za-z_][\w./-]*$/
const YAML_KEYWORDS = new Set(['true', 'false', 'yes', 'no', 'on', 'off', 'null'])

const yamlValue = (type: string, value: string) =>
  type !== 'string' || (PLAIN_SCALAR.test(value) && !YAML_KEYWORDS.has(value.toLowerCase())) ? value : JSON.stringify(value)

const findDefault = (lines: string[], domain: string, key: string) => {
  const at = lines.findIndex(line => line.includes(`{ domain: ${domain}, key: ${key}, `))
  if (at === -1) throw new Error(`macos.yaml has no entry for ${domain} ${key}`)
  return at
}

export const setDefaultValue = (yaml: string, domain: string, key: string, type: string, value: string): string => {
  const lines = yaml.split('\n')
  const at = findDefault(lines, domain, key)
  lines[at] = lines[at]!.replace(/value: (?:"(?:[^"\\]|\\.)*"|[^,}]*?)(?=,| })/, `value: ${yamlValue(type, value)}`)
  return lines.join('\n')
}

export const removeDefault = (yaml: string, domain: string, key: string): string => {
  const lines = yaml.split('\n')
  const at = findDefault(lines, domain, key)
  const isOnlyEntry = /^\s+\w+:$/.test(lines[at - 1] ?? '') && !(lines[at + 1] ?? '').trimStart().startsWith('- ')
  if (isOnlyEntry) lines.splice(at - 1, 2, `${lines[at - 1]} []`)
  else lines.splice(at, 1)
  return lines.join('\n')
}
