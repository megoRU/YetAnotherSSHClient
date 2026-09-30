//! Приватные ключи SSH — порт `electron/src/private-key.ts` и
//! `src/utils/privateKey.ts`.
//!
//! Единая точка резолва ключа для SSH, SFTP, MCP и проброса портов:
//! зашифрованный `SSHConfig.privateKey` — единственный источник истины,
//! `privateKeyPath` используется только для legacy-серверов, у которых
//! `privateKey` отсутствует.

use std::sync::Arc;

use russh::keys::ssh_key::private::{Ed25519Keypair, RsaKeypair, RsaPrivateKey};
use russh::keys::ssh_key::public::RsaPublicKey;
use russh::keys::ssh_key::Mpint;
use russh::keys::PrivateKey;

use crate::config::{EncryptedSecret, SshConfig};
use crate::vault;

const OPENSSH_MAGIC: &[u8] = b"openssh-key-v1\0";

/// Причина отказа при работе с ключом.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrivateKeyFailure {
    Read,
    Decrypt,
    Locked,
    Invalid,
    Missing,
    Passphrase,
}

#[derive(Debug, Clone)]
pub struct PrivateKeyError {
    pub failure: PrivateKeyFailure,
    pub message: String,
}

impl PrivateKeyError {
    fn new(failure: PrivateKeyFailure, message: impl Into<String>) -> Self {
        PrivateKeyError { failure, message: message.into() }
    }

    /// Локализованный текст для UI (тот же набор ключей, что и в TS-версии).
    pub fn localized(&self) -> String {
        crate::i18n::t(self.i18n_key(), &[])
    }

    fn i18n_key(&self) -> &'static str {
        match self.failure {
            PrivateKeyFailure::Read => "errors.readPrivateKeyFailed",
            PrivateKeyFailure::Decrypt => "errors.privateKeyDecryptFailed",
            PrivateKeyFailure::Locked => "errors.vaultLocked",
            PrivateKeyFailure::Invalid => "errors.invalidPrivateKey",
            PrivateKeyFailure::Missing => "errors.privateKeyNotSet",
            PrivateKeyFailure::Passphrase => "errors.keyPassphraseRequired",
        }
    }
}

impl std::fmt::Display for PrivateKeyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.failure {
            PrivateKeyFailure::Read => f.write_str(&self.message),
            _ => f.write_str(&self.localized()),
        }
    }
}

impl std::error::Error for PrivateKeyError {}

// ── Проверка формата ─────────────────────────────────────────────────────────

const PEM_HEADER: &str = "-----BEGIN ";
const PEM_FOOTER_MARKER: &str = "PRIVATE KEY-----";

/// Проверка пригодности содержимого ключа для хранения и загрузки.
///
/// Проверяется формат, а не работоспособность: «ключ рабочий» утверждать
/// нельзя до попытки авторизации. Незашифрованный ключ должен ещё и
/// разбираться — тем же разбором, что и `parse_key`, иначе проверка пропустила
/// бы ключ, который всё равно упал бы при подключении. Ключ с парольной
/// фразой, наоборот, принимается по структуре: без фразы он не разбирается.
pub fn is_supported_private_key_format(content: &str) -> bool {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return false;
    }

    if trimmed.starts_with("PuTTY-User-Key-File") {
        return is_ppk_structure_valid(trimmed);
    }

    if !trimmed.contains(PEM_HEADER) || !trimmed.contains(PEM_FOOTER_MARKER) {
        return false;
    }

    // Ключ с парольной фразой: node:crypto без пароля его не прочитает, но
    // формат валиден.
    if is_encrypted_private_key_content(trimmed) {
        return true;
    }

    // Реальный разбор доступных нам форматов (OpenSSH-контейнер, PEM).
    PrivateKey::from_openssh(trimmed).is_ok() || parse_pem_key(trimmed).is_ok()
}

fn is_ppk_structure_valid(content: &str) -> bool {
    content.starts_with("PuTTY-User-Key-File-")
        && content.contains("Encryption:")
        && has_numeric_header(content, "Public-Lines:")
        && has_numeric_header(content, "Private-Lines:")
}

