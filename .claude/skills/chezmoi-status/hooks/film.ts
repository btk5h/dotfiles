import { encodePng } from './png'

export const hash = (x: number, y = 0) => (Math.imul(x, 2654435761) ^ Math.imul(y, 2246822519)) >>> 0

type Rgb = readonly [number, number, number]
type Eyes = 'open' | 'closed' | 'left' | 'right' | 'down' | 'up' | 'happy' | 'flat'
type Side = 'left' | 'right'
type Point = { x: number; y: number }
export type Size = 1 | 2 | 3

type ClawdPose = { x: number; lift: number; eyes: Eyes; arms: 'down' | 'up'; hasUmbrella: boolean; isSweating: boolean }
export type Catch = { what: 'fish'; kind: number; size: Size } | { what: 'junk' }
type Flying = Point & Catch & { facing: Side }
type Bottle = Point & { isUpright: boolean }

export type Fishing = {
  bob: number
  tug: number
  flying: Flying | null
  held: (Catch & { wiggle: number }) | null
  ripples: { x: number; phase: number; isFaint?: boolean }[]
  isPropped: boolean
}

export type ReconcileStep = 'pull' | 'packages' | 'files' | 'done'
export type Mood = 'sync' | 'pending' | 'drift' | 'behind' | 'ahead' | 'error' | 'unknown'

export type Spec = {
  width: number
  rain: number | null
  isDrizzle: boolean
  shimmer: number
  swim: number | null
  clawd: ClawdPose
  fishing: Fishing
  bottle: Bottle | null
  alert: { count: Size; step: number } | null
  sparkle: number | null
  bubble: { text: string; side: Side } | null
  snore: number | null
}

export type Scene = { mood: Mood; previous: Mood; start: number; size: Size; kind: number; nudge?: number }

export const randomSize = (seed: number) => ((hash(seed, 11) % 3) + 1) as Size
export const fishKind = (seed: number) => hash(seed, 5) % 7

export const FILM_ROWS = 7
export const FILM_TICK_MS = 100
export const ART_PER_COLUMN = 4
export const HEIGHT = 56
const UPSCALE = 2
export const GROUND = 40
const POND_DEPTH = HEIGHT - GROUND - 1

const SPRITE = [
  '000111111111111000',
  '000110111111011000',
  '011111111111111110',
  '000111111111111000',
]
const EYE_COLUMNS = [5, 12]
const LEG_COLUMNS = [4, 6, 11, 13]
const QUAD_W = 2
const QUAD_H = 4
export const SPRITE_W = 36
export const SPRITE_H = 20

const BODY: Rgb = [215, 119, 87]
const HIGHLIGHT: Rgb = [236, 152, 120]
const SHADE: Rgb = [178, 92, 66]
const EYE: Rgb = [42, 23, 18]
const PAPER: Rgb = [246, 241, 232]
const INK: Rgb = [42, 23, 18]
const BLACK: Rgb = [0, 0, 0]
const LINE: Rgb = [128, 128, 128]
const SNORE: Rgb = [150, 150, 175]
const WATER_TOP: Rgb = [86, 140, 196]
const WATER_DEEP: Rgb = [38, 76, 128]
const BANK: Rgb = [66, 104, 150]
const SHINE: Rgb = [170, 208, 238]
const LILY: Rgb = [82, 146, 92]
const REED: Rgb = [96, 140, 84]
const CATTAIL: Rgb = [122, 82, 52]
const ROD: Rgb = [110, 78, 50]
const BOBBER: Rgb = [220, 60, 60]
const GLASS: Rgb = [120, 190, 150]
const CORK: Rgb = [150, 100, 60]
const ALERT: Rgb = [255, 214, 64]
const SWEAT: Rgb = [150, 200, 240]

export const FISH_KINDS: readonly { body: Rgb; dark: Rgb; belly: Rgb }[] = [
  { body: [235, 140, 70], dark: [190, 96, 48], belly: [250, 200, 150] },
  { body: [240, 196, 72], dark: [196, 150, 40], belly: [252, 230, 150] },
  { body: [232, 128, 150], dark: [190, 90, 112], belly: [248, 190, 204] },
  { body: [70, 180, 170], dark: [40, 130, 124], belly: [160, 226, 218] },
  { body: [150, 110, 200], dark: [106, 76, 150], belly: [204, 180, 236] },
  { body: [86, 140, 220], dark: [56, 96, 168], belly: [170, 200, 246] },
  { body: [110, 160, 80], dark: [76, 116, 52], belly: [190, 214, 150] },
]

const FISH_SPRITES: Record<Size, readonly string[]> = {
  1: [
    '...FF...',
    'T.BBBBB.',
    'TBBBBBEB',
    'T.LLLL..',
  ],
  2: [
    '....FFF.....',
    'T..BBBBBBB..',
    'TTBBBBBBBEBB',
    'T..BBBBBBBB.',
    '....LLLLL...',
  ],
  3: [
    '........FFFFF.........',
    'TT...BBBBBBBBBBBBB....',
    'TTT.BBBBBBBBBBBBBBBB..',
    'TTTBBBBBBBBBBBBBBBEBBB',
    'TTT.BBBBBBBBBBBBBBBBB.',
    'TT...LLLLLLLLLLLLLL...',
    '.........FF..FF.......',
  ],
}

