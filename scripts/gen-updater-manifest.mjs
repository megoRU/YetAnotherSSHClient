/**
 * Генерация статического манифеста автообновления Tauri.
 *
 * Файл `src-tauri/updater/latest.json` — единственный источник, который
 * приложение опрашивает: он лежит в публичной ветке и доступен по
 * `raw.githubusercontent.com`. Манифест собирается из артефактов сборки,
 * подписанных плагином updater (`*.sig`), поэтому подпись проверяется на
 * клиенте.
 *
 * ## Почему два режима
 *
 * Сборка идёт в матрице (`ubuntu` / `windows` / `macos`), и на каждой
 * платформе известна только её часть артефактов. Если бы каждая matrix-платформа
 * переписывала `latest.json` целиком и коммитила его от себя, последняя
 * запись затёрла бы остальные: в манифесте остался бы одинtarget, и все
 * остальные пользователи получили бы «платформа не найдена» вместо обновления.
 *
 * Поэтому работа разделена на два шага:
 *
 * 1. `fragment` — выполняется в каждой matrix-платформе. Сканирует локальный
 *    каталог бандла, находит подпись своей платформы и записывает
 *    `updater/fragments/fragment-<platform>.json`. Ничего не коммитится:
 *    фрагмент уезжает артефактом сборки.
 * 2. `merge` — выполняется один раз после всех сборок. Скачивает все
 *    фрагменты в `updater/fragments/`, объединяет их в единый манифест и
 *    коммитит его один раз.
 *
 * Оба шага проверяют, что версия и тег релиза во всех фрагментах совпадают:
 * смешивание артефактов разных релизов дало бы битые URL.
 *
 * ## Тег релиза
 *
 * URL артефактов строится из тега GitHub Release, и он обязан совпадать с
 * фактическим тегом: иначе ссылки в манифесте не резолвятся и обновление
 * не скачивается. Тег по умолчанию — версия без префикса `v`
 * (`4.0.0`), его же создаёт workflow. Задаётся `TAURI_UPDATER_TAG`.
 *
 * Если сборка выполнена без подписи, скрипт сохраняет безопасный «нулевой»
 * манифест (`version: 0.0.0`, пустые платформы) — приложение не предложит
 * обновление вместо того, чтобы упасть на проверке подписи.
 *
 * Запуск:
 *
 *   node scripts/gen-updater-manifest.mjs fragment
 *   node scripts/gen-updater-manifest.mjs merge
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const updaterDir = resolve(root, 'src-tauri', 'updater')
const target = join(updaterDir, 'latest.json')
const bundleDir = process.env.TAURI_BUNDLE_DIR ?? resolve(root, 'src-tauri/target/release/bundle')
const fragmentsDir = resolve(process.env.TAURI_UPDATER_FRAGMENTS ?? join(updaterDir, 'fragments'))

const version = (process.env.TAURI_UPDATER_VERSION ?? '').trim()
const repository = process.env.TAURI_UPDATER_REPOSITORY ?? 'megoRU/YetAnotherSSHClient'
const platform = (process.env.TAURI_UPDATER_PLATFORM ?? '').trim()
const tag = (process.env.TAURI_UPDATER_TAG ?? version).trim()

/** Безопасный манифест: обновление не предлагается, проверять нечего. */
const safeManifest = {
  version: '0.0.0',
  notes: 'Автообновление не сконфигурировано для этой сборки.',
  pub_date: '1970-01-01T00:00:00Z',
  platforms: {}
}

/** Имя артефакта → платформа Tauri updater v2. */
const PLATFORM_BY_TARGET = [
  // Tauri v2 NSIS updater archive ends in `.nsis.zip` (the `.exe` is inside it).
  { target: 'windows-x86_64', prefix: 'YASSH Client_', extension: '.nsis.zip' },
  { target: 'darwin-aarch64', prefix: 'YASSH Client_', extension: '.app.tar.gz' },
  { target: 'darwin-x86_64', prefix: 'YASSH Client_', extension: '.app.tar.gz' },
  { target: 'linux-x86_64', prefix: 'yassh-client_', extension: '.AppImage' },
  { target: 'linux-aarch64', prefix: 'yassh-client_', extension: '.AppImage' }
]

/** Рекурсивно ищет файлы по регулярному выражению. */
function walk(directory, matcher, out = []) {
  if (!existsSync(directory)) return out
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(path, matcher, out)
    } else if (matcher.test(entry.name)) {
      out.push(path)
    }
  }
  return out
}

function fail(message) {
  console.error(`updater manifest: ${message}`)
  process.exit(1)
}

function writeManifest(manifest, message) {
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`updater manifest: ${message}`)
}

/**
 * Проверяет, что версия и тег заданы и согласованы.
 *
 * Расхождение — это не предупреждение, а ошибка сборки: URL в манифесте
 * перестали бы совпадать с фактическим тегом GitHub Release, и обновление
 * не скачалось бы.
 */