fn has_numeric_header(content: &str, header: &str) -> bool {
    content.lines().any(|line| {
        let Some(rest) = line.trim().strip_prefix(header) else { return false };
        // PuTTY пишет `Public-Lines: 2` — после двоточия всегда пробел,
        // иначе числовой заголовок не распознаётся и ключ отвергается.
        let digits = rest.trim();
        !digits.is_empty() && digits.chars().all(|ch| ch.is_ascii_digit())
    })
}

/// Требуется ли парольная фраза для этого ключа.
///
/// Определяются все варианты, которые понимает ssh2: PKCS#8
/// (`ENCRYPTED PRIVATE KEY`), classic PEM с `Proc-Type`/`DEK-Info`,
/// контейнер OpenSSH с непустым `ciphername` и PPK с секцией `Encryption`.
pub fn is_encrypted_private_key_content(content: &str) -> bool {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return false;
    }

    if trimmed.contains("-----BEGIN ENCRYPTED PRIVATE KEY-----")
        || trimmed.contains("Proc-Type: 4,ENCRYPTED")
        || trimmed.lines().any(|line| line.starts_with("DEK-Info:"))
        || trimmed.contains("Encryption:")
    {
        return true;
    }

    // Контейнер OpenSSH: авторитетно — через ssh-key, структурно — по
    // заголовку, когда разбор не удался.
    if let Ok(key) = PrivateKey::from_openssh(trimmed) {
        return key.is_encrypted();
    }

    open_ssh_cipher_is_encrypted(trimmed)
}

/// Структурная проверка заголовка контейнера `openssh-key-v1`.
///
/// Используется только как фолбэк: повреждённый контейнер не должен
/// приводить к запросу парольной фразы (её не поможет).
fn open_ssh_cipher_is_encrypted(trimmed: &str) -> bool {
    let Some(buffer) = open_ssh_container_body(trimmed) else { return false };
    if buffer.len() <= OPENSSH_MAGIC.len() + 4 || !buffer.starts_with(OPENSSH_MAGIC) {
        return false;
    }

    let length_offset = OPENSSH_MAGIC.len();
    let cipher_len = u32::from_be_bytes([
        buffer[length_offset],
        buffer[length_offset + 1],
        buffer[length_offset + 2],
        buffer[length_offset + 3],
    ]) as usize;
    if cipher_len == 0 {
        return false;
    }
    let start = length_offset + 4;
    if start + cipher_len > buffer.len() {
        return false;
    }
    match std::str::from_utf8(&buffer[start..start + cipher_len]) {
        Ok(name) => !name.is_empty() && name != "none",
        Err(_) => false,
    }
}

/// Декодированное тело контейнера `-----BEGIN OPENSSH PRIVATE KEY-----`.
fn open_ssh_container_body(content: &str) -> Option<Vec<u8>> {
    const BEGIN: &str = "-----BEGIN OPENSSH PRIVATE KEY-----";
    const END: &str = "-----END OPENSSH PRIVATE KEY-----";

    let start = content.find(BEGIN)? + BEGIN.len();
    let stop = content[start..].find(END)? + start;

    let mut base64 = String::with_capacity(stop - start);
    base64.extend(content[start..stop].chars().filter(|ch| !ch.is_whitespace()));

    let only_base64 = !base64.is_empty()
        && base64
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/' || byte == b'=');
    if base64.len() < 32 || !only_base64 {
        return None;
    }

    decode_base64(&base64).ok()
}

fn decode_base64(text: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;
    STANDARD.decode(text).map_err(|err| err.to_string())
}

// ── Резолв ключа ─────────────────────────────────────────────────────────────

/// Достаёт содержимое приватного ключа для подключения.
///
/// `privateKey` (зашифрованный blob) имеет приоритет над `privateKeyPath`:
/// даже если blob не расшифровывается, возвращается понятная ошибка, а не
/// тихий переход к файлу — иначе «битый» ключ молча подменялся бы другим.
pub fn resolve_private_key(config: &SshConfig) -> Result<Vec<u8>, PrivateKeyError> {
    if let Some(secret) = config.private_key_secret() {
        if !vault::is_unlocked() {
            return Err(PrivateKeyError::new(PrivateKeyFailure::Locked, "PRIVATE_KEY_VAULT_LOCKED"));
        }
        let content = vault::decrypt(&secret)
            .map_err(|_| PrivateKeyError::new(PrivateKeyFailure::Decrypt, "PRIVATE_KEY_DECRYPT_FAILED"))?;
        return Ok(content.into_bytes());
    }

    if let Some(path) = config.private_key_path.as_ref() {
        return std::fs::read(path)
            .map_err(|err| PrivateKeyError::new(PrivateKeyFailure::Read, err.to_string()));
    }

    Err(PrivateKeyError::new(PrivateKeyFailure::Missing, "PRIVATE_KEY_NOT_FOUND"))
}

