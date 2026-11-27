<script module lang="ts">
    import { untrack } from 'svelte';
    import { CircleAlert, ClipboardPaste, Eye, EyeOff, FileKey, Play, Server, Save, Trash2 } from '@lucide/svelte';

    import type { SSHConfig, AppConfig } from '../types';

    import CustomSelect from './layout/CustomSelect.svelte';

    import { usePrivateKeyInput } from '../hooks/usePrivateKeyInput.svelte';

    import { createI18n } from '../utils/i18n';

    import { looksLikePrivateKey } from '../utils/privateKey';

    import { type RefObject, type SetStateAction, type ValueEvent, inlineStyle } from '../utils/dom';

    const { ipcRenderer } = window;

    const INITIAL_COMMANDS_ROWS = 4;

    const stripIpcErrorPrefix = (message: string): string =>
        message.replace(/^Error (?:occurred in handler for|invoking remote method) '[^']+':\s*(?:Error:\s*)?/, '');

    interface ConnectionFormProps {
        onConnect: (config: SSHConfig, shouldSave: boolean) => void;
        /** Сохраняет сервер в избранное без подключения */
        onSave: (config: SSHConfig) => void;
        initialConfig?: SSHConfig;
        appConfig?: AppConfig;
        onClose?: () => void;
    }

    type ConnectionFormSection = 'connection' | 'advanced';
</script>

