const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const adler32 = (bytes: Uint8Array): number => {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i += 4096) {
    const end = Math.min(bytes.length, i + 4096)
    for (let j = i; j < end; j++) {
      a += bytes[j]!
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

const reverseBits = (code: number, length: number) => {
  let reversed = 0
  for (let i = 0; i < length; i++) {
    reversed = (reversed << 1) | (code & 1)
    code >>>= 1
  }
  return reversed
}

const LITERAL_CODES = new Uint16Array(288)
const LITERAL_LENGTHS = new Uint8Array(288)
for (let symbol = 0; symbol < 288; symbol++) {
  const [base, length, first] =
    symbol < 144 ? [0x30, 8, 0] : symbol < 256 ? [0x190, 9, 144] : symbol < 280 ? [0, 7, 256] : [0xc0, 8, 280]
  LITERAL_CODES[symbol] = reverseBits(base + symbol - first, length)
  LITERAL_LENGTHS[symbol] = length
}

const LENGTH_BASES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DISTANCE_BASES = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

const LENGTH_SYMBOLS = new Uint8Array(259)
for (let code = 0; code < LENGTH_BASES.length; code++) {
  const end = code + 1 < LENGTH_BASES.length ? LENGTH_BASES[code + 1]! : 259
  for (let length = LENGTH_BASES[code]!; length < end; length++) LENGTH_SYMBOLS[length] = code
}
LENGTH_SYMBOLS[258] = 28


const distanceCode = (distance: number) => {
  let code = DISTANCE_BASES.length - 1
  while (DISTANCE_BASES[code]! > distance) code--
  return code
}

class BitWriter {
  bytes: Uint8Array
  length = 0
  private buffer = 0
  private bits = 0

  constructor(capacity: number) {
    this.bytes = new Uint8Array(capacity)
  }

  write(value: number, count: number) {
    this.buffer |= value << this.bits
    this.bits += count
    while (this.bits >= 8) {
      this.push(this.buffer & 0xff)
      this.buffer >>>= 8
      this.bits -= 8
    }
  }

  flush() {
    if (this.bits > 0) this.push(this.buffer & 0xff)
    this.buffer = 0
    this.bits = 0
  }

  private push(byte: number) {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2)
      grown.set(this.bytes)
      this.bytes = grown
    }
    this.bytes[this.length++] = byte
  }
}

const HASH_BITS = 15
const MAX_CHAIN = 16
const WINDOW = 32768

const deflate = (data: Uint8Array): Uint8Array => {
  const out = new BitWriter(Math.max(1024, data.length >> 3))
  const head = new Int32Array(1 << HASH_BITS).fill(-1)
  const previous = new Int32Array(data.length)
  const hashAt = (p: number) => ((data[p]! << 10) ^ (data[p + 1]! << 5) ^ data[p + 2]!) & ((1 << HASH_BITS) - 1)
  const insert = (p: number) => {
    if (p + 2 >= data.length) return
    const h = hashAt(p)
    previous[p] = head[h]!
    head[h] = p
  }
  const literal = (symbol: number) => out.write(LITERAL_CODES[symbol]!, LITERAL_LENGTHS[symbol]!)

  out.write(1, 1)
  out.write(1, 2)
  let i = 0
  while (i < data.length) {
    let bestLength = 0
    let bestDistance = 0
    if (i + 2 < data.length) {
      const limit = Math.min(258, data.length - i)
      let candidate = head[hashAt(i)]!
      for (let chain = 0; candidate >= 0 && i - candidate <= WINDOW && chain < MAX_CHAIN; chain++) {
        if (data[candidate + bestLength] === data[i + bestLength]) {
          let length = 0
          while (length < limit && data[candidate + length] === data[i + length]) length++
          if (length > bestLength) {
            bestLength = length
            bestDistance = i - candidate
            if (length === limit) break
          }
        }
        candidate = previous[candidate]!
      }
    }

    if (bestLength >= 3) {
      const lengthCode = LENGTH_SYMBOLS[bestLength]!
      literal(257 + lengthCode)
      out.write(bestLength - LENGTH_BASES[lengthCode]!, LENGTH_EXTRA[lengthCode]!)
      const code = distanceCode(bestDistance)
      out.write(reverseBits(code, 5), 5)
      out.write(bestDistance - DISTANCE_BASES[code]!, DISTANCE_EXTRA[code]!)
      for (let k = 0; k < bestLength; k++) insert(i + k)
      i += bestLength
    } else {
      literal(data[i]!)
      insert(i)
      i++
    }
  }
  literal(256)
  out.flush()
  return out.bytes.subarray(0, out.length)
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const bytes = new Uint8Array(12 + data.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i)
  bytes.set(data, 8)
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)))
  return bytes
}

export const encodePng = (pixels: Uint8Array, width: number, height: number, channels: 3 | 4): Uint8Array => {
  const stride = width * channels
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)

  const compressed = deflate(raw)
  const zlib = new Uint8Array(compressed.length + 6)
  zlib[0] = 0x78
  zlib[1] = 0x01
  zlib.set(compressed, 2)
  new DataView(zlib.buffer).setUint32(compressed.length + 2, adler32(raw))

  const header = new Uint8Array(13)
  const headerView = new DataView(header.buffer)
  headerView.setUint32(0, width)
  headerView.setUint32(4, height)
  header.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8)

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array(0)),
  ]
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}
