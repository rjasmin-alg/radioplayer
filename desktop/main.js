// RadioPlayer – desktop verzija (Electron). Poslužitelj radi unutar istog procesa,
// na slučajnom portu dostupnom samo ovom računalu, i gasi se zajedno s prozorom.
'use strict';

const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win;
  const stateFile = () => path.join(app.getPath('userData'), 'window.json');

  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    // macOS treba izbornik aplikacije (Cmd+Q, Cmd+C/V u poljima); Windows/Linux ga ne prikazuju
    Menu.setApplicationMenu(process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
      : null);
    const { start } = require('../server.js');
    const url = await start({ port: 0, dataDir: path.join(app.getPath('userData'), 'data') });

    let bounds = { width: 1280, height: 820 };
    try { bounds = { ...bounds, ...JSON.parse(fs.readFileSync(stateFile(), 'utf8')) }; } catch {}

    win = new BrowserWindow({
      ...bounds,
      minWidth: 380,
      minHeight: 500,
      title: 'RadioPlayer',
      icon: path.join(__dirname, 'icon.png'),
      backgroundColor: '#0f1216',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    if (bounds.maximized) win.maximize();

    // poveznice s target=_blank (izvori, "otvori u novom prozoru") idu u zadani preglednik
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:\/\//i.test(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, target) => {
      if (!target.startsWith(url)) { e.preventDefault(); shell.openExternal(target); }
    });

    win.on('close', () => {
      try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch {}
    });

    win.loadURL(url);
  });

  app.on('window-all-closed', () => app.quit());
}
