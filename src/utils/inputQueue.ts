/**
 * Очередь ввода терминала.
 *
 * Ввод собирается в одну команду за микрозадачу: быстрая печать и вставка не
 * создают поток IPC-вызовов, а порядок символов сохраняется. Отправка не
 * откладывается на кадр — микрозадача выполняется до отрисовки, и эхо не
 * ощущается запаздывающим.
 */
export const createInputQueue = (send: (data: string) => void): ((data: string) => void) => {
    let pending = '';
    let scheduled = false;

    return (data: string): void => {
        if (!data) return;
        pending += data;
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            const batch = pending;
            pending = '';
            if (batch) send(batch);
        });
    };
};
