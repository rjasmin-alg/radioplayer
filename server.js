// RadioPlayer – lokalni poslužitelj bez vanjskih ovisnosti (Node.js 18+).
// Poslužuje web sučelje, posreduje Radio Browser API, skuplja popise SDR prijemnika,
// proxy za audio streamove (vizualizator / http streamovi) i čita ICY "now playing".
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
let DATA = path.join(ROOT, 'data'); // desktop verzija ga preusmjerava u korisnički profil (start({ dataDir }))
const UA = 'RadioPlayerLocal/1.0';

// ---------- pomoćne funkcije ----------

function fetchRaw(url, { headers = {}, timeout = 20000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: { 'User-Agent': UA, ...headers }, timeout }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        res.resume();
        resolve(fetchRaw(new URL(res.headers.location, u).href, { headers, timeout, maxRedirects: maxRedirects - 1 }));
        return;
      }
      resolve({ res, url: u.href });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchText(url, opts) {
  const { res } = await fetchRaw(url, opts);
  if (res.statusCode >= 400) { res.resume(); throw new Error(`HTTP ${res.statusCode} za ${url}`); }
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 5e6) { req.destroy(); reject(new Error('prevelik zahtjev')); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isHttpUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

// ---------- Radio Browser ----------

let rbServers = null;
async function rbBase() {
  if (!rbServers) {
    try {
      const list = JSON.parse(await fetchText('https://all.api.radio-browser.info/json/servers', { timeout: 8000 }));
      rbServers = [...new Set(list.map((s) => s.name))].sort(() => Math.random() - 0.5);
    } catch { rbServers = []; }
    if (!rbServers.length) rbServers = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];
  }
  return rbServers;
}

async function radioBrowser(pathAndQuery) {
  const servers = await rbBase();
  let lastErr;
  for (let i = 0; i < servers.length; i++) {
    try {
      const txt = await fetchText(`https://${servers[0]}${pathAndQuery}`, { timeout: 15000 });
      return JSON.parse(txt);
    } catch (e) {
      lastErr = e;
      servers.push(servers.shift()); // probaj sljedeći poslužitelj
    }
  }
  throw lastErr;
}

// ---------- SDR popisi ----------

