<script module lang="ts">
    import {
        Server,
        Power,
        ShieldAlert,
        LockOpen,
        Search,
        ChevronDown,
        Trash2,
        HardDrive,
        Flame,
        Users,
        KeyRound,
        Settings,
        Lock,
        Clock,
        Activity,
        Box,
        Copy,
        Check,
    } from '@lucide/svelte';

    import CustomSelect from '../../layout/CustomSelect.svelte';

    import type {
        AppConfig,
        McpDangerCategory,
        McpDangerMode,
        McpStatus,
        NotificationAction,
        NotificationType,
    } from '../../../types';

    import { createI18n } from '../../../utils/i18n';

    import { getOSIcon } from '../../../utils';

    import {
        MCP_LISTEN_ADDRESS_ALL,
        MCP_LISTEN_ADDRESS_LOCAL,
        isMcpListenAddress,
        resolveMcpListenAddress,
    } from '../../../utils/mcpListen';

    import { writeClipboardText } from '../../../utils/clipboard';

    import { untrack } from 'svelte';

    import { type SetStateAction, inlineStyle, refAction } from '../../../utils/dom';

    const { ipcRenderer } = window;

    const MCP_SERVER_NAME = 'yassh-ssh-bridge';

    const CLIENT_FORMATS = [
        { value: 'claude', label: 'Claude Code', hint: 'mcp.clientConfigClaude' },
        { value: 'codex', label: 'Codex', hint: 'mcp.clientConfigCodex' },
        { value: 'opencode', label: 'OpenCode', hint: 'mcp.clientConfigOpenCode' },
        { value: 'json', label: 'JSON', hint: 'mcp.clientConfigJson' },
        { value: 'http', label: 'HTTP', hint: 'mcp.clientConfigHttp' },
    ];

    const DANGER_MODES: McpDangerMode[] = ['ask', 'allow'];

    const DANGER_MODE_LABELS: Record<McpDangerMode, string> = {
        ask: 'mcp.dangerModeAsk',
        allow: 'mcp.dangerModeAllow',
    };

    const DANGER_CATEGORY_COLORS: Record<string, string> = {
        fileDeletion: '#ef4444',
        diskOperations: '#3b82f6',
        firewall: '#f97316',
        userManagement: '#a855f7',
        sshConfiguration: '#22c55e',
        serviceManagement: '#8b5cf6',
        systemPower: '#ef4444',
        privilegeEscalation: '#eab308',
        shellExecution: '#ec4899',
        permissions: '#06b6d4',
        scheduledTasks: '#14b8a6',
        processes: '#f59e0b',
        containersIac: '#0ea5e9',
    };

    const dangerCategoryColor = (categoryId: string): string => DANGER_CATEGORY_COLORS[categoryId] ?? '#94a3b8';

    interface VisibleDangerCategory {
        category: McpDangerCategory;
        commands: string[];
    }

    let lastMcpStatus: McpStatus | undefined;

    interface McpSectionProps {
        config: AppConfig;
        setConfig: (config: AppConfig) => void;
        showNotification: (
            title: string,
            message: string,
            type?: NotificationType,
            action?: NotificationAction,
        ) => void;
    }
</script>

