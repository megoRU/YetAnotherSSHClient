/**
 * Генерация иконок для Tauri из существующих PNG приложения.
 *
 * Tauri требует `icon.ico`, `icon.icns` и набор PNG заданных размеров, а в
 * репозитории лежат только PNG (`public/icons/`). Скрипт собирает `.ico` и
 * `.icns` **без внешних зависимостей**: оба формата позволяют встроить PNG
 * напрямую (Windows Vista+ и macOS), поэтому перекодировать растр не нужно.
 *
 * Масштабирование тоже своё: PNG читается и пишется напрямую (`zlib` входит в
 * Node), ближайшим соседом с фильтром «бокс» для уменьшения. Так не появляется
 * ни `sharp`, ни `jimp`, а результат детерминирован.
 *
 * Запуск: `npm run icons:tauri`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync, deflateSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(root, 'public', 'icons')
const targetDir = join(root, 'src-tauri', 'icons')

/** PNG, которые Tauri требует явно. */
const pngSizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: 'icon.png', size: 512 }
]

/** Варианты для `.ico` (Windows выбирает лучший по DPI). */
const icoSizes = [16, 24, 32, 48, 64, 128, 256]

/** Типы `icns` (тип → размер в пикселях). */
const icnsTypes = [
  { type: 'icp4', size: 16 },
  { type: 'icp5', size: 32 },
  { type: 'icp6', size: 64 },
  { type: 'ic07', size: 128 },
  { type: 'ic08', size: 256 },
  { type: 'ic09', size: 512 },
  { type: 'ic10', size: 1024 }
]

// ── Декодирование PNG ────────────────────────────────────────────────────────

/** Байты на пиксель для поддерживаемых цветовых типов. */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }

/** Разбирает PNG в RGBA-растр. Поддерживаются 8-битные типы 0/2/4/6. */
function decodePng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error('Файл не является PNG')
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const dataChunks = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const start = offset + 8

    if (type === 'IHDR') {
      width = buffer.readUInt32BE(start)
      height = buffer.readUInt32BE(start + 4)
      bitDepth = buffer[start + 8]
      colorType = buffer[start + 9]
      interlace = buffer[start + 12]
    } else if (type === 'IDAT') {
      dataChunks.push(buffer.subarray(start, start + length))
    } else if (type === 'IEND') {
      break
    }

    offset = start + length + 4
  }

  if (bitDepth !== 8) {
    throw new Error(`Поддерживается только 8-битный PNG, получено ${bitDepth}`)
  }
  if (interlace !== 0) {
    throw new Error('Интерливинг не поддерживается')
  }
  const channels = CHANNELS[colorType]
  if (!channels) {
    throw new Error(`Цветовой тип ${colorType} не поддерживается`)
  }

  const raw = inflateSync(Buffer.concat(dataChunks))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)

  // Разворачиваем PNG-фильтры строк: без этого изображение собрано неверно.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[x - channels] : 0
      const up = prev ? prev[x] : 0
      const upLeft = prev && x >= channels ? prev[x - channels] : 0

      let value = line[x]
      switch (filter) {
        case 0: break
        case 1: value += left; break
        case 2: value += up; break
        case 3: value += (left + up) >> 1; break
        case 4: value += paeth(left, up, upLeft); break
        default: throw new Error(`Неизвестный PNG-фильтр ${filter}`)
      }
      out[x] = value & 0xff
    }
  }

  // Приводим к RGBA: недостающие каналы заполняем по правилам PNG.
  const rgba = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    const source = index * channels
    const target = index * 4
    if (channels === 4) {
      rgba[target] = pixels[source]
      rgba[target + 1] = pixels[source + 1]
      rgba[target + 2] = pixels[source + 2]
      rgba[target + 3] = pixels[source + 3]
    } else if (channels === 3) {
      rgba[target] = pixels[source]
      rgba[target + 1] = pixels[source + 1]
      rgba[target + 2] = pixels[source + 2]
      rgba[target + 3] = 255
    } else if (channels === 2) {
      const gray = pixels[source]
      rgba[target] = gray
      rgba[target + 1] = gray
      rgba[target + 2] = gray
      rgba[target + 3] = pixels[source + 1]
    } else {
      const gray = pixels[source]
      rgba[target] = gray
      rgba[target + 1] = gray
      rgba[target + 2] = gray
      rgba[target + 3] = 255
    }
  }

  return { width, height, pixels: rgba }
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const distLeft = Math.abs(estimate - left)
  const distUp = Math.abs(estimate - up)
  const distUpLeft = Math.abs(estimate - upLeft)
  if (distLeft <= distUp && distLeft <= distUpLeft) return left
  return distUp <= distUpLeft ? up : upLeft
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Кодирует RGBA-растр в PNG (фильтр 0 — проще и достаточно для иконок). */
function encodePng(image) {
  const { width, height, pixels } = image
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const chunk = (type, data) => {
    const header = Buffer.alloc(8)
    header.writeUInt32BE(data.length, 0)
    header.write(type, 4, 4, 'ascii')
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0)
    return Buffer.concat([header, data, checksum])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Масштабирует изображение до квадрата `size` фильтром «бокс» по площади. */
function resizeImage(image, size) {
  const { width, height, pixels } = image
  const out = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    // Получаем исходный прямоугольник, соответствующий строке вывода:
    // усреднение по площади даёт резкие края без «мыла» на мелких размерах.
    const yStart = Math.floor((y * height) / size)
    const yEnd = Math.max(yStart + 1, Math.floor(((y + 1) * height) / size))

    for (let x = 0; x < size; x += 1) {
      const xStart = Math.floor((x * width) / size)
      const xEnd = Math.max(xStart + 1, Math.floor(((x + 1) * width) / size))

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0
      for (let sy = yStart; sy < yEnd && sy < height; sy += 1) {
        for (let sx = xStart; sx < xEnd && sx < width; sx += 1) {
          const source = (sy * width + sx) * 4
          const alpha = pixels[source + 3]
          r += pixels[source] * alpha
          g += pixels[source + 1] * alpha
          b += pixels[source + 2] * alpha
          a += alpha
          count += 1
        }
      }

      const target = (y * size + x) * 4
      // Цвет усредняем с весом альфы, альфу — обычным средним: так прозрачные
      // края не дают тёмного ореола.
      out[target] = a > 0 ? Math.round(r / a) : 0
      out[target + 1] = a > 0 ? Math.round(g / a) : 0
      out[target + 2] = a > 0 ? Math.round(b / a) : 0
      out[target + 3] = Math.round(a / count)
    }
  }

  return { width: size, height: size, pixels: out }
}

