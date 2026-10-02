import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Конфигурация renderer-сборки для Tauri.
 *
 * Основной рабочий конфиг: собирает только фронтенд в `dist/`, который Tauri
 * затем пакует в `frontendDist`. Никаких плагинов Electron здесь нет — иначе
 * `tauri dev` запускал бы ещё и Electron-процесс.
 *
 * Порт и `strictPort` обязательны: `tauri.conf.json` жёстко указывает
 * `devUrl: http://localhost:1420`, и при автоматическом сдвиге порта на
 * следующий свободный Tauri не смог бы подключиться.
 */
export default defineConfig({
  base: './',
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      // `src-tauri` не часть фронтенда: перезапускать dev-сервер при изменении
      // Rust-кода не нужно, за этим следит `cargo`.
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    // Целевой браузер webview: Tauri использует WebView2 (Chromium) на
    // Windows и WKWebView на macOS, поэтому излишне старые цели не нужны.
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
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
  plugins: [react()]
})
