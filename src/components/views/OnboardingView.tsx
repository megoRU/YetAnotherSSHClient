import React, { useState, useEffect } from 'react';
import { Languages, Terminal, ChevronRight, ChevronLeft, Check, Sparkles, Keyboard, Info, Palette, Sun, Moon, Laptop, Coffee, X } from 'lucide-react';
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
        setIsVisible(true);
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

    const themes = [
        { id: 'Auto', name: t('settings.themeAuto'), icon: <Laptop size={24} />, color: 'linear-gradient(135deg, #f8fafc 50%, #0f172a 50%)' },
        { id: 'Light', name: t('settings.themeLight'), icon: <Sun size={24} />, color: '#f8fafc' },
        { id: 'Dark', name: t('settings.themeDark'), icon: <Moon size={24} />, color: '#0f172a' },
        { id: 'Gruvbox Dark', name: t('settings.themeGruvboxDark'), icon: <Coffee size={24} />, color: '#282828' },
    ];

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
                {/* Exit button */}
                <button
                    onClick={() => ipcRenderer?.send('window-close')}
                    style={{
                        position: 'absolute',
                        top: '20px',
                        right: '20px',
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        zIndex: 10
                    }}
                    className="onboarding-exit-btn"
                >
                    <X size={20} />
                </button>

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
                                        <span style={{ fontSize: '24px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}>🇷🇺</span>
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
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: '16px'
                            }}>
                                {themes.map(th => (
                                    <div key={th.id} style={{
                                        padding: '20px',
                                        borderRadius: '16px',
                                        border: '1px solid var(--border)',
                                        background: 'var(--hover-surface)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '12px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        borderColor: config.theme === th.id ? 'var(--accent)' : 'var(--border)',
                                        position: 'relative',
                                        overflow: 'hidden'
                                    }} onClick={() => handleThemeChange(th.id)}>
                                        <div style={{
                                            width: '100%',
                                            height: '60px',
                                            background: th.color,
                                            borderRadius: '10px',
                                            marginBottom: '4px',
                                            border: '1px solid var(--border)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: th.id === 'Light' ? '#1e293b' : '#f8fafc'
                                        }}>
                                            {th.icon}
                                        </div>
                                        <span style={{ fontWeight: 600, fontSize: '14px' }}>{th.name}</span>
                                        {config.theme === th.id && (
                                            <div style={{
                                                position: 'absolute',
                                                top: '12px',
                                                right: '12px',
                                                width: '20px',
                                                height: '20px',
                                                background: 'var(--accent)',
                                                borderRadius: '50%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: 'white'
                                            }}>
                                                <Check size={12} strokeWidth={4} />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div key="step3" style={{ animation: 'fadeIn 0.3s ease-out' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                                <Terminal size={20} style={{ color: 'var(--accent)' }} />
                                <h3 style={{ margin: 0 }}>{t('onboarding.stepTerminal')}</h3>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                <div style={{ display: 'flex', gap: '20px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '13px', opacity: 0.6, marginBottom: '8px' }}>
                                            {t('onboarding.terminalFontLabel')}
                                        </label>
                                        <CustomSelect
                                            value={config.terminalFontName}
                                            onChange={handleFontChange}
                                            options={systemFonts.map(f => ({ value: f, label: f }))}
                                        />
                                    </div>
                                    <div style={{ width: '180px' }}>
                                        <label style={{ display: 'block', fontSize: '13px', opacity: 0.6, marginBottom: '8px' }}>
                                            {t('onboarding.terminalFontSizeLabel')}
                                        </label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0', background: 'var(--hover-surface)', borderRadius: '10px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                            <button className="btn-font-control" style={{ flex: 1, height: '42px', border: 'none', background: 'transparent' }} onClick={() => handleSizeChange(-1)}>-</button>
                                            <div style={{ width: '50px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '16px', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>{config.terminalFontSize}</div>
                                            <button className="btn-font-control" style={{ flex: 1, height: '42px', border: 'none', background: 'transparent' }} onClick={() => handleSizeChange(1)}>+</button>
                                        </div>
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
                                        lineHeight: 1.2,
                                        whiteSpace: 'pre-wrap',
                                        border: '1px solid var(--border)'
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
                    font-size: 18px;
                    font-weight: 500;
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
                .onboarding-exit-btn:hover {
                    background: var(--hover-surface);
                    color: var(--text-primary);
                }
            `}</style>
        </div>
    );
};
