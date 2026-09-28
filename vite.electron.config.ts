import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import electronWorkerPlugin from 'vite-plugin-electron'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * Конфигурация legacy-сборки Electron.
 *
 * Перенесена из `vite.config.ts` без изменений и используется скриптами
 * `dev:electron` / `build:electron`. Нужна для сопоставления поведения двух
 * реализаций и для отката, пока миграция на Tauri не подтверждена.
 *
 * ВАЖНО: у группы worker ниже `onstart: () => {}` удалять нельзя — без него
 * `vite-plugin-electron` сам спавнит Electron при `closeBundle` этой группы, и
 * в dev-режиме запускаются ДВА инстанса: первый успевает показать пустое тёмное
 * окно (без стилей и позиции из конфига), затем убивается и открывается второй.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const suppressZodWarning = (warning: { message: string }, warn: (warning: { message: string }) => void) => {
  if (warning.message.includes('contains an annotation that Rollup cannot interpret')) return
  warn(warning)
}

export default defineConfig({
  base: './',
  build: {
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      onwarn: suppressZodWarning,
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@xterm')) return 'terminal'
          if (id.includes('react') || id.includes('scheduler')) return 'react'
          return 'vendor'
        }
      }
    }
  },
  plugins: [
    react(),
    (electron as unknown as (config: unknown) => import('vite').Plugin)({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            minify: 'esbuild',
            sourcemap: false,
            rollupOptions: {
              onwarn: suppressZodWarning,
              external: [
                'electron',
                'ssh2',
                'node-pty',
                'electron-updater',
                'fs',
                'path',
                'os',
                'crypto'
              ]
            }
          }
        }
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            minify: 'esbuild',
            sourcemap: false,
            rollupOptions: {
              onwarn: suppressZodWarning,
              external: ['electron']
            }
          }
        }
      },
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
    (electronWorkerPlugin as unknown as (configs: unknown[]) => import('vite').Plugin[])([{
      entry: 'electron/src/sftp/worker/sftp-transfer-worker.ts',
      vite: {
        build: {
          minify: 'esbuild',
          sourcemap: false,
          rollupOptions: {
            onwarn: suppressZodWarning,
            external: ['ssh2']
          }
        }
      },
      onstart: () => {}
    }])
  ]
})
