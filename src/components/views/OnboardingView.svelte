<script module lang="ts">
    import {
        Languages,
        Terminal,
        ChevronRight,
        ChevronLeft,
        Check,
        Sparkles,
        Palette,
        Minus,
        Plus,
    } from '@lucide/svelte';

    import CustomSelect from '../layout/CustomSelect.svelte';

    import { createI18n } from '../../utils/i18n';

    import type { Language } from '../../utils/i18n';

    import type { AppConfig } from '../../types';

    import { onMount } from 'svelte';

    import { inlineStyle } from '../../utils/dom';

    interface OnboardingViewProps {
        config: AppConfig;
        onUpdate: (updates: Partial<AppConfig>) => void;
        onComplete: () => void;
        systemFonts: string[];
    }
</script>

<script lang="ts">
    let { config, onUpdate, onComplete, systemFonts }: OnboardingViewProps = $props();

    let step = $state.raw(1);

    const { t } = $derived(createI18n(config.language));

    let isVisible = $state.raw(false);

    onMount(() => {
        Promise.resolve().then(() => {
            isVisible = true;
        });
    });

    const handleLanguageChange = (lang: string) => {
        onUpdate({ language: lang as Language });
    };

    const handleThemeChange = (theme: string) => {
        onUpdate({ theme });
    };

    const handleFontChange = (font: string) => {
        onUpdate({ terminalFontName: font });
    };

    const handleSizeChange = (delta: number) => {
        onUpdate({ terminalFontSize: Math.min(32, Math.max(8, config.terminalFontSize + delta)) });
    };

    const nextStep = () => {
        if (step < 3) step = step + 1;
        else onComplete();
    };

    const prevStep = () => {
        if (step > 1) step = step - 1;
    };
</script>

<div
    style={inlineStyle({
        background: 'var(--background)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.5s ease-out',
        padding: '20px',
        flex: 1,
        height: '100%',
    })}
