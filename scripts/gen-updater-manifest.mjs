/**
 * Генерация статического манифеста автообновления Tauri.
 *
 * Файл `src-tauri/updater/latest.json` — единственный источник, который
 * приложение опрашивает: он лежит в публичной ветке и доступен по `raw.githubusercontent.com`.
 * Манифест собирается из артефактов сборки, подписанных плагином updater
 * (`*.sig`), поэтому подпись проверяется на клиенте.
 *
 * Скрипт запускается в CI только при `TAURI_UPDATER_ENABLED=true` и коммитит
 * манифест обратно в ветку: так endpoint всегда указывает на последнюю
 * подписанную сборку.
 *
 * Если сборка выполнена без подписи, скрипт сохраняет безопасный «нулевой»
 * манифест (`version: 0.0.0`, пустые платформы) — приложение не предложит
 * обновление вместо того, чтобы упасть на проверке подписи.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'src-tauri', 'updater', 'latest.json')
const bundleDir = process.env.TAURI_BUNDLE_DIR ?? resolve(root, 'src-tauri/target/release/bundle')

const version = (process.env.TAURI_UPDATER_VERSION ?? '').trim()
const repository = process.env.TAURI_UPDATER_REPOSITORY ?? 'megoRU/YetAnotherSSHClient'
const tag = process.env.TAURI_UPDATER_TAG ?? `v${version}`

/** Безопасный манифест: обновление не предлагается, проверять нечего. */
const safeManifest = {
  version: '0.0.0',
  notes: 'Автообновление не сконфигурировано для этой сборки.',
  pub_date: '1970-01-01T00:00:00Z',
  platforms: {}
}

/** Имя артефакта → платформа Tauri updater v2. */
const PLATFORM_BY_TARGET = [
  { target: 'windows-x86_64', prefix: 'YASSH Client_', extension: '.exe.zip' },
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

function main() {
  if (!version) {
    console.error('updater manifest: не задан TAURI_UPDATER_VERSION')
    process.exit(1)
  }

  const signatures = walk(bundleDir, /\.sig$/)
  if (signatures.length === 0) {
    writeFileSync(target, `${JSON.stringify(safeManifest, null, 2)}\n`, 'utf8')
    console.log('updater manifest: подписанных артефактов нет, записан безопасный манифест')
    return
  }

  const platforms = {}
  for (const signaturePath of signatures) {
    const artifactPath = signaturePath.replace(/\.sig$/, '')
    const name = artifactPath.split(/[\\/]/).pop()

    const match = PLATFORM_BY_TARGET.find((candidate) => name.endsWith(candidate.extension) && name.startsWith(candidate.prefix))
    if (!match) {
      console.log(`updater manifest: пропущен неизвестный артефакт ${name}`)
      continue
    }

    platforms[match.target] = {
      signature: readFileSync(signaturePath, 'utf8'),
      url: `https://github.com/${repository}/releases/download/${tag}/${name}`
    }
  }

  if (Object.keys(platforms).length === 0) {
    writeFileSync(target, `${JSON.stringify(safeManifest, null, 2)}\n`, 'utf8')
    console.log('updater manifest: подходящих платформ нет, записан безопасный манифест')
    return
  }

  const manifest = {
    version,
    notes: `YetAnotherSSHClient ${version}`,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms
  }
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`updater manifest: платформы ${Object.keys(platforms).join(', ')}`)
}

main()
