use super::*;

// ── Генерация тестовых ключей ────────────────────────────────────────────────
//
// Приватных ключей в исходниках нет: и почерк-сканеры, и поиск по репозиторию
// не должны находить «ключи» в коде. Все ключи создаются при запуске теста из
// системной энтропии.

/// Случайное зерно Ed25519-ключа.
fn random_seed() -> [u8; 32] {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).expect("системная энтропия");
    seed
}

/// Свежий ключ Ed25519.
fn ed25519_key() -> PrivateKey {
    PrivateKey::from(Ed25519Keypair::from_seed(&random_seed()))
}

/// Свежий RSA-ключ.
///
/// 1024 бит — достаточно, чтобы проверить разбор DER, и достаточно быстро,
/// чтобы не замедлять прогон тестов.
fn rsa_key() -> rsa::RsaPrivateKey {
    rsa::RsaPrivateKey::new(&mut rand::rng(), 1024).expect("генерация RSA-ключа")
}

// ── Минимальный writer DER ───────────────────────────────────────────────────
//
// Нужен, чтобы собрать тестовые PEM-ключи в точности в формате, который
// использует `openssl` и `node:crypto`.

/// Длина элемента в DER: короткая или длинная форма.
fn der_length(length: usize) -> Vec<u8> {
    if length < 0x80 {
        return vec![length as u8];
    }
    let bytes = length.to_be_bytes();
    let start = bytes.iter().position(|byte| *byte != 0).unwrap_or(bytes.len() - 1);
    let significant = &bytes[start..];
    let mut out = vec![0x80 | significant.len() as u8];
    out.extend_from_slice(significant);
    out
}

/// Элемент DER: тег, длина и содержимое.
fn der_element(tag: u8, contents: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    out.extend_from_slice(&der_length(contents.len()));
    out.extend_from_slice(contents);
    out
}

/// `SEQUENCE` из готовых элементов.
fn der_sequence(elements: &[Vec<u8>]) -> Vec<u8> {
    let body: Vec<u8> = elements.concat();
    der_element(0x30, &body)
}

/// `INTEGER` без знака (для номеров и флагов).
fn der_integer(value: &[u8]) -> Vec<u8> {
    // DER требует ведущий 0x00, когда старший бит установлен.
    let mut body = Vec::with_capacity(value.len() + 1);
    if value.first().is_some_and(|byte| byte & 0x80 != 0) {
        body.push(0x00);
    }
    body.extend_from_slice(value);
    der_element(0x02, &body)
}

fn der_octet_string(contents: &[u8]) -> Vec<u8> {
    der_element(0x04, contents)
}

fn der_object_identifier(oid: &[u8]) -> Vec<u8> {
    der_element(0x06, oid)
}

/// OID Ed25519 (`1.3.101.112`).
const OID_ED25519: &[u8] = &[0x2b, 0x65, 0x70];
/// OID `id-ecPublicKey` (`1.2.840.10045.2.1`).
const OID_EC_PUBLIC_KEY: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];

/// `PrivateKeyInfo` (PKCS#8) с ключом Ed25519: RFC 8410 оборачивает 32-байтовое
/// зерно ещё одним `OCTET STRING`.
fn pkcs8_ed25519_der() -> Vec<u8> {
    der_sequence(&[
        der_integer(&[0x00]),
        der_sequence(&[der_object_identifier(OID_ED25519)]),
        der_octet_string(&der_octet_string(&random_seed())),
    ])
}

/// `PrivateKeyInfo` (PKCS#8) с EC-ключом: разбирается он же, но собирать
/// ECDSA-ключ из DER приложение не умеет.
fn pkcs8_ec_der() -> Vec<u8> {
    der_sequence(&[
        der_integer(&[0x00]),
        der_sequence(&[der_object_identifier(OID_EC_PUBLIC_KEY), der_octet_string(&[0x2a])]),
        der_octet_string(&der_octet_string(&random_seed())),
    ])
}

