import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  build: {
    minify: 'esbuild',
    sourcemap: false,
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
              external: [
                'electron',
                'ssh2',
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
              external: ['electron']
            }
          }
        }
      },
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
})
