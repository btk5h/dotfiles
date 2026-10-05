import type { ClientModule } from 'claude-code'

import { ART_PER_COLUMN, FILM_ROWS, FILM_TICK_MS, FISH_KINDS, GROUND, HEIGHT, RAIN_PERIOD, SPRITE_H, SPRITE_W, SWIM_PERIOD, bucketOf, describe, hash, heldOf, pondOf, rodOf } from './film'
import type { Catch, ReconcileStep, Scene, Spec } from './film'

type Props = { scene: Scene; reconcileStep: ReconcileStep | null }
type Reel = { t: number; base: number; sceneKey: string }
type Cell = { ch: string; color?: string; dim?: boolean; bold?: boolean }
type Style = Omit<Cell, 'ch'>

const FALLBACK_COLUMNS = 40
const ROW = HEIGHT / FILM_ROWS
const ORANGE = '#D77757'
const GOLD = '#FFD640'
const WATER = '#5690C4'
const DEEP = '#2E5A8C'
const SHINE = '#AAD0EE'
const ROD = '#8A6440'
const LINE = '#B8B8C0'
const RED = '#DC3C3C'

const HEADS = { open: ' ▐▛███▜▌ ', shut: ' ▐█████▌ ' }
const BODY = '▝▜█████▛▘'
const BODY_ARMS_UP = ' ▜█████▛ '
const LEGS = '  ▘▘ ▝▝  '
const SPRITE_COLUMNS = SPRITE_W / ART_PER_COLUMN

const hex = (rgb: readonly number[]) => `#${rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`
const cellX = (x: number) => Math.floor(x / ART_PER_COLUMN)
const cellY = (y: number) => Math.floor(y / ROW)

const paint = (grid: Cell[][], row: number, column: number, text: string, style: Style, isOpaque = false) => {
  const line = grid[row]
  if (line === undefined) return
  Array.from(text).forEach((ch, i) => {
    const at = column + i
    if ((isOpaque || ch !== ' ') && at >= 0 && at < line.length) line[at] = { ch, ...style }
  })
}

const catchGlyph = (what: Catch, facing: 'left' | 'right') => {
  if (what.what === 'junk') return { text: '▙', style: { color: '#6E5440' } }
  const glyphs = facing === 'right' ? ['><>', '><(>', '><((°>'] : ['<><', '<)><', '<°))><']
  return { text: glyphs[what.size - 1]!, style: { color: hex(FISH_KINDS[what.kind]!.body), bold: true } }
}

const paintLine = (grid: Cell[][], from: { x: number; y: number }, to: { x: number; y: number }, style: Style) => {
  const [x0, y0, x1, y1] = [cellX(from.x), cellY(from.y), cellX(to.x), cellY(to.y)]
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  const ch = y1 === y0 ? '─' : x1 === x0 ? '│' : (x1 - x0) * (y1 - y0) < 0 ? '╱' : '╲'
  for (let i = 0; i <= steps; i++) paint(grid, Math.round(y0 + ((y1 - y0) * i) / steps), Math.round(x0 + ((x1 - x0) * i) / steps), ch, style)
}

const paintBubble = (grid: Cell[][], x: number, columns: number, text: string) => {
  const room = columns - x - 5
  if (room < 4) return
  const chars = Array.from(text)
  const shown = chars.length > room ? `${chars.slice(0, room - 1).join('')}…` : text
  const border = '─'.repeat(Array.from(shown).length + 2)
  paint(grid, 0, x + 1, `╭${border}╮`, {}, true)
  paint(grid, 1, x, `─┤ ${shown} │`, {}, true)
  paint(grid, 2, x + 1, `╰${border}╯`, {}, true)
}