>
    <div
        style={inlineStyle({
            width: '100%',
            maxWidth: '680px',
            background: 'var(--surface)',
            borderRadius: '24px',
            border: '1px solid var(--border)',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.2)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
            transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            position: 'relative',
        })}
    >
        <!-- Header -->
        <div style="padding: 24px 32px 14px; text-align: center">
            <div
                style="width: 44px; height: 44px; background: linear-gradient(135deg, var(--accent) 0%, #3b82f6 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; color: white; box-shadow: 0 6px 12px rgba(var(--accent-rgb, 59, 130, 246), 0.25)"
            >
                <Sparkles size={22} />
            </div>
            <h1 style="margin: 0 0 4px; font-size: var(--font-size-xl); font-weight: 800; line-height: 1.2">
                {t('onboarding.title')}
            </h1>
            <p style="margin: 0; opacity: 0.6; font-size: var(--ui-font-size-base)">
                {t('onboarding.subtitle')}
            </p>
        </div>

        <!-- Progress bar -->
        <div style="display: flex; gap: 8px; padding: 0 32px; margin-bottom: 20px">
            {#each [1, 2, 3] as s (s)}<div
                    style={inlineStyle({
                        height: '4px',
                        flex: 1,
                        borderRadius: '2px',
                        background: s <= step ? 'var(--accent)' : 'var(--border)',
                        transition: 'background 0.3s ease',
                    })}
                ></div>{/each}
        </div>

        <!-- Content -->
        <div style="padding: 0 32px 24px; flex: 1; min-height: 340px; display: flex; flex-direction: column">
            {#if step === 1}<div style="animation: fadeIn 0.3s ease-out">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px">
                        <Languages size={20} style="color: var(--accent)" />
                        <h3 style="margin: 0">{t('onboarding.stepLanguage')}</h3>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 16px">
                        <button
                            type="button"
                            aria-pressed={config.language === 'ru'}
                            class="plain-button plain-button-wide"
                            style={inlineStyle({
                                padding: '20px',
                                borderRadius: '16px',
                                border: '1px solid var(--border)',
                                background: 'var(--hover-surface)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                borderColor: config.language === 'ru' ? 'var(--accent)' : 'var(--border)',
                            })}
                            onclick={() => handleLanguageChange('ru')}
                        >
                            <span style="display: flex; align-items: center; gap: 16px">
                                <span
                                    style="width: 28px; height: 21px; background: #f1f5f9; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: #1e293b; border: 1px solid #cbd5e1"
                                    >RU</span
                                >
                                <span style="font-weight: 600">Русский</span>
                            </span>
                            {#if config.language === 'ru'}<Check size={20} style="color: var(--accent)" />{/if}
                        </button>

                        <button
                            type="button"
                            aria-pressed={config.language === 'en'}
                            class="plain-button plain-button-wide"
                            style={inlineStyle({
                                padding: '20px',
                                borderRadius: '16px',
                                border: '1px solid var(--border)',
                                background: 'var(--hover-surface)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                borderColor: config.language === 'en' ? 'var(--accent)' : 'var(--border)',
                            })}
                            onclick={() => handleLanguageChange('en')}
                        >
                            <span style="display: flex; align-items: center; gap: 16px">
                                <span
                                    style="width: 28px; height: 21px; background: #f1f5f9; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: #1e293b; border: 1px solid #cbd5e1"
                                    >EN</span
                                >
                                <span style="font-weight: 600">English</span>
                            </span>
                            {#if config.language === 'en'}<Check size={20} style="color: var(--accent)" />{/if}
                        </button>

                        <button
                            type="button"
                            aria-pressed={config.language === 'sov'}
                            class="plain-button plain-button-wide"
                            style={inlineStyle({
                                padding: '20px',
                                borderRadius: '16px',
                                border: '1px solid var(--border)',
                                background: 'var(--hover-surface)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                borderColor: config.language === 'sov' ? 'var(--accent)' : 'var(--border)',
                            })}
                            onclick={() => handleLanguageChange('sov')}
                        >
                            <span style="display: flex; align-items: center; gap: 16px">
                                <span
                                    style="width: 32px; height: 21px; background: #f1f5f9; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; color: #1e293b; border: 1px solid #cbd5e1"
                                    >СССР</span
                                >
                                <span style="font-weight: 600">Советский</span>
                            </span>
                            {#if config.language === 'sov'}<Check size={20} style="color: var(--accent)" />{/if}
                        </button>
                    </div>
                </div>{/if}

            {#if step === 2}<div style="animation: fadeIn 0.3s ease-out">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px">
                        <Palette size={20} style="color: var(--accent)" />
                        <h3 style="margin: 0">{t('onboarding.stepTheme')}</h3>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 16px">
                        <div
                            style="display: flex; align-items: center; justify-content: space-between; padding: 20px; border-radius: 16px; background: var(--hover-surface); border: 1px solid var(--border)"
                        >
                            <div style="flex: 1">
                                <div style="font-weight: 600; font-size: var(--font-size-md)">
                                    {t('settings.theme')}
                                </div>
                                <div style="font-size: var(--font-size-secondary); opacity: 0.6; margin-top: 4px">
                                    {t('settings.subtitle')}
                                </div>
                            </div>
                            <CustomSelect
                                value={config.theme}
                                onChange={handleThemeChange}
                                options={[
                                    { value: 'Auto', label: t('settings.themeAuto') },
                                    { value: 'Light', label: t('settings.themeLight') },
                                    { value: 'Dark', label: t('settings.themeDark') },
                                    { value: 'Gruvbox Light', label: t('settings.themeGruvboxLight') },
                                    { value: 'Gruvbox Dark', label: t('settings.themeGruvboxDark') },
                                    { value: 'Windows Terminal', label: t('settings.themeWindowsTerminal') },
                                ]}
                                style={{ width: '220px' }}
                            />
                        </div>

                        <div
                            style={inlineStyle({
                                padding: '24px',
                                borderRadius: '16px',
                                background:
                                    config.theme === 'Light' ||
                                    (config.theme === 'Auto' &&
                                        !window.matchMedia('(prefers-color-scheme: dark)').matches)
                                        ? '#f8fafc'
                                        : config.theme === 'Dark' ||
                                            (config.theme === 'Auto' &&
                                                window.matchMedia('(prefers-color-scheme: dark)').matches)
                                          ? '#0f172a'
                                          : config.theme === 'Windows Terminal'
                                            ? '#0c0c0c'
                                            : config.theme === 'Gruvbox Dark'
                                              ? '#282828'
                                              : 'var(--hover-surface)',
                                border: '1px solid var(--border)',
                                minHeight: '140px',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                gap: '12px',
                                transition: 'all 0.3s ease',
                            })}
                        >
                            <div
                                style="height: 12px; background: var(--accent); border-radius: 6px; opacity: 0.8; width: 60%"
                            ></div>
                            <div
                                style="height: 12px; background: var(--text-primary); border-radius: 6px; opacity: 0.2; width: 85%"
                            ></div>
                            <div
                                style="height: 12px; background: var(--text-primary); border-radius: 6px; opacity: 0.1; width: 40%"
                            ></div>
                        </div>
                    </div>
                </div>{/if}

            {#if step === 3}<div style="animation: fadeIn 0.3s ease-out">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px">
                        <Terminal size={20} style="color: var(--accent)" />
                        <h3 style="margin: 0">{t('onboarding.stepTerminal')}</h3>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 12px">
                        <div
                            style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--hover-surface); border: 1px solid var(--border)"
                        >
                            <div style="flex: 1">
                                <div style="font-weight: 600; font-size: 14px">
                                    {t('onboarding.terminalFontLabel')}
                                </div>
                                <div style="font-size: 12px; opacity: 0.6; margin-top: 2px">
                                    {t('settings.terminalFontDesc')}
                                </div>
                            </div>
                            <CustomSelect
                                value={config.terminalFontName}
                                onChange={handleFontChange}
                                options={systemFonts.map((f) => ({ value: f, label: f }))}
                                style={{ width: '220px' }}
                            />
                        </div>

                        <div
                            style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--hover-surface); border: 1px solid var(--border)"
                        >
                            <div style="flex: 1">
                                <div style="font-weight: 600; font-size: 14px">
                                    {t('onboarding.terminalFontSizeLabel')}
                                </div>
                                <div style="font-size: 12px; opacity: 0.6; margin-top: 2px">
                                    {t('settings.terminalFontSizeDesc')}
                                </div>
                            </div>
                            <div
                                style="display: flex; align-items: center; background: var(--surface); border-radius: 8px; border: 1px solid var(--border); overflow: hidden; height: 36px; width: 120px"
                            >
                                <button
                                    class="btn-font-control"
                                    style="width: 36px; height: 100%; border: none; background: transparent; display: flex; align-items: center; justify-content: center"
                                    onclick={() => handleSizeChange(-1)}
                                >
                                    <Minus size={14} />
                                </button>
                                <div
                                    style="flex: 1; height: 100%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; border-left: 1px solid var(--border); border-right: 1px solid var(--border); background: var(--hover-surface)"
                                >
                                    {config.terminalFontSize}
                                </div>
                                <button
                                    class="btn-font-control"
                                    style="width: 36px; height: 100%; border: none; background: transparent; display: flex; align-items: center; justify-content: center"
                                    onclick={() => handleSizeChange(1)}
                                >
                                    <Plus size={14} />
                                </button>
                            </div>
                        </div>

                        <div
                            style="padding: 16px; border-radius: 16px; background: var(--hover-surface); border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between"
                        >
                            <div style="flex: 1">
                                <div
                                    style="font-weight: 600; font-size: var(--font-size-secondary); margin-bottom: 4px"
                                >
                                    {t('onboarding.quickCopyPaste')}
                                </div>
                                <div style="font-size: 12px; opacity: 0.6">
                                    {t('onboarding.quickCopyPasteDesc')}
                                </div>
                            </div>
                            <label class="ui-switch">
                                <input
                                    type="checkbox"
                                    checked={config.enableTerminalContextMenu ?? true}
                                    onchange={(e) =>
                                        onUpdate({ enableTerminalContextMenu: e.currentTarget.checked })}
                                />
                                <span class="ui-slider"></span>
                            </label>
                        </div>

                        <div>
                            <span
                                class="settings-label"
                                style="display: block; font-size: var(--font-size-secondary); opacity: 0.6; margin-bottom: 8px"
                            >
                                {t('onboarding.previewLabel')}
                            </span>
                            <div
                                style={inlineStyle({
                                    padding: '16px',
                                    background: '#000',
                                    borderRadius: '12px',
                                    fontFamily: config.terminalFontName,
                                    fontSize: `${config.terminalFontSize}px`,
                                    color: '#fff',
                                    minHeight: '80px',
                                    lineHeight: 1,
                                    whiteSpace: 'pre-wrap',
                                    border: '1px solid var(--border)',
                                    overflow: 'hidden',
                                })}
                            >
                                <span style="color: #10b981">user@yassh</span>:<span style="color: #3b82f6">~</span
                                >$ ls -la
                                <div style="opacity: 0.8; margin-top: 4px">
                                    {t('onboarding.previewText')}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>{/if}
        </div>

        <!-- Footer -->
        <div style="padding: 16px 32px 28px; display: flex; gap: 12px">
            {#if step > 1}<button
                    class="btn-secondary"
                    style="flex: 1; height: 50px; border-radius: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600"
                    onclick={prevStep}
                >
                    <ChevronLeft size={20} />
                    {t('onboarding.back')}
                </button>{/if}
            <button
                class="btn-primary"
                style="flex: 2; height: 50px; border-radius: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; background: var(--accent); color: white; border: none; cursor: pointer"
                onclick={nextStep}
            >
                {#if step === 3}{t('onboarding.finish')}{:else}{t('onboarding.next')}{/if}
                {#if step === 3}<Check size={20} />{:else}<ChevronRight size={20} />{/if}
            </button>
        </div>
    </div>

    <style>
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateX(10px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        .btn-primary:hover {
            filter: brightness(1.1);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(var(--accent-rgb, 59, 130, 246), 0.2);
        }
        .btn-primary:active {
            transform: translateY(0);
        }
        .onboarding-control-btn:hover {
            background: var(--hover-surface) !important;
            color: var(--text-primary) !important;
        }
        .onboarding-exit-btn:hover {
            background: rgba(239, 68, 68, 0.1) !important;
            color: #ef4444 !important;
        }
    </style>
</div>
