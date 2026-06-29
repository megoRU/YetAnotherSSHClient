const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function getElectronPackagePath() {
    return require.resolve('electron/package.json');
}

function getElectronPackageDirectory() {
    const electronPackagePath = getElectronPackagePath();
    return path.dirname(electronPackagePath);
}

function hasElectronBinaryMarker(electronPackageDirectory) {
    const markerPath = path.join(electronPackageDirectory, 'dist', 'electron.exe');
    const linuxMarkerPath = path.join(electronPackageDirectory, 'dist', 'electron');
    const macMarkerPath = path.join(electronPackageDirectory, 'dist', 'Electron.app');
    const pathFile = path.join(electronPackageDirectory, 'path.txt');
    return fs.existsSync(pathFile) || fs.existsSync(markerPath) || fs.existsSync(linuxMarkerPath) || fs.existsSync(macMarkerPath);
}

function runElectronInstall(electronPackageDirectory) {
    const installScriptPath = path.join(electronPackageDirectory, 'install.js');
    childProcess.execFileSync(process.execPath, [installScriptPath], {
        stdio: 'inherit'
    });
}

function ensureElectronInstalled() {
    const electronPackageDirectory = getElectronPackageDirectory();
    if (hasElectronBinaryMarker(electronPackageDirectory)) {
        return;
    }

    console.warn('[dev] Electron binary was not found. Running electron/install.js before starting Vite.');
    runElectronInstall(electronPackageDirectory);
}

ensureElectronInstalled();
