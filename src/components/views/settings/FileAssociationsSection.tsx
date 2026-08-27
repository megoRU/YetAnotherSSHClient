import React, { useState } from 'react';
import { Plus, Edit3, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

interface FileAssociationsSectionProps {
    fileAssociationDraftExtension: string;
    setFileAssociationDraftExtension: (value: string) => void;
    handleAddFileAssociation: () => Promise<void>;
    fileAssociationEntries: [string, string][];
    handleEditFileAssociation: (extension: string) => Promise<void>;
    handleDeleteFileAssociation: (extension: string) => void;
    t: (key: string, options?: Record<string, string>) => string;
}

const getApplicationName = (applicationPath: string): string => {
    const normalizedPath = applicationPath.replace(/\\/g, '/');
    const parts = normalizedPath.split('/');
    const fileName = parts.length > 0 ? parts[parts.length - 1] : applicationPath;
    if (fileName.toLowerCase().endsWith('.exe')) {
        return fileName.substring(0, fileName.length - 4);
    }
    return fileName;
};

export const FileAssociationsSection: React.FC<FileAssociationsSectionProps> = React.memo(({
    fileAssociationDraftExtension,
    setFileAssociationDraftExtension,
    handleAddFileAssociation,
    fileAssociationEntries,
    handleEditFileAssociation,
    handleDeleteFileAssociation,
    t
}) => {
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className="settings-section-page">
            <div className="settings-section-header">
                <h2 className="settings-section-title">{t('settings.fileAssociations')}</h2>
                <div className="settings-section-subtitle">{t('settings.fileAssociationsDesc')}</div>
            </div>

            <div className="settings-row flex-column">
                <div className="file-associations-controls">
                    <input
                        value={fileAssociationDraftExtension}
                        onChange={(event) => setFileAssociationDraftExtension(event.target.value)}
                        placeholder={t('settings.fileAssociationExtensionPlaceholder')}
                        className="file-extension-input"
                    />
                    <button className="btn-secondary btn-add-association" onClick={handleAddFileAssociation}>
                        <Plus size={16} /> {t('settings.fileAssociationAdd')}
                    </button>
                </div>
                <div className={`file-associations-accordion-single ${isExpanded ? 'expanded' : ''}`}>
                    <div
                        className="file-associations-accordion-header"
                        onClick={() => setIsExpanded(prev => !prev)}
                    >
                        <span className="file-associations-accordion-title">
                            {t('settings.fileAssociations')} ({fileAssociationEntries.length})
                        </span>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                    {isExpanded && (
                        <div className="file-associations-accordion-content-table">
                            <div className="file-associations-table-container">
                                <div className="file-associations-grid file-associations-header">
                                    <div>{t('settings.fileAssociationExtension')}</div>
                                    <div>{t('settings.fileAssociationApplication')}</div>
                                    <div>{t('settings.fileAssociationActions')}</div>
                                </div>
                                {fileAssociationEntries.length === 0 && (
                                    <div className="file-associations-empty">
                                        {t('settings.fileAssociationEmpty')}
                                    </div>
                                )}
                                {fileAssociationEntries.map(([extension, applicationPath]) => (
                                    <div key={extension} className="file-associations-grid file-associations-row">
                                        <div className="file-extension-cell">{extension}</div>
                                        <div title={applicationPath} className="file-application-name">
                                            {getApplicationName(applicationPath)}
                                        </div>
                                        <div className="file-association-actions">
                                            <button className="btn-secondary btn-association-action" onClick={() => handleEditFileAssociation(extension)}>
                                                <Edit3 size={14} /> {t('common.edit')}
                                            </button>
                                            <button className="btn-danger btn-association-action" onClick={() => handleDeleteFileAssociation(extension)}>
                                                <Trash2 size={14} /> {t('common.delete')}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});
