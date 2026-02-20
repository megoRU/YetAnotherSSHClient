# YetAnotherSSHClient

**YetAnotherSSHClient** — лёгкий SSH-клиент на Java (Swing) для быстрого подключения к серверам без лишней сложности. Подходит для повседневного администрирования и работы с несколькими хостами.

## Возможности

- Поддержка вкладок
- Добавление сервера в избранное
- Аутентификация по ключу
- Множество тем оформления
- Гибкая настройка шрифтов

## Скриншот

![Main view](https://github.com/megoRU/YetAnotherSSHClient/blob/main/images/YASSHClient.png?raw=true)

## Требования

- Для запуска: Java 21+

## Используемые технологии

[**JediTerm**](https://github.com/JetBrains/jediterm)  
[**PTY4J**](https://github.com/JetBrains/pty4j)  
[**Apache MINA SSHD**](https://mina.apache.org/sshd-project/)  
[**FlatLaf**](https://www.formdev.com/flatlaf/)  
[**Gson**](https://github.com/google/gson)

## Конфигурация

Файл настроек хранится локально:

- **Windows:** `C:\Users\<имя_пользователя>\.minissh_config.json`
- **Linux / macOS:** `~/.minissh_config.json`

## Лицензия

Проект распространяется под лицензией MIT.