<script lang="ts">
    const fieldId = $props.id();

    let { config, setConfig, showNotification }: McpSectionProps = $props();

    const { t } = $derived(createI18n(config.language));

    let mcpStatus = $state.raw<McpStatus>(
        (() => {
            // Настройки-поля (enabled/port/mode/disabled/allowed) берутся из
            // конфига — он источник истины, остальное — из кэша последнего статуса.
            const cached = lastMcpStatus;
            return {
                enabled: config.mcpEnabled || false,
                running: cached?.running ?? false,
                state: cached?.state,
                port: config.mcpPort || 3000,
                executable: cached?.executable,
                connectedAgents: cached?.connectedAgents ?? 0,
                agents: cached?.agents,
                dangerMode: config.mcpDangerousCommandMode ?? 'ask',
                dangerCommands: cached?.dangerCommands ?? [],
                disabledDangerCommands: config.mcpDisabledDangerCommands ?? [],
                allowedServerIds: config.mcpAllowedServerIds || [],
                pendingConfirmations: cached?.pendingConfirmations,
                error: cached?.error,
            };
        })(),
    );
    function setMcpStatus(next: SetStateAction<McpStatus>) {
        mcpStatus = typeof next === 'function' ? next(mcpStatus) : next;
    }

    const applyStatus = (status: McpStatus) => {
        lastMcpStatus = status;
        setMcpStatus(status);
    };

    let clientFormat = $state.raw('claude');
    function setClientFormat(next: SetStateAction<typeof clientFormat>) {
        clientFormat = typeof next === 'function' ? next(clientFormat) : next;
    }

    let copiedFormat = $state.raw<string | undefined>(undefined);
    function setCopiedFormat(next: SetStateAction<string | undefined>) {
        copiedFormat = typeof next === 'function' ? next(copiedFormat) : next;
    }

    $effect(() => {
        void [copiedFormat];
        return untrack(() => {
            if (!copiedFormat) return;
            const timer = setTimeout(() => setCopiedFormat(undefined), 2000);
            return () => clearTimeout(timer);
        });
    });

    const fetchStatus = async () => {
        if (!ipcRenderer?.mcpGetStatus) return;
        try {
            const status = await ipcRenderer.mcpGetStatus();
            applyStatus(status);
        } catch (e) {
            console.error('[MCP] Failed to get status:', e);
        }
    };

    $effect(() => {
        void [applyStatus, fetchStatus];
        return untrack(() => {
            const unsub = ipcRenderer?.onMcpStatusChanged?.((status: McpStatus) => {
                applyStatus(status);
            });
            Promise.resolve().then(() => {
                void fetchStatus();
            });
            return () => {
                if (typeof unsub === 'function') unsub();
            };
        });
    });

    const handleToggleMcp = async () => {
        const nextState = !mcpStatus.enabled;
        const updatedConfig = { ...config, mcpEnabled: nextState };
        setConfig(updatedConfig);
        if (ipcRenderer?.mcpToggle) {
            const status = await ipcRenderer.mcpToggle(nextState);
            applyStatus(status);
        }
    };

    const handleDangerModeChange = async (value: string) => {
        if (value !== 'ask' && value !== 'allow') return;
        if (config.mcpDangerousCommandMode === value) return;
        const mode: McpDangerMode = value;
        const updatedConfig = { ...config, mcpDangerousCommandMode: mode };
        setConfig(updatedConfig);
        void ipcRenderer?.saveConfig?.(updatedConfig);
        setMcpStatus((prev) => ({ ...prev, dangerMode: mode }));
    };

    let dangerQuery = $state.raw('');

    let expandedDangerCategories = $state.raw<Set<string>>(new Set());
    function setExpandedDangerCategories(next: SetStateAction<Set<string>>) {
        expandedDangerCategories = typeof next === 'function' ? next(expandedDangerCategories) : next;
    }

    const toggleDangerCategoryExpanded = (categoryId: string) => {
        setExpandedDangerCategories((previous) => {
            const next = new Set(previous);
            if (next.has(categoryId)) next.delete(categoryId);
            else next.add(categoryId);
            return next;
        });
    };

    const applyDisabledDangerCommands = (nextDisabled: string[]) => {
        const updatedConfig = { ...config, mcpDisabledDangerCommands: nextDisabled };
        setConfig(updatedConfig);
        void ipcRenderer?.saveConfig?.(updatedConfig);
        setMcpStatus((prev) => ({ ...prev, disabledDangerCommands: nextDisabled }));
    };

    const handleToggleDangerCommand = (rule: string) => {
        const disabled = config.mcpDisabledDangerCommands ?? [];
        applyDisabledDangerCommands(
            disabled.includes(rule) ? disabled.filter((value) => value !== rule) : [...disabled, rule],
        );
    };

    const handleToggleDangerCategory = (category: McpDangerCategory) => {
        const disabled = config.mcpDisabledDangerCommands ?? [];
        const allEnabled = category.commands.every((rule) => !disabled.includes(rule));
        const otherDisabled = disabled.filter((rule) => !category.commands.includes(rule));
        applyDisabledDangerCommands(allEnabled ? [...otherDisabled, ...category.commands] : otherDisabled);
    };

    const handlePortChange = async (newPortStr: string) => {
        const newPort = parseInt(newPortStr, 10) || 3000;
        const updatedConfig = { ...config, mcpPort: newPort };
        setConfig(updatedConfig);
        setMcpStatus((prev) => ({ ...prev, port: newPort }));
        if (ipcRenderer?.saveConfig) {
            await ipcRenderer.saveConfig(updatedConfig);
            if (mcpStatus.enabled) await fetchStatus();
        }
    };

    const portOptions = $derived([
        { value: '3000', label: '3000' },
        { value: '3001', label: '3001' },
        { value: '3002', label: '3002' },
        { value: '8080', label: '8080' },
        { value: '8081', label: '8081' },
        { value: '9000', label: '9000' },
    ]);

    const listenAddress = $derived(resolveMcpListenAddress(config.mcpListenAddress));

    const listenAddressOptions = $derived([
        { value: MCP_LISTEN_ADDRESS_LOCAL, label: `${MCP_LISTEN_ADDRESS_LOCAL} — ${t('mcp.listenAddressLocal')}` },
        { value: MCP_LISTEN_ADDRESS_ALL, label: `${MCP_LISTEN_ADDRESS_ALL} — ${t('mcp.listenAddressAll')}` },
    ]);

    const handleListenAddressChange = async (newAddress: string) => {
        if (!isMcpListenAddress(newAddress) || newAddress === listenAddress) return;
        const updatedConfig = { ...config, mcpListenAddress: newAddress };
        setConfig(updatedConfig);
        if (ipcRenderer?.saveConfig) {
            await ipcRenderer.saveConfig(updatedConfig);
            if (mcpStatus.enabled) await fetchStatus();
        }
    };

    const handleRegenerateToken = async () => {
        if (!ipcRenderer?.mcpRegenerateToken) return;
        const status = await ipcRenderer.mcpRegenerateToken();
        applyStatus(status);
        showNotification(t('common.success'), t('mcp.tokenRegenerated'), 'success');
    };

    const allowedServerIds = $derived(new Set(mcpStatus.allowedServerIds || config.mcpAllowedServerIds || []));

    const dangerMode = $derived(config.mcpDangerousCommandMode ?? 'ask');

    const disabledDanger = $derived(new Set(config.mcpDisabledDangerCommands ?? []));

    const dangerCategories = $derived(mcpStatus.dangerCommands ?? []);

    const isRuleEnabled = (rule: string) => !disabledDanger.has(rule);

    const handleSetAllDangerRules = (enabled: boolean) => {
        const allRules = Array.from(new Set(dangerCategories.flatMap((category) => category.commands)));
        applyDisabledDangerCommands(enabled ? [] : allRules);
    };

    const normalizedDangerQuery = $derived(dangerQuery.trim().toLowerCase());

    const visibleDangerCategories = $derived.by(() => {
        if (!normalizedDangerQuery) {
            return dangerCategories.map((category) => ({ category, commands: category.commands }));
        }
        const matches: VisibleDangerCategory[] = [];
        for (const category of dangerCategories) {
            const title = t(`mcp.dangerCategory.${category.id}`).toLowerCase();
            if (title.includes(normalizedDangerQuery)) {
                matches.push({ category, commands: category.commands });
                continue;
            }
            const commands = category.commands.filter((rule) =>
                rule.toLowerCase().includes(normalizedDangerQuery),
            );
            if (commands.length > 0) matches.push({ category, commands });
        }
        return matches;
    });

    const dangerModeOptions = $derived(
        DANGER_MODES.map((mode) => ({ value: mode, label: t(DANGER_MODE_LABELS[mode]) })),
    );

    const handleCloseServerAccess = async (serverId: string) => {
        if (!serverId) return;
        if (ipcRenderer?.mcpCloseServer) {
            const status = await ipcRenderer.mcpCloseServer(serverId);
            applyStatus(status);
        }
        const updatedServerIds = (config.mcpAllowedServerIds || []).filter((id) => id !== serverId);
        setConfig({
            ...config,
            mcpAllowedServerIds: updatedServerIds,
        });
    };

    const handleToggleServerAccess = async (serverId: string) => {
        if (!serverId) return;
        if (allowedServerIds.has(serverId)) {
            await handleCloseServerAccess(serverId);
            return;
        }
        if (ipcRenderer?.mcpOpenServer) {
            const status = await ipcRenderer.mcpOpenServer(serverId);
            applyStatus(status);
        }
        setConfig({
            ...config,
            mcpAllowedServerIds: [...(config.mcpAllowedServerIds || []), serverId],
        });
    };

    const allFavorites = $derived((config.favorites || []).filter((fav) => Boolean(fav.id)));

    const isWindows = ipcRenderer?.platform === 'win32';

    const { executable } = $derived(mcpStatus);

    const clientHint = $derived(
        CLIENT_FORMATS.find(({ value }) => value === clientFormat)?.hint ?? 'mcp.clientConfigClaude',
    );

    const clientConfig = (token = '••••••••', commandSeparator = ' ') => {
        if (clientFormat === 'http') {
            return JSON.stringify(
                {
                    mcpServers: {
                        [MCP_SERVER_NAME]: {
                            type: 'http',
                            url: `http://127.0.0.1:${mcpStatus.port || 3000}/mcp`,
                            headers: { Authorization: `Bearer ${token}` },
                        },
                    },
                },
                null,
                2,
            );
        }
        if (!executable) return '';
        if (clientFormat === 'claude') {
            const quotedPath = isWindows ? executable.replaceAll("'", "''") : executable.replaceAll("'", "'\\''");
            return `claude mcp add --scope user ${MCP_SERVER_NAME}${commandSeparator}'${quotedPath}' mcp`;
        }
        if (clientFormat === 'codex') {
            return `[mcp_servers.${MCP_SERVER_NAME}]\ncommand = ${JSON.stringify(executable)}\nargs = ["mcp"]`;
        }
        if (clientFormat === 'opencode') {
            return JSON.stringify(
                {
                    mcp: { servers: { [MCP_SERVER_NAME]: { type: 'local', command: [executable, 'mcp'] } } },
                },
                null,
                2,
            );
        }
        return JSON.stringify(
            {
                mcpServers: { [MCP_SERVER_NAME]: { command: executable, args: ['mcp'] } },
            },
            null,
            2,
        );
    };

    const copyClientConfig = async () => {
        try {
            const token = clientFormat === 'http' ? await ipcRenderer?.mcpGetToken() : undefined;
            if (clientFormat === 'http' && !token) throw new Error();
            await writeClipboardText(clientConfig(token));
            setCopiedFormat(clientFormat);
        } catch {
            showNotification(t('mcp.clientConfigTitle'), t('mcp.clientConfigCopyError'), 'error');
        }
    };

    const preview = clientConfig(undefined, '\n');

    const copied = $derived(copiedFormat === clientFormat);