const JUNK_SPRITE = [
  '...BBB...',
  '...BBB...',
  '...BBBB..',
  '...BBBBBB',
  '..BBBBBBB',
  '..SSSSSSS',
]

const LINES = {
  greeting: 'tight lines!',
  idle: ['nothing biting', 'calm waters', 'just me and the pond', 'perfect fishing weather', 'patience is bait'],
  bite: ["something's biting!", 'got a nibble!', 'easy… easy…', 'reel it in?'],
  bigBite: "that's a big one!",
  catch: ['what a catch!', 'look at this beauty', 'a real keeper', 'one for the album'],
  nudge: 'still more on the line!',
  reconciled: 'got it!',
  release: 'catch and release!',
  junk: 'just junk…',
  back: 'back you go',
  bottle: ['message in a bottle', 'off you go, little bottle', 'drifting out to sea'],
  sailed: 'bon voyage!',
  storm: ['stormy waters…', 'better wait it out', 'the fish are hiding'],
  clearing: 'clearing up!',
  checking: 'checking the waters…',
  reconciling: {
    pull: ['reeling in the line…', 'steady now…', 'almost there…'],
    packages: ['checking the tackle box…', 'sorting the lures', 'need more bait?'],
    files: ['sorting the catch…', 'keep or toss?', 'measuring this one'],
    done: ['nice haul!', 'good day on the water'],
  },
} as const

const LINE_TICKS = 30
const cycle = (lines: readonly string[], local: number) => lines[Math.floor(local / LINE_TICKS) % lines.length]!

const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', '0': '111101101101111', '1': '010110010010111',
  '2': '110001010100111', '3': '110001010001110', '4': '101101111001001', '5': '111100110001110',
  '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
  '!': '010010010000010', '?': '110001010000010', '.': '000000000000010', ',': '000000000010100',
  '+': '000010111010000', '/': '001001010100100', '=': '000111000111000', ':': '000010000010000', '-': '000000111000000', ' ': '000000000000000',
}

const toGlyphText = (text: string) => Array.from(text.toUpperCase().replaceAll('…', '...'))


const CAST_TICKS = 4
const NIBBLE_TICKS = 4
const STRIKE_TICKS = 2
const REEL_TICKS = 7
const THROW_TICKS = 7
const SPLASH_TICKS = 4
const REACT_TICKS = 14
const INTRO_TICKS = 12
const NUDGE_TICKS = 14
const IDLE_PERIOD = 50
const IDLE_REST = 25
const JUMP_TICKS = 9
export const SWIM_PERIOD = 40
export const RAIN_PERIOD = 8
const TOSS_TICKS = 8
const BOTTLE_DRIFT_TICKS = 20
const SAIL_TICKS = 12
const CLEAR_TICKS = 10
const TUGS = [0, 2, 1, 2, 0, 0, 2, 1]

export type Pond = { left: number; cx: number; rx: number; bobber: number; jumpFrom: number; jumpTo: number }

export const pondOf = (width: number, clawdX: number): Pond => {
  const left = clawdX + SPRITE_W + 16
  const rx = Math.max(10, Math.min(64, Math.floor((width - 4 - left) / 2)))
  const cx = left + rx
  return { left, cx, rx, bobber: left + Math.round(rx * 0.7), jumpFrom: cx + Math.round(rx * 0.15), jumpTo: cx + Math.round(rx * 0.6) }
}

export const homeOf = (width: number) => Math.max(4, Math.round(width * 0.06))
export const bucketOf = (clawdX: number) => clawdX + SPRITE_W + 4
export const heldOf = (clawdX: number): Point => ({ x: clawdX + SPRITE_W / 2, y: GROUND - SPRITE_H - 6 })
export const rodOf = (clawdX: number, fishing: Fishing) => {
  const top = GROUND - SPRITE_H + 1
  return {
    butt: fishing.isPropped ? { x: clawdX + 38, y: GROUND } : { x: clawdX + 33, y: top + 9 },
    tip: fishing.isPropped ? { x: clawdX + 58, y: top - 4 } : { x: clawdX + 52, y: top - 12 + fishing.tug },
  }
}

const arc = (from: Point, to: Point, p: number, height: number): Point => ({
  x: Math.round(from.x + (to.x - from.x) * p),
  y: Math.round(from.y + (to.y - from.y) * p - Math.sin(Math.PI * p) * height),
})

