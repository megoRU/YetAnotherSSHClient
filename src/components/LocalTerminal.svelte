<script module lang="ts">
    import { Terminal } from '@xterm/xterm';

    import { FitAddon } from '@xterm/addon-fit';

    import { ClipboardAddon } from '@xterm/addon-clipboard';

    import { WebLinksAddon } from '@xterm/addon-web-links';

    import { WebglAddon } from '@xterm/addon-webgl';

    import { LoaderCircle } from '@lucide/svelte';

    import { getXtermTheme } from '../utils/theme';

    import { ensureTerminalFont } from '../utils/fontLoader';

    import { useTerminalFit } from '../hooks/useTerminalFit.svelte';

    import { createTerminalKeyHandler } from '../utils/terminalKeys';

    import { createInputQueue } from '../utils/inputQueue';

    import { copyToClipboard, createTerminalClipboardProvider, readClipboardText } from '../utils/clipboard';

    import { createI18n } from '../utils/i18n';

    import TerminalLinkTooltip from './TerminalLinkTooltip.svelte';
    import type { TerminalLinkTooltipPosition } from './TerminalLinkTooltip.svelte';

    import type { AppConfig, LocalTerminalStartResult } from '../types';

    import '@xterm/xterm/css/xterm.css';

    import { untrack } from 'svelte';

    import { type RefObject, type SetStateAction, inlineStyle } from '../utils/dom';

    const { ipcRenderer } = window;

    type LocalTerminalPhase = 'starting' | 'running' | 'exited' | 'error';

    const OUTPUT_QUEUE_LIMIT_BYTES = 128 * 1024;

    interface Props {
        id: string;
        theme: string;
        terminalFontName: string;
        terminalFontSize: number;
        terminalScrollSensitivity: number;
        terminalScrollback: number;
        visible?: boolean;
        enableContextMenu?: boolean;
        appConfig: AppConfig;
        onClose?: () => void;
        onAlternateScreenChange?: (isAlternate: boolean) => void;
    }
</script>

