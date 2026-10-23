import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const executable = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
const tauriCli = join(import.meta.dirname, '..', 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
const mingwBin = process.platform === 'win32' ? 'C:\\msys64\\ucrt64\\bin' : undefined
const mingwCompiler = mingwBin ? join(mingwBin, 'x86_64-w64-mingw32-gcc.exe') : undefined
const home = process.platform === 'win32'
  ? process.env.USERPROFILE
  : process.env.HOME
const cargoHome = home ? join(home, '.cargo', 'bin') : undefined

if (mingwBin && mingwCompiler && existsSync(mingwCompiler) && !pathEntries.includes(mingwBin)) {
  pathEntries.unshift(mingwBin)
}

if (cargoHome && !pathEntries.includes(cargoHome)) {
  pathEntries.unshift(cargoHome)
}

const cargoFound = pathEntries.some((entry) => existsSync(join(entry, executable)))
if (!cargoFound) {
  console.error('Не найден Cargo. Установите Rust через rustup и добавьте ~/.cargo/bin в PATH.')
  process.exit(1)
}

if (!existsSync(tauriCli)) {
  console.error('Не найден Tauri CLI. Выполните npm install.')
  process.exit(1)
}

const child = spawn(process.execPath, [tauriCli, 'dev'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    // Rust incremental-cache hard links are not reliable in the managed
    // Windows workspace; Cargo already falls back to copies, so skip that
    // cache for `tauri dev` to avoid repeating the warning on every launch.
    CARGO_INCREMENTAL: '0',
    PATH: pathEntries.join(delimiter),
    ...(mingwCompiler && existsSync(mingwCompiler)
      ? { CC_x86_64_pc_windows_gnu: process.env.CC_x86_64_pc_windows_gnu ?? mingwCompiler }
      : {}),
  },
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error(`Не удалось запустить Tauri: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