/// `PrivateKeyInfo` (PKCS#8) с RSA-ключом: внутри — `RSAPrivateKey` (PKCS#1).
fn pkcs8_rsa_der(key: &rsa::RsaPrivateKey) -> Vec<u8> {
    let pkcs1 = pkcs1_der(key);
    der_sequence(&[
        der_integer(&[0x00]),
        der_sequence(&[
            der_object_identifier(&[0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]),
            der_element(0x05, &[]),
        ]),
        der_octet_string(&pkcs1),
    ])
}

/// `RSAPrivateKey` (PKCS#1) в виде PEM.
fn pem_rsa_pkcs1(key: &rsa::RsaPrivateKey) -> String {
    pem("RSA PRIVATE KEY", &pkcs1_der(key))
}

/// DER `RSAPrivateKey` (PKCS#1).
fn pkcs1_der(key: &rsa::RsaPrivateKey) -> Vec<u8> {
    use rsa::pkcs1::EncodeRsaPrivateKey;

    key.to_pkcs1_der().expect("PKCS#1").as_bytes().to_vec()
}

/// Оборачивает DER в PEM-текст (строки по 64 символа, как это делает OpenSSL).
fn pem(label: &str, der: &[u8]) -> String {
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD;

    let body = STANDARD.encode(der);
    let mut wrapped = String::with_capacity(body.len() + body.len() / 64 + 1);
    for (index, chunk) in body.as_bytes().chunks(64).enumerate() {
        if index > 0 {
            wrapped.push('\n');
        }
        wrapped.push_str(std::str::from_utf8(chunk).expect("base64 — это текст"));
    }
    format!("-----BEGIN {label}-----\n{wrapped}\n-----END {label}-----")
}

/// Синтетический контейнер `openssh-key-v1`: magic + header-строки + приватный
/// блок. Криптографически невалиден — так и должен отвергаться.
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

    pem("OPENSSH PRIVATE KEY", &body)
}

/// Отпечаток публичного ключа: он определяет, один ли перед нами ключ.
fn fingerprint(key: &PrivateKey) -> String {
    russh::keys::ssh_key::PublicKey::from(key)
        .fingerprint(russh::keys::ssh_key::HashAlg::Sha256)
        .to_string()
}

fn algorithm_of(key: &PrivateKey) -> String {
    format!("{:?}", key.algorithm())
}

// ── Контейнер OpenSSH ────────────────────────────────────────────────────────

#[test]
fn не_расшифрованный_контейнер_должен_разбираться() {
    // Контейнер собран вручную и криптографически невалиден, поэтому
    // принимать его нельзя: `parse_key` использует тот же разбор и на
    // авторизации такой ключ всё равно упал бы. Структурной проверки
    // достаточно там, где разбор невозможен из-за парольной фразы
    // (см. `определяет_шифрование_по_имени_шифра`).
    let container = build_open_ssh_container("none");
    assert!(!is_supported_private_key_format(&container));
    assert!(!is_encrypted_private_key_content(&container));
}

#[test]
fn определяет_шифрование_по_имени_шифра() {
    let container = build_open_ssh_container("aes256-ctr");
    assert!(is_encrypted_private_key_content(&container));
}