const blinking = (local: number): Eyes => (local % 40 === 30 || local % 40 === 31 ? 'closed' : 'open')
const describeScene = (t: number, columns: number, scene: Scene): Spec => {
  const width = columns * ART_PER_COLUMN
  const home = homeOf(width)
  const pond = pondOf(width, home)
  const surface = { x: pond.bobber, y: GROUND }
  const held = heldOf(home)
  const shore = { x: bucketOf(home) + 9, y: GROUND - 7 }
  const landing = { x: pond.cx - Math.round(pond.rx * 0.2), y: GROUND - 1 }
  const moored = Math.round(landing.x + pond.rx * 0.7)
  const standing: ClawdPose = { x: home, lift: 0, eyes: 'open', arms: 'down', hasUmbrella: false, isSweating: false }
  const watching: ClawdPose = { ...standing, eyes: 'right' }
  const calm: Fishing = { bob: Math.floor(t / 8) % 2, tug: 0, flying: null, held: null, ripples: [], isPropped: false }
  const base: Spec = {
    width,
    rain: null,
    isDrizzle: false,
    shimmer: Math.floor(t / 6) % 2,
    swim: null,
    clawd: standing,
    fishing: calm,
    bottle: null,
    alert: null,
    sparkle: null,
    bubble: null,
    snore: null,
  }
  const fish = { what: 'fish' as const, kind: scene.kind, size: scene.size }
  const say = (text: string) => ({ text, side: 'right' as const })
  const reel = (local: number, what: Catch): Spec => ({
    ...base,
    clawd: watching,
    fishing: { ...calm, bob: 0, flying: { ...arc(surface, held, local / (REEL_TICKS - 1), 16), ...what, facing: 'left' }, ripples: local < 3 ? [{ x: pond.bobber, phase: local + 1 }] : [] },
  })
  const toss = (local: number, what: Catch, bubble: Spec['bubble']): Spec => ({
    ...base,
    bubble: local < THROW_TICKS ? null : bubble,
    fishing:
      local < THROW_TICKS
        ? { ...calm, isPropped: true, flying: { ...arc(held, surface, local / (THROW_TICKS - 1), 14), ...what, facing: 'right' } }
        : { ...calm, ripples: [{ x: pond.bobber, phase: local - THROW_TICKS }] },
  })
  const storm = (beat: number): Spec => {
    const burst = Math.floor(t / 4) % 6
    const ripples = [0, 1, 2].map(i => ({ x: pond.cx - pond.rx + 4 + (hash(burst, i) % (pond.rx * 2 - 8)), phase: t % 4 }))
    return {
      ...base,
      rain: t % RAIN_PERIOD,
      clawd: { ...standing, hasUmbrella: true, eyes: beat === 10 || beat === 11 ? 'closed' : 'open' },
      fishing: { ...calm, isPropped: true, ripples },
    }
  }

  const idleAt = (local: number, isGreeting: boolean): Spec => {
    const beat = local % IDLE_PERIOD
    const anim = Math.floor(local / IDLE_PERIOD) % 4
    const blink = beat === 12 || beat === 13
    const idle: Spec = {
      ...base,
      swim: Math.floor(t / 3) % SWIM_PERIOD,
      bubble: isGreeting && local < 16 ? say(LINES.greeting) : null,
      clawd: { ...standing, eyes: blink ? 'closed' : 'open' },
    }
    if (beat < IDLE_REST) return idle
    const step = beat - IDLE_REST
    if (anim === 0) {
      const from = { x: pond.jumpFrom, y: GROUND + 2 }
      const to = { x: pond.jumpTo, y: GROUND + 2 }
      const jumper = { what: 'fish' as const, kind: hash(Math.floor(local / IDLE_PERIOD), 9) % FISH_KINDS.length, size: 2 as const, facing: 'right' as const }
      if (step < JUMP_TICKS) {
        const ripples = step < 3 ? [{ x: pond.jumpFrom, phase: step + 1 }] : []
        return { ...idle, clawd: watching, fishing: { ...calm, flying: { ...arc(from, to, step / (JUMP_TICKS - 1), 13), ...jumper }, ripples } }
      }
      if (step < JUMP_TICKS + 4) {
        return { ...idle, clawd: watching, fishing: { ...calm, ripples: [{ x: pond.jumpTo, phase: step - JUMP_TICKS }] } }
      }
      return idle
    }
    if (anim === 1) return { ...idle, bubble: say(LINES.idle[Math.floor(local / (IDLE_PERIOD * 4)) % LINES.idle.length]!) }
    if (anim === 2) return { ...idle, clawd: { ...standing, eyes: step < 6 ? 'left' : step < 12 ? 'right' : 'open' } }
    return { ...idle, clawd: { ...standing, eyes: 'closed' }, snore: Math.floor(step / 3) % 4 }
  }

  const exits: Partial<Record<Mood, (local: number) => Spec | number>> = {
    pending: local => {
      const release = say(LINES.release)
      if (local < 3) return { ...base, clawd: { ...standing, arms: 'up', eyes: 'happy' }, fishing: { ...calm, isPropped: true, held: { ...fish, wiggle: local % 2 } }, bubble: release }
      return local < 3 + THROW_TICKS + SPLASH_TICKS ? toss(local - 3, fish, release) : 3 + THROW_TICKS + SPLASH_TICKS
    },
    ahead: local => {
      if (local >= SAIL_TICKS) return SAIL_TICKS
      const sink = Math.max(0, local - (SAIL_TICKS - 4))
      return { ...base, clawd: { ...standing, eyes: 'right' }, bottle: { x: moored + local * 2, y: GROUND - 1 + sink, isUpright: false }, bubble: say(LINES.sailed) }
    },
    error: local => {
      if (local >= CLEAR_TICKS) return CLEAR_TICKS
      if (local < CLEAR_TICKS / 2) return { ...storm(0), isDrizzle: true }
      return { ...base, clawd: { ...standing, eyes: 'happy' }, fishing: { ...calm, isPropped: true }, bubble: say(LINES.clearing) }
    },
  }

  let local = t - scene.start
  const exit = scene.previous !== scene.mood ? exits[scene.previous] : undefined
  if (exit) {
    const leaving = exit(local)
    if (typeof leaving !== 'number') return leaving
    local -= leaving
  }

  if (scene.mood === 'pending') {
    if (scene.previous !== 'behind' && scene.previous !== 'drift') {
      if (local < CAST_TICKS) return { ...base, clawd: watching, fishing: { ...calm, bob: 0, ripples: [{ x: pond.bobber, phase: local }] } }
      local -= CAST_TICKS
      if (local < NIBBLE_TICKS) return { ...base, clawd: watching, fishing: { ...calm, bob: local % 2 } }
      local -= NIBBLE_TICKS
      if (local < STRIKE_TICKS) {
        return { ...base, clawd: watching, alert: { count: scene.size, step: 4 + local }, fishing: { ...calm, bob: 2, tug: 2, ripples: [{ x: pond.bobber, phase: local, isFaint: true }] } }
      }
      local -= STRIKE_TICKS
    }
    if (local < REEL_TICKS) return reel(local, fish)
    local -= REEL_TICKS
    const sinceNudge = scene.nudge === undefined ? Infinity : t - scene.nudge
    const isNudged = sinceNudge >= 0 && sinceNudge < NUDGE_TICKS
    const isCheering = local < INTRO_TICKS || isNudged
    return {
      ...base,
      clawd: { ...standing, arms: 'up', eyes: isCheering ? 'happy' : blinking(local) },
      fishing: { ...calm, isPropped: true, held: { ...fish, wiggle: Math.floor(local / 3) % 2 } },
      sparkle: local < 16 || isNudged || local % 40 >= 36 ? local % 4 : null,
      bubble: say(isNudged ? LINES.nudge : cycle(LINES.catch, local)),
    }
  }

  if (scene.mood === 'drift' || scene.mood === 'behind') {
    const bob = TUGS[local % TUGS.length]!
    return {
      ...base,
      clawd: watching,
      alert: { count: scene.size, step: alertStep(local) },
      fishing: { ...calm, bob, tug: bob, ripples: bob === 2 ? [{ x: pond.bobber, phase: local % 2, isFaint: true }] : [] },
      bubble: say(scene.size === 3 && local < LINE_TICKS ? LINES.bigBite : cycle(LINES.bite, local)),
    }
  }

  if (scene.mood === 'ahead') {
    if (local < 6) return { ...base, clawd: watching, bottle: { ...shore, isUpright: true } }
    local -= 6
    if (local < TOSS_TICKS) {
      return { ...base, clawd: watching, bottle: { ...arc(shore, landing, local / (TOSS_TICKS - 1), 16), isUpright: false } }
    }
    local -= TOSS_TICKS
    const drift = Math.min(local, BOTTLE_DRIFT_TICKS) / BOTTLE_DRIFT_TICKS
    const bottle = { x: Math.round(landing.x + (moored - landing.x) * drift), y: GROUND - 1 + (Math.floor(local / 5) % 2), isUpright: false }
    if (local < BOTTLE_DRIFT_TICKS) {
      return {
        ...base,
        clawd: { ...standing, eyes: 'right' },
        bottle,
        fishing: { ...calm, ripples: local < 4 ? [{ x: landing.x, phase: local }] : [] },
        bubble: say(cycle(LINES.bottle, local)),
      }
    }
    return { ...idleAt(local - BOTTLE_DRIFT_TICKS, false), bottle }
  }

  if (scene.mood === 'error') {
    const beat = t % 60
    return { ...storm(beat), bubble: beat >= 30 ? say(LINES.storm[Math.floor(t / 60) % LINES.storm.length]!) : null }
  }

  if (scene.mood === 'unknown') {
    return {
      ...base,
      clawd: { ...standing, eyes: Math.floor(t / 6) % 2 === 0 ? 'down' : 'right' },
      swim: Math.floor(t / 3) % SWIM_PERIOD,
      fishing: { ...calm, bob: Math.floor(t / 4) % 2 },
      bubble: say(LINES.checking),
    }
  }

  if (scene.previous === 'drift') {
    if (local < REEL_TICKS) return reel(local, fish)
    local -= REEL_TICKS
    if (local < REACT_TICKS) {
      return { ...base, clawd: { ...standing, arms: 'up', eyes: 'happy' }, fishing: { ...calm, isPropped: true, held: { ...fish, wiggle: Math.floor(local / 3) % 2 } }, sparkle: local % 4, bubble: say(LINES.reconciled) }
    }
    local -= REACT_TICKS
    if (local < THROW_TICKS + SPLASH_TICKS) return toss(local, fish, say(LINES.release))
    local -= THROW_TICKS + SPLASH_TICKS
  }

  if (scene.previous === 'behind') {
    const junk = { what: 'junk' as const }
    if (local < REEL_TICKS) return reel(local, junk)
    local -= REEL_TICKS
    if (local < REACT_TICKS) {
      return {
        ...base,
        clawd: { ...standing, arms: 'up', eyes: 'flat', isSweating: true },
        fishing: { ...calm, isPropped: true, held: { ...junk, wiggle: Math.floor(local / 4) % 2 } },
        bubble: say(LINES.junk),
      }
    }
    local -= REACT_TICKS
    if (local < THROW_TICKS + SPLASH_TICKS) return toss(local, junk, say(LINES.back))
    local -= THROW_TICKS + SPLASH_TICKS
  }

  return idleAt(local, true)
}

