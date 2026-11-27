<script module lang="ts">
    import { Power, TriangleAlert } from '@lucide/svelte';

    import type { AppConfig, SSHConfig, McpStatus, McpLogItem, McpConfirmationRequest } from '../types';

    import { createI18n } from '../utils/i18n';

    import { mergeLogs } from '../utils/mcpLogs';

    import McpTabHeader from './McpTabHeader.svelte';

    import McpPendingConfirmations from './McpPendingConfirmations.svelte';

    import McpActivityLog from './McpActivityLog.svelte';

    import { untrack } from 'svelte';

    import { type SetStateAction } from '../utils/dom';

    const { ipcRenderer } = window;

    interface McpTabProps {
        config: SSHConfig;
        appConfig: AppConfig;
        /** Вкладка открыта и активна (иначе журнал в main очищается по простою). */
        visible: boolean;
        onClose: () => void;
        onAppConfigUpdate: (config: AppConfig) => void;
    }
</script>

<script lang="ts">
    let { config, appConfig, visible, onClose, onAppConfigUpdate }: McpTabProps = $props();

    const { t } = $derived(createI18n(appConfig.language));

    let mcpStatus = $state.raw<McpStatus>(
        untrack(() => ({
            enabled: appConfig.mcpEnabled || false,
            running: false,
            port: appConfig.mcpPort || 3000,
            connectedAgents: 0,
            dangerMode: appConfig.mcpDangerousCommandMode ?? 'ask',
            allowedServerIds: appConfig.mcpAllowedServerIds || [],
        })),
    );
    function setMcpStatus(next: SetStateAction<McpStatus>) {
        mcpStatus = typeof next === 'function' ? next(mcpStatus) : next;
    }

    let logs = $state.raw<McpLogItem[]>([]);
    function setLogs(next: SetStateAction<McpLogItem[]>) {
        logs = typeof next === 'function' ? next(logs) : next;
    }

    let pendingConfirmations = $state.raw<McpConfirmationRequest[]>([]);
    function setPendingConfirmations(next: SetStateAction<McpConfirmationRequest[]>) {
        pendingConfirmations = typeof next === 'function' ? next(pendingConfirmations) : next;
    }

    const isServerAllowed = $derived(mcpStatus.allowedServerIds?.includes(config.id || ''));

    $effect(() => {
        void [config.id];
        return untrack(() => {
            let isMounted = true;

            const loadInitialStatus = async () => {
                if (!ipcRenderer?.mcpGetStatus) return;
                try {
                    const status = await ipcRenderer.mcpGetStatus();
                    if (isMounted) {
                        setMcpStatus(status);
                        if (Array.isArray(status.pendingConfirmations)) {
                            setPendingConfirmations(
                                status.pendingConfirmations.filter((req) => req.connectionId === config.id),
                            );
                        }
                    }
                } catch (e) {
                    console.error('[MCP] Failed to get MCP status in tab:', e);
                }
            };

            // Журнал действий агента накапливается в main-процессе, пока вкладка закрыта:
            // без этой загрузки события, случившиеся раньше, в таймлайне не отображались.
            const loadInitialLogs = async () => {
                if (!config.id || !ipcRenderer?.mcpGetLogs) return;
                try {
                    const history = await ipcRenderer.mcpGetLogs(config.id);
                    if (isMounted && Array.isArray(history)) {
                        setLogs((prev) => mergeLogs(history, prev));
                    }
                } catch (e) {
                    console.error('[MCP] Failed to get MCP log history in tab:', e);
                }
            };

            void loadInitialStatus();
            void loadInitialLogs();

            const unsubStatus = ipcRenderer?.onMcpStatusChanged?.((status: McpStatus) => {
                if (isMounted) {
                    setMcpStatus(status);
                    if (Array.isArray(status.pendingConfirmations)) {
                        setPendingConfirmations(
                            status.pendingConfirmations.filter((req) => req.connectionId === config.id),
                        );
                    }
                }
            });

            const unsubLog = ipcRenderer?.onMcpLog?.((log: McpLogItem) => {
                if (isMounted && log.connectionId === config.id) {
                    setLogs((prev) => {
                        const existingIndex = prev.findIndex((item) => item.id === log.id);
                        if (existingIndex > -1) {
                            const updated = [...prev];
                            updated[existingIndex] = log;
                            return updated;
                        }
                        return [log, ...prev];
                    });
                }
            });

            const unsubReq = ipcRenderer?.onMcpRequestConfirmation?.((req: McpConfirmationRequest) => {
                if (isMounted && req.connectionId === config.id) {
                    setPendingConfirmations((prev) => [...prev.filter((r) => r.id !== req.id), req]);
                }
            });

            return () => {
                isMounted = false;
                if (typeof unsubStatus === 'function') unsubStatus();
                if (typeof unsubLog === 'function') unsubLog();
                if (typeof unsubReq === 'function') unsubReq();
            };
        });
    });

    $effect(() => {
        void [config.id, visible];
        return untrack(() => {
            const connectionId = config.id;
            if (!connectionId || !ipcRenderer?.mcpSetLogsVisible) return;
            ipcRenderer.mcpSetLogsVisible(connectionId, visible);
            return () => {
                ipcRenderer?.mcpSetLogsVisible?.(connectionId, false);
            };
        });
    });

    const handleGrantAccess = async () => {
        if (config.id && ipcRenderer?.mcpOpenServer) {
            const status = await ipcRenderer.mcpOpenServer(config.id);
            setMcpStatus(status);
            if (appConfig.mcpAllowedServerIds && !appConfig.mcpAllowedServerIds.includes(config.id)) {
                onAppConfigUpdate({
                    ...appConfig,
                    mcpAllowedServerIds: [...appConfig.mcpAllowedServerIds, config.id],
                });
            }
        }
    };

    const handleCloseAccess = async () => {
        if (config.id && ipcRenderer?.mcpCloseServer) {
            const status = await ipcRenderer.mcpCloseServer(config.id);
            setMcpStatus(status);
            if (appConfig.mcpAllowedServerIds) {
                onAppConfigUpdate({
                    ...appConfig,
                    mcpAllowedServerIds: appConfig.mcpAllowedServerIds.filter((id) => id !== config.id),
                });
            }
        }
        onClose();
    };

    const handleEnableMcpGlobally = async () => {
        if (ipcRenderer?.mcpToggle) {
            const status = await ipcRenderer.mcpToggle(true);
            setMcpStatus(status);
            onAppConfigUpdate({ ...appConfig, mcpEnabled: true });
        }
    };

    const handleConfirm = async (reqId: string, approved: boolean) => {
        if (ipcRenderer?.mcpConfirmCommand) {
            await ipcRenderer.mcpConfirmCommand({ id: reqId, approved });
        }
        setPendingConfirmations((prev) => prev.filter((r) => r.id !== reqId));
    };

    const handleCancelRun = async (runId: string) => {
        if (ipcRenderer?.mcpCancelRun) {
            await ipcRenderer.mcpCancelRun(runId);
        }
    };
