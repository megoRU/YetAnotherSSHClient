import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { SftpFileEntry } from '../../types';

interface SftpModalsProps {
    modal: {
        type: string;
        file?: SftpFileEntry;
        errorMessage?: string;
        filename?: string;
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
    if (!modal) return null;

    return (
        <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2000
        }} onClick={onClose}>
            <div style={{
                background: 'var(--bg-color)',
                padding: '20px',
                borderRadius: '8px',
                width: '400px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                border: '1px solid var(--border-color)'
            }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                    {(modal.type === 'error' || modal.type === 'cancelUpload') && <AlertTriangle color="#cc241d" size={24} />}
                    <h3 style={{ marginTop: 0, marginBottom: 0 }}>
                        {modal.type === 'delete' && 'Удаление'}
                        {modal.type === 'rename' && 'Переименование'}
                        {modal.type === 'permissions' && 'Права доступа'}
                        {modal.type === 'error' && 'Ошибка'}
                        {modal.type === 'cancelUpload' && 'Отмена загрузки'}
                        {modal.type === 'fileUpdate' && 'Обновление файла'}
                    </h3>
                </div>

                {modal.type === 'delete' && (
                    <p>Вы уверены, что хотите удалить <b>{selectedCount > 1 ? `${selectedCount} элементов` : modal.file?.filename}</b>?</p>
                )}

                {modal.type === 'fileUpdate' && (
                    <p>Файл <b>{modal.filename}</b> был изменен. Обновить его на сервере?</p>
                )}

                {modal.type === 'error' && (
                    <p style={{ color: '#cc241d' }}>{modal.errorMessage}</p>
                )}

                {modal.type === 'cancelUpload' && (
                    <p>Вы уверены, что хотите отменить все текущие загрузки? Это приведет к временному разрыву соединения.</p>
                )}

                {(modal.type === 'rename' || modal.type === 'permissions') && (
                    <input
                        autoFocus
                        value={modalInput}
                        onChange={e => setModalInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && onConfirm()}
                        style={{
                            width: '100%',
                            padding: '8px',
                            marginBottom: '20px',
                            background: 'var(--input-bg)',
                            color: 'var(--text-color)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px'
                        }}
                    />
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    {modal.type !== 'error' && <button className="btn-secondary" onClick={onClose}>Отмена</button>}
                    <button
                        className="btn-primary"
                        onClick={onConfirm}
                    >
                        {modal.type === 'delete' ? 'Удалить' :
                         modal.type === 'error' ? 'OK' :
                         modal.type === 'cancelUpload' ? 'Да, отменить' :
                         modal.type === 'fileUpdate' ? 'Обновить' : 'Сохранить'}
                    </button>
                </div>
            </div>
        </div>
    );
};