</script>

{#snippet renderDangerCategoryIcon(categoryId: string)}
    {#if categoryId === 'fileDeletion'}<Trash2 size={14} />{:else if categoryId === 'diskOperations'}<HardDrive
            size={14}
        />{:else if categoryId === 'firewall'}<Flame size={14} />{:else if categoryId === 'userManagement'}<Users
            size={14}
        />{:else if categoryId === 'sshConfiguration'}<KeyRound
            size={14}
        />{:else if categoryId === 'serviceManagement'}<Settings
            size={14}
        />{:else if categoryId === 'systemPower'}<Power
            size={14}
        />{:else if categoryId === 'privilegeEscalation'}<ShieldAlert
            size={14}
        />{:else if categoryId === 'shellExecution'}<Activity
            size={14}
        />{:else if categoryId === 'permissions'}<Lock size={14} />{:else if categoryId === 'scheduledTasks'}<Clock
            size={14}
        />{:else if categoryId === 'processes'}<Activity size={14} />{:else if categoryId === 'containersIac'}<Box
            size={14}
        />{:else}<ShieldAlert size={14} />{/if}
{/snippet}

<div class="settings-section-page">
    <div class="settings-section-header">
        <h2 class="settings-section-title">{t('mcp.title')}</h2>
        <div class="settings-section-subtitle">{t('mcp.subtitle')}</div>
    </div>

    <div class="settings-row">
        <div class="settings-label-container">
            <label for={fieldId + '-enableNow'}>{t('mcp.enableNow')}</label>
            <div class="settings-description" style="display: flex; align-items: center; gap: 8px">
                {#if mcpStatus.enabled && mcpStatus.running}<span
                        style="width: 8px; height: 8px; border-radius: 50%; background-color: #2ea44f; display: inline-block"
                    ></span>{/if}
                <span>
                    {#if mcpStatus.enabled}{#if mcpStatus.state === 'failed'}{mcpStatus.error ||
                                t('mcp.portInUse')}{:else if mcpStatus.running}{t('mcp.statusRunning')}{:else}{t(
                                'mcp.statusStarting',
                            )}{/if}{:else}{t('mcp.statusDisabled')}{/if}
                </span>
            </div>
        </div>
        <label class="ui-switch">
            <input
                id={fieldId + '-enableNow'}
                type="checkbox"
                checked={mcpStatus.enabled}
                onchange={handleToggleMcp}
            />
            <span class="ui-slider"></span>
        </label>
    </div>

    {#if mcpStatus.enabled}
        <div class="settings-row">
            <div class="settings-label-container">
                <label for={fieldId + '-serverPort'}>{t('mcp.serverPort')}</label>
                <div class="settings-description">
                    {t('mcp.serverPortDesc')}
                </div>
            </div>
            <CustomSelect
                id={fieldId + '-serverPort'}
                value={String(mcpStatus.port || 3000)}
                onChange={handlePortChange}
                options={portOptions}
                className="settings-select-fixed"
            />
        </div>

        {#if mcpStatus.state !== 'failed'}
            <div class="settings-row" style="flex-direction: column; align-items: stretch; gap: 10px">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 24px">
                    <div class="settings-label-container">
                        <label for={fieldId + '-listenAddress'}>{t('mcp.listenAddress')}</label>
                        <div class="settings-description">
                            {t('mcp.listenAddressDesc')}
                        </div>
                    </div>
                    <CustomSelect
                        id={fieldId + '-listenAddress'}
                        value={listenAddress}
                        onChange={handleListenAddressChange}
                        options={listenAddressOptions}
                        className="settings-select-fixed"
                    />
                </div>

                {#if listenAddress === MCP_LISTEN_ADDRESS_ALL}<div
                        class="settings-description"
                        style="display: flex; align-items: flex-start; gap: 8px; color: var(--text-secondary); font-size: var(--ui-font-size); line-height: 1.4"
                    >
                        <ShieldAlert size={16} style="flex-shrink: 0; margin-top: 2px" />
                        <span>{t('mcp.listenAddressWarning')}</span>
                    </div>{/if}
            </div>

            <div class="settings-row">
                <div class="settings-label-container">
                    <label for={fieldId + '-requireConfirmation'}>{t('mcp.requireConfirmation')}</label>
                    <div class="settings-description">
                        {t('mcp.requireConfirmationDesc')}
                    </div>
                </div>
                <CustomSelect
                    id={fieldId + '-requireConfirmation'}
                    value={dangerMode}
                    onChange={handleDangerModeChange}
                    options={dangerModeOptions}
                    className="settings-select-fixed"
                />
            </div>

            {#if dangerMode !== 'allow' && dangerCategories.length > 0}<div
                    class="settings-row"
                    style="flex-direction: column; align-items: stretch; gap: 12px"
                >
                    <div class="settings-label-container">
                        <span class="settings-label">{t('mcp.dangerListTitle')}</span>
                        <div class="settings-description">
                            {t('mcp.dangerListDesc')}
                        </div>
                    </div>

                    <div class="danger-panel">
                        <div class="danger-toolbar">
                            <div class="danger-search">
                                <Search size={14} class="danger-search-icon" />
                                <input
                                    type="text"
                                    value={dangerQuery}
                                    oninput={(event) => (dangerQuery = event.currentTarget.value)}
                                    placeholder={t('mcp.dangerSearchPlaceholder')}
                                />
                            </div>
                            <div class="danger-bulk-actions">
                                <button
                                    type="button"
                                    class="danger-bulk-btn"
                                    onclick={() => handleSetAllDangerRules(true)}
                                >
                                    {t('mcp.dangerEnableAll')}
                                </button>
                                <button
                                    type="button"
                                    class="danger-bulk-btn danger-bulk-btn--off"
                                    onclick={() => handleSetAllDangerRules(false)}
                                >
                                    {t('mcp.dangerDisableAll')}
                                </button>
                            </div>
                        </div>

                        {#if visibleDangerCategories.length === 0}<div class="danger-empty">
                                {t('mcp.dangerNoResults')}
                            </div>{:else}<div class="danger-list">
                                {#each visibleDangerCategories as { category, commands } (category.id)}{@const enabledCount =
                                        category.commands.filter((rule) =>
                                            isRuleEnabled(rule),
                                        ).length}{@const allEnabled =
                                        enabledCount === category.commands.length}{@const isExpanded =
                                        normalizedDangerQuery.length > 0 ||
                                        expandedDangerCategories.has(category.id)}{@const categoryTitle = t(
                                        `mcp.dangerCategory.${category.id}`,
                                    )}{@const categoryColor = dangerCategoryColor(
                                        category.id,
                                    )}{@const previewRules =
                                        category.commands.length > 5
                                            ? commands.slice(0, 5)
                                            : commands}{@const hiddenCount = commands.length - previewRules.length}
                                    <div class={`danger-row${isExpanded ? ' danger-row--open' : ''}`}>
                                        <div class="danger-row-head">
                                            <button
                                                type="button"
                                                class="danger-row-main"
                                                aria-expanded={isExpanded}
                                                onclick={() => toggleDangerCategoryExpanded(category.id)}
                                            >
                                                <span
                                                    class="danger-row-icon"
                                                    style={inlineStyle({
                                                        color: categoryColor,
                                                        backgroundColor: `${categoryColor}26`,
                                                    })}
                                                >
                                                    {@render renderDangerCategoryIcon(category.id)}
                                                </span>
                                                <span class="danger-row-title">{categoryTitle}</span>
                                                <span class="danger-row-count">{category.commands.length}</span>
                                                <span class="danger-row-chips">
                                                    {#each previewRules as rule (rule)}<code
                                                            class={`danger-chip${isRuleEnabled(rule) ? '' : ' danger-chip--off'}`}
                                                        >
                                                            {rule}
                                                        </code>{/each}
                                                    {#if hiddenCount > 0}<span class="danger-chip-more">
                                                            {t('mcp.dangerMoreCommands', {
                                                                n: String(hiddenCount),
                                                            })}
                                                        </span>{/if}
                                                </span>
                                            </button>
                                            <label class="ui-switch">
                                                <input
                                                    type="checkbox"
                                                    checked={allEnabled}
                                                    aria-label={categoryTitle}
                                                    use:refAction={(element) => {
                                                        if (element)
                                                            element.indeterminate =
                                                                enabledCount > 0 && !allEnabled;
                                                    }}
                                                    onchange={() => handleToggleDangerCategory(category)}
                                                />
                                                <span class="ui-slider"></span>
                                            </label>
                                            <button
                                                type="button"
                                                class="danger-row-chevron"
                                                aria-expanded={isExpanded}
                                                aria-label={categoryTitle}
                                                onclick={() => toggleDangerCategoryExpanded(category.id)}
                                            >
                                                <ChevronDown size={16} />
                                            </button>
                                        </div>
                                        <div class="danger-row-body">
                                            <div class="danger-row-body-inner">
                                                {#each commands as rule (rule)}<div class="danger-command">
                                                        <code
                                                            class={isRuleEnabled(rule)
                                                                ? undefined
                                                                : 'danger-command--off'}
                                                        >
                                                            {rule}
                                                        </code>
                                                        <label class="ui-switch">
                                                            <input
                                                                type="checkbox"
                                                                checked={isRuleEnabled(rule)}
                                                                aria-label={rule}
                                                                onchange={() => handleToggleDangerCommand(rule)}
                                                            />
                                                            <span class="ui-slider"></span>
                                                        </label>
                                                    </div>{/each}
                                            </div>
                                        </div>
                                    </div>{/each}
                            </div>{/if}
                    </div>
                </div>{/if}

            <div class="settings-row flex-column mcp-client-config">
                <div class="mcp-client-heading">
                    <h3 id="mcp-client-config-title">{t('mcp.clientConfigTitle')}</h3>
                    <div class="mcp-client-formats" role="group" aria-labelledby="mcp-client-config-title">
                        {#each CLIENT_FORMATS as { value, label } (value)}<button
                                type="button"
                                aria-pressed={value === clientFormat}
                                onclick={() => setClientFormat(value)}
                            >
                                {label}
                            </button>{/each}
                    </div>
                </div>
                <div class="mcp-client-panel">
                    <pre class="mcp-client-preview"><code>{preview}</code></pre>
                    <button
                        type="button"
                        class="btn-secondary mcp-client-copy"
                        onclick={copyClientConfig}
                        disabled={!preview}
                        aria-label={copied ? t('common.copied') : t('mcp.copyConfig')}
                        aria-live="polite"
                    >
                        {#if copied}<Check size={15} aria-hidden="true" />{:else}<Copy
                                size={15}
                                aria-hidden="true"
                            />{/if}
                        {#if copied}{t('common.copied')}{:else}{t('common.copy')}{/if}
                    </button>
                </div>
                <div class="mcp-client-footer">
                    <div class="settings-description">
                        {t(clientFormat === 'claude' && isWindows ? 'mcp.clientConfigClaudeWindows' : clientHint)}
                    </div>
                    {#if clientFormat === 'http'}<button
                            type="button"
                            class="mcp-client-token"
                            onclick={handleRegenerateToken}
                        >
                            <KeyRound size={15} aria-hidden="true" />
                            {t('mcp.resetToken')}
                        </button>{/if}
                </div>
            </div>

            <div class="settings-row" style="flex-direction: column; align-items: stretch; gap: 12px">
                <div class="settings-label-container">
                    <span class="settings-label">{t('mcp.allowedServersListTitle')}</span>
                </div>
                {#if allFavorites.length === 0}<div
                        class="settings-description"
                        style="padding: 16px; background: var(--surface); border-radius: 8px; border: 1px solid var(--border); color: var(--text-secondary)"
                    >
                        {t('mcp.noServersToGrant')}
                    </div>{:else}<div
                        style={inlineStyle({
                            display: 'grid',
                            gridTemplateColumns:
                                allFavorites.length >= 3
                                    ? 'repeat(3, minmax(0, 1fr))'
                                    : 'repeat(auto-fill, minmax(min(100%, 320px), 320px))',
                            gap: '10px',
                        })}
                    >
                        {#each allFavorites as fav (fav.id)}{@const isAllowed = Boolean(
                                fav.id && allowedServerIds.has(fav.id),
                            )}
                            <div
                                style="display: flex; flex-direction: column; align-items: stretch; padding: 10px 12px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); gap: 10px; min-width: 0"
                            >
                                <div style="display: flex; align-items: center; gap: 10px; min-width: 0">
                                    <div
                                        style="width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; flex-shrink: 0"
                                    >
                                        {#if fav.osPrettyName}<img
                                                src={getOSIcon(fav.osPrettyName)}
                                                alt={fav.osPrettyName}
                                                style="width: 100%; height: 100%; object-fit: contain"
                                                draggable="false"
                                            />{:else}<Server size={16} style="color: var(--text-secondary)" />{/if}
                                    </div>
                                    <div style="min-width: 0">
                                        <div
                                            style="font-weight: 600; color: var(--text-primary); font-size: var(--ui-font-size); white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
                                        >
                                            {fav.name || fav.host}
                                        </div>
                                        <div
                                            style="font-size: var(--ui-font-size); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
                                        >
                                            {fav.user}@{fav.host}:{fav.port || 22}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    class={isAllowed ? 'btn-danger' : 'btn-secondary'}
                                    onclick={() => handleToggleServerAccess(fav.id!)}
                                    style="height: 30px; padding: 0 10px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: var(--ui-font-size); border-radius: 6px; cursor: pointer; width: 100%; min-width: 0; white-space: nowrap; overflow: hidden"
                                >
                                    {#if isAllowed}<Power size={14} style="flex-shrink: 0" />{:else}<LockOpen
                                            size={14}
                                            style="flex-shrink: 0"
                                        />{/if}
                                    <span
                                        style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                                    >
                                        {#if isAllowed}{t('mcp.closeAccess')}{:else}{t('mcp.grantAccess')}{/if}
                                    </span>
                                </button>
                            </div>{/each}
                    </div>{/if}
            </div>
        {/if}
    {/if}
</div>
