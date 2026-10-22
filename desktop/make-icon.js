// Iscrtava public/icon.svg u desktop/icon.png (512x512) za ikonu .exe datoteke.
// Pokretanje: npm run icon
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="512" height="512"></body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  console.log('desktop/icon.png spremljen');
  app.quit();
});