<script lang="ts">
    const fieldId = $props.id();

    let { onConnect, onSave, initialConfig, appConfig, onClose }: ConnectionFormProps = $props();

    const { t } = $derived(createI18n(appConfig?.language || 'ru'));

    const formRef: RefObject<HTMLFormElement | null> = $state({ current: null });

    let config = $state.raw<SSHConfig>(
        untrack(
            () =>
                initialConfig || {
                    name: '',
                    host: '',
                    port: 22,
                    user: 'root',
                    password: '',
                    authType: 'password',
                    initialCommands: '',
                },
        ),
    );
    function setConfig(next: SetStateAction<SSHConfig>) {
        config = typeof next === 'function' ? next(config) : next;
    }

    let saveToFavorites = $state.raw(true);

    let activeSection = $state.raw<ConnectionFormSection>('connection');
    function setActiveSection(next: SetStateAction<ConnectionFormSection>) {
        activeSection = typeof next === 'function' ? next(activeSection) : next;
    }

    let isSubmitting = $state.raw(false);

    let showPassword = $state.raw(false);

    let showInitialCommands = $state.raw(untrack(() => !!config.initialCommands));
    function setShowInitialCommands(next: SetStateAction<typeof showInitialCommands>) {
        showInitialCommands = typeof next === 'function' ? next(showInitialCommands) : next;
    }

    let validationField = $state.raw<'host' | 'port' | null>(null);

    let fingerprintError = $state.raw<string | null>(null);
    function setFingerprintError(next: SetStateAction<string | null>) {
        fingerprintError = typeof next === 'function' ? next(fingerprintError) : next;
    }

    const privateKeyInput = usePrivateKeyInput(() => appConfig);

    const isHostValid = $derived(!!config.host.trim());

    const isPortValid = $derived(Number.isInteger(config.port) && config.port > 0 && config.port <= 65535);

    const hasSavedKey = $derived(!!(config.privateKey || config.privateKeyPath));

    const hasKey = $derived(hasSavedKey || privateKeyInput.keyDraft !== '');

    const isKeyDraftValid = $derived(
        privateKeyInput.keyDraft === '' || looksLikePrivateKey(privateKeyInput.keyDraft),
    );

    const canSave = $derived(isHostValid && isPortValid && isKeyDraftValid);

    const canConnect = $derived(
        canSave && (config.authType !== 'key' || hasSavedKey || privateKeyInput.keyDraft !== ''),
    );

    const canAttemptConnect = $derived(
        canSave && (config.authType !== 'key' || hasSavedKey || privateKeyInput.keyDraft !== ''),
    );

    const handleChange = (e: ValueEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.currentTarget;
        if (
            (name === 'host' && value.trim()) ||
            (name === 'port' && Number(value) > 0 && Number(value) <= 65535)
        ) {
            validationField = null;
        }
        setConfig((prev: SSHConfig) => ({
            ...prev,
            [name]: name === 'port' ? parseInt(value) || 0 : value,
        }));
    };

    const handleRemoveKey = () => {
        privateKeyInput.clearKeyDraft();
        setConfig((prev) => {
            const next = { ...prev };
            delete next.privateKey;
            delete next.privateKeyPath;
            // Парольная фраза принадлежит этому ключу, поэтому вместе с ним
            // удаляется из вольта и системного хранилища.
            next.keyPassphrase = '';
            return next;
        });
    };

    const handleRemoveFingerprint = async () => {
        const serverId = config.id;
        if (!serverId) {
            setConfig((prev) => {
                const next = { ...prev };
                delete next.fingerprint;
                return next;
            });
            return;
        }

        isSubmitting = true;
        setFingerprintError(null);
        try {
            await ipcRenderer?.sshClearFingerprint?.(serverId);
        } catch (err) {
            const message = stripIpcErrorPrefix(err instanceof Error ? err.message : String(err));
            setFingerprintError(message);
            isSubmitting = false;
            return;
        }
        setConfig((prev) => {
            const next = { ...prev };
            delete next.fingerprint;
            return next;
        });
        isSubmitting = false;
    };

    const handleInitialCommandsToggle = (enabled: boolean) => {
        setShowInitialCommands(enabled);
        if (!enabled) {
            setConfig((prev) => ({ ...prev, initialCommands: '' }));
        }
    };

    const prepareKeyForSubmit = async (): Promise<{ config: SSHConfig } | { error: string }> => {
        if (config.authType !== 'key' || privateKeyInput.keyDraft === '') {
            return { config };
        }
        if (!looksLikePrivateKey(privateKeyInput.keyDraft)) {
            return { error: t('errors.invalidPrivateKey') };
        }
        try {
            const encrypted = await ipcRenderer?.encryptPrivateKey?.(privateKeyInput.keyDraft);
            if (!encrypted) {
                return { error: t('errors.privateKeyEncryptFailed') };
            }
            const next: SSHConfig = { ...config, privateKey: encrypted };
            delete next.privateKeyPath;
            return { config: next };
        } catch (err) {
            const message = stripIpcErrorPrefix(err instanceof Error ? err.message : String(err));
            return { error: message };
        }
    };

    const validateRequiredFields = (): boolean => {
        if (!config.host.trim()) {
            validationField = 'host';
            return false;
        }
        if (!config.port) {
            validationField = 'port';
            return false;
        }
        validationField = null;
        return true;
    };

    const handleConnect = async (e: SubmitEvent) => {
        e.preventDefault();
        if (isSubmitting || !validateRequiredFields() || !canConnect) return;
        isSubmitting = true;
        const prepared = await prepareKeyForSubmit();
        if ('error' in prepared) {
            privateKeyInput.setKeyError(prepared.error);
            isSubmitting = false;
            return;
        }
        setConfig(prepared.config);
        privateKeyInput.clearKeyDraft();
        onConnect(prepared.config, saveToFavorites);
    };

    const handleSaveOnly = async (e: MouseEvent) => {
        e.preventDefault();
        if (isSubmitting || !validateRequiredFields() || !canSave) return;
        isSubmitting = true;
        const prepared = await prepareKeyForSubmit();
        if ('error' in prepared) {
            privateKeyInput.setKeyError(prepared.error);
            isSubmitting = false;
            return;
        }
        setConfig(prepared.config);
        privateKeyInput.clearKeyDraft();
        isSubmitting = false;
        onSave(prepared.config);
        if (onClose) onClose();
    };
</script>