/// Расшифровывает blob, введённый пользователем в текущей сессии.
pub fn decrypt_session_secret(secret: &EncryptedSecret) -> Result<Vec<u8>, PrivateKeyError> {
    if !vault::is_unlocked() {
        return Err(PrivateKeyError::new(PrivateKeyFailure::Locked, "PRIVATE_KEY_VAULT_LOCKED"));
    }
    let content = vault::decrypt(secret)
        .map_err(|_| PrivateKeyError::new(PrivateKeyFailure::Decrypt, "PRIVATE_KEY_DECRYPT_FAILED"))?;
    Ok(content.into_bytes())
}

/// Разбирает содержимое ключа в объект, при необходимости с парольной фразой.
///
/// Поддерживаются контейнер OpenSSH, формат PuTTY (PPK) и незашифрованные
/// PEM-ключи (PKCS#8 и PKCS#1) — тот же набор, что принимала Electron-версия
/// через `node:crypto`.
pub fn parse_key(
    content: &[u8],
    passphrase: Option<&str>,
) -> Result<Arc<PrivateKey>, PrivateKeyError> {
    let text = String::from_utf8_lossy(content).to_string();

    // Контейнер OpenSSH и PPK разбирает `ssh-key`, PEM — см. `parse_pem_key`.
    let parsed = PrivateKey::from_openssh(&text)
        .or_else(|_| PrivateKey::from_ppk(&text, passphrase.map(str::to_owned)));
    let key = match parsed {
        Ok(key) => key,
        Err(_) => {
            let pem = parse_pem_key(&text)?;
            // PEM всегда незашифрованный: шифрованные варианты `parse_pem_key`
            // отклоняет, поэтому парольная фраза к нему неприменима.
            if pem.is_encrypted() {
                return Err(PrivateKeyError::new(PrivateKeyFailure::Invalid, "encrypted pem"));
            }
            pem
        }
    };

    Ok(Arc::new(decrypt_if_needed(key, passphrase)?))
}

/// Расшифровывает ключ, если он зашифрован; без парольной фразы — понятная ошибка.
fn decrypt_if_needed(key: PrivateKey, passphrase: Option<&str>) -> Result<PrivateKey, PrivateKeyError> {
    if !key.is_encrypted() {
        return Ok(key);
    }
    match passphrase {
        Some(passphrase) => key
            .decrypt(passphrase)
            .map_err(|_| PrivateKeyError::new(PrivateKeyFailure::Passphrase, "bad passphrase")),
        None => Err(PrivateKeyError::new(PrivateKeyFailure::Passphrase, "passphrase required")),
    }
}

// ── PEM (PKCS#8 / PKCS#1) ─────────────────────────────────────────────────────
//
// Форматы PEM (PKCS#8, PKCS#1) `ssh-key` не читает, а Electron-версия принимала
// их через `node:crypto`, поэтому разбор сделан здесь: PEM-обёртка снимается
// штатным base64, а ASN.1 DER разбирается минимальнымreader'ом. Поддерживаются
// Ed25519 (PKCS#8, RFC 8410) и RSA (PKCS#8 и PKCS#1).
//
// Зашифрованные PEM-ключи (`ENCRYPTED PRIVATE KEY`, `Proc-Type: 4,ENCRYPTED`)
// не разбираются: для них нужен PBES2/PBKDF2 и AES-CBC, а `ssh-key` их не
// умеет. Валидация формата такие ключи по-прежнему принимает, но подключение
// завершится ошибкой `PrivateKeyFailure::Invalid`.