export const describe = (t: number, columns: number, scene: Scene, reconcileStep: ReconcileStep | null): Spec => {
  const spec = describeScene(t, columns, scene)
  if (reconcileStep === null || spec.fishing.flying !== null) return spec
  return { ...spec, bubble: { text: cycle(LINES.reconciling[reconcileStep], t), side: 'right' } }
}

class Canvas {
  readonly pixels: Uint8ClampedArray

  constructor(readonly width: number, readonly height: number) {
    this.pixels = new Uint8ClampedArray(width * height * 4)
  }

  set(x: number, y: number, color: Rgb, alpha = 1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = (y * this.width + x) * 4
    const below = (this.pixels[i + 3]! / 255) * (1 - alpha)
    const covered = alpha + below
    if (covered === 0) return
    for (let c = 0; c < 3; c++) this.pixels[i + c] = (color[c]! * alpha + this.pixels[i + c]! * below) / covered
    this.pixels[i + 3] = covered * 255
  }

  fill(x: number, y: number, w: number, h: number, color: Rgb, alpha = 1) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, color, alpha)
  }

  line(x0: number, y0: number, x1: number, y1: number, color: Rgb, alpha = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= steps; i++) this.set(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), color, alpha)
  }

  text(x: number, y: number, chars: string[], color: Rgb) {
    chars.forEach((ch, i) => {
      const glyph = GLYPHS[ch] ?? GLYPHS['?']!
      for (let j = 0; j < 15; j++) if (glyph[j] === '1') this.set(x + i * 4 + (j % 3), y + Math.floor(j / 3), color)
    })
  }
}

