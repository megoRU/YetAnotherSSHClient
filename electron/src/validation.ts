import { z } from 'zod';

const idSchema = z.string().max(64);
const pathSchema = z.string().max(4096);
const portSchema = z.number().int().min(1).max(65535);

export const sshConfigSchema = z.object({
    id: idSchema.optional(),
    name: z.string().max(256),
    user: z.string().max(256),
    host: z.string().max(256),
    port: portSchema,
    password: z.string().max(10000).optional(),
    authType: z.enum(['password', 'key']).optional(),
    privateKeyPath: z.string().max(4096).optional(),
    osPrettyName: z.string().max(256).optional(),
    initialCommands: z.string().max(10000).optional(),
});

export const appConfigSchema = z.object({
    encryption: z.object({
        version: z.number().int(),
        salt: z.string()
    }).optional(),
    encryptedPasswords: z.record(z.string(), z.object({
        iv: z.string(),
        tag: z.string(),
        data: z.string()
    })).optional(),
    cachedRecoveryKey: z.string().optional(),
    terminalFontName: z.string().max(256),
    terminalFontSize: z.number().int().min(1).max(100),
    uiFontName: z.string().max(256),
    uiFontSize: z.number().int().min(1).max(100),
    theme: z.string().max(64),
    language: z.enum(['ru', 'en']),
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(100),
    height: z.number().int().min(100),
    maximized: z.boolean(),
    lastUpdateCheck: z.number().optional(),
    enableTerminalContextMenu: z.boolean(),
    terminalScrollSensitivity: z.number().min(0.1).max(100),
    keywordHighlighting: z.boolean(),
    sftpSoundEnabled: z.boolean(),
    sftpSoundVolume: z.number().min(0).max(1),
    sftpFlashIcon: z.boolean(),
    activeTabColorEnabled: z.boolean(),
    alwaysShowHoverOnInactiveTabs: z.boolean(),
    serverCardSize: z.enum(['standard', 'compact']),
    isOnboardingCompleted: z.boolean(),
    sidebarEnabled: z.boolean(),
    sidebarPosition: z.enum(['left', 'right']),
    favorites: z.array(sshConfigSchema)
});

export const sshConnectSchema = z.object({
    id: idSchema,
    config: sshConfigSchema,
    cols: z.number().int().min(1).max(1000).optional(),
    rows: z.number().int().min(1).max(1000).optional(),
});

export const sshInputSchema = z.object({
    id: idSchema,
    data: z.string().max(100000),
});

export const sshResizeSchema = z.object({
    id: idSchema,
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
});

export const sftpConnectSchema = z.object({
    id: idSchema,
    config: sshConfigSchema,
});

export const sftpPathPayloadSchema = z.object({
    id: idSchema,
    path: pathSchema,
});

export const sftpRenameSchema = z.object({
    id: idSchema,
    oldPath: pathSchema,
    newPath: pathSchema,
});

export const sftpChmodSchema = z.object({
    id: idSchema,
    path: pathSchema,
    mode: z.union([z.number().int(), z.string().max(10)]),
});

export const sftpExtractSchema = z.object({
    id: idSchema,
    remotePath: pathSchema,
});

export const sftpDownloadFileSchema = z.object({
    id: idSchema,
    remotePath: pathSchema,
    filename: z.string().max(1024),
    transferId: idSchema,
});

export const sftpDownloadMultipleSchema = z.object({
    id: idSchema,
    files: z.array(z.object({
        remotePath: pathSchema,
        filename: z.string().max(1024),
        transferId: idSchema,
        isDir: z.boolean().optional(),
    })),
});

export const sftpUploadFilesFromPathsSchema = z.object({
    id: idSchema,
    remoteDir: pathSchema,
    transfers: z.array(z.object({
        localPath: pathSchema,
        transferId: idSchema,
    })),
});

export const sftpCancelUploadSchema = z.object({
    id: idSchema,
    remotePath: pathSchema.optional(),
    transferId: idSchema.optional(),
});

export const sftpOpenInEditorSchema = z.object({
    id: idSchema,
    remotePath: pathSchema,
    filename: z.string().max(1024),
    transferId: idSchema.optional(),
});

export const sftpUploadDirectSchema = z.object({
    id: idSchema,
    localPath: pathSchema,
    remotePath: pathSchema,
    transferId: idSchema.optional(),
});

export const sftpRmSchema = z.object({
    id: idSchema,
    path: pathSchema,
    isDir: z.boolean(),
});

export const sshForwardStartSchema = z.object({
    id: idSchema,
    config: sshConfigSchema,
    localAddress: z.string().max(256),
    localPort: portSchema,
    remoteAddress: z.string().max(256),
    remotePort: portSchema,
});