function parseGps(s) {
  const m = /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/.exec(s || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

async function loadKiwi() {
  // Javni popis KiwiSDR prijemnika (izvor: kiwisdr.com/public, preko rx.linkfanel.net)
  const js = await fetchText('http://rx.linkfanel.net/kiwisdr_com.js', { timeout: 25000 });
  const arr = JSON.parse(js.slice(js.indexOf('['), js.lastIndexOf(']') + 1).replace(/,\s*\]$/, ']'));
  return arr.map((k) => {
    const gps = parseGps(k.gps);
    const [lo, hi] = (k.bands || '0-30000000').split('-').map(Number);
    return {
      id: 'kiwi:' + (k.id || k.url),
      type: 'KiwiSDR',
      name: k.name,
      url: (k.url || '').replace(/\/$/, ''),
      loc: k.loc,
      lat: gps ? gps[0] : null,
      lon: gps ? gps[1] : null,
      users: Number(k.users) || 0,
      usersMax: Number(k.users_max) || 0,
      online: k.offline !== 'yes' && k.status !== 'offline',
      antenna: k.antenna || '',
      minHz: lo || 0,
      maxHz: hi || 30e6,
      snr: k.snr || '',
      grid: k.grid || '',
    };
  }).filter((k) => k.url);
}

async function loadReceiverBook() {
  // ReceiverBook.de: OpenWebRX, WebSDR i KiwiSDR prijemnici s koordinatama
  const html = await fetchText('https://www.receiverbook.de/map', { timeout: 25000 });
  const m = /var receivers = (\[.*\]);?\s*$/m.exec(html);
  if (!m) throw new Error('ReceiverBook format nije prepoznat');
  const groups = JSON.parse(m[1]);
  const out = [];
  for (const g of groups) {
    const [lon, lat] = (g.location && g.location.coordinates) || [null, null];
    for (const r of g.receivers || []) {
      out.push({
        id: 'rb:' + r.url,
        type: r.type,
        name: String(r.label || g.label || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        url: String(r.url || '').replace(/\/$/, ''),
        loc: g.label || '',
        lat, lon,
        users: null, usersMax: null,
        online: true,
        antenna: '',
        version: r.version || '',
      });
    }
  }
  return out;
}

async function sdrList() {
  return cached('sdr', 30 * 60 * 1000, async () => {
    const cacheFile = path.join(DATA, 'sdr-cache.json');
    const [kiwi, rb] = await Promise.allSettled([loadKiwi(), loadReceiverBook()]);
    let list = [];
    const errors = [];
    const kiwiUrls = new Set();
    if (kiwi.status === 'fulfilled') {
      list.push(...kiwi.value);
      kiwi.value.forEach((k) => kiwiUrls.add(normHost(k.url)));
    } else errors.push('KiwiSDR: ' + kiwi.reason.message);
    if (rb.status === 'fulfilled') {
      for (const r of rb.value) {
        if (r.type === 'KiwiSDR' && kiwiUrls.has(normHost(r.url))) continue; // već imamo detaljniji zapis
        list.push(r);
      }
    } else errors.push('ReceiverBook: ' + rb.reason.message);

    if (list.length) {
      fs.writeFile(cacheFile, JSON.stringify(list), () => {});
    } else if (fs.existsSync(cacheFile)) {
      list = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      errors.push('Koristim spremljeni popis.');
    }
    return { updated: new Date().toISOString(), errors, receivers: list };
  });
}

function normHost(u) {
  try { const x = new URL(u); return (x.hostname + ':' + (x.port || '80')).toLowerCase(); } catch { return u; }
}

// ---------- audio: playliste, proxy, ICY metadata ----------

async function resolveStream(url) {
  // .pls / .m3u -> prvi stvarni URL streama
  if (!/\.(pls|m3u)(\?|$)/i.test(url)) return url;
  const txt = await fetchText(url, { timeout: 10000 });
  const pls = /^File\d+=(.+)$/im.exec(txt);
  if (pls) return pls[1].trim();
  const line = txt.split(/\r?\n/).map((l) => l.trim()).find((l) => /^https?:\/\//i.test(l));
  return line || url;
}

function proxyStream(req, res, target) {
  let upstreamReq;
  const go = (url, redirects) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    upstreamReq = lib.get(u, { headers: { 'User-Agent': UA, 'Icy-MetaData': '0', Accept: '*/*' }, timeout: 15000 }, (up) => {
      if ([301, 302, 303, 307, 308].includes(up.statusCode) && up.headers.location && redirects > 0) {
        up.resume();
        go(new URL(up.headers.location, u).href, redirects - 1);
        return;
      }
      const headers = {
        'Content-Type': up.headers['content-type'] || 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      };
      res.writeHead(up.statusCode >= 400 ? 502 : 200, headers);
      up.pipe(res);
    });
    upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('timeout')));
    upstreamReq.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  };
  req.on('close', () => upstreamReq && upstreamReq.destroy());
  go(target, 5);
}

function icyTitle(url) {
  // spaja se na stream s Icy-MetaData:1, čita prvi blok metapodataka i prekida vezu
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const go = (target, redirects) => {
      let u;
      try { u = new URL(target); } catch { return finish(null); }
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.get(u, { headers: { 'User-Agent': UA, 'Icy-MetaData': '1' }, timeout: 8000 }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          res.destroy();
          go(new URL(res.headers.location, u).href, redirects - 1);
          return;
        }
        const metaint = Number(res.headers['icy-metaint']);
        const info = { name: res.headers['icy-name'] || null, genre: res.headers['icy-genre'] || null, bitrate: res.headers['icy-br'] || null };
        if (!metaint) { res.destroy(); return finish({ ...info, title: null }); }
        let buf = Buffer.alloc(0);
        res.on('data', (c) => {
          buf = Buffer.concat([buf, c]);
          if (buf.length > metaint) {
            const len = buf[metaint] * 16;
            if (len === 0) { res.destroy(); return finish({ ...info, title: null }); }
            if (buf.length >= metaint + 1 + len) {
              const meta = buf.slice(metaint + 1, metaint + 1 + len).toString('utf8').replace(/\0+$/, '');
              const m = /StreamTitle='(.*?)';/.exec(meta);
              res.destroy();
              finish({ ...info, title: m ? m[1].trim() || null : null });
            }
          }
          if (buf.length > metaint + 5000) { res.destroy(); finish({ ...info, title: null }); }
        });
        res.on('error', () => finish(null));
      });
      req.on('timeout', () => { req.destroy(); finish(null); });
      req.on('error', () => finish(null));
    };
    go(url, 5);
    setTimeout(() => finish(null), 10000);
  });
}