</script>

{#if !mcpStatus.enabled}<div
        style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; background: var(--background); text-align: center"
    >
        <div
            style="width: 64px; height: 64px; border-radius: 16px; background: rgba(217, 130, 43, 0.15); display: flex; align-items: center; justify-content: center; color: #d9822b; margin-bottom: 20px"
        >
            <TriangleAlert size={32} />
        </div>
        <h2 style="color: var(--text-primary); margin: 0 0 8px 0">
            {t('mcp.disabledTitle')}
        </h2>
        <p style="color: var(--text-secondary); max-width: 460px; margin: 0 0 24px 0; line-height: 1.5">
            {t('mcp.disabledDesc')}
        </p>
        <button
            class="btn-primary"
            onclick={handleEnableMcpGlobally}
            style="padding: 10px 20px; font-size: var(--font-size-base); display: flex; align-items: center; gap: 8px"
        >
            <Power size={18} />
            {t('mcp.enableNow')}
        </button>
    </div>{:else}<div
        style="height: 100%; display: flex; flex-direction: column; background: var(--background); color: var(--text-primary); font-size: var(--ui-font-size-base); overflow: hidden"
    >
        <McpTabHeader
            {config}
            {isServerAllowed}
            agents={mcpStatus.agents}
            language={appConfig.language}
            onGrantAccess={handleGrantAccess}
            onCloseAccess={handleCloseAccess}
        />

        <McpPendingConfirmations
            confirmations={pendingConfirmations}
            language={appConfig.language}
            onConfirm={handleConfirm}
        />

        <McpActivityLog {logs} language={appConfig.language} onCancelRun={handleCancelRun} />
    </div>{/if}