const paintEyes = (canvas: Canvas, x: number, y: number, eyes: Eyes) => {
  const cells: Record<Eyes, (dx: number, dy: number) => boolean> = {
    open: () => true,
    closed: (_dx, dy) => dy === QUAD_H - 1,
    left: dx => dx === 0,
    right: dx => dx === 1,
    down: (_dx, dy) => dy >= 2,
    up: (_dx, dy) => dy < 2,
    happy: (_dx, dy) => dy === 1,
    flat: (_dx, dy) => dy === 2,
  }
  for (let dy = 0; dy < QUAD_H; dy++) for (let dx = 0; dx < QUAD_W; dx++) canvas.set(x + dx, y + dy, cells[eyes](dx, dy) ? EYE : BODY)
}

const paintBubble = (canvas: Canvas, clawdX: number, bubble: { text: string; side: Side }) => {
  const maxChars = Math.floor((canvas.width - 10) / 4)
  const chars = toGlyphText(bubble.text)
  const text = chars.length > maxChars ? [...chars.slice(0, maxChars - 2), '.', '.'] : chars
  const width = text.length * 4 + 5
  const height = 11
  const right = clawdX + SPRITE_W + 2
  const left = clawdX - width - 2
  const fitsRight = right + width <= canvas.width - 1
  const fitsLeft = left >= 1
  const isRight = bubble.side === 'right' ? fitsRight || !fitsLeft : !fitsLeft && fitsRight
  if (!fitsRight && !fitsLeft) return
  const bx = isRight ? right : left
  const by = GROUND - SPRITE_H - height - 5

  canvas.fill(bx + 1, by, width - 2, height, INK)
  canvas.fill(bx, by + 1, width, height - 2, INK)
  canvas.fill(bx + 1, by + 1, width - 2, height - 2, PAPER)
  const tail = isRight ? bx + 3 : bx + width - 6
  const at = (dx: number) => (isRight ? tail + dx : tail + 2 - dx)
  const TAIL: [number, number, number, number][] = [[-1, 3, 0, 2], [-2, 1, -1, 0], [-3, -1, -2, -2], [-3, -3, 1, 0]]
  TAIL.forEach(([inkFrom, inkTo, paperFrom, paperTo], row) => {
    for (let dx = inkFrom; dx <= inkTo; dx++) canvas.set(at(dx), by + height - 1 + row, INK)
    for (let dx = paperFrom; dx <= paperTo; dx++) canvas.set(at(dx), by + height - 1 + row, PAPER)
  })
  canvas.text(bx + 3, by + 3, text, INK)
}

const paintSnore = (canvas: Canvas, x: number, phase: number) => {
  const top = GROUND - SPRITE_H + 1
  for (let k = 0; k <= Math.min(phase, 2); k++) canvas.text(x + 30 + k * 4, top - 4 - k * 5, ['Z'], SNORE)
}

const paintUmbrella = (canvas: Canvas, x: number, top: number) => {
  const cx = x + SPRITE_W / 2
  const rim = top - 3
  const rx = 19
  const ry = 10
  const panel = 7
  for (let dx = -rx; dx <= rx; dx++) {
    const u = ((dx + rx) % panel) / panel
    const hem = rim - Math.round(Math.sin(Math.PI * u) * 2)
    const crown = rim - Math.round(ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / (rx * rx))))
    const isRib = (dx + rx) % panel === 0
    const color: Rgb = isRib ? [120, 34, 46] : Math.floor((dx + rx) / panel) % 2 === 0 ? [200, 56, 70] : [236, 222, 206]
    for (let y = crown; y <= hem; y++) canvas.set(cx + dx, y, y === crown ? mix(color, [255, 255, 255], 0.25) : color)
  }
  canvas.fill(cx, rim - ry - 2, 1, 2, [90, 62, 44])
  canvas.fill(cx, rim + 1, 1, 2, [90, 62, 44])
}

