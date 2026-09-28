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

/** Мини-ключ minisign начинается с этих префиксов (base64 « Rw = public key). */
function looksLikePublicKey(value) {
  return value.startsWith('RWQ') || value.startsWith('RWT') || value.startsWith('RWS')
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
