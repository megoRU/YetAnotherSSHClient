import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Loader2, Lock, Sparkles } from 'lucide-react';
import { getXtermTheme } from '../utils/theme';
import { useI18n } from '../utils/i18n';
import type { AppConfig, LocalTerminalStartResult } from '../types';
import '@xterm/xterm/css/xterm.css';

const { ipcRenderer } = window;

type LocalTerminalPhase = 'starting' | 'running' | 'exited' | 'error';

function checkIsLicensed(appConfig: AppConfig): boolean {
    return !!(appConfig.licenseKey && (!appConfig.licenseExpiresAt || appConfig.licenseExpiresAt > Date.now()));
}

interface Props {
    id: string;
    theme: string;
    terminalFontName: string;
    terminalFontSize: number;
    terminalScrollSensitivity: number;
    visible?: boolean;
    enableContextMenu?: boolean;
    appConfig: AppConfig;
    onClose?: () => void;
    onOpenSupport?: () => void;
    onAlternateScreenChange?: (isAlternate: boolean) => void;
}

export const LocalTerminalComponent: React.FC<Props> = ({
    id,
    theme,
    terminalFontName,
    terminalFontSize,
    terminalScrollSensitivity,
    visible,
    enableContextMenu,
    appConfig,
    onClose,
    onOpenSupport,
    onAlternateScreenChange
}) => {
    const { t } = useI18n(appConfig.language || 'ru');
    const tRef = useRef(t);
    useEffect(() => { tRef.current = t; }, [t]);

    // Статус подписки вычисляется динамически на основе appConfig.
    // Итоговое решение о запуске shell принимает main-процесс — здесь только UI-гейт.
    const isLicensed = checkIsLicensed(appConfig);

    const themeRef = useRef(theme);
    const terminalFontNameRef = useRef(terminalFontName);
    const terminalFontSizeRef = useRef(terminalFontSize);
    const terminalScrollSensitivityRef = useRef(terminalScrollSensitivity);
    useEffect(() => { themeRef.current = theme; }, [theme]);
    useEffect(() => { terminalFontNameRef.current = terminalFontName; }, [terminalFontName]);
    useEffect(() => { terminalFontSizeRef.current = terminalFontSize; }, [terminalFontSize]);
    useEffect(() => { terminalScrollSensitivityRef.current = terminalScrollSensitivity; }, [terminalScrollSensitivity]);

    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const safeFitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMountedRef = useRef<boolean>(true);
    const sessionIdRef = useRef<string | null>(null);
    const outputQueueRef = useRef<string[]>([]);
    const outputFlushRafIdRef = useRef<number | null>(null);
    /** Все отложенные таймеры компонента — очищаются при размонтировании */
    const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

    const [phase, setPhase] = useState<LocalTerminalPhase>('starting');
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [exitCode, setExitCode] = useState<number | null>(null);
    /** Номер shell-сессии: увеличивается при перезапуске, эффект сессии привязан к нему */
    const [sessionKey, setSessionKey] = useState(1);
    /** xterm открыт и выполнен первый fit() — только после этого создаём PTY с реальными размерами */
    const [isTermReady, setIsTermReady] = useState(false);

    const phaseRef = useRef(phase);
    useEffect(() => { phaseRef.current = phase; }, [phase]);

    const onAlternateScreenChangeRef = useRef(onAlternateScreenChange);
    useEffect(() => { onAlternateScreenChangeRef.current = onAlternateScreenChange; }, [onAlternateScreenChange]);

    const visibleRef = useRef(visible);
    useEffect(() => {
        visibleRef.current = visible;
        if (xtermRef.current) {
            const isAlt = xtermRef.current.buffer.active.type === 'alternate';
            onAlternateScreenChangeRef.current?.(visible ? isAlt : false);
        }
    }, [visible]);

    const scheduleTimeout = useCallback((fn: () => void, delay: number) => {
        const timer = setTimeout(() => {
            timersRef.current.delete(timer);
            if (isMountedRef.current) fn();
        }, delay);
        timersRef.current.add(timer);
        return timer;
    }, []);

    const clearScheduledTimeouts = useCallback(() => {
        timersRef.current.forEach(timer => clearTimeout(timer));
        timersRef.current.clear();
    }, []);

    const safeFit = useCallback((delay = 80) => {
        if (!isMountedRef.current || !xtermRef.current || !fitAddonRef.current || !visible) return;
        if (safeFitTimeoutRef.current) {
            clearTimeout(safeFitTimeoutRef.current);
            safeFitTimeoutRef.current = null;
        }
        const doFit = () => {
            if (!isMountedRef.current || !xtermRef.current || !fitAddonRef.current || !visible) return;
            try {
                fitAddonRef.current.fit();
                const { cols, rows } = xtermRef.current;
                if (cols > 0 && rows > 0 && sessionIdRef.current && phaseRef.current === 'running') {
                    ipcRenderer?.localTerminalResize?.({ id: sessionIdRef.current, cols, rows });
                }
            } catch (err) {
                console.warn('[LocalTerminal] fit() failed:', err);
            }
        };
        if (delay === 0) {
            doFit();
            return;
        }
        safeFitTimeoutRef.current = setTimeout(() => {
            safeFitTimeoutRef.current = null;
            doFit();
        }, delay);
    }, [visible]);

    const safeFitRef = useRef(safeFit);
    useEffect(() => { safeFitRef.current = safeFit; }, [safeFit]);

    // Создание xterm-инстанса (переиспользуем существующую xterm-инфраструктуру проекта)
    useEffect(() => {
        if (!termRef.current) return;
        let active = true;
        let openRafId: number | null = null;
        isMountedRef.current = true;

        const term = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            theme: getXtermTheme(themeRef.current),
            fontFamily: "'" + terminalFontNameRef.current + "', 'JetBrains Mono', monospace",
            fontSize: terminalFontSizeRef.current,
            allowProposedApi: true,
            lineHeight: 1,
            letterSpacing: 0,
            scrollback: 50000,
            scrollSensitivity: terminalScrollSensitivityRef.current,
        });

        const fitAddon = new FitAddon();
        const clipboardAddon = new ClipboardAddon();
        const webLinksAddon = new WebLinksAddon((_event, url) => {
            ipcRenderer?.openExternal?.(url);
        });

        term.loadAddon(fitAddon);
        term.loadAddon(clipboardAddon);
        term.loadAddon(webLinksAddon);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        const openTerminal = () => {
            if (!active || !termRef.current) return;
            term.open(termRef.current);
            try {
                const webglAddon = new WebglAddon();
                // При потере WebGL-контекста освобождаем аддон — xterm вернётся к стандартному рендереру
                webglAddon.onContextLoss(() => webglAddon.dispose());
                term.loadAddon(webglAddon);
            } catch (e) {
                console.warn('WebGL addon could not be loaded, falling back to standard renderer', e);
            }
            // Pipeline: fit() выполняется до запуска PTY, чтобы shell сразу получил реальные размеры
            openRafId = requestAnimationFrame(() => {
                openRafId = null;
                if (!active) return;
                try {
                    fitAddon.fit();
                    term.element?.classList.add('xterm-ready');
                } catch (e) {
                    console.warn('[LocalTerminal] Initial fit failed:', e);
                }
                setIsTermReady(true);
            });
        };

        const docWithFonts = document as unknown as { fonts?: { status: string, ready: Promise<void> } };
        if (docWithFonts.fonts?.status === 'loaded') {
            openTerminal();
        } else if (docWithFonts.fonts) {
            docWithFonts.fonts.ready.then(openTerminal);
        } else {
            openTerminal();
        }

        const resizeObserver = new ResizeObserver(() => {
            if (isMountedRef.current) {
                safeFitRef.current();
            }
        });
        resizeObserver.observe(termRef.current);

        const dataDisposable = term.onData(data => {
            if (sessionIdRef.current && phaseRef.current === 'running') {
                ipcRenderer?.localTerminalInput?.({ id: sessionIdRef.current, data });
            }
        });

        const updateBufferType = () => {
            const isAlternate = term.buffer.active.type === 'alternate';
            if (visibleRef.current) {
                onAlternateScreenChangeRef.current?.(isAlternate);
            }
        };

        const bufferDisposable = term.buffer.onBufferChange(updateBufferType);
        updateBufferType();

        term.attachCustomKeyEventHandler((e) => {
            if (e.type === 'keydown') {
                const isMac = ipcRenderer?.platform === 'darwin';
                const isCtrl = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;

                // Навигация приложения: Ctrl+Tab и Ctrl+Shift+Tab всегда обрабатываются приложением
                if (isCtrl && !e.altKey && (e.code === 'Tab' || e.key === 'Tab')) {
                    return false;
                }

                const isAlternate = term.buffer.active.type === 'alternate';

                // Ctrl+W (или Cmd+W на Mac)
                const isCloseTabKey = isCtrl && !e.shiftKey && !e.altKey && (e.code === 'KeyW' || e.key.toLowerCase() === 'w');
                if (isCloseTabKey) {
                    if (isAlternate) {
                        return true;
                    }
                    return false;
                }

                // Горячие клавиши Copy / Paste
                const isCopy = (isMac && e.metaKey && e.code === 'KeyC') || (!isMac && e.ctrlKey && e.shiftKey && e.code === 'KeyC');
                const isPaste = (isMac && e.metaKey && e.code === 'KeyV') || (!isMac && e.ctrlKey && e.shiftKey && e.code === 'KeyV');

                if (isCopy) {
                    e.preventDefault();
                    e.stopPropagation();
                    const selection = term.getSelection();
                    if (selection) {
                        navigator.clipboard.writeText(selection);
                    }
                    return false;
                }

                if (isPaste) {
                    e.preventDefault();
                    e.stopPropagation();
                    navigator.clipboard.readText().then(text => {
                        if (text && isMountedRef.current) {
                            term.paste(text);
                        }
                    });
                    return false;
                }
            }
            return true;
        });

        return () => {
            active = false;
            isMountedRef.current = false;
            if (openRafId !== null) {
                cancelAnimationFrame(openRafId);
                openRafId = null;
            }
            if (safeFitTimeoutRef.current) {
                clearTimeout(safeFitTimeoutRef.current);
                safeFitTimeoutRef.current = null;
            }
            clearScheduledTimeouts();
            resizeObserver.disconnect();
            dataDisposable.dispose();
            bufferDisposable.dispose();
            onAlternateScreenChangeRef.current?.(false);
            if (outputFlushRafIdRef.current !== null) {
                window.cancelAnimationFrame(outputFlushRafIdRef.current);
                outputFlushRafIdRef.current = null;
            }
            outputQueueRef.current = [];
            try {
                // dispose() освобождает все загруженные аддоны (fit, clipboard, web-links, webgl)
                term.dispose();
            } catch { /* ignore */ }
            xtermRef.current = null;
            fitAddonRef.current = null;
        };
    }, [clearScheduledTimeouts]);

    // Жизненный цикл shell-сессии.
    // Подписчик: PTY создаётся сразу, как только xterm готов (без дополнительных действий).
    // Неподписчик: сессия не создаётся вовсе — main-процесс всё равно отклонит запрос.
    // Эффект привязан к sessionKey: перезапуск создаёт новую сессию, смена фазы её не пересоздаёт.
    useEffect(() => {
        if (!isLicensed || !isTermReady) return;

        const term = xtermRef.current;
        if (!term) return;

        const sessionId = `${id}-${sessionKey}-${Math.random().toString(36).substring(2, 10)}`;
        sessionIdRef.current = sessionId;

        // Локальное состояние сессии: защищает от гонки «exit пришёл раньше результата start»
        let sessionState: 'starting' | 'running' | 'ended' = 'starting';
        let disposed = false;

        if (phaseRef.current !== 'starting') {
            Promise.resolve().then(() => {
                if (!disposed && isMountedRef.current) setPhase('starting');
            });
        }

        const flushOutputQueue = () => {
            outputFlushRafIdRef.current = null;
            if (!isMountedRef.current || outputQueueRef.current.length === 0) {
                outputQueueRef.current = [];
                return;
            }
            const joined = outputQueueRef.current.join('');
            outputQueueRef.current = [];
            try {
                term.write(joined);
            } catch (err) {
                console.warn('[LocalTerminal] batched write failed:', err);
            }
        };

        const scheduleOutputFlush = () => {
            if (outputFlushRafIdRef.current !== null) return;
            outputFlushRafIdRef.current = window.requestAnimationFrame(flushOutputQueue);
        };

        // Подписки устанавливаются ДО запроса на создание PTY — первые байты shell потеряны быть не могут
        const unsubOutput = ipcRenderer?.onLocalTerminalOutput?.(sessionId, (data: string) => {
            if (disposed || !isMountedRef.current) return;
            outputQueueRef.current.push(data);
            scheduleOutputFlush();
        });

        const unsubExit = ipcRenderer?.onLocalTerminalExit?.(sessionId, (code: number) => {
            if (disposed || !isMountedRef.current) return;
            sessionState = 'ended';
            setExitCode(code);
            setPhase('exited');
        });

        const cols = term.cols > 0 ? term.cols : 80;
        const rows = term.rows > 0 ? term.rows : 24;

        // Handshake: main создаёт PTY и синхронно возвращает результат (ok / ошибка / нет подписки)
        Promise.resolve(ipcRenderer?.localTerminalStart?.({ id: sessionId, cols, rows }))
            .then((result: LocalTerminalStartResult | undefined) => {
                if (disposed || !isMountedRef.current) return;
                if (!result || !result.ok) {
                    sessionState = 'ended';
                    setErrorMessage(result?.error || tRef.current('localTerminal.shellStartError', { message: 'IPC unavailable' }));
                    setPhase('error');
                    return;
                }
                // Shell мог завершиться ещё до получения ответа — не переводим в running
                if (sessionState !== 'starting') return;
                sessionState = 'running';
                setPhase('running');
                scheduleTimeout(() => {
                    if (sessionIdRef.current !== sessionId) return;
                    term.focus();
                    safeFitRef.current();
                    scheduleTimeout(() => {
                        if (sessionIdRef.current === sessionId) safeFitRef.current();
                    }, 100);
                }, 50);
            })
            .catch((err: unknown) => {
                if (disposed || !isMountedRef.current) return;
                sessionState = 'ended';
                const message = err instanceof Error ? err.message : String(err);
                setErrorMessage(tRef.current('localTerminal.shellStartError', { message }));
                setPhase('error');
            });

        return () => {
            disposed = true;
            if (typeof unsubOutput === 'function') unsubOutput();
            if (typeof unsubExit === 'function') unsubExit();
            // Единая точка завершения: main идемпотентно уничтожит PTY, если он ещё жив
            // (закрытие вкладки, перезапуск, размонтирование). Сообщение обрабатывается после start.
            ipcRenderer?.localTerminalClose?.(sessionId);
            if (outputFlushRafIdRef.current !== null) {
                window.cancelAnimationFrame(outputFlushRafIdRef.current);
                outputFlushRafIdRef.current = null;
            }
            outputQueueRef.current = [];
            if (sessionIdRef.current === sessionId) {
                sessionIdRef.current = null;
            }
        };
    }, [isLicensed, isTermReady, sessionKey, id, scheduleTimeout]);

    useEffect(() => {
        if (xtermRef.current) {
            xtermRef.current.options.theme = getXtermTheme(theme);
            xtermRef.current.options.fontFamily = "'" + terminalFontName + "', 'JetBrains Mono', monospace";
            xtermRef.current.options.fontSize = terminalFontSize;
            xtermRef.current.options.lineHeight = 1;
            xtermRef.current.options.letterSpacing = 0;
            xtermRef.current.options.scrollSensitivity = terminalScrollSensitivity;
            safeFit();
        }
    }, [theme, terminalFontName, terminalFontSize, terminalScrollSensitivity, safeFit]);

    // Фокус и подгонка размеров при показе вкладки
    useEffect(() => {
        if (!visible || !isMountedRef.current || phase !== 'running') return;
        safeFit();
        const timer = setTimeout(() => {
            if (isMountedRef.current && xtermRef.current && phaseRef.current === 'running') {
                xtermRef.current.focus();
            }
        }, 50);
        return () => clearTimeout(timer);
    }, [visible, phase, safeFit]);

    // Ctrl+R перехватывается main-процессом (защита от перезагрузки окна) и приходит как событие —
    // передаём его в shell так же, как это делает SSH-терминал (поиск по истории команд)
    useEffect(() => {
        const handleForceCtrlR = () => {
            if (visible && phase === 'running' && sessionIdRef.current) {
                ipcRenderer?.localTerminalInput?.({ id: sessionIdRef.current, data: '\x12' });
            }
        };
        window.addEventListener('terminal-force-ctrl-r', handleForceCtrlR);
        return () => window.removeEventListener('terminal-force-ctrl-r', handleForceCtrlR);
    }, [visible, phase]);

    const handleRestart = useCallback(() => {
        if (!isLicensed) return;
        setErrorMessage('');
        setExitCode(null);
        xtermRef.current?.reset();
        setPhase('starting');
        setSessionKey(k => k + 1);
    }, [isLicensed]);

    // Поведение настройки «Быстрый Copy/Paste» идентично SSH-терминалу (Terminal.tsx):
    // ПКМ при наличии выделения — копировать его и снять выделение, ПКМ без выделения — вставить из буфера.
    const handleContextMenu = (e: React.MouseEvent) => {
        if (!enableContextMenu || !xtermRef.current || phase !== 'running') return;
        e.preventDefault();

        const term = xtermRef.current;
        const selection = term.getSelection();

        if (selection) {
            navigator.clipboard.writeText(selection);
            term.clearSelection();
            return;
        }

        navigator.clipboard.readText().then(text => {
            if (text && isMountedRef.current) {
                term.paste(text);
            }
        });
    };

    const isRunning = isLicensed && phase === 'running';
    const showOverlay = !isRunning;

    const renderOverlayContent = () => {
        // Неподписчик: экран блокировки, shell не запускается
        if (!isLicensed) {
            return (
                <>
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '12px',
                        background: 'rgba(251, 191, 36, 0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fbbf24'
                    }}>
                        <Lock size={24} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'center', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                {t('localTerminal.title')}
                            </span>
                            <span style={{
                                padding: '2px 8px',
                                borderRadius: '999px',
                                background: 'var(--accent)',
                                color: '#fff',
                                fontSize: '11px',
                                fontWeight: 700,
                                letterSpacing: '0.5px',
                                textTransform: 'uppercase'
                            }}>
                                {t('localTerminal.betaBadge')}
                            </span>
                        </div>
                        <div style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '420px', lineHeight: 1.5 }}>
                            {t('localTerminal.subscribersOnly')}
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', width: '100%' }}>
                        {onClose && (
                            <button onClick={onClose} className="btn-secondary" style={{ padding: '12px 28px', fontSize: '14px' }}>
                                {t('common.close')}
                            </button>
                        )}
                        {onOpenSupport && (
                            <button onClick={onOpenSupport} className="btn-primary" style={{ padding: '12px 28px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Sparkles size={16} />
                                {t('localTerminal.getSubscription')}
                            </button>
                        )}
                    </div>
                </>
            );
        }

        if (phase === 'starting') {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--accent)', fontWeight: 600, fontSize: '16px' }}>
                    <Loader2 size={20} className="spin" />
                    {t('localTerminal.starting')}
                </div>
            );
        }

        const message = phase === 'error'
            ? errorMessage
            : (exitCode !== null && exitCode !== 0
                ? t('localTerminal.exitedWithCode', { code: String(exitCode) })
                : t('localTerminal.exited'));
        return (
            <>
                <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    background: phase === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: phase === 'error' ? '#ef4444' : 'var(--text-primary)',
                    fontSize: '24px'
                }}>{phase === 'error' ? '⚠️' : '🔌'}</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--text-primary)', textAlign: 'center', maxWidth: '420px' }}>
                    {message}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', width: '100%' }}>
                    {onClose && (
                        <button onClick={onClose} className="btn-secondary" style={{ padding: '12px 28px', fontSize: '14px' }}>
                            {t('common.close')}
                        </button>
                    )}
                    <button onClick={handleRestart} className="btn-primary" style={{ padding: '12px 28px', fontSize: '14px' }}>
                        {t('localTerminal.restart')}
                    </button>
                </div>
            </>
        );
    };

    return (
        <div className="terminal-container"
            onContextMenu={handleContextMenu}
            style={{
                flex: 1,
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                paddingLeft: '15px',
                paddingTop: '10px',
                paddingBottom: '20px',
                boxSizing: 'border-box',
                backgroundColor: getXtermTheme(theme).background,
                overflow: 'hidden',
                minWidth: 0
            }}>
            {showOverlay && (
                <div className="connection-overlay" style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: getXtermTheme(theme).background,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    zIndex: 10, padding: '40px', textAlign: 'center'
                }}>
                    <div className="connection-container" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '24px',
                        padding: '48px',
                        maxWidth: '550px',
                        width: '95%'
                    }}>
                        {renderOverlayContent()}
                    </div>
                </div>
            )}
            <div ref={termRef}
                style={{
                    flex: 1,
                    minHeight: 0,
                    opacity: isRunning ? 1 : 0,
                    transition: 'opacity 0.1s ease'
                }} />
        </div>
    );
};