const mix = (a: Rgb, b: Rgb, amount: number): Rgb => [
  a[0] + (b[0] - a[0]) * amount,
  a[1] + (b[1] - a[1]) * amount,
  a[2] + (b[2] - a[2]) * amount,
]

const paintClawd = (canvas: Canvas, pose: ClawdPose) => {
  const top = GROUND - SPRITE_H + 1 - pose.lift
  const x = pose.x
  canvas.fill(x + 2, GROUND, SPRITE_W - 4, 2, BLACK, 0.3)

  SPRITE.forEach((row, qy) => {
    for (let qx = 0; qx < row.length; qx++) {
      const isArm = qy === 2 && (qx <= 2 || qx >= 15)
      if (row[qx] !== '1' || (isArm && pose.arms === 'up')) continue
      for (let dy = 0; dy < QUAD_H; dy++) {
        const color = qy === 0 && dy === 0 ? HIGHLIGHT : qy === SPRITE.length - 1 && dy >= QUAD_H - 2 ? SHADE : BODY
        canvas.fill(x + qx * QUAD_W, top + qy * QUAD_H + dy, QUAD_W, 1, color)
      }
    }
  })
  if (pose.arms === 'up') {
    ;[[1, 2], [0, 1], [-1, 1], [1, 15], [0, 16], [-1, 16]].forEach(([qy, qx]) => canvas.fill(x + qx! * QUAD_W, top + qy! * QUAD_H, QUAD_W, QUAD_H, BODY))
  }
  EYE_COLUMNS.forEach(qx => paintEyes(canvas, x + qx * QUAD_W, top + QUAD_H, pose.eyes))
  LEG_COLUMNS.forEach(qx => canvas.fill(x + qx * QUAD_W, top + SPRITE.length * QUAD_H, QUAD_W, QUAD_H, SHADE))
  if (pose.hasUmbrella) paintUmbrella(canvas, x, top)
  if (pose.isSweating) {
    canvas.fill(x + 30, top + 1, 1, 2, SWEAT)
    canvas.set(x + 31, top + 3, SWEAT)
  }
}

const paintPond = (canvas: Canvas, pond: Pond, shimmer: number) => {
  for (let dy = 0; dy <= POND_DEPTH; dy++) {
    const half = Math.round(pond.rx * Math.sqrt(1 - (dy / (POND_DEPTH + 1)) ** 2))
    canvas.fill(pond.cx - half, GROUND + dy, half * 2 + 1, 1, mix(WATER_TOP, WATER_DEEP, dy / POND_DEPTH))
    canvas.set(pond.cx - half - 1, GROUND + dy, BANK)
    canvas.set(pond.cx + half + 1, GROUND + dy, BANK)
  }
  for (let k = 0; k < 4; k++) {
    const x = pond.cx - pond.rx + Math.round(pond.rx * (0.25 + k * 0.42)) + shimmer * 2
    canvas.fill(x, GROUND + 1 + (k % 2) * 2, 4, 1, SHINE, 0.7)
  }
  const lily = pond.cx + Math.round(pond.rx * 0.45)
  canvas.fill(lily - 3, GROUND, 7, 1, LILY)
  canvas.fill(lily - 2, GROUND - 1, 2, 1, LILY)
  canvas.fill(lily + 1, GROUND - 1, 2, 1, LILY)
  canvas.set(lily, GROUND - 2, [236, 150, 180])
  ;[[-3, 10], [-1, 13], [1, 9]].forEach(([dx, height]) => {
    const x = pond.cx + pond.rx + dx!
    canvas.fill(x, GROUND - height!, 1, height!, REED)
    canvas.fill(x, GROUND - height! - 1, 1, 3, CATTAIL)
  })
}

const paintSwimmers = (canvas: Canvas, pond: Pond, phase: number) => {
  for (let i = 0; i < 2; i++) {
    const p = ((phase + i * (SWIM_PERIOD / 2)) % SWIM_PERIOD) / SWIM_PERIOD
    const travel = p < 0.5 ? p * 2 : 2 - p * 2
    const x = Math.round(pond.cx - pond.rx * 0.55 + travel * pond.rx * 1.1)
    const y = GROUND + 5 + i * 5
    const tail = p < 0.5 ? x - 2 : x + 8
    canvas.fill(x, y, 8, 3, [22, 50, 90], 0.75)
    canvas.fill(tail, y - 1 + (phase % 2), 2, 3, [22, 50, 90], 0.6)
  }
}

const paintRipple = (canvas: Canvas, x: number, phase: number, isFaint: boolean) => {
  const rx = 2 + phase * 2
  const alpha = (0.85 - phase * 0.18) * (isFaint ? 0.5 : 1)
  for (let dx = -rx; dx <= rx; dx++) {
    const dy = Math.round(Math.sqrt(Math.max(0, 1 - (dx * dx) / (rx * rx))) * (1 + Math.floor(phase / 2)))
    canvas.set(x + dx, GROUND + 1 + dy, SHINE, alpha)
    canvas.set(x + dx, GROUND + 1 - dy, SHINE, alpha)
  }
}

const paintRain = (canvas: Canvas, phase: number, isDrizzle: boolean) => {
  const step = HEIGHT / RAIN_PERIOD
  for (let i = 0; i < canvas.width / 3; i += isDrizzle ? 4 : 1) {
    const y = (hash(i, 8) + phase * step) % HEIGHT
    const x = (hash(i, 7) + Math.floor(y / 2)) % canvas.width
    for (let k = 0; k < 3; k++) canvas.set(x - k, y - k * 2, [160, 170, 200], 0.55)
  }
}