/// Настоящий ключ OpenSSH обязан приниматься и разбираться: это основной
/// формат, который отдаёт `ssh-keygen`.
#[test]
fn принимает_настоящий_контейнер_openssh() {
    let key = ed25519_key();
    let text = key.to_openssh(russh::keys::ssh_key::LineEnding::LF).expect("OpenSSH-текст");

    assert!(is_supported_private_key_format(&text));
    assert!(!is_encrypted_private_key_content(&text));
    let parsed = parse_key(text.as_bytes(), None).expect("разбор OpenSSH-ключа");
    assert_eq!(fingerprint(&parsed), fingerprint(&key));
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

// ── PEM (PKCS#8 / PKCS#1) ────────────────────────────────────────────────────

#[test]
fn разбирает_pem_ed25519_pkcs8() {
    let pem = pem("PRIVATE KEY", &pkcs8_ed25519_der());
    assert!(is_supported_private_key_format(&pem));
    assert!(!is_encrypted_private_key_content(&pem));

    let key = parse_key(pem.as_bytes(), None).expect("разбор PEM Ed25519");
    assert!(algorithm_of(&key).contains("Ed25519"));
    assert!(!key.is_encrypted());
}

/// Зерно из PEM обязано совпасть с исходным ключом: иначе разбор подставил бы
/// чужие байты и авторизация прошла бы не тем ключом.
#[test]
fn разбирает_pem_ed25519_без_потери_ключа() {
    let seed = random_seed();
    let expected = PrivateKey::from(Ed25519Keypair::from_seed(&seed));

    // RFC 8410: внутри PKCS#8 зерно лежит ещё в одном `OCTET STRING`.
    let pem = pem(
        "PRIVATE KEY",
        &der_sequence(&[
            der_integer(&[0x00]),
            der_sequence(&[der_object_identifier(OID_ED25519)]),
            der_octet_string(&der_octet_string(&seed)),
        ]),
    );

    let parsed = parse_key(pem.as_bytes(), None).expect("разбор PEM Ed25519");
    assert_eq!(fingerprint(&parsed), fingerprint(&expected), "разбор подменил зерно ключа");
}

#[test]
fn разбирает_pem_rsa_pkcs8() {
    let pem = pem("PRIVATE KEY", &pkcs8_rsa_der(&rsa_key()));

    assert!(is_supported_private_key_format(&pem));
    let key = parse_key(pem.as_bytes(), None).expect("разбор PEM RSA PKCS#8");
    assert!(algorithm_of(&key).contains("Rsa"));
}

#[test]
fn разбирает_pem_rsa_pkcs1() {
    let pem = pem_rsa_pkcs1(&rsa_key());

    assert!(is_supported_private_key_format(&pem));
    let key = parse_key(pem.as_bytes(), None).expect("разбор PEM RSA PKCS#1");
    assert!(algorithm_of(&key).contains("Rsa"));
}

/// PKCS#8 и PKCS#1 описывают один и тот же RSA-ключ, поэтому публичные части
/// должны совпадать: это проверяет, что разбор PKCS#8 не теряет компоненты.
#[test]
fn pkcs8_и_pkcs1_дают_один_ключ() {
    let key = rsa_key();
    let from_pkcs8 = parse_key(pem("PRIVATE KEY", &pkcs8_rsa_der(&key)).as_bytes(), None).expect("PKCS#8");
    let from_pkcs1 = parse_key(pem_rsa_pkcs1(&key).as_bytes(), None).expect("PKCS#1");

    assert_eq!(fingerprint(&from_pkcs8), fingerprint(&from_pkcs1));
}

/// Компоненты RSA читаются из DER по номеру поля, поэтому проверяем их
/// пересборкой: тот же DER, собранный обратно из прочитанных чисел, обязан
/// совпасть байт в байт с исходным (`rsa`-крейт его и сериализовал).
///
/// Так ловится и пропущенное поле, и перестановка `p`/`q` или `d`/`qinv`:
/// ошибки компиляции они не дают, а ключ получается «не тот».
#[test]
fn компоненты_rsa_читаются_верно() {
    let der = pkcs1_der(&rsa_key());
    let numbers = read_pkcs1_numbers(&der).expect("разбор компонентов");
    let bytes = |value: &russh::keys::ssh_key::Mpint| value.as_positive_bytes().expect("положительное").to_vec();

    // version, n, e, d, p, q, dp, dq, qinv — по RFC 8017.
    let rebuilt = der_sequence(&[
        der_integer(&[0x00]),
        der_integer(&bytes(&numbers[0])),
        der_integer(&bytes(&numbers[1])),
        der_integer(&bytes(&numbers[2])),
        der_integer(&bytes(&numbers[3])),
        der_integer(&bytes(&numbers[4])),
        der_integer(&bytes(&numbers[5])),
        der_integer(&bytes(&numbers[6])),
        der_integer(&bytes(&numbers[7])),
    ]);

    assert_eq!(rebuilt, der, "разбор PKCS#1 исказил поля или их порядок");
}

#[test]
fn pem_с_ec_ключом_не_поддерживается() {
    // Формат PEM валиден, но собирать ECDSA-ключи из DER без
    // крипто-зависимостей нечем. Отказ на этапе проверки формата — лучше,
    // чем принять ключ при импорте и упасть на подключении.
    let pem = pem("PRIVATE KEY", &pkcs8_ec_der());
    assert!(!is_supported_private_key_format(&pem));
    let error = parse_key(pem.as_bytes(), None).expect_err("EC не поддерживается");
    assert_eq!(error.failure, PrivateKeyFailure::Invalid);
}

#[test]
fn зашифрованный_pem_не_разбирается() {
    let encrypted = "-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----";
    // Валидация формата проходит (структура верная) — иначе ключ нельзя
    // было бы сохранить, — но подключение честно падает.
    assert!(is_supported_private_key_format(encrypted));
    assert!(is_encrypted_private_key_content(encrypted));
    assert!(parse_key(encrypted.as_bytes(), Some("secret")).is_err());
}

#[test]
fn отбрасывает_искажённый_pem() {
    // Обрезанный PKCS#8 и PEM с чужим заголовком.
    let truncated = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2Vw\n-----END PRIVATE KEY-----";
    assert!(parse_key(truncated.as_bytes(), None).is_err());
    assert!(parse_pem_key("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----").is_err());
    // Несовпадение меток BEGIN/END.
    assert!(parse_pem_key("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----").is_err());
    // Корректная метка, но не DER.
    assert!(parse_pem_key("-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----").is_err());
}

// ── Резолв ключа ─────────────────────────────────────────────────────────────

#[test]
fn blob_приоритетнее_пути() {
    // Хранилище глобальное: пока держим guard, соседний тест его не переоткроет.
    let _guard = vault::test_guard();
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

/// Закрытое хранилище обязано давать понятную ошибку, а не пустой ключ:
/// иначе авторизация ушла бы с «пустым» ключом и падала непонятно.
#[test]
fn закрытое_хранилище_даёт_locked() {
    let _guard = vault::test_guard();
    vault::unlock(&crate::paths::random_base64(32), &crate::paths::random_base64(16)).expect("unlock");
    let secret = vault::encrypt("материал").expect("encrypt");
    vault::lock();

    let config = SshConfig {
        id: Some("srv-1".to_owned()),
        name: "s".to_owned(),
        user: "u".to_owned(),
        host: "h".to_owned(),
        port: 22,
        private_key: serde_json::to_value(secret).ok(),
        ..SshConfig::default()
    };

    let err = resolve_private_key(&config).expect_err("хранилище закрыто");
    assert_eq!(err.failure, PrivateKeyFailure::Locked);
    assert_eq!(err.localized(), crate::i18n::t("errors.vaultLocked", &[]));
}

/// Несуществующий файл ключа — это ошибка чтения с системным текстом: его
/// показывают пользователю, поэтому он не должен быть пустым.
#[test]
fn отсутствующий_файл_даёт_read() {
    let config = SshConfig {
        name: "s".to_owned(),
        user: "u".to_owned(),
        host: "h".to_owned(),
        port: 22,
        private_key_path: Some("/no/such/private_key".to_owned()),
        ..SshConfig::default()
    };

    let err = resolve_private_key(&config).expect_err("файла нет");
    assert_eq!(err.failure, PrivateKeyFailure::Read);
    assert!(!err.message.is_empty(), "пользователю покажут пустую ошибку");
}