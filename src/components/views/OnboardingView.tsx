import React, { useState, useEffect } from 'react';
import { Languages, Terminal, ChevronRight, ChevronLeft, Check, Sparkles, Keyboard, Info, Palette, X, Minus, Plus } from 'lucide-react';
import { CustomSelect } from '../layout/CustomSelect';
import { useI18n } from '../../utils/i18n';
import type { Language } from '../../utils/i18n';
import type { AppConfig } from '../../types';

const { ipcRenderer } = window;

interface OnboardingViewProps {
    config: AppConfig;
    onUpdate: (updates: Partial<AppConfig>) => void;
    onComplete: () => void;
    systemFonts: string[];
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({ config, onUpdate, onComplete, systemFonts }) => {
    const [step, setStep] = useState(1);
    const { t } = useI18n(config.language);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        Promise.resolve().then(() => {
            setIsVisible(true);
        });
    }, []);

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
        if (step < 4) setStep(step + 1);
        else onComplete();
    };

    const prevStep = () => {
        if (step > 1) setStep(step - 1);
    };

    const isMac = ipcRenderer?.platform === 'darwin';

    const shortcuts = [
        { label: t('settings.searchHistory'), key: 'Ctrl + R' },
        { label: t('settings.reloadApp'), key: 'Ctrl + R / F5' },
    ];

    if (isMac) {
        shortcuts.push({ label: t('settings.copyTerminal'), key: 'Cmd + C' });
        shortcuts.push({ label: t('settings.pasteTerminal'), key: 'Cmd + V' });
    } else {
        shortcuts.push({ label: t('settings.copyTerminal'), key: 'Ctrl + Shift + C' });
        shortcuts.push({ label: t('settings.pasteTerminal'), key: 'Ctrl + Shift + V' });
    }

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'var(--background)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: isVisible ? 1 : 0,
            transition: 'opacity 0.5s ease-out',
            padding: '20px'
        }}>
            <div style={{
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
                position: 'relative'
            }}>
                {/* Window controls */}
                <div style={{
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    display: 'flex',
                    gap: '8px',
                    zIndex: 10
                }}>
                    <button
                        onClick={() => ipcRenderer?.send('window-minimize')}
                        style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}
                        className="onboarding-control-btn"
                    >
                        <Minus size={20} />
                    </button>
                    <button
                        onClick={() => ipcRenderer?.send('window-close')}
                        style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}
                        className="onboarding-exit-btn"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Header */}
                <div style={{
                    padding: '40px 40px 20px',
                    textAlign: 'center'
                }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        background: 'linear-gradient(135deg, var(--accent) 0%, #3b82f6 100%)',
                        borderRadius: '18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 24px',
                        color: 'white',
                        boxShadow: '0 8px 16px rgba(var(--accent-rgb, 59, 130, 246), 0.3)'
                    }}>
                        <Sparkles size={32} />
                    </div>
                    <h1 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: 800, lineHeight: 1.2 }}>
                        {t('onboarding.title')}
                    </h1>
                    <p style={{ margin: 0, opacity: 0.6, fontSize: '15px' }}>
                        {t('onboarding.subtitle')}
                    </p>
                </div>

                {/* Progress bar */}
                <div style={{
                    display: 'flex',
                    gap: '8px',
                    padding: '0 40px',
                    marginBottom: '32px'
                }}>
                    {[1, 2, 3, 4].map(s => (
                        <div key={s} style={{
                            height: '4px',
                            flex: 1,
                            borderRadius: '2px',
                            background: s <= step ? 'var(--accent)' : 'var(--border)',
                            transition: 'background 0.3s ease'
                        }} />
                    ))}
                </div>

                {/* Content */}
                <div style={{
                    padding: '0 40px 40px',
                    flex: 1,
                    minHeight: '380px',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    {step === 1 && (
                        <div key="step1" style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                                <Languages size={20} style={{ color: 'var(--accent)' }} />
                                <h3 style={{ margin: 0 }}>{t('onboarding.stepLanguage')}</h3>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{
                                    padding: '20px',
                                    borderRadius: '16px',
                                    border: '1px solid var(--border)',
                                    background: 'var(--hover-surface)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    borderColor: config.language === 'ru' ? 'var(--accent)' : 'var(--border)'
                                }} onClick={() => handleLanguageChange('ru')}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                        <div style={{
                                            width: '28px',
                                            height: '21px',
                                            background: '#f1f5f9',
                                            borderRadius: '3px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '11px',
                                            fontWeight: 800,
                                            color: '#1e293b',
                                            border: '1px solid #cbd5e1'
                                        }}>RU</div>
                                        <span style={{ fontWeight: 600 }}>Русский</span>
                                    </div>
                                    {config.language === 'ru' && <Check size={20} style={{ color: 'var(--accent)' }} />}
                                </div>

                                <div style={{
                                    padding: '20px',
                                    borderRadius: '16px',
                                    border: '1px solid var(--border)',
                                    background: 'var(--hover-surface)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    borderColor: config.language === 'en' ? 'var(--accent)' : 'var(--border)'
                                }} onClick={() => handleLanguageChange('en')}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                        <div style={{
                                            width: '28px',
                                            height: '21px',
                                            background: '#f1f5f9',
                                            borderRadius: '3px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '11px',
                                            fontWeight: 800,
                                            color: '#1e293b',
                                            border: '1px solid #cbd5e1'
                                        }}>EN</div>
                                        <span style={{ fontWeight: 600 }}>English</span>
                                    </div>
                                    {config.language === 'en' && <Check size={20} style={{ color: 'var(--accent)' }} />}
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div key="step2" style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                                <Palette size={20} style={{ color: 'var(--accent)' }} />
                                <h3 style={{ margin: 0 }}>{t('onboarding.stepTheme')}</h3>
                            </div>

                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '16px'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '20px',
                                    borderRadius: '16px',
                                    background: 'var(--hover-surface)',
                                    border: '1px solid var(--border)'
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: '15px' }}>{t('settings.theme')}</div>
                                        <div style={{ fontSize: '13px', opacity: 0.6, marginTop: '4px' }}>{t('settings.subtitle')}</div>
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
                                            { value: 'Windows Terminal', label: t('settings.themeWindowsTerminal') }
                                        ]}
                                        style={{ width: '220px' }}
                                    />
                                </div>

                                <div style={{
                                    padding: '24px',
                                    borderRadius: '16px',
                                    background: (config.theme === 'Light' || (config.theme === 'Auto' && !window.matchMedia('(prefers-color-scheme: dark)').matches)) ? '#f8fafc' :
                                               (config.theme === 'Dark' || (config.theme === 'Auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) ? '#0f172a' :
                                               config.theme === 'Windows Terminal' ? '#0c0c0c' :
                                               config.theme === 'Gruvbox Dark' ? '#282828' : 'var(--hover-surface)',
                                    border: '1px solid var(--border)',
                                    minHeight: '140px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    gap: '12px',
                                    transition: 'all 0.3s ease'
                                }}>
                                    <div style={{
                                        height: '12px',
                                        background: 'var(--accent)',
                                        borderRadius: '6px',
                                        opacity: 0.8,
                                        width: '60%'
                                    }} />
                                    <div style={{
                                        height: '12px',
                                        background: 'var(--text-primary)',
                                        borderRadius: '6px',
                                        opacity: 0.2,
                                        width: '85%'
                                    }} />
                                    <div style={{
                                        height: '12px',
                                        background: 'var(--text-primary)',
                                        borderRadius: '6px',
                                        opacity: 0.1,
                                        width: '40%'
                                    }} />
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div key="step3" style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                                <Terminal size={20} style={{ color: 'var(--accent)' }} />
                                <h3 style={{ margin: 0 }}>{t('onboarding.stepTerminal')}</h3>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '16px 20px',
                                    borderRadius: '16px',
                                    background: 'var(--hover-surface)',
                                    border: '1px solid var(--border)'
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: '14px' }}>{t('onboarding.terminalFontLabel')}</div>
                                        <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '2px' }}>{t('settings.terminalFontDesc')}</div>
                                    </div>
                                    <CustomSelect
                                        value={config.terminalFontName}
                                        onChange={handleFontChange}
                                        options={systemFonts.map(f => ({ value: f, label: f }))}
                                        style={{ width: '220px' }}
                                    />
                                </div>

                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '16px 20px',
                                    borderRadius: '16px',
                                    background: 'var(--hover-surface)',
                                    border: '1px solid var(--border)'
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: '14px' }}>{t('onboarding.terminalFontSizeLabel')}</div>
                                        <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '2px' }}>{t('settings.terminalFontSizeDesc')}</div>
                                    </div>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        background: 'var(--surface)',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border)',
                                        overflow: 'hidden',
                                        height: '36px',
                                        width: '120px'
                                    }}>
                                        <button
                                            className="btn-font-control"
                                            style={{ width: '36px', height: '100%', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            onClick={() => handleSizeChange(-1)}
                                        >
                                            <Minus size={14} />
                                        </button>
                                        <div style={{
                                            flex: 1,
                                            height: '100%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontWeight: 700,
                                            fontSize: '14px',
                                            borderLeft: '1px solid var(--border)',
                                            borderRight: '1px solid var(--border)',
                                            background: 'var(--hover-surface)',
                                        }}>
                                            {config.terminalFontSize}
                                        </div>
                                        <button
                                            className="btn-font-control"
                                            style={{ width: '36px', height: '100%', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            onClick={() => handleSizeChange(1)}
                                        >
                                            <Plus size={14} />
                                        </button>
                                    </div>
                                </div>

                                <div style={{
                                    padding: '16px',
                                    borderRadius: '16px',
                                    background: 'var(--hover-surface)',
                                    border: '1px solid var(--border)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between'
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>{t('onboarding.quickCopyPaste')}</div>
                                        <div style={{ fontSize: '12px', opacity: 0.6 }}>{t('onboarding.quickCopyPasteDesc')}</div>
                                    </div>
                                    <label className="ui-switch">
                                        <input
                                            type="checkbox"
                                            checked={config.enableTerminalContextMenu || false}
                                            onChange={e => onUpdate({ enableTerminalContextMenu: e.target.checked })}
                                        />
                                        <span className="ui-slider"></span>
                                    </label>
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', opacity: 0.6, marginBottom: '8px' }}>
                                        {t('onboarding.previewLabel')}
                                    </label>
                                    <div style={{
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
                                        overflow: 'hidden'
                                    }}>
                                        <span style={{ color: '#10b981' }}>user@yassh</span>:<span style={{ color: '#3b82f6' }}>~</span>$ ls -la
                                        <div style={{ opacity: 0.8, marginTop: '4px' }}>
                                            {t('onboarding.previewText')}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div key="step4" style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                                <Keyboard size={20} style={{ color: 'var(--accent)' }} />
                                <h3 style={{ margin: 0 }}>{t('onboarding.stepShortcuts')}</h3>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                                {shortcuts.map((s, i) => (
                                    <div key={i} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '14px 16px',
                                        background: 'var(--hover-surface)',
                                        borderRadius: '12px',
                                        border: '1px solid var(--border)'
                                    }}>
                                        <span style={{ opacity: 0.8, fontSize: '14px' }}>{s.label}</span>
                                        <span style={{
                                            padding: '4px 10px',
                                            background: 'var(--surface)',
                                            borderRadius: '6px',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            border: '1px solid var(--border)',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                                        }}>{s.key}</span>
                                    </div>
                                ))}
                            </div>

                            <div style={{
                                padding: '16px',
                                borderRadius: '14px',
                                background: 'rgba(59, 130, 246, 0.05)',
                                border: '1px solid rgba(59, 130, 246, 0.2)',
                                display: 'flex',
                                gap: '12px',
                                alignItems: 'flex-start'
                            }}>
                                <Info size={18} style={{ color: 'var(--accent)', marginTop: '2px', flexShrink: 0 }} />
                                <div style={{ fontSize: '13px', lineHeight: 1.5, opacity: 0.8 }}>
                                    {t('onboarding.shortcutsNote')}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '20px 40px 40px',
                    display: 'flex',
                    gap: '12px'
                }}>
                    {step > 1 && (
                        <button className="btn-secondary" style={{
                            flex: 1,
                            height: '50px',
                            borderRadius: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            fontWeight: 600
                        }} onClick={prevStep}>
                            <ChevronLeft size={20} />
                            {t('onboarding.back')}
                        </button>
                    )}
                    <button className="btn-primary" style={{
                        flex: 2,
                        height: '50px',
                        borderRadius: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        fontWeight: 600,
                        background: 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer'
                    }} onClick={nextStep}>
                        {step === 4 ? t('onboarding.finish') : t('onboarding.next')}
                        {step === 4 ? <Check size={20} /> : <ChevronRight size={20} />}
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateX(10px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                .btn-secondary {
                    background: var(--hover-surface);
                    border: 1px solid var(--border);
                    color: var(--text-primary);
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .btn-secondary:hover {
                    background: var(--border);
                }
                .btn-font-control {
                    color: var(--text-primary);
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .btn-font-control:hover {
                    background: var(--border);
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
            `}</style>
        </div>
    );
};
