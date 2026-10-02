/**
 * Генерация манифеста автообновления Tauri.
 *
 * `latest.json` — единственный манифест: он указывает на самую свежую сборку,
 * а отсекать ли pre-release, решает приложение по настройке «Получать
 * обновления Pre-release». Отдельного манифеста pre-release не существует:
 * `tauri-plugin-updater` всё равно берёт первую ответившую запись, поэтому
 * разделение на два канала давало только лишний источник правды, который
 * расходился с фактическими релизами.
 *
 * Готовый манифест публикуется ассетом GitHub Release, а приложение читает
 * `releases/latest/download/latest.json`. Ветка репозитория в этом не
 * участвует: манифест, закоммиченный в ветку, успевал указывать на тег,
 * которого ещё нет, и приводил к 404 при скачивании.
 *
 * Matrix-сборки сначала создают отдельные фрагменты, после чего они
 * объединяются в единый манифест.
 *
 * Имена release-файлов намеренно стабильные и НЕ содержат версию.
 * Версия остаётся в GitHub Release tag и в самом updater-манифесте.
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
const manifestTarget = join(updaterDir, 'latest.json')
const bundleDir = process.env.TAURI_BUNDLE_DIR ?? resolve(root, 'src-tauri/target/release/bundle')
const fragmentsDir = resolve(
    process.env.TAURI_UPDATER_FRAGMENTS ?? join(updaterDir, 'fragments')
)

const version = (process.env.TAURI_UPDATER_VERSION ?? '').trim()
const repository = process.env.TAURI_UPDATER_REPOSITORY ?? 'megoRU/YetAnotherSSHClient'
const platform = (process.env.TAURI_UPDATER_PLATFORM ?? '').trim()
const tag = (process.env.TAURI_UPDATER_TAG ?? version).trim()

// `notes` здесь нет намеренно. Приложение показывает «Что нового» из поля
// `notes` манифеста, а если оно пустое — само тянет тело релиза через GitHub
// API (`fetchReleaseNotesFromGithub` в AboutSection). Раньше сюда писалась
// строка `YetAnotherSSHClient <версия>`: она была непустой, поэтому запасной
// путь не срабатывал и пользователь видел заглушку вместо заметок.
const safeManifest = {
  version: '0.0.0',
  pub_date: '1970-01-01T00:00:00Z',
  platforms: {}
}

/**
 * Стабильное имя release-файла для каждой платформы.
 *
 * Версия специально отсутствует.
 */
const RELEASE_ARTIFACTS = {
  'windows-x86_64': {
    // Tauri 2 не упаковывает установщик в zip: плагин запускает сам NSIS-инсталлятор.
    updater: 'YASSH-Client-windows-x64.exe',
    installer: 'YASSH-Client-windows-x64.exe'
  },

  'darwin-aarch64': {
    updater: 'YASSH-Client-macos-arm64.app.tar.gz',
    installer: 'YASSH-Client-macos-arm64.dmg'
  },

  'darwin-x86_64': {
    updater: 'YASSH-Client-macos-x64.app.tar.gz',
    installer: 'YASSH-Client-macos-x64.dmg'
  },

  'linux-x86_64': {
    updater: 'YASSH-Client-linux-amd64.AppImage'
  },

  'linux-aarch64': {
    updater: 'YASSH-Client-linux-arm64.AppImage'
  }
}

/**
 * Рекурсивно ищет файлы по регулярному выражению.
 */
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

function writeManifest(path, manifest, message) {
  // Каталог создаётся здесь, а не только в `buildFragment`: манифест больше не
  // лежит в репозитории, поэтому в свежем checkout'е `src-tauri/updater/`
  // отсутствует, и локальный запуск `merge` падал бы с ENOENT.
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`updater manifest: ${message}`)
}

/**
 * Проверяет версию и тег.
 */
function resolveRelease() {
  if (!version) {
    fail('не задан TAURI_UPDATER_VERSION')
  }

  if (!tag) {
    fail('не задан TAURI_UPDATER_TAG (по умолчанию берётся версия)')
  }

  const expected = [version, `v${version}`]

  if (!expected.includes(tag)) {
    fail(
        `тег релиза «${tag}» не соответствует версии «${version}»: ` +
        `ожидается ${expected.join(' или ')}`
    )
  }

  return { version, tag }
}

/**
 * Определяет платформу Tauri по имени реально созданного updater-файла.
 *
 * Tauri 2 подписывает не «updater-архив», а сам бандл: `tauri-cli` берёт
 * пакеты `Updater | Nsis | WindowsMsi | AppImage | Deb | Rpm`, а
 * `tauri-bundler` создаёт `PackageType::Updater` (zip/tar.gz) только если
 * среди целей есть `.app`. Поэтому имена выглядят так:
 *
 *   Windows — `YASSH Client_4.0.0_x64-setup.exe`
 *   macOS   — `YASSH Client.app.tar.gz` (без версии и архитектуры)
 *   Linux   — `YASSH Client_4.0.0_amd64.AppImage`
 *
 * Токен архитектуры есть только у AppImage, поэтому для macOS платформа
 * берётся из `TAURI_UPDATER_PLATFORM`: по имени arm64 и x64 не различить.
 *
 * `built` — платформа текущей сборки.
 */