const paintBottle = (canvas: Canvas, bottle: Bottle) => {
  if (bottle.isUpright) {
    canvas.fill(bottle.x, bottle.y + 2, 3, 6, GLASS, 0.9)
    canvas.fill(bottle.x + 1, bottle.y, 1, 2, GLASS, 0.9)
    canvas.set(bottle.x + 1, bottle.y - 1, CORK)
    canvas.fill(bottle.x + 1, bottle.y + 3, 1, 3, PAPER)
    return
  }
  canvas.fill(bottle.x - 3, bottle.y, 6, 3, GLASS, 0.9)
  canvas.fill(bottle.x + 3, bottle.y + 1, 2, 1, GLASS, 0.9)
  canvas.set(bottle.x + 5, bottle.y + 1, CORK)
  canvas.fill(bottle.x - 2, bottle.y + 1, 3, 1, PAPER)
}

const paintSprite = (canvas: Canvas, rows: readonly string[], center: Point, facing: Side, colorOf: (cell: string) => Rgb | null) => {
  const width = rows[0]!.length
  const left = Math.round(center.x - width / 2)
  const top = Math.round(center.y - rows.length / 2)
  rows.forEach((row, dy) => {
    Array.from(row).forEach((cell, i) => {
      const color = colorOf(cell)
      if (color) canvas.set(left + (facing === 'right' ? i : width - 1 - i), top + dy, color)
    })
  })
}

const paintCatch = (canvas: Canvas, what: Catch, center: Point, facing: Side) => {
  if (what.what === 'junk') {
    paintSprite(canvas, JUNK_SPRITE, center, facing, cell => (cell === 'B' ? [110, 84, 64] : cell === 'S' ? [60, 46, 36] : null))
    return
  }
  const colors = FISH_KINDS[what.kind]!
  paintSprite(canvas, FISH_SPRITES[what.size], center, facing, cell =>
    cell === 'B' ? colors.body : cell === 'L' ? colors.belly : cell === 'E' ? EYE : cell === 'F' || cell === 'T' ? colors.dark : null,
  )
}

const paintHeld = (canvas: Canvas, held: Catch & { wiggle: number }, clawdX: number) => {
  const center = heldOf(clawdX)
  if (held.what === 'junk') {
    paintCatch(canvas, held, center, 'right')
    canvas.set(center.x + 3, center.y + 5 + held.wiggle * 2, WATER_TOP)
    return
  }
  paintCatch(canvas, held, { x: center.x, y: center.y - held.wiggle }, held.wiggle === 0 ? 'right' : 'left')
}

const ALERT_BIG = [
  '.OOO.',
  'OHYYO',
  'OHYYO',
  'OHYSO',
  'OHYSO',
  '.OYO.',
  '.OYO.',
  '.OSO.',
  '..O..',
  '.....',
  '.OOO.',
  'OHYSO',
  '.OOO.',
]

const ALERT_SMALL = [
  '.OOO.',
  'OHYYO',
  'OHYSO',
  '.OYO.',
  '.OSO.',
  '..O..',
  '.....',
  '.OOO.',
  'OHYSO',
  '.OOO.',
]

const ALERT_LAYOUTS: Record<Size, readonly (readonly string[])[]> = {
  1: [ALERT_BIG],
  2: [ALERT_BIG, ALERT_SMALL],
  3: [ALERT_SMALL, ALERT_BIG, ALERT_SMALL],
}

const ALERT_COLORS: Record<string, Rgb> = { O: INK, Y: ALERT, H: [255, 246, 200], S: [230, 160, 40] }

const alertStep = (local: number) => (local < 6 ? local : 6 + (Math.floor(local / 6) % 2))

const paintAlert = (canvas: Canvas, alert: { count: Size; step: number }, clawdX: number) => {
  const marks = ALERT_LAYOUTS[alert.count]
  const gap = 1
  const width = marks.reduce((sum, mark) => sum + mark[0]!.length, 0) + gap * (marks.length - 1)
  const baseline = GROUND - SPRITE_H - 2
  let left = Math.round(clawdX + SPRITE_W / 2 - width / 2)
  marks.forEach((mark, i) => {
    const age = alert.step - i * 2
    if (age >= 0) {
      const lift = age === 0 ? -2 : age === 1 ? 1 : alert.step === 7 && i % 2 === 0 ? 1 : alert.step === 6 && i % 2 === 1 ? 1 : 0
      const top = baseline - mark.length - lift
      mark.forEach((row, dy) =>
        Array.from(row).forEach((cell, dx) => {
          const color = ALERT_COLORS[cell]
          if (color) canvas.set(left + dx, top + dy, color)
        }),
      )
    }
    left += mark[0]!.length + gap
  })
}