<script lang="ts">
    let {
        id,
        theme,
        terminalFontName,
        terminalFontSize,
        terminalScrollSensitivity,
        terminalScrollback,
        visible,
        enableContextMenu,
        appConfig,
        onClose,
        onAlternateScreenChange,
    }: Props = $props();

    const { t } = $derived(createI18n(appConfig.language || 'ru'));

    const tRef = {
        get current() {
            return t;
        },
    };

    const themeRef = {
        get current() {
            return theme;
        },
    };

    const terminalFontNameRef = {
        get current() {
            return terminalFontName;
        },
    };

    const terminalFontSizeRef = {
        get current() {
            return terminalFontSize;
        },
    };

    const terminalScrollSensitivityRef = {
        get current() {
            return terminalScrollSensitivity;
        },
    };

    const terminalScrollbackRef = {
        get current() {
            return terminalScrollback;
        },
    };

    const termRef: RefObject<HTMLDivElement | null> = $state({ current: null });

    const xtermRef: RefObject<Terminal | null> = { current: null };

    const fitAddonRef: RefObject<FitAddon | null> = { current: null };

    const webglAddonRef: RefObject<WebglAddon | null> = { current: null };

    const lastColsRef: RefObject<number> = { current: 0 };

    const lastRowsRef: RefObject<number> = { current: 0 };

    const isMountedRef: RefObject<boolean> = { current: true };

    const sessionIdRef: RefObject<string | null> = { current: null };

    const outputQueueRef: RefObject<string[]> = { current: [] };

    const outputQueueBytesRef: RefObject<number> = { current: 0 };

    const outputFlushRafIdRef: RefObject<number | null> = { current: null };

    const outputFlushIsTimeoutRef: RefObject<boolean> = { current: false };

    const timersRef: RefObject<Set<ReturnType<typeof setTimeout>>> = { current: new Set() };

    let phase = $state.raw<LocalTerminalPhase>('starting');

    let errorMessage = $state.raw<string>('');

    let exitCode = $state.raw<number | null>(null);
    function setExitCode(next: SetStateAction<number | null>) {
        exitCode = typeof next === 'function' ? next(exitCode) : next;
    }

    let sessionKey = $state.raw(1);
    function setSessionKey(next: SetStateAction<typeof sessionKey>) {
        sessionKey = typeof next === 'function' ? next(sessionKey) : next;
    }

    let isTermReady = $state.raw(false);

    let linkTooltipPosition = $state.raw<TerminalLinkTooltipPosition | null>(null);

    const phaseRef = {
        get current() {
            return phase;
        },
    };

    const onAlternateScreenChangeRef = {
        get current() {
            return onAlternateScreenChange;
        },
    };

    const visibleRef = {
        get current() {
            return visible;
        },
    };

    const scheduleTimeout = (fn: () => void, delay: number) => {
        const timer = setTimeout(() => {
            timersRef.current.delete(timer);
            if (isMountedRef.current) fn();
        }, delay);
        timersRef.current.add(timer);
        return timer;
    };

    const clearScheduledTimeouts = () => {
        timersRef.current.forEach((timer) => clearTimeout(timer));
        timersRef.current.clear();
    };

    const terminalFit = useTerminalFit({
        get visible() {
            return !!visible;
        },
        get isMountedRef() {
            return isMountedRef;
        },
        get xtermRef() {
            return xtermRef;
        },
        get fitAddonRef() {
            return fitAddonRef;
        },
        get termRef() {
            return termRef;
        },
        get lastColsRef() {
            return lastColsRef;
        },
        get lastRowsRef() {
            return lastRowsRef;
        },
        get canResize() {
            return () => !!sessionIdRef.current && phaseRef.current === 'running';
        },
        get onResize() {
            return (cols: number, rows: number) => {
                const sessionId = sessionIdRef.current;
                if (sessionId) ipcRenderer?.localTerminalResize?.({ id: sessionId, cols, rows });
            };
        },
        get logPrefix() {
            return '[LocalTerminal]';
        },
    });

    const safeFitRef = { current: terminalFit.safeFit };

    $effect(() => {
        void [terminalFit.safeFit];
        return untrack(() => {
            safeFitRef.current = terminalFit.safeFit;
        });
    });

    $effect(() => {
        void [terminalFit.clearPendingFit, clearScheduledTimeouts];
        return untrack(() => {
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
                scrollback: terminalScrollbackRef.current,
                scrollSensitivity: terminalScrollSensitivityRef.current,
            });

            const fitAddon = new FitAddon();
            const clipboardAddon = new ClipboardAddon(undefined, createTerminalClipboardProvider());
            const webLinksAddon = new WebLinksAddon(
                (event, url) => {
                    if (event.button !== 0 || !event.ctrlKey) return;
                    ipcRenderer?.openExternal?.(url);
                },
                {
                    hover: (event) => {
                        const container = termRef.current?.closest('.terminal-container');
                        if (!container) return;
                        const rect = container.getBoundingClientRect();
                        const y = event.clientY - rect.top;
                        linkTooltipPosition = {
                            left: Math.max(128, Math.min(rect.width - 128, event.clientX - rect.left)),
                            top: y,
                            placement: y < 72 ? 'below' : 'above',
                        };
                    },
                    leave: () => {
                        linkTooltipPosition = null;
                    },
                },
            );

            term.loadAddon(fitAddon);
            term.loadAddon(clipboardAddon);
            term.loadAddon(webLinksAddon);

            xtermRef.current = term;
            fitAddonRef.current = fitAddon;

            const openTerminal = () => {
                if (!active || !termRef.current) return;
                term.open(termRef.current);
                if (visibleRef.current) {
                    try {
                        const webglAddon = new WebglAddon();
                        webglAddon.onContextLoss(() => {
                            webglAddon.dispose();
                            webglAddonRef.current = null;
                        });
                        term.loadAddon(webglAddon);
                        webglAddonRef.current = webglAddon;
                    } catch (e) {
                        console.warn('WebGL addon could not be loaded, falling back to standard renderer', e);
                    }
                }
                // Pipeline: fit() выполняется до запуска PTY, чтобы shell сразу получил реальные размеры
                openRafId = requestAnimationFrame(() => {
                    openRafId = null;
                    if (!active) return;
                    try {
                        if (
                            termRef.current &&
                            termRef.current.clientWidth > 0 &&
                            termRef.current.clientHeight > 0
                        ) {
                            fitAddon.fit();
                        }
                        lastColsRef.current = term.cols;
                        lastRowsRef.current = term.rows;
                        term.element?.classList.add('xterm-ready');
                    } catch (e) {
                        console.warn('[LocalTerminal] Initial fit failed:', e);
                    }
                    isTermReady = true;
                });
            };

            const ensureFont = async () => {
                await ensureTerminalFont(terminalFontSizeRef.current, terminalFontNameRef.current);
                openTerminal();
            };
            void ensureFont();

            const resizeObserver = new ResizeObserver(() => {
                if (isMountedRef.current) {
                    safeFitRef.current();
                }
            });
            resizeObserver.observe(termRef.current);

            const sendInput = createInputQueue((data) => {
                const sessionId = sessionIdRef.current;
                if (sessionId && phaseRef.current === 'running') {
                    ipcRenderer?.localTerminalInput?.({ id: sessionId, data });
                }
            });

            const dataDisposable = term.onData((data) => {
                if (sessionIdRef.current && phaseRef.current === 'running') {
                    sendInput(data);
                }
            });

            const updateBufferType = () => {
                const isAlternate = term.buffer.active.type === 'alternate';
                if (visibleRef.current) {
                    onAlternateScreenChangeRef.current?.(isAlternate);
                }
            };

            const updateScrollbackVisibility = () => {
                const hasScrollback = term.buffer.active.type === 'normal' && term.buffer.active.baseY > 0;
                term.element?.classList.toggle('xterm-has-scrollback', hasScrollback);
            };

            const updateBufferState = () => {
                updateBufferType();
                updateScrollbackVisibility();
            };

            const bufferDisposable = term.buffer.onBufferChange(updateBufferState);
            const writeParsedDisposable = term.onWriteParsed(updateScrollbackVisibility);
            updateBufferState();

            term.attachCustomKeyEventHandler(
                createTerminalKeyHandler(term, {
                    isMounted: () => isMountedRef.current,
                    isMac: ipcRenderer?.platform === 'darwin',
                    // Локальный терминал блокирует Ctrl+R и в альтернативном экране
                    passCtrlInAlternateScreen: false,
                }),
            );

            return () => {
                active = false;
                isMountedRef.current = false;
                if (openRafId !== null) {
                    cancelAnimationFrame(openRafId);
                    openRafId = null;
                }
                terminalFit.clearPendingFit();
                clearScheduledTimeouts();
                resizeObserver.disconnect();
                dataDisposable.dispose();
                bufferDisposable.dispose();
                writeParsedDisposable.dispose();
                onAlternateScreenChangeRef.current?.(false);
                if (outputFlushRafIdRef.current !== null) {
                    if (outputFlushIsTimeoutRef.current) {
                        clearTimeout(outputFlushRafIdRef.current);
                    } else {
                        window.cancelAnimationFrame(outputFlushRafIdRef.current);
                    }
                    outputFlushRafIdRef.current = null;
                    outputFlushIsTimeoutRef.current = false;
                }
                outputQueueRef.current = [];
                outputQueueBytesRef.current = 0;
                if (webglAddonRef.current) {
                    try {
                        webglAddonRef.current.dispose();
                    } catch {
                        /* ignore */
                    }
                    webglAddonRef.current = null;
                }
                try {
                    // dispose() освобождает все загруженные аддоны (fit, clipboard, web-links)
                    term.dispose();
                } catch {
                    /* ignore */
                }
                xtermRef.current = null;
                fitAddonRef.current = null;
            };
        });
    });

    $effect(() => {
        void [isTermReady, sessionKey, id, scheduleTimeout];
        return untrack(() => {
            if (!isTermReady) return;

            const term = xtermRef.current;
            if (!term) return;

            const sessionId = `${id}-${sessionKey}-${Math.random().toString(36).substring(2, 10)}`;
            sessionIdRef.current = sessionId;

            // Локальное состояние сессии: защищает от гонки «exit пришёл раньше результата start»
            let sessionState: 'starting' | 'running' | 'ended' = 'starting';
            let disposed = false;

            if (phaseRef.current !== 'starting') {
                Promise.resolve().then(() => {
                    if (!disposed && isMountedRef.current) phase = 'starting';
                });
            }

            const cancelScheduledFlush = () => {
                if (outputFlushRafIdRef.current !== null) {
                    if (outputFlushIsTimeoutRef.current) {
                        clearTimeout(outputFlushRafIdRef.current);
                    } else {
                        window.cancelAnimationFrame(outputFlushRafIdRef.current);
                    }
                    outputFlushRafIdRef.current = null;
                    outputFlushIsTimeoutRef.current = false;
                }
            };

            const flushOutputQueue = () => {
                cancelScheduledFlush();
                if (!isMountedRef.current || outputQueueRef.current.length === 0) {
                    outputQueueRef.current = [];
                    outputQueueBytesRef.current = 0;
                    return;
                }
                const joined = outputQueueRef.current.join('');
                outputQueueRef.current = [];
                outputQueueBytesRef.current = 0;
                try {
                    term.write(joined);
                } catch (err) {
                    console.warn('[LocalTerminal] batched write failed:', err);
                }
            };

            const scheduleOutputFlush = () => {
                if (outputFlushRafIdRef.current !== null) return;
                if (visibleRef.current) {
                    // Keep visible output in sync with rendering and coalesce bursts
                    // into one xterm write per frame.
                    outputFlushIsTimeoutRef.current = false;
                    outputFlushRafIdRef.current = window.requestAnimationFrame(flushOutputQueue);
                } else {
                    outputFlushIsTimeoutRef.current = true;
                    outputFlushRafIdRef.current = window.setTimeout(flushOutputQueue, 20) as unknown as number;
                }
            };

            // Канал сырого вывода: байты декодируются потоково (символ может
            // делиться между чанками), поэтому декодер живёт в сессии и не
            // переносится на следующую.
            const decoder = new TextDecoder();
            const onOutput = (data: Uint8Array) => {
                if (disposed || !isMountedRef.current) return;
                const text = decoder.decode(data, { stream: true });
                if (text.length > 0) {
                    outputQueueRef.current.push(text);
                }
                outputQueueBytesRef.current += data.byteLength;

                // An incomplete UTF-8 character stays in the decoder until the
                // next chunk or process exit; don't schedule an empty xterm write.
                if (outputQueueRef.current.length === 0) return;

                const isBufferFull = outputQueueBytesRef.current >= OUTPUT_QUEUE_LIMIT_BYTES;

                if (isBufferFull) {
                    flushOutputQueue();
                    return;
                }

                scheduleOutputFlush();
            };

            const unsubExit = ipcRenderer?.onLocalTerminalExit?.(sessionId, (code: number) => {
                if (disposed || !isMountedRef.current) return;
                // Процесс завершился: сбрасываем декодер, чтобы не потерять
                // последний неполный UTF-8 символ (если он уже пришёл).
                const tail = decoder.decode();
                if (tail) {
                    outputQueueRef.current.push(tail);
                    flushOutputQueue();
                }
                sessionState = 'ended';
                setExitCode(code);
                phase = 'exited';
            });

            const cols = term.cols > 0 ? term.cols : 80;
            const rows = term.rows > 0 ? term.rows : 24;

            // Handshake: main создаёт PTY и синхронно возвращает результат (ok / ошибка / нет подписки).
            // Канал вывода создаётся и регистрируется до запуска PTY — первые байты не потеряются.
            Promise.resolve(ipcRenderer?.localTerminalStart?.({ id: sessionId, cols, rows }, onOutput))
                .then((result: LocalTerminalStartResult | undefined) => {
                    if (disposed || !isMountedRef.current) return;
                    if (!result || !result.ok) {
                        sessionState = 'ended';
                        errorMessage =
                            result?.error ||
                            tRef.current('localTerminal.shellStartError', { message: 'IPC unavailable' });
                        phase = 'error';
                        return;
                    }
                    // Shell мог завершиться ещё до получения ответа — не переводим в running
                    if (sessionState !== 'starting') return;
                    sessionState = 'running';
                    phase = 'running';
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
                    errorMessage = tRef.current('localTerminal.shellStartError', { message });
                    phase = 'error';
                });

            return () => {
                disposed = true;
                if (typeof unsubExit === 'function') unsubExit();
                // Единая точка завершения: main идемпотентно уничтожит PTY, если он ещё жив
                // (закрытие вкладки, перезапуск, размонтирование). Сообщение обрабатывается после start.
                ipcRenderer?.localTerminalClose?.(sessionId);
                cancelScheduledFlush();
                outputQueueRef.current = [];
                outputQueueBytesRef.current = 0;
                if (sessionIdRef.current === sessionId) {
                    sessionIdRef.current = null;
                }
            };
        });
    });

    $effect(() => {
        void [
            theme,
            terminalFontName,
            terminalFontSize,
            terminalScrollSensitivity,
            terminalScrollback,
            terminalFit.safeFit,
        ];
        return untrack(() => {
            if (xtermRef.current) {
                xtermRef.current.options.theme = getXtermTheme(theme);
                xtermRef.current.options.fontFamily = "'" + terminalFontName + "', 'JetBrains Mono', monospace";
                xtermRef.current.options.fontSize = terminalFontSize;
                xtermRef.current.options.lineHeight = 1;
                xtermRef.current.options.letterSpacing = 0;
                xtermRef.current.options.scrollSensitivity = terminalScrollSensitivity;
                xtermRef.current.options.scrollback = terminalScrollback;
                terminalFit.safeFit();
            }
        });
    });

    $effect(() => {
        void [visible, phase, terminalFit.safeFit];
        return untrack(() => {
            if (visible) {
                if (xtermRef.current && !webglAddonRef.current) {
                    try {
                        const webglAddon = new WebglAddon();
                        webglAddon.onContextLoss(() => {
                            webglAddon.dispose();
                            webglAddonRef.current = null;
                        });
                        xtermRef.current.loadAddon(webglAddon);
                        webglAddonRef.current = webglAddon;
                    } catch (e) {
                        console.warn('WebGL addon could not be loaded on local terminal focus', e);
                    }
                }
                if (isMountedRef.current && phase === 'running') {
                    terminalFit.safeFit();
                    const timer = setTimeout(() => {
                        if (isMountedRef.current && xtermRef.current && phaseRef.current === 'running') {
                            xtermRef.current.focus();
                        }
                    }, 50);
                    return () => clearTimeout(timer);
                }
            } else {
                if (webglAddonRef.current) {
                    try {
                        webglAddonRef.current.dispose();
                    } catch {
                        /* ignore */
                    }
                    webglAddonRef.current = null;
                }
            }
        });
    });

    $effect(() => {
        void [visible, phase];
        return untrack(() => {
            const handleForceCtrlR = () => {
                if (visible && phase === 'running' && sessionIdRef.current) {
                    ipcRenderer?.localTerminalInput?.({ id: sessionIdRef.current, data: '\x12' });
                }
            };
            window.addEventListener('terminal-force-ctrl-r', handleForceCtrlR);
            return () => window.removeEventListener('terminal-force-ctrl-r', handleForceCtrlR);
        });
    });

    const handleRestart = () => {
        errorMessage = '';
        setExitCode(null);
        lastColsRef.current = 0;
        lastRowsRef.current = 0;
        xtermRef.current?.reset();
        phase = 'starting';
        setSessionKey((k) => k + 1);
    };

    const handleContextMenu = (e: MouseEvent) => {
        if (!enableContextMenu || !xtermRef.current || phase !== 'running') return;
        e.preventDefault();

        const term = xtermRef.current;
        const selection = term.getSelection();

        if (selection) {
            copyToClipboard(selection);
            term.clearSelection();
            return;
        }

        readClipboardText()
            .then((text) => {
                if (text && isMountedRef.current) {
                    term.paste(text);
                }
            })
            .catch(() => {
                // Буфер недоступен — вставка невозможна.
            });
    };

    const isRunning = $derived(phase === 'running');

    const showOverlay = $derived(!isRunning);
