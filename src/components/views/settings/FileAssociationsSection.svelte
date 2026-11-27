<script module lang="ts">
    import { Plus, PenLine, Trash2, ChevronDown, ChevronUp } from '@lucide/svelte';

    import { type SetStateAction } from '../../../utils/dom';

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
</script>

<script lang="ts">
    let {
        fileAssociationDraftExtension,
        setFileAssociationDraftExtension,
        handleAddFileAssociation,
        fileAssociationEntries,
        handleEditFileAssociation,
        handleDeleteFileAssociation,
        t,
    }: FileAssociationsSectionProps = $props();

    let isExpanded = $state.raw(true);
    function setIsExpanded(next: SetStateAction<typeof isExpanded>) {
        isExpanded = typeof next === 'function' ? next(isExpanded) : next;
    }
</script>

<div class="settings-section-page">
    <div class="settings-section-header">
        <h2 class="settings-section-title">{t('settings.fileAssociations')}</h2>
        <div class="settings-section-subtitle">{t('settings.fileAssociationsDesc')}</div>
    </div>

    <div class="settings-row flex-column">
        <div class="file-associations-controls">
            <input
                value={fileAssociationDraftExtension}
                oninput={(event) => setFileAssociationDraftExtension(event.currentTarget.value)}
                placeholder={t('settings.fileAssociationExtensionPlaceholder')}
                class="file-extension-input"
            />
            <button class="btn-secondary btn-add-association" onclick={handleAddFileAssociation}>
                <Plus size={16} />
                {t('settings.fileAssociationAdd')}
            </button>
        </div>
        <div class={`file-associations-accordion-single ${isExpanded ? 'expanded' : ''}`}>
            <button
                type="button"
                aria-expanded={isExpanded}
                class="plain-button plain-button-wide file-associations-accordion-header"
                onclick={() => setIsExpanded((prev) => !prev)}
            >
                <span class="file-associations-accordion-title">
                    {t('settings.fileAssociations')} ({fileAssociationEntries.length})
                </span>
                {#if isExpanded}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
            </button>
            {#if isExpanded}<div class="file-associations-accordion-content-table">
                    <div class="file-associations-table-container">
                        <div class="file-associations-grid file-associations-header">
                            <div>{t('settings.fileAssociationExtension')}</div>
                            <div>{t('settings.fileAssociationApplication')}</div>
                            <div>{t('settings.fileAssociationActions')}</div>
                        </div>
                        {#if fileAssociationEntries.length === 0}<div class="file-associations-empty">
                                {t('settings.fileAssociationEmpty')}
                            </div>{/if}
                        {#each fileAssociationEntries as [extension, applicationPath] (extension)}<div
                                class="file-associations-grid file-associations-row"
                            >
                                <div class="file-extension-cell">{extension}</div>
                                <div title={applicationPath} class="file-application-name">
                                    {getApplicationName(applicationPath)}
                                </div>
                                <div class="file-association-actions">
                                    <button
                                        class="btn-secondary btn-association-action"
                                        onclick={() => handleEditFileAssociation(extension)}
                                    >
                                        <PenLine size={14} />
                                        {t('common.edit')}
                                    </button>
                                    <button
                                        class="btn-danger btn-association-action"
                                        onclick={() => handleDeleteFileAssociation(extension)}
                                    >
                                        <Trash2 size={14} />
                                        {t('common.delete')}
                                    </button>
                                </div>
                            </div>{/each}
                    </div>
                </div>{/if}
        </div>
    </div>
</div>