/// Метка PEM-блока и его содержимое в DER.
fn decode_pem_block(content: &str) -> Option<(&str, Vec<u8>)> {
    let label_start = content.find(PEM_HEADER)? + PEM_HEADER.len();
    let label_end = label_start + content[label_start..].find("-----")?;
    let label = content[label_start..label_end].trim();

    let body_start = label_end + "-----".len();
    let end_marker = "-----END ";
    let end_label_start = content[body_start..].find(end_marker)? + body_start + end_marker.len();
    let end_label_end = end_label_start + content[end_label_start..].find("-----")?;
    let end_label = content[end_label_start..end_label_end].trim();

    // Метка BEGIN и END должны совпадать: иначе блок собран из разных частей.
    if label.is_empty() || end_label != label {
        return None;
    }

    let body_end = content[body_start..].find("\n-----").map(|offset| body_start + offset)?;
    let mut base64 = String::with_capacity(body_end - body_start);
    base64.extend(content[body_start..body_end].chars().filter(|ch| !ch.is_whitespace()));
    decode_base64(&base64).ok().map(|der| (label, der))
}

/// Разбирает незашифрованный PEM-ключ в объект `ssh-key`.
fn parse_pem_key(content: &str) -> Result<PrivateKey, PrivateKeyError> {
    let Some((label, der)) = decode_pem_block(content) else {
        return Err(PrivateKeyError::new(PrivateKeyFailure::Invalid, "invalid pem"));
    };

    match label {
        "PRIVATE KEY" => parse_pkcs8(&der),
        "RSA PRIVATE KEY" => parse_pkcs1_rsa(&der),
        // EC (SEC1) и DSA: `ssh-key` не умеет собирать такие ключи из DER
        // без дополнительных крипто-зависимостей, поэтому честный отказ.
        _ => Err(PrivateKeyError::new(PrivateKeyFailure::Invalid, "unsupported pem")),
    }
}



/// Один элемент ASN.1 DER: тег, содержимое и остаток буфера.
struct DerElement<'a> {
    tag: u8,
    contents: &'a [u8],
    rest: &'a [u8],
}

const DER_INTEGER: u8 = 0x02;

const DER_OCTET_STRING: u8 = 0x04;
const DER_OBJECT_IDENTIFIER: u8 = 0x06;
const DER_SEQUENCE: u8 = 0x30;

/// OID Ed25519 (`1.3.101.112`).
const OID_ED25519: &[u8] = &[0x2b, 0x65, 0x70];

/// Читает очередной TLV-элемент.
fn der_next(input: &[u8]) -> Option<DerElement<'_>> {
    let (&tag, tail) = input.split_first()?;
    let (&first_length, tail) = tail.split_first()?;

    let (length, tail) = if first_length & 0x80 == 0 {
        (usize::from(first_length), tail)
    } else {
        let count = usize::from(first_length & 0x7f);
        // Много��айтовые длины в ключах не встречаются, но ограничиваем разбор,
        // чтобы повреждённый ключ не приводил к огромным выделениям.
        if count == 0 || count > 4 || tail.len() < count {
            return None;
        }
        let (bytes, tail) = tail.split_at(count);
        let length = bytes.iter().try_fold(0usize, |acc, byte| acc.checked_shl(8)?.checked_add(usize::from(*byte)))?;
        (length, tail)
    };

    if tail.len() < length {
        return None;
    }
    let (contents, rest) = tail.split_at(length);
    Some(DerElement { tag, contents, rest })
}

/// Содержимое элемента с ожидаемым тегом.
fn der_expect<'a>(element: &DerElement<'a>, tag: u8) -> Option<&'a [u8]> {
    (element.tag == tag).then_some(element.contents)
}

/// Положительное DER-`INTEGER` без ведущего нулевого байта.
fn der_positive_integer(element: &DerElement<'_>) -> Option<Vec<u8>> {
    let mut bytes = der_expect(element, DER_INTEGER)?;
    // DER кодирует положительные числа со ведущим 0x00, если старший бит установлен.
    while bytes.first() == Some(&0) {
        bytes = &bytes[1..];
    }
    if bytes.is_empty() {
        return None;
    }
    Some(bytes.to_vec())
}