const compose = (spec: Spec, columns: number): Cell[][] => {
  const grid: Cell[][] = Array.from({ length: FILM_ROWS }, () => Array.from({ length: columns }, () => ({ ch: ' ' })))
  const x = cellX(spec.clawd.x)
  const pond = pondOf(spec.width, spec.clawd.x)
  const groundRow = cellY(GROUND)

  paint(grid, groundRow, 0, '▁'.repeat(columns), { dim: true })
  for (let column = cellX(pond.cx - pond.rx); column <= cellX(pond.cx + pond.rx); column++) {
    paint(grid, groundRow, column, (column + spec.shimmer) % 3 === 0 ? '∽' : '~', { color: WATER })
  }
  for (let column = cellX(pond.cx - pond.rx * 0.8); column <= cellX(pond.cx + pond.rx * 0.8); column++) {
    paint(grid, groundRow + 1, column, '≈', { color: DEEP })
  }
  if (spec.swim !== null) {
    for (let i = 0; i < 2; i++) {
      const p = ((spec.swim + i * (SWIM_PERIOD / 2)) % SWIM_PERIOD) / SWIM_PERIOD
      const travel = p < 0.5 ? p * 2 : 2 - p * 2
      paint(grid, groundRow + 1, cellX(pond.cx - pond.rx * 0.55 + travel * pond.rx * 1.1), p < 0.5 ? '>' : '<', { color: DEEP, bold: true })
    }
  }
  spec.fishing.ripples.forEach(ripple => {
    const reach = Math.ceil(ripple.phase / 2)
    paint(grid, groundRow, cellX(ripple.x) - reach, '◦', { color: SHINE, dim: ripple.isFaint })
    paint(grid, groundRow, cellX(ripple.x) + reach, '◦', { color: SHINE, dim: ripple.isFaint })
  })
  if (spec.rain !== null) {
    for (let i = 0; i < spec.width / 3; i += spec.isDrizzle ? 4 : 1) {
      const y = (hash(i, 8) + spec.rain * (HEIGHT / RAIN_PERIOD)) % HEIGHT
      if (i % 3 === 0) paint(grid, cellY(y), cellX((hash(i, 7) + Math.floor(y / 2)) % spec.width), '╱', { color: SHINE, dim: true })
    }
  }

  const clawdRow = cellY(GROUND - SPRITE_H + 1) + 1
  const isShut = ['closed', 'happy', 'flat'].includes(spec.clawd.eyes)
  paint(grid, clawdRow, x, isShut ? HEADS.shut : HEADS.open, { color: ORANGE })
  paint(grid, clawdRow + 1, x, spec.clawd.arms === 'up' ? BODY_ARMS_UP : BODY, { color: ORANGE })
  paint(grid, clawdRow + 2, x, LEGS, { color: ORANGE })
  if (spec.clawd.arms === 'up') {
    paint(grid, clawdRow, x, '▐', { color: ORANGE })
    paint(grid, clawdRow, x + SPRITE_COLUMNS - 1, '▌', { color: ORANGE })
  }
  if (spec.clawd.isSweating) paint(grid, clawdRow, x + SPRITE_COLUMNS, '’', { color: SHINE })
  if (spec.clawd.hasUmbrella) paint(grid, clawdRow - 1, x - 1, '▄▆████████▆▄', { color: RED })

  paint(grid, clawdRow + 1, cellX(bucketOf(spec.clawd.x)), '▆▆', { color: '#9696A0' })
  const { butt, tip } = rodOf(spec.clawd.x, spec.fishing)
  paintLine(grid, butt, tip, { color: ROD })
  const bobber = { x: pond.bobber, y: GROUND }
  paintLine(grid, tip, bobber, { color: LINE, dim: spec.fishing.tug === 0 })
  paint(grid, groundRow, cellX(pond.bobber), spec.fishing.bob === 2 ? '·' : 'o', { color: RED, bold: true })

  if (spec.bottle) {
    paint(grid, spec.bottle.isUpright ? clawdRow + 1 : groundRow, cellX(spec.bottle.x), spec.bottle.isUpright ? '▮' : '▬', { color: '#78BE96' })
  }
  const held = heldOf(spec.clawd.x)
  if (spec.fishing.held) {
    const glyph = catchGlyph(spec.fishing.held, spec.fishing.held.wiggle === 0 ? 'right' : 'left')
    paint(grid, clawdRow - 1, cellX(held.x) - Math.floor(Array.from(glyph.text).length / 2), glyph.text, glyph.style)
  }
  if (spec.sparkle !== null) {
    paint(grid, clawdRow - 1, x - 1 + (spec.sparkle % 2), '✦', { color: GOLD })
    paint(grid, clawdRow - 2, x + SPRITE_COLUMNS - 1 - (spec.sparkle % 2), '✦', { color: GOLD })
  }
  if (spec.fishing.flying) {
    const glyph = catchGlyph(spec.fishing.flying, spec.fishing.flying.facing)
    paint(grid, cellY(spec.fishing.flying.y), cellX(spec.fishing.flying.x) - 1, glyph.text, glyph.style)
  }
  if (spec.alert) {
    const marks = '!'.repeat(spec.alert.count)
    const shown = Array.from(marks).slice(0, Math.max(1, Math.ceil((spec.alert.step + 1) / 2))).join('')
    paint(grid, clawdRow - 1, cellX(held.x) - Math.floor(shown.length / 2), shown, { color: GOLD, bold: true })
  }
  if (spec.snore !== null) paint(grid, clawdRow - 1 - (spec.snore % 2), x + SPRITE_COLUMNS - 1, spec.snore < 2 ? 'z' : 'Z', { dim: true })
  if (spec.bubble) paintBubble(grid, x + SPRITE_COLUMNS, columns, spec.bubble.text)

  return grid
}

const toRuns = (line: Cell[]): Cell[] =>
  line.reduce<Cell[]>((runs, cell) => {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === cell.color && last.dim === cell.dim && last.bold === cell.bold) {
      last.ch += cell.ch
    } else {
      runs.push({ ...cell })
    }
    return runs
  }, [])

const Clawd: ClientModule<Props | null, Reel> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ t: 0, base: 0, sceneKey: '' })
    surface.every(FILM_TICK_MS, () => {
      const reel = surface.state
      if (reel) surface.setState({ ...reel, t: reel.t + 1 })
    })
  }
  const reel = surface.state ?? { t: 0, base: 0, sceneKey: '' }
  if (props === null) return <Box />

  const sceneKey = JSON.stringify([props.scene.mood, props.scene.previous, props.scene.start, props.scene.nudge])
  const base = reel.sceneKey === sceneKey ? reel.base : reel.t
  if (reel.sceneKey !== sceneKey) surface.setState({ ...reel, base, sceneKey })
  const scene: Scene = {
    ...props.scene,
    start: base,
    ...(props.scene.nudge === undefined ? {} : { nudge: base + (props.scene.nudge - props.scene.start) }),
  }
  const columns = surface.columns || FALLBACK_COLUMNS
  const grid = compose(describe(reel.t, columns, scene, props.reconcileStep), columns)

  return (
    <Box flexDirection="column">
      {grid.map(line => (
        <Box flexDirection="row">
          {toRuns(line).map(run => (
            <Text color={run.color} dimColor={run.dim} bold={run.bold} wrap="truncate-end">
              {run.ch}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Clawd
