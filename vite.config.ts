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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@xterm')) return 'terminal'
          if (id.includes('react-syntax-highlighter') || id.includes('prism') || id.includes('refractor')) return 'syntax-highlighter'
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-') || id.includes('unified') || id.includes('micromark') || id.includes('mdast') || id.includes('hast')) return 'markdown'
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