/// `PrivateKeyInfo` по RFC 8418 (PKCS#8).
fn parse_pkcs8(der: &[u8]) -> Result<PrivateKey, PrivateKeyError> {
    let invalid = || PrivateKeyError::new(PrivateKeyFailure::Invalid, "invalid pkcs8");
    let outer = der_next(der).ok_or_else(invalid)?;
    if der_expect(&outer, DER_SEQUENCE).is_none() {
        return Err(invalid());
    }

    // Версия — целое число, но она равна 0, поэтому на «положительность» не проверяется.
    let version = der_next(outer.contents).ok_or_else(invalid)?;
    if der_expect(&version, DER_INTEGER).is_none() {
        return Err(invalid());
    }

    let algorithm = der_next(version.rest).ok_or_else(invalid)?;
    let algorithm_id = der_next(algorithm.contents).ok_or_else(invalid)?;
    let oid = der_expect(&algorithm_id, DER_OBJECT_IDENTIFIER).ok_or_else(invalid)?;

    // После AlgorithmIdentifier (у Ed25519 он состоит только из OID, без
    // параметров) идёт OCTET STRING с ключом алгоритма.
    let private_key = der_next(algorithm.rest).ok_or_else(invalid)?;
    let key_bytes = der_expect(&private_key, DER_OCTET_STRING).ok_or_else(invalid)?;
    build_pkcs8_key(oid, key_bytes)
}

fn build_pkcs8_key(oid: &[u8], key_bytes: &[u8]) -> Result<PrivateKey, PrivateKeyError> {
    if oid == OID_ED25519 {
        // RFC 8410: ключ — OCTET STRING с 32-байтовым зерном.
        let seed_element = der_next(key_bytes)
            .ok_or_else(|| PrivateKeyError::new(PrivateKeyFailure::Invalid, "invalid pkcs8"))?;
        let seed = der_expect(&seed_element, DER_OCTET_STRING)
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or_else(|| PrivateKeyError::new(PrivateKeyFailure::Invalid, "invalid pkcs8"))?;
        return Ok(PrivateKey::from(Ed25519Keypair::from_seed(seed)));
    }

    // rsaEncryption (1.2.840.113549.1.1.1) и всё остальное: RSA-ключ внутри
    // лежит в PKCS#1, остальные алгоритмы для SSH не используются.
    parse_pkcs1_rsa(key_bytes)
}

/// `RSAPrivateKey` (PKCS#1).
fn parse_pkcs1_rsa(der: &[u8]) -> Result<PrivateKey, PrivateKeyError> {
    let invalid = || PrivateKeyError::new(PrivateKeyFailure::Invalid, "invalid pkcs1");
    let numbers = read_pkcs1_numbers(der).ok_or_else(invalid)?;

    // Порядок полей в DER не совпадает с порядком аргументов конструкторов
    // `ssh-key`, поэтому индексы переставлены явно.
    let number = |index: usize| numbers[index].clone();
    let public = RsaPublicKey::new(number(1), number(0)).map_err(|_| invalid())?;
    let private = RsaPrivateKey::new(number(2), number(7), number(3), number(4)).map_err(|_| invalid())?;
    let keypair = RsaKeypair::new(public, private).map_err(|_| invalid())?;
    Ok(PrivateKey::from(keypair))
}

/// Компоненты `RSAPrivateKey` в порядке полей DER: `n`, `e`, `d`, `p`, `q`,
/// `dp`, `dq`, `qinv`.
///
/// Отдельная функция нужна не только для читаемости: порядок полей в DER и
/// порядок аргументов конструкторов `ssh-key` различаются, и перестановка
/// местами не дала бы ошибки компиляции — ключ получился бы «не тот».
fn read_pkcs1_numbers(der: &[u8]) -> Option<[Mpint; 8]> {
    let outer = der_next(der)?;
    if der_expect(&outer, DER_SEQUENCE).is_none() {
        return None;
    }

    // Первое поле — версия, она не входит в результат.
    let mut cursor = der_next(outer.contents)?.rest;
    let mut numbers: Vec<Mpint> = Vec::with_capacity(8);
    for _ in 0..8 {
        let element = der_next(cursor)?;
        numbers.push(Mpint::from_positive_bytes(&der_positive_integer(&element)?));
        cursor = element.rest;
    }
    numbers.try_into().ok()
}

#[cfg(test)]
#[path = "tests/keys.rs"]
mod tests;
