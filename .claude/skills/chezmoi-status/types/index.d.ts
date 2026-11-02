export type StatusEntry = { code: string; path: string }

export type Snapshot = {
  entries: StatusEntry[]
  error?: string
  checkedAt: number
}

export type Summary = {
  text: string
  diffHash: string
  isLoading: boolean
  error?: string
}

export type Upstream = { branch: string; ahead: number; behind: number | null; isDirty: boolean; isReachable: boolean }

export type PackageKind = 'tap' | 'formula' | 'cask'
export type PackageDecision = 'added' | 'ignored' | 'uninstalled' | 'skipped'
export type PackageRef = { kind: PackageKind; name: string }
export type ExtraPackage = PackageRef & { decision: PackageDecision | null; scope: string | null }

export type DefaultDecision = 'applied' | 'kept' | 'skipped'
export type DriftedDefault = {
  domain: string
  key: string
  type: string
  machine: string | null
  repo: string
  isCurrentHost: boolean
  decision: DefaultDecision | null
}

export type FileDirection = 'REPO_NEWER' | 'MACHINE_NEWER' | 'SAME_TIME' | 'NEW_FILE'
export type FileDecision = 'applied' | 'kept' | 'merging' | 'skipped'
export type FileSummary = { text: string; isLoading: boolean; error?: string }
export type DriftedFile = {
  path: string
  direction: FileDirection
  preview: string[]
  isTemplate: boolean
  isScript: boolean
  decision: FileDecision | null
  summary: FileSummary | null
}

export type PushState = { busy: string | null; note: { text: string; tone: 'ok' | 'warn' | 'error' } | null }

export type Reconcile = {
  step: 'pull' | 'packages' | 'defaults' | 'files' | 'done'
  busy: string | null
  note: { text: string; tone: 'ok' | 'warn' | 'error' } | null
  isBlocked: boolean
  profile: string
  missing: PackageRef[]
  packages: ExtraPackage[]
  defaults: DriftedDefault[]
  files: DriftedFile[]
  cursor: number
  isConfirming: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'chezmoi-status': {
      snapshot: Snapshot | null
      summary: Summary | null
      upstream: Upstream | null
      reconcile: Reconcile | null
      push: PushState | null
    }
  }
}