// ── Контейнеры ───────────────────────────────────────────────────────────────

/** Собирает ICO с PNG-входами внутри. */
function buildIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const directory = Buffer.alloc(16 * count)
  let offset = header.length + directory.length

  images.forEach((image, index) => {
    const entry = 16 * index
    // Размер 0 в каталоге означает 256 px.
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 0)
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1)
    directory.writeUInt8(0, entry + 2)
    directory.writeUInt8(0, entry + 3)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(image.data.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += image.data.length
  })

  return Buffer.concat([header, directory, ...images.map((image) => image.data)])
}

/** Собирает ICNS с PNG-входами внутри. */
function buildIcns(images) {
  const chunks = images.map((image) => {
    const header = Buffer.alloc(8)
    header.write(image.type, 0, 4, 'ascii')
    header.writeUInt32BE(image.data.length + 8, 4)
    return Buffer.concat([header, image.data])
  })

  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(8)

  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)

  return Buffer.concat([header, body])
}

// ── Точка входа ──────────────────────────────────────────────────────────────

function findSource() {
  for (const name of ['512x512.png', '1024x1024.png', 'icon.png']) {
    const candidate = join(sourceDir, name)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`Не найден исходный PNG в ${sourceDir}`)
}

function main() {
  const source = findSource()
  const base = decodePng(readFileSync(source))
  console.log(`Источник: ${source} (${base.width}x${base.height})`)
  mkdirSync(targetDir, { recursive: true })

  const rendered = new Map()
  const render = (size) => {
    if (!rendered.has(size)) {
      rendered.set(size, encodePng(size === base.width ? base : resizeImage(base, size)))
    }
    return rendered.get(size)
  }

  for (const target of pngSizes) {
    const data = render(target.size)
    writeFileSync(join(targetDir, target.name), data)
    console.log(`  ${target.name} (${target.size}px, ${data.length} Б)`)
  }

  const icoImages = icoSizes.map((size) => ({ size, data: render(size) }))
  const ico = buildIco(icoImages)
  writeFileSync(join(targetDir, 'icon.ico'), ico)
  console.log(`  icon.ico (${icoSizes.join(', ')}px, ${ico.length} Б)`)

  const icnsImages = icnsTypes.map((entry) => ({ type: entry.type, data: render(entry.size) }))
  const icns = buildIcns(icnsImages)
  writeFileSync(join(targetDir, 'icon.icns'), icns)
  console.log(`  icon.icns (${icnsTypes.map((entry) => entry.type).join(', ')}, ${icns.length} Б)`)

  console.log('Готово.')
}

main()
