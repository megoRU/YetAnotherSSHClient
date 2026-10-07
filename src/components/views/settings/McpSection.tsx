import { useState, useEffect, useCallback, useMemo, type FC } from 'react';
import { Server, Power, ShieldAlert, Unlock, Search, ChevronDown, Trash2, HardDrive, Flame, Users, KeyRound, Settings, Lock, Clock, Activity, Box } from 'lucide-react';
import { CustomSelect } from '../../layout/CustomSelect';
import type { AppConfig, McpDangerCategory, McpDangerMode, McpStatus, NotificationAction, NotificationType } from '../../../types';
import { useI18n } from '../../../utils/i18n';
import { getOSIcon } from '../../../utils';
import { MCP_LISTEN_ADDRESS_ALL, MCP_LISTEN_ADDRESS_LOCAL, isMcpListenAddress, resolveMcpListenAddress } from '../../../utils/mcpListen';
import { copyToClipboard } from '../../../utils/clipboard';

const { ipcRenderer } = window;

/** Режимы обработки опасных команд — порядок соответствует UI. */
const DANGER_MODES: McpDangerMode[] = ['ask', 'allow'];

/** Ключи локализации подписей режимов. */
const DANGER_MODE_LABELS: Record<McpDangerMode, string> = {
    ask: 'mcp.dangerModeAsk',
    allow: 'mcp.dangerModeAllow'
};

/** Цвета иконок категорий (hex — цвет применяется и как подложка с альфой). */
const DANGER_CATEGORY_COLORS: Record<string, string> = {
    fileDeletion: '#ef4444',
    diskOperations: '#3b82f6',
    firewall: '#f97316',
    userManagement: '#a855f7',
    sshConfiguration: '#22c55e',
    serviceManagement: '#8b5cf6',
    systemPower: '#ef4444',
    privilegeEscalation: '#eab308',
    permissions: '#06b6d4',
    scheduledTasks: '#14b8a6',
    processes: '#f59e0b',
    containersIac: '#0ea5e9'
};

/** Цвет иконки категории: по каталогу бэкенда или нейтральный fallback. */
const dangerCategoryColor = (categoryId: string): string =>
    DANGER_CATEGORY_COLORS[categoryId] ?? '#94a3b8';

/** Иконка категории по её идентификатору из каталога бэкенда. */
const renderDangerCategoryIcon = (categoryId: string) => {
    switch (categoryId) {
        case 'fileDeletion': return <Trash2 size={14} />;
        case 'diskOperations': return <HardDrive size={14} />;
        case 'firewall': return <Flame size={14} />;
        case 'userManagement': return <Users size={14} />;
        case 'sshConfiguration': return <KeyRound size={14} />;
        case 'serviceManagement': return <Settings size={14} />;
        case 'systemPower': return <Power size={14} />;
        case 'privilegeEscalation': return <ShieldAlert size={14} />;
        case 'permissions': return <Lock size={14} />;
        case 'scheduledTasks': return <Clock size={14} />;
        case 'processes': return <Activity size={14} />;
        case 'containersIac': return <Box size={14} />;
        default: return <ShieldAlert size={14} />;
    }
};

/** Категория с учётом поиска: `commands` — видимые (совпавшие) правила. */
interface VisibleDangerCategory {
    category: McpDangerCategory;
    commands: string[];
}

/**
 * Последний статус MCP-сервера, переживающий размонтирование секции.
 *
 * `McpSection` создаётся заново при каждом переходе на вкладку настроек MCP,
 * а каталог опасных команд и состояние сервера приходят только из асинхронного
 * `mcpGetStatus`. Без кэша первый кадр каждого входа пустой: индикатор показывает
 * «Запускается…», а список категорий появляется позже — визуально это выглядит
 * как подгрузка. Кэш делает повторные входы мгновенными; актуальность
 * гарантируют `applyStatus` и обновления ниже.
 */
let lastMcpStatus: McpStatus | null = null;

interface McpSectionProps {
    config: AppConfig;
    setConfig: (config: AppConfig) => void;
    showNotification: (title: string, message: string, type?: NotificationType, action?: NotificationAction) => void;
}

