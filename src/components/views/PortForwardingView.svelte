<script module lang="ts">
    import { ExternalLink, LoaderCircle, Play, Power, Share2 } from '@lucide/svelte';

    import { createI18n, type Language } from '../../utils/i18n';

    import { useFingerprintPrompt } from '../../hooks/useFingerprintPrompt.svelte';

    import SshFingerprintModal from '../modals/SshFingerprintModal.svelte';

    import type { AppConfig, SSHConfig } from '../../types';

    import { onMount, untrack } from 'svelte';

    import { type ElementEvent, type RefObject, inlineStyle } from '../../utils/dom';

    const { ipcRenderer } = window;

    const MIN_PORT = 1;

    const MAX_PORT = 65535;

    const isValidPort = (port: number): boolean => Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;

    const buildForwardedUrl = (address: string, port: string): string | null => {
        const portNumber = Number(port);
        if (!isValidPort(portNumber)) {
            return null;
        }

        const trimmedAddress = address.trim();
        let host = trimmedAddress || '127.0.0.1';

        if (host === '0.0.0.0') {
            host = '127.0.0.1';
        } else if (host === '::') {
            host = '::1';
        }

        if (host.includes(':') && !host.startsWith('[')) {
            host = `[${host}]`;
        }

        try {
            const url = new URL(`http://${host}:${portNumber}`);

            // Не допускаем подмены хоста через user:pass@host
            if (url.username || url.password) {
                return null;
            }

            return url.toString();
        } catch {
            return null;
        }
    };

    interface PortForwardingViewProps {
        sshConfig: SSHConfig;
        theme: string;
        language: Language;
        /** Полный конфиг приложения: нужен словарь и тема окна подтверждения. */
        appConfig?: AppConfig;
    }
</script>

<script lang="ts">
    const fieldId = $props.id();

    let { sshConfig, language, appConfig }: PortForwardingViewProps = $props();

    const { t } = $derived(createI18n(language));

    let localPort = $state.raw('');

    let localAddress = $state.raw('127.0.0.1');

    let internalAddress = $state.raw('127.0.0.1');

    let internalPort = $state.raw('');

    let isActive = $state.raw(false);

    let isPending = $state.raw(false);

    let error = $state.raw<string | null>(null);

    const formRef: RefObject<HTMLFormElement | null> = $state({ current: null });

    const sessionId = $derived(`forward:${sshConfig.host}:${localPort}`);

    const fingerprint = useFingerprintPrompt(() => sessionId);

    const activeSessionIdRef: RefObject<string | null> = { current: null };

    const forwardedUrl = $derived(isActive ? buildForwardedUrl(localAddress, localPort) : null);

    const isFieldsLocked = $derived(isActive || isPending);

    $effect(() => {
        void [isActive, sessionId];
        return untrack(() => {
            if (isActive) {
                activeSessionIdRef.current = sessionId;
            } else {
                activeSessionIdRef.current = null;
            }
        });
    });

    onMount(() => {
        return () => {
            if (activeSessionIdRef.current) {
                void ipcRenderer?.sshForwardStop?.(activeSessionIdRef.current);
            }
        };
    });

    const handleToggle = async (e?: SubmitEvent) => {
        if (e) e.preventDefault();

        if (isPending) return;

        if (isActive) {
            isPending = true;
            try {
                if (typeof ipcRenderer !== 'undefined') {
                    await ipcRenderer?.sshForwardStop?.(sessionId);
                }
                isActive = false;
            } finally {
                isPending = false;
            }
            return;
        }

        if (typeof ipcRenderer === 'undefined') {
            error = 'IPC renderer is not available';
            return;
        }

        error = null;

        const localPortNumber = Number(localPort);
        const internalPortNumber = Number(internalPort);
        if (!isValidPort(localPortNumber) || !isValidPort(internalPortNumber)) {
            error = t('forward.invalidPort');
            return;
        }

        isPending = true;
        try {
            await ipcRenderer?.sshForwardStart?.({
                id: sessionId,
                config: sshConfig,
                localAddress,
                localPort: localPortNumber,
                remoteAddress: internalAddress,
                remotePort: internalPortNumber,
            });
            isActive = true;
        } catch (err: unknown) {
            error = err instanceof Error ? err.message : String(err);
        } finally {
            isPending = false;
        }
    };

    const handleOpenForwardedUrl = (event: ElementEvent<MouseEvent, HTMLAnchorElement>) => {
        event.preventDefault();

        if (!forwardedUrl) {
            return;
        }

        ipcRenderer?.openExternal?.(forwardedUrl);
    };

    const inputStyle = (disabled: boolean) => ({
        width: '100%',
        padding: '8px',
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'text',
    });

    const wideInputStyle = (disabled: boolean) => ({
        width: '100%',
        padding: '10px',
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'text',
    });
</script>

