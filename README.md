# YetAnotherSSHClient

YetAnotherSSHClient — лёгкий SSH-клиент на Java (Swing) для быстрого подключения к серверам без лишней сложности. Подходит для повседневного администрирования и работы с несколькими хостами.

🚀 Возможности
- Поддержка вкладок
- Добавление сервера в избранное
- Аутентификация по ключу
- Множество тем оформления
- Гибкая настройка шрифтов

🖼️ Скриншот

![Main view](https://github.com/megoRU/YetAnotherSSHClient/blob/main/images/YASSHClient.png?raw=true)

🧩 Используемые технологии
- JediTerm — терминальный компонент ([ссылка](https://github.com/JetBrains/jediterm))
- PTY4J — псевдотерминалы для корректной работы команд ([ссылка](https://github.com/JetBrains/pty4j))
- Apache MINA SSHD — работа по протоколу SSH ([ссылка](https://mina.apache.org/sshd-project/))
- FlatLaf — современные темы для Swing ([ссылка](https://www.formdev.com/flatlaf/))
- Gson — сериализация конфигурации в JSON ([ссылка](https://github.com/google/gson))

📋 Требования
- Java 21+

⚙️ Конфигурация
Файл настроек хранится локально:
- Windows: `C:\Users\<имя_пользователя>\.minissh_config.json`
- Linux / macOS: `~/.minissh_config.json`

⚠️ Примечание для Windows
- Если при запуске появляется ошибка «Не удается проверить издателя», откройте свойства файла и разблокируйте его.

⚠️ Примечание для macOS / Linux  
- Запускайте через командную строку:
```bash
java -jar YetAnotherSSHClient.jar
```