export const McpSection: FC<McpSectionProps> = ({ config, setConfig, showNotification }) => {
    const { t } = useI18n(config.language);
    const [mcpStatus, setMcpStatus] = useState<McpStatus>(() => {
        // Настройки-поля (enabled/port/mode/disabled/allowed) берутся из
        // конфига — он источник истины, остальное — из кэша последнего статуса.
        const cached = lastMcpStatus;
        return {
            enabled: config.mcpEnabled || false,
            running: cached?.running ?? false,
            state: cached?.state,
            port: config.mcpPort || 3000,
            connectedAgents: cached?.connectedAgents ?? 0,
            agents: cached?.agents,
            dangerMode: config.mcpDangerousCommandMode ?? 'ask',
            dangerCommands: cached?.dangerCommands ?? [],
            disabledDangerCommands: config.mcpDisabledDangerCommands ?? [],
            allowedServerIds: config.mcpAllowedServerIds || [],
            pendingConfirmations: cached?.pendingConfirmations,
            error: cached?.error
        };
    });

    /** Принимает авторитетный статус от бэкенда и обновляет кэш секции. */
    const applyStatus = useCallback((status: McpStatus) => {
        lastMcpStatus = status;
        setMcpStatus(status);
    }, []);

    const [mcpToken, setMcpToken] = useState<string>(config.mcpToken || '');
    const [copiedConfig, setCopiedConfig] = useState(false);
    const fetchToken = useCallback(async () => {
        if (!ipcRenderer?.mcpGetToken) return;
        try {
            const token = await ipcRenderer.mcpGetToken();
            setMcpToken(token);
        } catch (e) {
            console.error('[MCP] Failed to get token:', e);
        }
    }, []);

    const fetchStatus = useCallback(async () => {
        if (!ipcRenderer?.mcpGetStatus) return;
        try {
            const status = await ipcRenderer.mcpGetStatus();
            applyStatus(status);
        } catch (e) {
            console.error('[MCP] Failed to get status:', e);
        }
    }, [applyStatus]);

    useEffect(() => {
        const unsub = ipcRenderer?.onMcpStatusChanged?.((status: McpStatus) => {
            applyStatus(status);
        });
        Promise.resolve().then(() => {
            void fetchStatus();
            void fetchToken();
        });
        return () => {
            if (typeof unsub === 'function') unsub();
        };
    }, [applyStatus, fetchStatus, fetchToken]);

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
        setMcpStatus(prev => ({ ...prev, dangerMode: mode }));
    };

    const [dangerQuery, setDangerQuery] = useState('');
    const [expandedDangerCategories, setExpandedDangerCategories] = useState<Set<string>>(() => new Set());

    const toggleDangerCategoryExpanded = useCallback((categoryId: string) => {
        setExpandedDangerCategories(previous => {
            const next = new Set(previous);
            if (next.has(categoryId)) next.delete(categoryId);
            else next.add(categoryId);
            return next;
        });
    }, []);

    /** Сохраняет новый список отключённых правил в конфиг и статус сервера. */
    const applyDisabledDangerCommands = useCallback((nextDisabled: string[]) => {
        const updatedConfig = { ...config, mcpDisabledDangerCommands: nextDisabled };
        setConfig(updatedConfig);
        void ipcRenderer?.saveConfig?.(updatedConfig);
        setMcpStatus(prev => ({ ...prev, disabledDangerCommands: nextDisabled }));
    }, [config, setConfig]);

    const handleToggleDangerCommand = (rule: string) => {
        const disabled = config.mcpDisabledDangerCommands ?? [];
        applyDisabledDangerCommands(
            disabled.includes(rule)
                ? disabled.filter(value => value !== rule)
                : [...disabled, rule]
        );
    };

    const handleToggleDangerCategory = (category: McpDangerCategory) => {
        const disabled = config.mcpDisabledDangerCommands ?? [];
        const allEnabled = category.commands.every(rule => !disabled.includes(rule));
        const otherDisabled = disabled.filter(rule => !category.commands.includes(rule));
        applyDisabledDangerCommands(allEnabled ? [...otherDisabled, ...category.commands] : otherDisabled);
    };

    const handlePortChange = async (newPortStr: string) => {
        const newPort = parseInt(newPortStr, 10) || 3000;
        const updatedConfig = { ...config, mcpPort: newPort };
        setConfig(updatedConfig);
        setMcpStatus(prev => ({ ...prev, port: newPort }));
        if (ipcRenderer?.saveConfig) {
            await ipcRenderer.saveConfig(updatedConfig);
            if (mcpStatus.enabled) await fetchStatus();
        }
    };

    const portOptions = useMemo(() => [
        { value: '3000', label: '3000' },
        { value: '3001', label: '3001' },
        { value: '3002', label: '3002' },
        { value: '8080', label: '8080' },
        { value: '8081', label: '8081' },
        { value: '9000', label: '9000' }
    ], []);

    const listenAddress = resolveMcpListenAddress(config.mcpListenAddress);

    const listenAddressOptions = useMemo(() => [
        { value: MCP_LISTEN_ADDRESS_LOCAL, label: `${MCP_LISTEN_ADDRESS_LOCAL} — ${t('mcp.listenAddressLocal')}` },
        { value: MCP_LISTEN_ADDRESS_ALL, label: `${MCP_LISTEN_ADDRESS_ALL} — ${t('mcp.listenAddressAll')}` }
    ], [t]);

    // Адрес меняется только вместе с перезапуском сервера: `save-config`
    // сравнивает адрес с прежним и поднимает сервер заново, а `mcpToggle(true)`
    // делает то же для текущего сеанса — как и при смене порта.
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
        await fetchToken();
        showNotification(t('common.success'), t('mcp.tokenRegenerated'), 'success');
    };

    const allowedServerIds = new Set(mcpStatus.allowedServerIds || config.mcpAllowedServerIds || []);

    // Источник истины по режиму и отключённым правилам — конфиг: именно его
    // читает бэкенд при выполнении команды. Каталог приходит в статусе.
    const dangerMode = config.mcpDangerousCommandMode ?? 'ask';
    const disabledDanger = new Set(config.mcpDisabledDangerCommands ?? []);
    // Мемоизация нужна useMemo ниже: без неё `?? []` дал бы новый массив
    // на каждом рендере и сбрасывала бы вычисление видимых категорий.
    const dangerCategories = useMemo(
        () => mcpStatus.dangerCommands ?? [],
        [mcpStatus.dangerCommands]
    );

    /** Правило включено: оно не отключено пользователем. */
    const isRuleEnabled = (rule: string) => !disabledDanger.has(rule);

    // «Включить все» — разрешить всё без исключений; «Отключить все» —
    // снять все правила каталога целиком.
    const handleSetAllDangerRules = (enabled: boolean) => {
        const allRules = Array.from(new Set(dangerCategories.flatMap(category => category.commands)));
        applyDisabledDangerCommands(enabled ? [] : allRules);
    };

    // Поиск по названиям категорий и командам: совпадение по названию
    // показывает категорию целиком, по команде — только совпавшие правила.
    const normalizedDangerQuery = dangerQuery.trim().toLowerCase();

    const visibleDangerCategories = useMemo<VisibleDangerCategory[]>(() => {
        if (!normalizedDangerQuery) {
            return dangerCategories.map(category => ({ category, commands: category.commands }));
        }
        const matches: VisibleDangerCategory[] = [];
        for (const category of dangerCategories) {
            const title = t(`mcp.dangerCategory.${category.id}`).toLowerCase();
            if (title.includes(normalizedDangerQuery)) {
                matches.push({ category, commands: category.commands });
                continue;
            }
            const commands = category.commands.filter(rule => rule.toLowerCase().includes(normalizedDangerQuery));
            if (commands.length > 0) matches.push({ category, commands });
        }
        return matches;
    }, [dangerCategories, normalizedDangerQuery, t]);

    const dangerModeOptions = useMemo(
        () => DANGER_MODES.map(mode => ({ value: mode, label: t(DANGER_MODE_LABELS[mode]) })),
        [t]
    );

    const handleCloseServerAccess = async (serverId: string) => {
        if (!serverId) return;
        if (ipcRenderer?.mcpCloseServer) {
            const status = await ipcRenderer.mcpCloseServer(serverId);
            applyStatus(status);
        }
        const updatedServerIds = (config.mcpAllowedServerIds || []).filter(id => id !== serverId);
        setConfig({
            ...config,
            mcpAllowedServerIds: updatedServerIds
        });
    };

    // Кнопка в списке работает как переключатель: сервер без доступа получает его
    // по нажатию, сервер с доступом — теряет.
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
            mcpAllowedServerIds: [...(config.mcpAllowedServerIds || []), serverId]
        });
    };

    // Все сервера из избранного, в том же порядке, что и в самом избранном.
    const allFavorites = useMemo(
        () => (config.favorites || []).filter(fav => Boolean(fav.id)),
        [config.favorites]
    );

    const copyAndFlash = (text: string, setCopied: (v: boolean) => void) => {
        copyToClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const mcpEndpoint = `http://127.0.0.1:${mcpStatus.port || 3000}`;

    const jsonClientConfig = {
        mcpServers: {
            "yassh-ssh-bridge": {
                type: "http",
                url: `${mcpEndpoint}/mcp`,
                headers: {
                    Authorization: `Bearer ${mcpToken}`
                }
            }
        }
    };

    return (
        <div className="settings-section-page">
            <div className="settings-section-header">
                <h2 className="settings-section-title">{t('mcp.title')}</h2>
                <div className="settings-section-subtitle">{t('mcp.subtitle')}</div>
            </div>

            <div className="settings-row">
                <div className="settings-label-container">
                    <label>{t('mcp.enableNow')}</label>
                    <div className="settings-description" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {mcpStatus.enabled && mcpStatus.running && (
                            <span style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: '#2ea44f',
                                display: 'inline-block'
                            }} />
                        )}
                        <span>
                            {mcpStatus.enabled
                                ? (mcpStatus.state === 'failed'
                                    ? mcpStatus.error || t('mcp.portInUse')
                                    : mcpStatus.running
                                        ? t('mcp.statusRunning')
                                        : t('mcp.statusStarting'))
                                : t('mcp.statusDisabled')}
                        </span>
                    </div>
                </div>
                <label className="ui-switch">
                    <input
                        type="checkbox"
                        checked={mcpStatus.enabled}
                        onChange={handleToggleMcp}
                    />
                    <span className="ui-slider"></span>
                </label>
            </div>

            {mcpStatus.enabled && (
                <>
                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('mcp.serverPort')}</label>
                            <div className="settings-description">
                                {t('mcp.serverPortDesc')}
                            </div>
                        </div>
                        <CustomSelect
                            value={String(mcpStatus.port || 3000)}
                            onChange={handlePortChange}
                            options={portOptions}
                            className="settings-select-fixed"
                        />
                    </div>

                    {mcpStatus.state !== 'failed' && (
                        <>
                    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px' }}>
                            <div className="settings-label-container">
                                <label>{t('mcp.listenAddress')}</label>
                                <div className="settings-description">
                                    {t('mcp.listenAddressDesc')}
                                </div>
                            </div>
                            <CustomSelect
                                value={listenAddress}
                                onChange={handleListenAddressChange}
                                options={listenAddressOptions}
                                className="settings-select-fixed"
                            />
                        </div>

                        {listenAddress === MCP_LISTEN_ADDRESS_ALL && (
                            <div className="settings-description" style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                color: 'var(--text-secondary)',
                                fontSize: 'var(--ui-font-size)',
                                lineHeight: '1.4'
                            }}>
                                <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                                <span>{t('mcp.listenAddressWarning')}</span>
                            </div>
                        )}
                    </div>

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('mcp.requireConfirmation')}</label>
                            <div className="settings-description">
                                {t('mcp.requireConfirmationDesc')}
                            </div>
                        </div>
                        <CustomSelect
                            value={dangerMode}
                            onChange={handleDangerModeChange}
                            options={dangerModeOptions}
                            className="settings-select-fixed"
                        />
                    </div>

                    {dangerMode !== 'allow' && dangerCategories.length > 0 && (
                        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
                            <div className="settings-label-container">
                                <label>{t('mcp.dangerListTitle')}</label>
                                <div className="settings-description">
                                    {t('mcp.dangerListDesc')}
                                </div>
                            </div>

                            <div className="danger-panel">
                                <div className="danger-toolbar">
                                    <div className="danger-search">
                                        <Search size={14} className="danger-search-icon" />
                                        <input
                                            type="text"
                                            value={dangerQuery}
                                            onChange={event => setDangerQuery(event.target.value)}
                                            placeholder={t('mcp.dangerSearchPlaceholder')}
                                        />
                                    </div>
                                    <div className="danger-bulk-actions">
                                        <button
                                            type="button"
                                            className="danger-bulk-btn"
                                            onClick={() => handleSetAllDangerRules(true)}
                                        >
                                            {t('mcp.dangerEnableAll')}
                                        </button>
                                        <button
                                            type="button"
                                            className="danger-bulk-btn danger-bulk-btn--off"
                                            onClick={() => handleSetAllDangerRules(false)}
                                        >
                                            {t('mcp.dangerDisableAll')}
                                        </button>
                                    </div>
                                </div>

                                {visibleDangerCategories.length === 0 ? (
                                    <div className="danger-empty">{t('mcp.dangerNoResults')}</div>
                                ) : (
                                    <div className="danger-list">
                                        {visibleDangerCategories.map(({ category, commands }) => {
                                            const enabledCount = category.commands.filter(rule => isRuleEnabled(rule)).length;
                                            const allEnabled = enabledCount === category.commands.length;
                                            const isExpanded = normalizedDangerQuery.length > 0
                                                || expandedDangerCategories.has(category.id);
                                            const categoryTitle = t(`mcp.dangerCategory.${category.id}`);
                                            const categoryColor = dangerCategoryColor(category.id);
                                            // Длинные категории (много команд) в свёрнутом виде показывают часть —
                                            // иначе строка раздувается; короткие — целиком. Полный список
                                            // доступен при раскрытии.
                                            const previewRules = category.commands.length > 5
                                                ? commands.slice(0, 5)
                                                : commands;
                                            const hiddenCount = commands.length - previewRules.length;
                                            return (
                                                <div
                                                    key={category.id}
                                                    className={`danger-row${isExpanded ? ' danger-row--open' : ''}`}
                                                >
                                                    <div className="danger-row-head">
                                                        <button
                                                            type="button"
                                                            className="danger-row-main"
                                                            aria-expanded={isExpanded}
                                                            onClick={() => toggleDangerCategoryExpanded(category.id)}
                                                        >
                                                            <span
                                                                className="danger-row-icon"
                                                                style={{
                                                                    color: categoryColor,
                                                                    backgroundColor: `${categoryColor}26`
                                                                }}
                                                            >
                                                                {renderDangerCategoryIcon(category.id)}
                                                            </span>
                                                            <span className="danger-row-title">{categoryTitle}</span>
                                                            <span className="danger-row-count">{category.commands.length}</span>
                                                            <span className="danger-row-chips">
                                                                {previewRules.map(rule => (
                                                                    <code
                                                                        key={rule}
                                                                        className={
                                                                            `danger-chip${isRuleEnabled(rule) ? '' : ' danger-chip--off'}`
                                                                        }
                                                                    >
                                                                        {rule}
                                                                    </code>
                                                                ))}
                                                                {hiddenCount > 0 && (
                                                                    <span className="danger-chip-more">
                                                                        {t('mcp.dangerMoreCommands', { n: String(hiddenCount) })}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </button>
                                                        <label className="ui-switch">
                                                            <input
                                                                type="checkbox"
                                                                checked={allEnabled}
                                                                aria-label={categoryTitle}
                                                                ref={element => {
                                                                    if (element) element.indeterminate = enabledCount > 0 && !allEnabled;
                                                                }}
                                                                onChange={() => handleToggleDangerCategory(category)}
                                                            />
                                                            <span className="ui-slider"></span>
                                                        </label>
                                                        <button
                                                            type="button"
                                                            className="danger-row-chevron"
                                                            aria-expanded={isExpanded}
                                                            aria-label={categoryTitle}
                                                            onClick={() => toggleDangerCategoryExpanded(category.id)}
                                                        >
                                                            <ChevronDown size={16} />
                                                        </button>
                                                    </div>
                                                    <div className="danger-row-body">
                                                        <div className="danger-row-body-inner">
                                                            {commands.map(rule => (
                                                                <div key={rule} className="danger-command">
                                                                    <code className={isRuleEnabled(rule) ? undefined : 'danger-command--off'}>
                                                                        {rule}
                                                                    </code>
                                                                    <label className="ui-switch">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={isRuleEnabled(rule)}
                                                                            aria-label={rule}
                                                                            onChange={() => handleToggleDangerCommand(rule)}
                                                                        />
                                                                        <span className="ui-slider"></span>
                                                                    </label>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="settings-row">
                        <div className="settings-label-container">
                            <label>{t('mcp.clientConfigTitle')}</label>
                            <div className="settings-description">
                                {t('mcp.clientConfigDesc')}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                            <button
                                className="btn-secondary settings-select-fixed"
                                onClick={handleRegenerateToken}
                                title={t('mcp.regenerateToken')}
                                style={{ height: '36px', cursor: 'pointer' }}
                            >
                                {t('mcp.resetToken')}
                            </button>
                            <button
                                className="btn-secondary settings-select-fixed"
                                onClick={() => copyAndFlash(JSON.stringify(jsonClientConfig, null, 2), setCopiedConfig)}
                                style={{ height: '36px', cursor: 'pointer' }}
                            >
                                {copiedConfig ? t('common.copied') : t('mcp.copyConfig')}
                            </button>
                        </div>
                    </div>

                    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
                        <div className="settings-label-container">
                            <label>{t('mcp.allowedServersListTitle')}</label>
                        </div>
                        {allFavorites.length === 0 ? (
                            <div className="settings-description" style={{
                                padding: '16px',
                                background: 'var(--surface)',
                                borderRadius: '8px',
                                border: '1px solid var(--border)',
                                color: 'var(--text-secondary)'
                            }}>
                                {t('mcp.noServersToGrant')}
                            </div>
                        ) : (
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                gap: '10px'
                            }}>
                                {allFavorites.map(fav => {
                                    const isAllowed = Boolean(fav.id && allowedServerIds.has(fav.id));
                                    return (
                                        <div
                                            key={fav.id}
                                            style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'stretch',
                                                padding: '10px 12px',
                                                borderRadius: '8px',
                                                background: 'var(--surface)',
                                                border: isAllowed ? '1px solid #2ea44f' : '1px solid var(--border)',
                                                gap: '10px',
                                                minWidth: 0
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                                                <div style={{ width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                    {fav.osPrettyName ? (
                                                        <img
                                                            src={getOSIcon(fav.osPrettyName)}
                                                            alt={fav.osPrettyName}
                                                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                                            draggable="false"
                                                        />
                                                    ) : (
                                                        <Server size={16} style={{ color: 'var(--text-secondary)' }} />
                                                    )}
                                                </div>
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{
                                                        fontWeight: 600,
                                                        color: 'var(--text-primary)',
                                                        fontSize: 'var(--ui-font-size)',
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis'
                                                    }}>
                                                        {fav.name || fav.host}
                                                    </div>
                                                    <div style={{
                                                        fontSize: 'var(--ui-font-size)',
                                                        color: 'var(--text-secondary)',
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis'
                                                    }}>
                                                        {fav.user}@{fav.host}:{fav.port || 22}
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                className={isAllowed ? 'btn-danger' : 'btn-secondary'}
                                                onClick={() => handleToggleServerAccess(fav.id!)}
                                                title={isAllowed ? t('mcp.closeAccess') : t('mcp.grantAccess')}
                                                style={{
                                                    height: '30px',
                                                    padding: '0 10px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: '6px',
                                                    fontSize: 'var(--ui-font-size)',
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    width: '100%',
                                                    minWidth: 0,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden'
                                                }}
                                            >
                                                {isAllowed ? <Power size={14} style={{ flexShrink: 0 }} /> : <Unlock size={14} style={{ flexShrink: 0 }} />}
                                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {isAllowed ? t('mcp.closeAccess') : t('mcp.grantAccess')}
                                                </span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
};