</script>

{#snippet renderOverlayContent()}
    {#if phase === 'starting'}<div
            style="display: flex; align-items: center; gap: 12px; color: var(--accent); font-weight: 600; font-size: var(--font-size-base)"
        >
            <LoaderCircle size={20} class="spin" />
            {t('localTerminal.starting')}
        </div>{:else}{@const message =
            phase === 'error'
                ? errorMessage
                : exitCode !== null && exitCode !== 0
                  ? t('localTerminal.exitedWithCode', { code: String(exitCode) })
                  : t('localTerminal.exited')}
        <div
            style={inlineStyle({
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: phase === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: phase === 'error' ? '#ef4444' : 'var(--text-primary)',
                fontSize: '24px',
            })}
        >
            {#if phase === 'error'}⚠️{:else}🔌{/if}
        </div>
        <div
            style="font-size: var(--font-size-base); font-weight: bold; color: var(--text-primary); text-align: center; max-width: 420px"
        >
            {message}
        </div>
        <div style="display: flex; justify-content: center; gap: 12px; width: 100%">
            {#if onClose}<button
                    onclick={onClose}
                    class="btn-secondary"
                    style="padding: 12px 28px; font-size: var(--font-size-secondary)"
                >
                    {t('common.close')}
                </button>{/if}
            <button onclick={handleRestart} class="btn-primary" style="padding: 12px 28px; font-size: 14px">
                {t('localTerminal.restart')}
            </button>
        </div>
    {/if}
{/snippet}

<div
    role="presentation"
    class="terminal-container"
    data-theme={theme}
    oncontextmenu={handleContextMenu}
    style={inlineStyle({
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
        minWidth: 0,
    })}
>
    {#if showOverlay}<div
            class="connection-overlay"
            style={inlineStyle({
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: getXtermTheme(theme).background,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                padding: '40px',
                textAlign: 'center',
            })}
        >
            <div
                class="connection-container"
                style="display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 48px; max-width: 550px; width: 95%"
            >
                {@render renderOverlayContent()}
            </div>
        </div>{/if}
    <div
        bind:this={termRef.current}
        style={inlineStyle({
            flex: 1,
            minHeight: 0,
            opacity: isRunning ? 1 : 0,
            transition: 'opacity 0.1s ease',
        })}
    ></div>
    {#if linkTooltipPosition}<TerminalLinkTooltip
            position={linkTooltipPosition}
            clickLabel={t('terminal.linkClick')}
            hint={t('terminal.linkOpenHint')}
        />{/if}
</div>