const paintSparkles = (canvas: Canvas, phase: number, clawdX: number, held: Fishing['held']) => {
  const center = heldOf(clawdX)
  const sprite = held?.what === 'fish' ? FISH_SPRITES[held.size] : JUNK_SPRITE
  const spread = Math.ceil(sprite[0]!.length / 2) + 3
  const rise = Math.ceil(sprite.length / 2) + 3
  const spots = [
    { x: center.x - spread, y: center.y - 2 },
    { x: center.x + spread, y: center.y - 4 },
    { x: center.x - 5, y: center.y - rise },
    { x: center.x + 7, y: center.y - rise - 1 },
  ]
  spots.forEach((spot, i) => {
    const reach = (phase + i) % 4
    if (reach === 3) return
    canvas.set(spot.x, spot.y, ALERT)
    for (let r = 1; r <= reach; r++) {
      canvas.set(spot.x + r, spot.y, ALERT, 0.6)
      canvas.set(spot.x - r, spot.y, ALERT, 0.6)
      canvas.set(spot.x, spot.y + r, ALERT, 0.6)
      canvas.set(spot.x, spot.y - r, ALERT, 0.6)
    }
  })
}

const paintGear = (canvas: Canvas, fishing: Fishing, clawdX: number, pond: Pond) => {
  const bucket = bucketOf(clawdX)
  canvas.fill(bucket, GROUND - 6, 8, 7, [150, 150, 160])
  canvas.fill(bucket, GROUND - 6, 8, 1, [196, 196, 206])
  canvas.fill(bucket + 1, GROUND - 5, 6, 1, [72, 72, 82])

  const { butt, tip } = rodOf(clawdX, fishing)
  const bobber = { x: pond.bobber, y: GROUND - 2 + fishing.bob }
  const bend = { x: Math.round((butt.x + tip.x) / 2), y: Math.round((butt.y + tip.y) / 2) + Math.ceil(fishing.tug / 2) }
  canvas.line(butt.x, butt.y, bend.x, bend.y, ROD)
  canvas.line(bend.x, bend.y, tip.x, tip.y, ROD)
  canvas.line(tip.x, tip.y, bobber.x, bobber.y, [200, 200, 205], fishing.tug > 0 ? 0.9 : 0.6)
  canvas.fill(bobber.x, bobber.y, 2, 2, BOBBER)
  canvas.fill(bobber.x, bobber.y + 2, 2, 1, PAPER)
}

const paint = (spec: Spec): Canvas => {
  const canvas = new Canvas(spec.width, HEIGHT)
  const pond = pondOf(spec.width, spec.clawd.x)
  canvas.fill(0, GROUND, spec.width, 1, LINE, 0.35)
  paintPond(canvas, pond, spec.shimmer)
  if (spec.swim !== null) paintSwimmers(canvas, pond, spec.swim)
  spec.fishing.ripples.forEach(ripple => paintRipple(canvas, ripple.x, ripple.phase, ripple.isFaint === true))
  if (spec.rain !== null) paintRain(canvas, spec.rain, spec.isDrizzle)
  paintClawd(canvas, spec.clawd)
  paintGear(canvas, spec.fishing, spec.clawd.x, pond)
  if (spec.bottle) paintBottle(canvas, spec.bottle)
  if (spec.fishing.held) paintHeld(canvas, spec.fishing.held, spec.clawd.x)
  if (spec.sparkle !== null) paintSparkles(canvas, spec.sparkle, spec.clawd.x, spec.fishing.held)
  if (spec.fishing.flying) paintCatch(canvas, spec.fishing.flying, spec.fishing.flying, spec.fishing.flying.facing)
  if (spec.alert) paintAlert(canvas, spec.alert, spec.clawd.x)
  if (spec.snore !== null) paintSnore(canvas, spec.clawd.x, spec.snore)
  if (spec.bubble) paintBubble(canvas, spec.clawd.x, spec.bubble)
  return canvas
}

const upscale = (canvas: Canvas): Uint8Array => {
  const width = canvas.width * UPSCALE
  const rgba = new Uint8Array(width * canvas.height * UPSCALE * 4)
  for (let y = 0; y < canvas.height; y++) {
    const row = new Uint8Array(width * 4)
    for (let x = 0; x < canvas.width; x++) {
      const src = (y * canvas.width + x) * 4
      for (let k = 0; k < UPSCALE; k++) row.set(canvas.pixels.subarray(src, src + 4), (x * UPSCALE + k) * 4)
    }
    for (let k = 0; k < UPSCALE; k++) rgba.set(row, (y * UPSCALE + k) * width * 4)
  }
  return rgba
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const toBase64 = (bytes: Uint8Array): string => {
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4)
  let o = 0
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    out[o++] = BASE64.charCodeAt(a >> 2)
    out[o++] = BASE64.charCodeAt(((a & 3) << 4) | (b >> 4))
    out[o++] = i + 1 < bytes.length ? BASE64.charCodeAt(((b & 15) << 2) | (c >> 6)) : 61
    out[o++] = i + 2 < bytes.length ? BASE64.charCodeAt(c & 63) : 61
  }
  return new TextDecoder().decode(out)
}

const FRAME_CACHE_SIZE = 512
const frames = new Map<string, string>()

export type FilmFrame = { key: string; source: { png: string } }

export const filmFrame = (t: number, columns: number, scene: Scene, reconcileStep: ReconcileStep | null): FilmFrame => {
  const spec = describe(t, columns, scene, reconcileStep)
  const key = JSON.stringify(spec)
  let png = frames.get(key)
  if (png === undefined) {
    const canvas = paint(spec)
    png = toBase64(encodePng(upscale(canvas), canvas.width * UPSCALE, canvas.height * UPSCALE, 4))
    if (frames.size >= FRAME_CACHE_SIZE) frames.delete(frames.keys().next().value!)
    frames.set(key, png)
  }
  return { key, source: { png } }
}
