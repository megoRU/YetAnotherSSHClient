/**
 * Очередь ввода терминала: объединяет все `onData`-события одного JS-такта
 * в один IPC-вызов. Следующая микрозадача отправляет данные без ожидания кадра
 * или таймера, чтобы не добавлять задержку к обычному нажатию клавиши.
 *
 * Фрагменты соединяются один раз, поэтому большие вставки не требуют
 * многократной перекопировки уже накопленной строки. Синхронная ошибка
 * отправителя логируется и не прерывает микрозадачу.
 */
export const createInputQueue = (send: (data: string) => void): ((data: string) => void) => {
    const pending: string[] = [];
    let scheduled = false;

    return (data: string): void => {
        if (!data) return;
        pending.push(data);
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            const batch = pending.join('');
            pending.length = 0;
            if (!batch) return;
            try {
                send(batch);
            } catch (err) {
                console.warn('[inputQueue] send failed:', err);
            }
        });
    };
};