// ---------- lokalna pohrana (favoriti, vlastite stanice, postavke) ----------

const STORES = new Set(['favorites', 'custom', 'settings', 'memories', 'history']);
function storePath(name) { return path.join(DATA, name + '.json'); }
function readStore(name) {
  try { return JSON.parse(fs.readFileSync(storePath(name), 'utf8')); } catch { return null; }
}
function writeStore(name, value) {
  const tmp = storePath(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, storePath(name));
}

// ---------- statičke datoteke ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------- usmjeravanje ----------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;
  try {
    if (p.startsWith('/api/rb/')) {
      // /api/rb/json/... -> Radio Browser API (s predmemorijom od 10 min)
      const target = p.slice('/api/rb'.length) + u.search;
      if (!target.startsWith('/json/')) return sendJSON(res, 400, { error: 'neispravna putanja' });
      const isClick = target.startsWith('/json/url/');
      const data = isClick ? await radioBrowser(target) : await cached('rb:' + target, 10 * 60 * 1000, () => radioBrowser(target));
      return sendJSON(res, 200, data);
    }

    if (p === '/api/sdr') {
      if (u.searchParams.get('refresh')) cache.delete('sdr');
      return sendJSON(res, 200, await sdrList());
    }

    if (p === '/api/resolve') {
      const url = u.searchParams.get('url');
      if (!isHttpUrl(url)) return sendJSON(res, 400, { error: 'neispravan URL' });
      return sendJSON(res, 200, { url: await resolveStream(url) });
    }

    if (p === '/api/stream') {
      const url = u.searchParams.get('url');
      if (!isHttpUrl(url)) { res.writeHead(400); return res.end(); }
      return proxyStream(req, res, await resolveStream(url));
    }

    if (p === '/api/nowplaying') {
      const url = u.searchParams.get('url');
      if (!isHttpUrl(url)) return sendJSON(res, 400, { error: 'neispravan URL' });
      const info = await cached('np:' + url, 15000, () => icyTitle(url));
      return sendJSON(res, 200, info || {});
    }

    if (p.startsWith('/api/store/')) {
      const name = p.slice('/api/store/'.length);
      if (!STORES.has(name)) return sendJSON(res, 404, { error: 'nepoznata pohrana' });
      if (req.method === 'GET') return sendJSON(res, 200, readStore(name));
      if (req.method === 'PUT' || req.method === 'POST') {
        writeStore(name, JSON.parse(await readBody(req)));
        return sendJSON(res, 200, { ok: true });
      }
      res.writeHead(405); return res.end();
    }

    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'nepoznato' });
    return serveStatic(req, res, p);
  } catch (e) {
    if (!res.headersSent) sendJSON(res, 502, { error: e.message });
    else res.end();
  }
});

// Pokreće poslužitelj; port 0 = slobodan port koji odabere sustav. Vraća URL sučelja.
function start({ port = 8642, host = '127.0.0.1', dataDir } = {}) {
  if (dataDir) DATA = dataDir;
  fs.mkdirSync(DATA, { recursive: true });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}/`;
      resolve(url);
    });
  });
}

module.exports = { start };

if (require.main === module) {
  start({ port: Number(process.env.PORT) || 8642, host: process.env.HOST || '127.0.0.1' }).then((url) => {
    console.log(`RadioPlayer radi na ${url}`);
    console.log('Zaustavi s Ctrl+C.');
    if (process.argv.includes('--open')) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      require('child_process').exec(cmd);
    }
  });
}
