import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { SftpFileEntry } from '../../types';

interface SftpModalsProps {
    modal: {
        type: string;
        file?: SftpFileEntry;
        errorMessage?: string;
        filename?: string;
        localPath?: string;
        remotePath?: string;
    } | null;
    modalInput: string;
    setModalInput: (val: string) => void;
    onClose: () => void;
    onConfirm: () => void;
    selectedCount: number;
}

export const SftpModals: React.FC<SftpModalsProps> = ({
    modal,
    modalInput,
    setModalInput,
    onClose,
    onConfirm,
    selectedCount
}) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && modal) {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [modal, onClose]);

    if (!modal) return null;

    const parseMode = (modeStr: string) => {
        const m = parseInt(modeStr, 8) || 0;
        return {
            owner: {
                read: !!(m & 0o400),
                write: !!(m & 0o200),
                execute: !!(m & 0o100)
            },
            group: {
                read: !!(m & 0o040),
                write: !!(m & 0o020),
                execute: !!(m & 0o010)
            },
            others: {
                read: !!(m & 0o004),
                write: !!(m & 0o002),
                execute: !!(m & 0o001)
            }
        };
    };

    const togglePermission = (role: 'owner' | 'group' | 'others', type: 'read' | 'write' | 'execute') => {
        let m = parseInt(modalInput, 8) || 0;
        let mask = 0;
        if (role === 'owner') {
            if (type === 'read') mask = 0o400;
            if (type === 'write') mask = 0o200;
            if (type === 'execute') mask = 0o100;
        } else if (role === 'group') {
            if (type === 'read') mask = 0o040;
            if (type === 'write') mask = 0o020;
            if (type === 'execute') mask = 0o010;
        } else if (role === 'others') {
            if (type === 'read') mask = 0o004;
            if (type === 'write') mask = 0o002;
            if (type === 'execute') mask = 0o001;
        }

        if (m & mask) {
            m &= ~mask;
        } else {
            m |= mask;
        }
        setModalInput(m.toString(8).padStart(3, '0'));
    };

    const permissions = modal.type === 'permissions' ? parseMode(modalInput) : null;

    return (
        <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(2px)'
        }} onClick={() => modal.type !== 'rename' && onClose()}>
            <div style={{
                background: 'var(--bg-color)',
                padding: '0',
                borderRadius: '12px',
                width: modal.type === 'permissions' ? '500px' : '400px',
                boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
                border: '1px solid var(--border-color)',
                overflow: 'hidden'
            }} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '20px 25px',
                    background: 'rgba(0,0,0,0.05)',
                    borderBottom: '1px solid var(--border-color)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {(modal.type === 'error' || modal.type === 'cancelUpload') && <AlertTriangle color="#cc241d" size={20} />}
                        <h3 style={{ margin: 0, fontSize: '1.2em' }}>
                            {modal.type === 'delete' && 'Удаление'}
                            {modal.type === 'rename' && 'Переименование'}
                            {modal.type === 'permissions' && 'Права доступа'}
                            {modal.type === 'error' && 'Ошибка'}
                            {modal.type === 'cancelUpload' && 'Отмена загрузки'}
                            {modal.type === 'fileUpdate' && 'Обновление файла'}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="modal-close-btn"
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: '5px',
                            cursor: 'pointer',
                            color: 'var(--text-color)',
                            opacity: 0.6,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '6px'
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '25px' }}>
                    {modal.type === 'delete' && (
                        <p style={{ margin: 0, fontSize: '1.1em' }}>Вы уверены, что хотите удалить <b style={{ wordBreak: 'break-all' }}>{selectedCount > 1 ? `${selectedCount} элементов` : modal.file?.filename}</b>?</p>
                    )}

                    {modal.type === 'fileUpdate' && (
                        <p style={{ margin: 0, fontSize: '1.1em' }}>Файл <b>{modal.filename}</b> был изменен. Обновить его на сервере?</p>
                    )}

                    {modal.type === 'error' && (
                        <p style={{ color: '#cc241d', margin: 0 }}>{modal.errorMessage}</p>
                    )}

                    {modal.type === 'cancelUpload' && (
                        <p style={{ margin: 0 }}>Вы уверены, что хотите отменить все текущие загрузки? Это приведет к временному разрыву соединения.</p>
                    )}

                    {modal.type === 'rename' && (
                        <input
                            autoFocus
                            value={modalInput}
                            onChange={e => setModalInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && onConfirm()}
                            style={{
                                width: '100%',
                                padding: '12px',
                                background: 'var(--input-bg)',
                                color: 'var(--text-color)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '8px',
                                fontSize: '1em'
                            }}
                        />
                    )}

                    {modal.type === 'permissions' && permissions && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '0.9em', opacity: 0.9 }}>{modal.file?.filename}</div>

                            <div>
                                <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '10px' }}>
                                    <div style={{ flex: 2, fontWeight: 'bold' }}>Доступ к файлу</div>
                                    <div style={{ flex: 1, textAlign: 'center', fontWeight: 'bold' }}>Чтение</div>
                                    <div style={{ flex: 1, textAlign: 'center', fontWeight: 'bold' }}>Запись</div>
                                    <div style={{ flex: 1, textAlign: 'center', fontWeight: 'bold' }}>Запуск</div>
                                </div>

                                {(['owner', 'group', 'others'] as const).map(role => (
                                    <div key={role} style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                                        <div style={{ flex: 2, opacity: 0.8 }}>
                                            {role === 'owner' ? 'Владелец' : role === 'group' ? 'Группы' : 'Остальные'}
                                        </div>
                                        {(['read', 'write', 'execute'] as const).map(type => (
                                            <div key={type} style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                                                <label className="ui-switch">
                                                    <input
                                                        type="checkbox"
                                                        checked={permissions[role][type]}
                                                        onChange={() => togglePermission(role, type)}
                                                    />
                                                    <span className="ui-slider"></span>
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: 1, fontSize: '0.9em' }}>
                                Восьмеричный режим:
                                <input
                                    value={modalInput}
                                    onChange={e => {
                                        const val = e.target.value.replace(/[^0-7]/g, '').slice(0, 3);
                                        setModalInput(val);
                                    }}
                                    style={{
                                        width: '60px',
                                        padding: '4px 8px',
                                        background: 'var(--input-bg)',
                                        color: 'var(--text-color)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '4px',
                                        textAlign: 'center'
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '30px' }}>
                        {modal.type !== 'error' && (
                            <button
                                className="btn-secondary"
                                onClick={onClose}
                                style={{ padding: '10px 20px', minWidth: '100px' }}
                            >
                                Отмена
                            </button>
                        )}
                        <button
                            className="btn-primary"
                            onClick={onConfirm}
                            style={{
                                padding: '10px 20px',
                                minWidth: '100px',
                                background: modal.type === 'delete' ? '#cc241d' : (modal.type === 'permissions' ? '#1fb466' : 'var(--primary-color)')
                            }}
                        >
                            {modal.type === 'delete' ? 'Удалить' :
                             modal.type === 'error' ? 'OK' :
                             modal.type === 'cancelUpload' ? 'Да, отменить' :
                             modal.type === 'fileUpdate' ? 'Обновить' : 'Сохранить'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