<div style="user-select: none; height: 100%; overflow-y: auto">
    <div style="padding: clamp(16px, 3vw, 36px); max-width: 620px; margin: 0 auto">
        <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px">
            <div
                style="width: 50px; height: 50px; border-radius: 12px; background: var(--accent); color: white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1)"
            >
                <Server size={28} />
            </div>
            <div>
                <h2 style="margin: 0">{t('connection.title')}</h2>
                <div style="opacity: 0.7; font-size: 1em">{t('connection.subtitle')}</div>
            </div>
        </div>

        <form
            bind:this={formRef.current}
            onsubmit={handleConnect}
            autocomplete="off"
            novalidate
            class="connection-form-layout"
        >
            <div class="connection-form-section-tabs" role="tablist" aria-label={t('connection.title')}>
                {#each [['connection', 'connection.sectionConnection'], ['advanced', 'connection.sectionAdvanced']] as const as [section, label] (section)}<button
                        type="button"
                        role="tab"
                        aria-selected={activeSection === section}
                        class={`connection-form-section-tab${activeSection === section ? ' active' : ''}`}
                        onclick={() => setActiveSection(section)}
                    >
                        {t(label)}
                    </button>{/each}
            </div>

            {#if activeSection === 'connection'}<div
                    class="settings-group"
                    role="tabpanel"
                    style="margin-bottom: 0; padding: 15px"
                >
                    <div class="settings-group-title" style="margin-bottom: 10px">{t('connection.general')}</div>

                    <div
                        class="settings-row connection-form-name"
                        style="flex-direction: column; font-size: var(--ui-font-size-base); align-items: stretch; gap: 4px; padding: 8px 0"
                    >
                        <label for={fieldId + '-name'}>{t('connection.name')}</label>
                        <input
                            id={fieldId + '-name'}
                            name="name"
                            autocomplete="off"
                            value={config.name}
                            oninput={handleChange}
                            placeholder={t('connection.namePlaceholder')}
                            style="width: 100%; padding: 10px"
                        />
                    </div>

                    <!-- Single horizontal row for Host, Port, and User -->
                    <div
                        class="settings-row connection-form-endpoint"
                        style="gap: 10px; padding: 8px 0; flex-wrap: wrap"
                    >
                        <div style="flex: 3 1 180px; position: relative">
                            <label for={fieldId + '-host'} style="display: block; margin-bottom: 4px"
                                >{t('connection.host')}</label
                            >
                            <input
                                id={fieldId + '-host'}
                                name="host"
                                autocomplete="off"
                                required
                                value={config.host}
                                oninput={handleChange}
                                onblur={() => !config.host.trim() && (validationField = 'host')}
                                placeholder="127.0.0.1"
                                aria-invalid={validationField === 'host'}
                                aria-describedby={validationField === 'host'
                                    ? 'connection-host-validation'
                                    : undefined}
                                style="width: 100%; padding: 8px"
                            />
                            {#if validationField === 'host'}<div
                                    id="connection-host-validation"
                                    class="connection-validation-tooltip"
                                    role="tooltip"
                                >
                                    <CircleAlert size={16} />
                                    {t('connection.hostRequired')}
                                </div>{/if}
                        </div>
                        <div style="flex: 1 1 80px; min-width: 70px">
                            <label for={fieldId + '-port'} style="display: block; margin-bottom: 4px"
                                >{t('connection.port')}</label
                            >
                            <div style="position: relative">
                                <input
                                    id={fieldId + '-port'}
                                    name="port"
                                    autocomplete="off"
                                    type="number"
                                    min={1}
                                    max={65535}
                                    required
                                    value={config.port || ''}
                                    oninput={handleChange}
                                    onblur={() => !isPortValid && (validationField = 'port')}
                                    placeholder="22"
                                    aria-invalid={validationField === 'port'}
                                    aria-describedby={validationField === 'port'
                                        ? 'connection-port-validation'
                                        : undefined}
                                    style="width: 100%; padding: 8px"
                                />
                                {#if validationField === 'port'}<div
                                        id="connection-port-validation"
                                        class="connection-validation-tooltip"
                                        role="tooltip"
                                    >
                                        <CircleAlert size={16} />
                                        {t('connection.portRequired')}
                                    </div>{/if}
                            </div>
                        </div>
                        <div style="flex: 2 1 120px">
                            <label for={fieldId + '-user'} style="display: block; margin-bottom: 4px"
                                >{t('connection.user')}</label
                            >
                            <input
                                id={fieldId + '-user'}
                                name="user"
                                autocomplete="off"
                                value={config.user}
                                oninput={handleChange}
                                placeholder="root"
                                style="width: 100%; padding: 8px"
                            />
                        </div>
                    </div>
                    <div class="settings-group-title" style="margin: 20px 0 10px">{t('connection.auth')}</div>

                    <div class="settings-row" style="padding: 8px 0">
                        <div class="settings-label-container">
                            <label for={fieldId + '-authType'}>{t('connection.authType')}</label>
                        </div>
                        <CustomSelect
                            id={fieldId + '-authType'}
                            value={config.authType || 'password'}
                            onChange={(val) =>
                                setConfig((prev) => ({ ...prev, authType: val as 'password' | 'key' }))}
                            options={[
                                { value: 'password', label: t('connection.password') },
                                { value: 'key', label: t('connection.sshKey') },
                            ]}
                            style={{
                                width: '180px',
                            }}
                        />
                    </div>

                    {#if config.authType === 'key'}<div
                            class="settings-row"
                            style="flex-direction: column; align-items: stretch; gap: 4px; padding: 8px 0"
                        >
                            <span class="settings-label">{t('connection.privateKey')}</span>
                            {#if hasKey}
                                <div
                                    style="color: #22c55e; font-weight: 600; font-size: var(--font-size-secondary)"
                                >
                                    {t('connection.keySaved')}
                                </div>
                                <div style="display: flex; gap: 10px; margin-top: 4px">
                                    <button
                                        type="button"
                                        onclick={hasSavedKey ? handleRemoveKey : privateKeyInput.clearKeyDraft}
                                        class="btn-danger"
                                        style="padding: 8px 15px; border-radius: 6px; display: flex; align-items: center; gap: 6px"
                                    >
                                        <Trash2 size={16} />
                                        {t('common.delete')}
                                    </button>
                                </div>
                            {:else}<div style="display: flex; gap: 10px; margin-top: 4px; justify-content: center">
                                    <button
                                        type="button"
                                        onclick={privateKeyInput.loadFromFile}
                                        class="btn-secondary"
                                        style="padding: 8px 15px; border-radius: 6px; display: flex; align-items: center; gap: 6px"
                                    >
                                        <FileKey size={16} />
                                        {t('connection.loadFromFile')}
                                    </button>
                                    <button
                                        type="button"
                                        onclick={privateKeyInput.pasteFromClipboard}
                                        class="btn-secondary"
                                        style="padding: 8px 15px; border-radius: 6px; display: flex; align-items: center; gap: 6px"
                                    >
                                        <ClipboardPaste size={16} />
                                        {t('connection.pasteFromClipboard')}
                                    </button>
                                </div>{/if}
                            {#if privateKeyInput.keyError}<div
                                    style="color: var(--danger-color, #ef4444); font-size: var(--ui-font-size); margin-top: 4px"
                                >
                                    {privateKeyInput.keyError}
                                </div>{/if}
                            <label for={fieldId + '-authPassphrase'} style="margin-top: 8px"
                                >{t('terminal.authPassphrase')}</label
                            >
                            <div style="position: relative">
                                <input
                                    id={fieldId + '-authPassphrase'}
                                    name="keyPassphrase"
                                    autocomplete="new-password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={config.keyPassphrase ?? ''}
                                    oninput={handleChange}
                                    placeholder={t('terminal.authPassphrasePlaceholder')}
                                    style="width: 100%; padding: 8px; padding-right: 40px"
                                />
                                <button
                                    type="button"
                                    aria-label={t('connection.showSecret')}
                                    aria-pressed={showPassword}
                                    class="plain-button"
                                    onclick={() => (showPassword = !showPassword)}
                                    style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; display: flex; align-items: center; opacity: 0.5"
                                >
                                    {#if showPassword}<EyeOff size={18} />{:else}<Eye size={18} />{/if}
                                </button>
                            </div>
                        </div>{:else}<div
                            class="settings-row"
                            style="flex-direction: column; align-items: stretch; gap: 4px; padding: 8px 0"
                        >
                            <label for={fieldId + '-password'}>{t('connection.password')}</label>
                            <div style="position: relative">
                                <input
                                    id={fieldId + '-password'}
                                    name="password"
                                    autocomplete="new-password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={config.password}
                                    oninput={handleChange}
                                    placeholder="••••••••"
                                    style="width: 100%; padding: 8px; padding-right: 40px"
                                />
                                <button
                                    type="button"
                                    aria-label={t('connection.showSecret')}
                                    aria-pressed={showPassword}
                                    class="plain-button"
                                    onclick={() => (showPassword = !showPassword)}
                                    style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); cursor: pointer; display: flex; align-items: center; opacity: 0.5"
                                >
                                    {#if showPassword}<EyeOff size={18} />{:else}<Eye size={18} />{/if}
                                </button>
                            </div>
                        </div>{/if}
                    <div class="settings-row" style="padding: 8px 0">
                        <div class="settings-label-container">
                            <label for={fieldId + '-saveToFavorites'}>{t('connection.saveToFavorites')}</label>
                            <div class="settings-description">{t('connection.saveToFavoritesDesc')}</div>
                        </div>
                        <label class="ui-switch">
                            <input
                                id={fieldId + '-saveToFavorites'}
                                type="checkbox"
                                checked={saveToFavorites}
                                onchange={(e) => (saveToFavorites = e.currentTarget.checked)}
                            />
                            <span class="ui-slider"></span>
                        </label>
                    </div>
                </div>{/if}

            {#if activeSection === 'advanced'}<div
                    class="settings-group"
                    role="tabpanel"
                    style="margin-bottom: 0; padding: 15px"
                >
                    <div class="settings-group-title" style="margin-bottom: 10px">{t('connection.advanced')}</div>

                    {#if config.fingerprint}<div
                            class="settings-row connection-form-fingerprint"
                            style="flex-direction: column; align-items: stretch; gap: 4px; padding: 8px 0"
                        >
                            <span class="settings-label">{t('terminal.fingerprintValue')} (SHA256)</span>
                            <div style="display: flex; align-items: center; gap: 10px">
                                <code
                                    style="flex: 1; font-family: var(--ui-font-family); font-size: var(--font-size-base); padding: 8px 10px; border-radius: 8px; background: var(--hover-surface); border: 1px solid var(--border); word-break: break-all; user-select: text"
                                >
                                    {config.fingerprint.replace('SHA256:', '')}
                                </code>
                                <button
                                    type="button"
                                    class="btn-danger"
                                    onclick={handleRemoveFingerprint}
                                    disabled={isSubmitting}
                                    style="padding: 8px 15px; border-radius: 6px; display: flex; align-items: center; gap: 6px; white-space: nowrap; flex-shrink: 0"
                                >
                                    <Trash2 size={16} />
                                    {t('terminal.fingerprintDelete')}
                                </button>
                            </div>
                            {#if fingerprintError}<div
                                    style="color: var(--danger-color, #ef4444); font-size: var(--ui-font-size); margin-top: 4px"
                                >
                                    {fingerprintError}
                                </div>{/if}
                        </div>{/if}

                    <div class="settings-row connection-form-commands-toggle" style="padding: 8px 0">
                        <div class="settings-label-container">
                            <label for={fieldId + '-initialCommands'}>{t('connection.initialCommands')}</label>
                            <div class="settings-description">{t('connection.initialCommandsDesc')}</div>
                        </div>
                        <label class="ui-switch">
                            <input
                                id={fieldId + '-initialCommands'}
                                type="checkbox"
                                checked={showInitialCommands}
                                onchange={(e) => handleInitialCommandsToggle(e.currentTarget.checked)}
                            />
                            <span class="ui-slider"></span>
                        </label>
                    </div>

                    {#if showInitialCommands}<div
                            class="settings-row connection-form-commands-input"
                            style="flex-direction: column; align-items: stretch; gap: 8px"
                        >
                            <textarea
                                name="initialCommands"
                                autocomplete="off"
                                value={config.initialCommands}
                                oninput={handleChange}
                                placeholder="cd /var/www&#10;ls -la"
                                rows={INITIAL_COMMANDS_ROWS}
                                style={inlineStyle({
                                    width: '100%',
                                    padding: '10px',
                                    // Ширину поля менять нельзя: оно идёт во всю
                                    // форму, и растянутое мышью ломает вёрстку
                                    // соседних групп. Высота — можно, но не
                                    // уже четырёх команд: меньше половины
                                    // четвертую строку не видно, и она
                                    // пропадает при сворачивании секции.
                                    resize: 'vertical',
                                    minHeight: `calc(${INITIAL_COMMANDS_ROWS} * 1.5em + 22px)`,
                                })}
                            ></textarea>
                        </div>{/if}

                    <div
                        class="settings-row connection-form-sftp-directory"
                        style="flex-direction: column; align-items: stretch; gap: 8px"
                    >
                        <div class="settings-label-container">
                            <label for={fieldId + '-sftpDefaultDirectory'}
                                >{t('connection.sftpDefaultDirectory')}</label
                            >
                            <div class="settings-description">{t('connection.sftpDefaultDirectoryDesc')}</div>
                        </div>
                        <div style="display: flex; gap: 8px">
                            <input
                                id={fieldId + '-sftpDefaultDirectory'}
                                name="sftpDefaultDirectory"
                                autocomplete="off"
                                value={config.sftpDefaultDirectory || ''}
                                oninput={handleChange}
                                placeholder="/var/www"
                                style="flex: 1; min-width: 0; padding: 10px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 8px"
                            />
                            {#if !!config.sftpDefaultDirectory}<button
                                    type="button"
                                    class="btn-secondary"
                                    onclick={() =>
                                        setConfig((prev) => {
                                            const next = { ...prev };
                                            delete next.sftpDefaultDirectory;
                                            return next;
                                        })}>{t('common.delete')}</button
                                >{/if}
                        </div>
                    </div>
                </div>{/if}

            <div style="display: flex; gap: 15px; margin-top: 10px">
                <button
                    type="button"
                    onclick={handleSaveOnly}
                    disabled={isSubmitting || !canSave}
                    class="btn-secondary"
                    style={inlineStyle({
                        flex: 1,
                        padding: '14px',
                        fontSize: 'var(--ui-font-size-base)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        opacity: !canSave || isSubmitting ? 0.5 : 1,
                        cursor: !canSave || isSubmitting ? 'not-allowed' : 'pointer',
                    })}
                >
                    <Save size={20} />
                    {t('common.save')}
                </button>
                <button
                    type="submit"
                    disabled={isSubmitting ||
                        !canSave ||
                        (config.authType === 'key' && !hasSavedKey && privateKeyInput.keyDraft === '')}
                    class="btn-primary"
                    style={inlineStyle({
                        flex: 1,
                        padding: '14px',
                        fontSize: 'var(--ui-font-size-base)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        opacity: !canAttemptConnect || isSubmitting ? 0.5 : 1,
                        cursor: !canAttemptConnect || isSubmitting ? 'not-allowed' : 'pointer',
                    })}
                >
                    <Play size={20} />
                    {t('connection.connect')}
                </button>
            </div>
        </form>
    </div>
</div>
