/**
 * Фильтр предупреждений Tauri о ненайденных callback'ах IPC.
 *
 * `tauri-plugin` печатает `[TAURI] Couldn't find callback id …`, когда ответ
 * из Rust приходит на вызов, чья запись уже удалена. В разработке это
 * происходит постоянно и безвредно: страницу перезагружает HMR, а
 * `runCallback` из `tauri/scripts/core.js` попадает на id, которого в карте
 * уже нет. Ответ при этом доставлен, состояние приложения не затронуто,
 * ничего не теряется.
 *
 * Почему фильтр, а не правка в приложении: сообщение выдаёт JS-контракт Tauri
 * (`console.warn` внутри `runCallback`), до нашего кода оно не доходит и
 * повлиять на него можно только перехватом консоли.
 *
 * Почему фильтр точечный: молчание на все `console.warn` закроет настоящие
 * проблемы. Скрывается ровно одна строка, всё останое идёт как обычно, а сам
 * факт срабатывания пишется в лог приложения на уровне `debug` — если
 * сообщений станет много, это будет видно.
 */

/** Префикс сообщения Tauri о потерянном callback'е. */
const LOST_CALLBACK_PREFIX = '[TAURI] Couldn\'t find callback id'

/** Признак, что фильтр уже установлен: `console.warn` подменён один раз. */
const INSTALLED_FLAG = '__yasshLostCallbackFilterInstalled'

/**
 * Сколько раз повторить заметку в логе перед тем, как замолчать совсем.
 *
 * В разработке сообщение приходит десятками за минуту. Заметка нужна, чтобы
 * по логу было видно, что фильтр работает и сколько таких случаев было, но
 * и Hundreds одинаковых строк в логе тоже шум — поэтому счётчик.
 */
const MAX_NOTES = 5

interface WarnCapableConsole {
    warn: (...args: unknown[]) => void
    info?: (...args: unknown[]) => void
}

/**
 * Возвращает `true`, если сообщение — потерянный callback Tauri.
 *
 * Совпадение по префиксу, а не по полному тексту: Tauri дописывает id и
 * пояснение, и их формулировка меняется между версиями. Префикс стабилен.
 */
export function isLostCallbackWarning(first: unknown): boolean {
    return typeof first === 'string' && first.startsWith(LOST_CALLBACK_PREFIX)
}

/**
 * Устанавливает фильтр один раз на переданный объект.
 *
 * Возвращает `true`, если фильтр установлен этим вызовом, `false` — если он
 * уже был установлен ранее. Идемпотентность нужна потому, что мост могут
 * вызвать повторно (HMR в разработке перезагружает модуль).
 */
export function installLostCallbackFilter(target: WarnCapableConsole = console): boolean {
    if (target[INSTALLED_FLAG as keyof WarnCapableConsole]) {
        return false
    }
    Object.defineProperty(target, INSTALLED_FLAG, { value: true, enumerable: false })

    const originalWarn = target.warn.bind(target)
    let notes = 0
    target.warn = (...args: unknown[]): void => {
        if (isLostCallbackWarning(args[0])) {
            // Сведения идут в лог приложения, а не теряются: по логу видно,
            // что фильтр работает. После `MAX_NOTES` повторов замолкаем, чтобы
            // поток таких сообщений не вытеснил из лога остальное.
            notes += 1
            if (notes <= MAX_NOTES) {
                target.info?.(`[IPC] Tauri reported a lost callback id (hidden, #${notes})`)
            }
            return
        }
        originalWarn(...args)
    }
    return true
}