function detectPlatform(name, built) {
  if (name.endsWith('-setup.exe.sig')) {
    return 'windows-x86_64'
  }

  if (name.endsWith('.app.tar.gz.sig')) {
    return DARWIN_PLATFORMS.includes(built) ? built : null
  }

  if (name.endsWith('_amd64.AppImage.sig')) {
    return 'linux-x86_64'
  }

  if (
      name.endsWith('_aarch64.AppImage.sig') ||
      name.endsWith('_arm64.AppImage.sig')
  ) {
    return 'linux-aarch64'
  }

  return null
}

/** Платформы macOS: имя `.app.tar.gz` не содержит архитектуры. */
const DARWIN_PLATFORMS = ['darwin-aarch64', 'darwin-x86_64']

/**
 * Запись одной платформы.
 *
 * В подписи используется фактический `.sig` файл,
 * а URL всегда указывает на стабильное имя release-файла.
 */
function entryFor(signaturePath, release) {
  const signatureName = signaturePath.split(/[\\/]/).pop()
  const target = detectPlatform(signatureName, platform)

  if (!target) {
    console.log(`updater manifest: пропущен неизвестный артефакт ${signatureName}`)
    return null
  }

  const artifact = RELEASE_ARTIFACTS[target]

  if (!artifact?.updater) {
    console.log(`updater manifest: для ${target} нет updater-артефакта`)
    return null
  }

  return {
    target,
    entry: {
      signature: readFileSync(signaturePath, 'utf8').trim(),
      url: `https://github.com/${repository}/releases/download/${release.tag}/${artifact.updater}`
    }
  }
}

/**
 * Шаг 1: фрагмент одной matrix-платформы.
 */
function buildFragment() {
  const release = resolveRelease()

  if (!platform) {
    fail('не задан TAURI_UPDATER_PLATFORM')
  }

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

  const fragment = {
    ...release,
    repository,
    platforms
  }

  mkdirSync(fragmentsDir, { recursive: true })

  writeFileSync(
      join(fragmentsDir, `fragment-${platform}.json`),
      `${JSON.stringify(fragment, null, 2)}\n`,
      'utf8'
  )

  if (own.length === 0) {
    console.log(
        `updater manifest: для ${platform} подписанных артефактов нет`
    )
  } else if (!own.includes(platform)) {
    console.log(
        `updater manifest: внимание — сборка ${platform} дала платформы ${own.join(', ')}`
    )
  } else {
    console.log(
        `updater manifest: фрагмент ${platform} → ${own.join(', ')}`
    )
  }
}

/**
 * Шаг 2: объединение всех фрагментов.
 */
function mergeFragments() {
  const release = resolveRelease()

  if (!existsSync(fragmentsDir)) {
    fail(`каталог с фрагментами не найден: ${fragmentsDir}`)
  }

  const files = readdirSync(fragmentsDir)
      .filter((name) => name.startsWith('fragment-') && name.endsWith('.json'))
      .sort()

  if (files.length === 0) {
    fail(
        `в ${fragmentsDir} нет ни одного фрагмента — манифест был бы неполным`
    )
  }

  const platforms = {}

  for (const name of files) {
    let fragment

    try {
      fragment = JSON.parse(
          readFileSync(join(fragmentsDir, name), 'utf8')
      )
    } catch (error) {
      fail(`фрагмент ${name} не разобран: ${error.message}`)
    }

    if (
        fragment.version !== release.version ||
        fragment.tag !== release.tag
    ) {
      fail(
          `фрагмент ${name} собран для ${fragment.version}/${fragment.tag}, ` +
          `а релиз — ${release.version}/${release.tag}`
      )
    }

    for (const [target, entry] of Object.entries(
        fragment.platforms ?? {}
    )) {
      if (platforms[target]) {
        fail(
            `платформа ${target} попала в манифест дважды ` +
            `(фрагмент ${name})`
        )
      }

      platforms[target] = entry
    }
  }

  if (Object.keys(platforms).length === 0) {
    writeManifest(
        manifestTarget,
        safeManifest,
        'подписанных артефактов нет, записан безопасный манифест'
    )

    return
  }

  const missing = Object.keys(RELEASE_ARTIFACTS)
      .filter((target) => !platforms[target])

  if (missing.length > 0) {
    console.log(
        `updater manifest: без артефактов ${missing.join(', ')}`
    )
  }

  const manifest = {
    version: release.version,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms
  }

  const summary = `версия ${release.version}, тег ${release.tag}, платформы ${Object.keys(platforms).join(', ')}`

  // Один манифест на оба канала: он всегда указывает на самую свежую сборку,
  // а отсекать ли pre-release — дело приложения (`updates::check`). Отдельный
  // манифест pre-release не давал ничего: плагин всё равно берёт первую
  // ответившую запись, а в стабильный `latest.json` попадал бы релиз, которого
  // на момент публикации ещё нет.
  writeManifest(manifestTarget, manifest, summary)
}

const mode = process.argv[2]

if (mode === 'fragment') {
  buildFragment()
} else if (mode === 'merge') {
  mergeFragments()
} else {
  fail('не указан режим: `fragment` или `merge`')
}