function resolveRelease() {
  if (!version) fail('не задан TAURI_UPDATER_VERSION')
  if (!tag) fail('не задан TAURI_UPDATER_TAG (по умолчанию берётся версия)')

  const expected = [version, `v${version}`]
  if (!expected.includes(tag)) {
    fail(
      `тег релиза «${tag}» не соответствует версии «${version}»: ` +
        `ожидается ${expected.join(' или ')}`
    )
  }

  return { version, tag }
}

/** Запись одной платформы: подпись и прямая ссылка на файл релиза. */
function entryFor(signaturePath, release) {
  const artifactPath = signaturePath.replace(/\.sig$/, '')
  const name = artifactPath.split(/[\\/]/).pop()

  const match = PLATFORM_BY_TARGET.find(
    (candidate) => name.endsWith(candidate.extension) && name.startsWith(candidate.prefix)
  )
  if (!match) {
    console.log(`updater manifest: пропущен неизвестный артефакт ${name}`)
    return null
  }

  return {
    target: match.target,
    entry: {
      signature: readFileSync(signaturePath, 'utf8').trim(),
      url: `https://github.com/${repository}/releases/download/${release.tag}/${name}`
    }
  }
}

/** Шаг 1: фрагмент одной matrix-платформы. */
function buildFragment() {
  const release = resolveRelease()
  if (!platform) fail('не задан TAURI_UPDATER_PLATFORM')

  const platforms = {}
  for (const signaturePath of walk(bundleDir, /\.sig$/)) {
    const found = entryFor(signaturePath, release)
    if (!found) continue
    if (platforms[found.target]) {
      fail(`платформа ${found.target} найдена дважды в бандле ${platform}`)
    }
    platforms[found.target] = found.entry
  }

  const own = Object.keys(platforms)
  const fragment = { ...release, repository, platforms }
  // Фрагменты складываются в общий каталог: шаг `merge` читает ровно его, и
  // локальный прогон повторяет CI (там в тот же каталог распаковываются
  // скачанные артефакты сборки).
  mkdirSync(fragmentsDir, { recursive: true })
  writeFileSync(join(fragmentsDir, `fragment-${platform}.json`), `${JSON.stringify(fragment, null, 2)}\n`, 'utf8')

  if (own.length === 0) {
    console.log(`updater manifest: для ${platform} подписанных артефактов нет`)
  } else if (!own.includes(platform)) {
    console.log(`updater manifest: внимание — сборка ${platform} дала платформы ${own.join(', ')}`)
  } else {
    console.log(`updater manifest: фрагмент ${platform} → ${own.join(', ')}`)
  }
}

/** Шаг 2: единый манифест из всех фрагментов. */
function mergeFragments() {
  const release = resolveRelease()

  if (!existsSync(fragmentsDir)) {
    fail(`каталог с фрагментами не найден: ${fragmentsDir}`)
  }

  const files = readdirSync(fragmentsDir)
    .filter((name) => name.startsWith('fragment-') && name.endsWith('.json'))
    .sort()
  if (files.length === 0) {
    fail(`в ${fragmentsDir} нет ни одного фрагмента — манифест был бы неполным`)
  }

  const platforms = {}
  for (const name of files) {
    let fragment
    try {
      fragment = JSON.parse(readFileSync(join(fragmentsDir, name), 'utf8'))
    } catch (error) {
      fail(`фрагмент ${name} не разобран: ${error.message}`)
    }

    // Смешивать артефакты разных релизов нельзя: URL ведут на один тег.
    if (fragment.version !== release.version || fragment.tag !== release.tag) {
      fail(
        `фрагмент ${name} собран для ${fragment.version}/${fragment.tag}, ` +
          `а релиз — ${release.version}/${release.tag}`
      )
    }

    for (const [target, entry] of Object.entries(fragment.platforms ?? {})) {
      if (platforms[target]) fail(`платформа ${target} попала в манифест дважды (фрагмент ${name})`)
      platforms[target] = entry
    }
  }

  if (Object.keys(platforms).length === 0) {
    writeManifest(safeManifest, 'подписанных артефактов нет, записан безопасный манифест')
    return
  }

  // Недостающие платформы — не повод ронять сборку (macOS-матрица может быть
  // отключена), но о них обязательно узнать: иначе «нет обновления» на этой
  // ОС будет выглядеть как поломка.
  const missing = PLATFORM_BY_TARGET.map((item) => item.target).filter((item) => !platforms[item])
  if (missing.length > 0) {
    console.log(`updater manifest: без артефактов ${missing.join(', ')}`)
  }

  writeManifest(
    {
      version: release.version,
      notes: `YetAnotherSSHClient ${release.version}`,
      pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      platforms
    },
    `версия ${release.version}, тег ${release.tag}, платформы ${Object.keys(platforms).join(', ')}`
  )
}

const mode = process.argv[2]
if (mode === 'fragment') {
  buildFragment()
} else if (mode === 'merge') {
  mergeFragments()
} else {
  fail('не указан режим: `fragment` или `merge`')
}
