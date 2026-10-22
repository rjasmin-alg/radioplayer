// RadioPlayer – desktop verzija (Electron). Poslužitelj radi unutar istog procesa,
// na slučajnom portu dostupnom samo ovom računalu, i gasi se zajedno s aplikacijom.
// Minimiziranje skriva prozor u traku sa satom (macOS: traka izbornika); zatvaranje gasi aplikaciju.
'use strict';

const { app, BrowserWindow, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win, tray;
  let trayHintShown = false;
  const stateFile = () => path.join(app.getPath('userData'), 'window.json');

  function showWindow() {
    if (!win) return;
    win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
  }

  function hideToTray() {
    win.hide();
    if (!trayHintShown && process.platform === 'win32') {
      trayHintShown = true;
      tray.displayBalloon({ title: 'RadioPlayer i dalje svira', content: 'Klikni ikonu u traci za povratak prozora.', iconType: 'none' });
    }
  }

  function createTray() {
    const size = process.platform === 'darwin' ? 18 : 16;
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: size, height: size }));
    tray.setToolTip('RadioPlayer');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Prikaži RadioPlayer', click: showWindow },
      { label: 'Sviraj / pauza', click: () => win.webContents.executeJavaScript('player.toggle()').catch(() => {}) },
      { label: 'Sljedeći favorit', click: () => win.webContents.executeJavaScript('player.skip(1)').catch(() => {}) },
      { type: 'separator' },
      { label: 'Izlaz', click: () => app.quit() },
    ]));
    // Windows/Linux: klik na ikonu prikazuje ili skriva prozor (na macOS-u klik otvara izbornik)
    if (process.platform !== 'darwin') tray.on('click', () => (win.isVisible() && !win.isMinimized() ? hideToTray() : showWindow()));
  }

  app.on('second-instance', showWindow);

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
      // bez usporavanja u pozadini: KiwiSDR keepalive, skener i "trenutno svira" rade i kad je prozor skriven
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    if (bounds.maximized) win.maximize();
    createTray();

    // poveznice s target=_blank (izvori, "otvori u novom prozoru") idu u zadani preglednik
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:\/\//i.test(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, target) => {
      if (!target.startsWith(url)) { e.preventDefault(); shell.openExternal(target); }
    });

    win.on('minimize', hideToTray);
    win.on('page-title-updated', (_, title) => tray.setToolTip(title.slice(0, 127)));

    win.on('close', () => {
      try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch {}
    });

    win.loadURL(url);
  });

  app.on('window-all-closed', () => app.quit());
}
