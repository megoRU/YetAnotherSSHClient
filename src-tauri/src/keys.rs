//! Приватные ключи SSH — порт `electron/src/private-key.ts` и
//! `src/utils/privateKey.ts`.
//!
//! Единая точка резолва ключа для SSH, SFTP, MCP и проброса портов:
//! зашифрованный `SSHConfig.privateKey` — единственный источник истины,
//! `privateKeyPath` используется только для legacy-серверов, у которых
//! `privateKey` отсутствует.

use std::sync::Arc;

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
/// Проверяется структура, а не криптографическая валидность: «ключ рабочий»
/// утверждать нельзя до попытки авторизации.
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

    // Реальный разбор доступных нам форматов (PKCS#1/PKCS#8/SEC1).
    PrivateKey::from_openssh(trimmed).is_ok()
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
        !rest.is_empty() && rest.chars().all(|ch| ch.is_ascii_digit())
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
pub fn parse_key(
    content: &[u8],
    passphrase: Option<&str>,
) -> Result<Arc<PrivateKey>, PrivateKeyError> {
    let text = String::from_utf8_lossy(content).to_string();

    let parsed = if let Some(passphrase) = passphrase {
        PrivateKey::from_openssh(&text)
            .or_else(|_| PrivateKey::from_ppk(&text, Some(passphrase.to_owned())))
    } else {
        PrivateKey::from_openssh(&text).or_else(|_| PrivateKey::from_ppk(&text, None))
    };

    let key = parsed.map_err(|_| PrivateKeyError::new(PrivateKeyFailure::Invalid, "invalid key"))?;
    let key = if key.is_encrypted() {
        match passphrase {
            Some(passphrase) => key
                .decrypt(passphrase)
                .map_err(|_| PrivateKeyError::new(PrivateKeyFailure::Passphrase, "bad passphrase"))?,
            None => return Err(PrivateKeyError::new(PrivateKeyFailure::Passphrase, "passphrase required")),
        }
    } else {
        key
    };

    Ok(Arc::new(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    const BEGIN: &str = "-----BEGIN OPENSSH PRIVATE KEY-----";
    const END: &str = "-----END OPENSSH PRIVATE KEY-----";

    /// Синтетический контейнер `openssh-key-v1` (реальные ключи в репозитории
    /// не хранятся): magic + header-строки + N публичных ключей + приватный блок.
    fn build_open_ssh_container(ciphername: &str) -> String {
        fn push_string(out: &mut Vec<u8>, value: &[u8]) {
            out.extend_from_slice(&(value.len() as u32).to_be_bytes());
            out.extend_from_slice(value);
        }

        let mut body = OPENSSH_MAGIC.to_vec();
        push_string(&mut body, ciphername.as_bytes());
        push_string(&mut body, b"none");
        push_string(&mut body, b"");
        body.extend_from_slice(&1u32.to_be_bytes());
        push_string(&mut body, b"public-key-0");
        push_string(&mut body, b"private-block");

        use base64::Engine as _;
        use base64::engine::general_purpose::STANDARD;
        format!("{BEGIN}\n{}\n{END}", STANDARD.encode(body))
    }

    #[test]
    fn принимает_структурно_валидный_контейнер() {
        let container = build_open_ssh_container("none");
        assert!(is_supported_private_key_format(&container));
        assert!(!is_encrypted_private_key_content(&container));
    }

    #[test]
    fn определяет_шифрование_по_имени_шифра() {
        let container = build_open_ssh_container("aes256-ctr");
        assert!(is_encrypted_private_key_content(&container));
    }

    #[test]
    fn отбрасывает_мусор() {
        assert!(!is_supported_private_key_format(""));
        assert!(!is_supported_private_key_format("   "));
        assert!(!is_supported_private_key_format("not a key"));
        assert!(!is_supported_private_key_format("-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA"));
    }

    #[test]
    fn принимает_зашифрованный_pem_и_ppk() {
        let pkcs8 = "-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----";
        assert!(is_supported_private_key_format(pkcs8));
        assert!(is_encrypted_private_key_content(pkcs8));

        let ppk = concat!(
            "PuTTY-User-Key-File-2: ssh-rsa\n",
            "Encryption: aes256-cbc\n",
            "Public-Lines: 2\nAAAA\nBBBB\n",
            "Private-Lines: 1\nCCCC\n"
        );
        assert!(is_supported_private_key_format(ppk));
        assert!(is_encrypted_private_key_content(ppk));
    }

    #[test]
    fn blob_приоритетнее_пути() {
        let (key, salt) = (
            crate::paths::random_base64(32),
            crate::paths::random_base64(16),
        );
        vault::unlock(&key, &salt).expect("unlock");

        let secret = vault::encrypt("synthetic-key-material").expect("encrypt");
        let config = SshConfig {
            id: Some("srv-1".to_owned()),
            name: "s".to_owned(),
            user: "u".to_owned(),
            host: "h".to_owned(),
            port: 22,
            private_key: serde_json::to_value(secret).ok(),
            private_key_path: Some("/no/such/file".to_owned()),
            ..SshConfig::default()
        };

        let content = resolve_private_key(&config).expect("blob wins");
        assert_eq!(String::from_utf8_lossy(&content), "synthetic-key-material");
        vault::lock();
    }

    #[test]
    fn отсутствие_ключа_даёт_missing() {
        let config = SshConfig {
            name: "s".to_owned(),
            user: "u".to_owned(),
            host: "h".to_owned(),
            port: 22,
            ..SshConfig::default()
        };
        let err = resolve_private_key(&config).expect_err("missing");
        assert_eq!(err.failure, PrivateKeyFailure::Missing);
    }
}
