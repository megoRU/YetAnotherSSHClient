/**
 * Генерация конфигурации Tauri для сборки с автообновлением.
 *
 * Транслируется в `src-tauri/tauri.updater.generated.json` и передаётся в
 * `tauri build --config`. Ключи подписи приходят из секретов репозитория и
 * никогда не попадают в git.
 *
 * Логика:
 * * `TAURI_UPDATER_PUBLIC_KEY` отсутствует или `TAURI_UPDATER_ENABLED` не
 *   `true` ⇒ подпись выключена, `createUpdaterArtifacts: false`. Обычная
 *   сборка не требует ключей и всегда работает;
 * * иначе подставляется публичный ключ и запрашиваются артефакты обновления.
 *   Если при этом нет приватного ключа, CI падает ДО сборки — иначе получился
 *   бы релиз с манифестом, который приложение не может проверить.
 */

import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'src-tauri', 'tauri.updater.generated.json')

const enabled = (process.env.TAURI_UPDATER_ENABLED ?? '').toLowerCase() === 'true'
const publicKey = (process.env.TAURI_UPDATER_PUBLIC_KEY ?? '').trim()
const hasPrivateKey = Boolean((process.env.TAURI_SIGNING_PRIVATE_KEY ?? '').trim())
const hasPassword = (process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '').trim().length > 0

/**
 * Похож ли ключ на публичный ключ minisign.
 *
 * Tauri принимает **два** формата, и проверка обязана понимать оба:
 *
 * 1. base64 от всего файла `.pub` — именно то, что лежит в
 *    `plugins.updater.pubkey` (`tauri signer generate` печатает файл
 *    целиком, а конфиг хранит его в base64). Декодируется в текст вида
 *    `untrusted comment: minisign public key: <ID>\nRWQ…`;
 * 2. «голый» ключ из 32 байт в base64 — начинается с `RWQ`/`RWT`/`RWS`.
 *
 * Раньше проверялся только префикс `RWQ`, то есть второй формат. Формат из
 * пункта 1, который и прописан в конфиге, так не проходил никогда: CI падал
 * с «не задан или не похож на minisign-ключ» при совершенно верном ключе.
 */
function looksLikePublicKey(value) {
  if (!value) return false

  // Формат 2: «голый» ключ из 32 байт.
  if (value.startsWith('RWQ') || value.startsWith('RWT') || value.startsWith('RWS')) {
    return true
  }

  // Формат 1: base64 от файла. Проверяем, что внутри действительно ключ
  // minisign, а не произвольный текст.
  let decoded
  try {
    decoded = Buffer.from(value, 'base64').toString('utf8')
  } catch {
    return false
  }

  if (!decoded.includes('minisign public key')) return false
  return /^(RWQ|RWT|RWS)/m.test(decoded)
}

if (!enabled) {
  writeFileSync(
    target,
    `${JSON.stringify({ bundle: { createUpdaterArtifacts: false } }, null, 2)}\n`,
    'utf8'
  )
  console.log('updater: выключен (TAURI_UPDATER_ENABLED не равен true) — сборка без артефактов обновления')
  process.exit(0)
}

if (!publicKey || !looksLikePublicKey(publicKey)) {
  console.error('updater: включён, но TAURI_UPDATER_PUBLIC_KEY не задан или не похож на minisign-ключ')
  process.exit(1)
}

if (!hasPrivateKey || !hasPassword) {
  console.error('updater: включён, но не заданы TAURI_SIGNING_PRIVATE_KEY и TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
  process.exit(1)
}

writeFileSync(
  target,
  `${JSON.stringify(
    {
      bundle: { createUpdaterArtifacts: true },
      plugins: { updater: { pubkey: publicKey } }
    },
    null,
    2
  )}\n`,
  'utf8'
)
console.log('updater: включён, публичный ключ подставлен, артефакты обновления запрошены')