{#if fingerprint.challenge}<div style="position: relative; width: 100%; height: 100%">
        {#key fingerprint.challenge.fingerprint}<SshFingerprintModal
                challenge={fingerprint.challenge}
                server={sshConfig}
                {appConfig}
                onAccept={fingerprint.accept}
                onReject={fingerprint.reject}
            />{/key}
    </div>{:else}<div style="user-select: none; height: 100%; overflow-y: auto">
        <div style="padding: 40px; max-width: 600px; margin: 0 auto">
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px">
                <div
                    style="width: 50px; height: 50px; border-radius: 12px; background: var(--primary-color); color: white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1)"
                >
                    <Share2 size={28} />
                </div>
                <div>
                    <h2 style="margin: 0">{t('forward.title')}</h2>
                    <div style="opacity: 0.7; font-size: 1em">{sshConfig.name || sshConfig.host}</div>
                </div>
            </div>

            <form
                bind:this={formRef.current}
                onsubmit={handleToggle}
                style="display: flex; flex-direction: column; gap: 15px"
            >
                <div class="settings-group" style="margin-bottom: 0; padding: 15px">
                    <div class="settings-group-title" style="margin-bottom: 10px">{t('forward.title')}</div>

                    <div class="settings-row" style="gap: 15px; padding: 8px 0">
                        <div style="flex: 1">
                            <label for={fieldId + '-localAddress'} style="display: block; margin-bottom: 4px"
                                >{t('forward.localAddress')}</label
                            >
                            <input
                                id={fieldId + '-localAddress'}
                                value={localAddress}
                                oninput={(e) => (localAddress = e.currentTarget.value)}
                                readonly={isFieldsLocked}
                                placeholder="127.0.0.1"
                                style={inlineStyle(inputStyle(isFieldsLocked))}
                            />
                        </div>
                        <div style="width: 160px; flex-shrink: 0">
                            <label for={fieldId + '-localPort'} style="display: block; margin-bottom: 4px"
                                >{t('forward.localPort')}</label
                            >
                            <input
                                id={fieldId + '-localPort'}
                                required
                                value={localPort}
                                oninput={(e) => (localPort = e.currentTarget.value.replace(/\D/g, ''))}
                                readonly={isFieldsLocked}
                                placeholder="80"
                                style={inlineStyle(inputStyle(isFieldsLocked))}
                            />
                        </div>
                    </div>

                    <div
                        class="settings-row"
                        style="flex-direction: column; align-items: stretch; gap: 4px; padding: 8px 0"
                    >
                        <label for={fieldId + '-remoteHost'}>{t('forward.remoteHost')}</label>
                        <input
                            id={fieldId + '-remoteHost'}
                            value={sshConfig.host}
                            readonly
                            style={inlineStyle({ ...wideInputStyle(true), cursor: 'not-allowed' })}
                        />
                    </div>

                    <div class="settings-row" style="gap: 15px; padding: 8px 0">
                        <div style="flex: 1">
                            <label for={fieldId + '-internalAddress'} style="display: block; margin-bottom: 4px"
                                >{t('forward.internalAddress')}</label
                            >
                            <input
                                id={fieldId + '-internalAddress'}
                                value={internalAddress}
                                oninput={(e) => (internalAddress = e.currentTarget.value)}
                                readonly={isFieldsLocked}
                                placeholder="127.0.0.1"
                                style={inlineStyle(inputStyle(isFieldsLocked))}
                            />
                        </div>
                        <div style="width: 160px; flex-shrink: 0">
                            <label for={fieldId + '-internalPort'} style="display: block; margin-bottom: 4px"
                                >{t('forward.internalPort')}</label
                            >
                            <input
                                id={fieldId + '-internalPort'}
                                required
                                value={internalPort}
                                oninput={(e) => (internalPort = e.currentTarget.value.replace(/\D/g, ''))}
                                readonly={isFieldsLocked}
                                placeholder="80"
                                style={inlineStyle(inputStyle(isFieldsLocked))}
                            />
                        </div>
                    </div>
                </div>

                {#if error}<div
                        style="padding: 10px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.35); background: rgba(255, 0, 0, 0.1); color: var(--danger-color); font-size: var(--font-size-secondary)"
                    >
                        {t('forward.error')}: {error}
                    </div>{/if}

                <div
                    style="display: flex; gap: 15px; margin-top: 10px; flex-direction: column; align-items: center"
                >
                    <button
                        type="submit"
                        disabled={isPending}
                        class={isActive ? 'btn-danger' : 'btn-primary'}
                        style={inlineStyle({
                            width: '100%',
                            padding: '14px',
                            fontSize: '1.1em',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            opacity: isPending ? 0.75 : 1,
                            cursor: 'pointer',
                        })}
                    >
                        {#if isPending}<LoaderCircle size={20} class="spin" />{:else if isActive}<Power
                                size={20}
                            />{:else}<Play size={20} />{/if}
                        {#if isPending}{#if isActive}{t('forward.stopping')}{:else}{t(
                                    'forward.starting',
                                )}{/if}{:else if isActive}{t('forward.stop')}{:else}{t('forward.start')}{/if}
                    </button>

                    {#if isActive && forwardedUrl}<a
                            href={forwardedUrl}
                            onclick={handleOpenForwardedUrl}
                            style="width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text-primary); text-decoration: none"
                        >
                            <span
                                aria-hidden="true"
                                style="width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14)"
                            ></span>
                            <span style="flex: 1; min-width: 0; text-align: left">
                                <span style="display: block; color: var(--text-secondary); font-size: 0.92em">
                                    {t('forward.openInBrowser')}
                                </span>
                                <span
                                    style="display: block; margin-top: 2px; color: var(--accent); font-family: var(--mono-font-family); font-size: 0.92em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                                >
                                    {forwardedUrl}
                                </span>
                            </span>
                            <ExternalLink size={18} color="var(--text-secondary)" />
                        </a>{/if}
                </div>
            </form>
        </div>
    </div>{/if}
