import React, { useState } from 'react';
import { FileSymlink, Plus, Edit3, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

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
    const [expandedExtension, setExpandedExtension] = useState<string | null>(null);

    const toggleExtension = (extension: string) => {
        setExpandedExtension(prev => prev === extension ? null : extension);
    };

    return (
        <div className="settings-group" id="section-file-associations">
            <div className="settings-group-title">
                <FileSymlink size={14} className="settings-group-icon" /> {t('settings.fileAssociations')}
            </div>
            <div className="settings-description file-associations-desc">
                {t('settings.fileAssociationsDesc')}
            </div>
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
            <div className="file-associations-accordion">
                {fileAssociationEntries.length === 0 && (
                    <div className="file-associations-empty">
                        {t('settings.fileAssociationEmpty')}
                    </div>
                )}
                {fileAssociationEntries.map(([extension, applicationPath]) => {
                    const isExpanded = expandedExtension === extension;
                    return (
                        <div key={extension} className={`file-association-item ${isExpanded ? 'expanded' : ''}`}>
                            <div
                                className="file-association-header-clickable"
                                onClick={() => toggleExtension(extension)}
                            >
                                <span className="file-extension-cell">{extension}</span>
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                            {isExpanded && (
                                <div className="file-association-content">
                                    <div className="file-association-app-info">
                                        <span className="file-association-app-label">
                                            {t('settings.fileAssociationApplication')}
                                        </span>
                                        <span className="file-association-app-value" title={applicationPath}>
                                            {getApplicationName(applicationPath)} <span style={{ opacity: 0.6, fontSize: '0.9em', fontWeight: 'normal' }}>({applicationPath})</span>
                                        </span>
                                    </div>
                                    <div className="file-association-actions-expanded">
                                        <button className="btn-secondary btn-association-action" onClick={() => handleEditFileAssociation(extension)}>
                                            <Edit3 size={14} /> {t('common.edit')}
                                        </button>
                                        <button className="btn-danger btn-association-action" onClick={() => handleDeleteFileAssociation(extension)}>
                                            <Trash2 size={14} /> {t('common.delete')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
});
