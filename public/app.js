// RadioPlayer – logika sučelja.
'use strict';

// ---------- pomoćne funkcije ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const regionNames = new Intl.DisplayNames(['hr'], { type: 'region' });
const countryName = (cc) => { try { return cc ? regionNames.of(cc.toUpperCase()) : ''; } catch { return cc; } };

async function api(path, opts) {
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
  return data;
}
const rb = (path, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== false));
  return api(`/api/rb/json/${path}${q.toString() ? '?' + q : ''}`);
};

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function distanceKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null || Number.isNaN(Number(v)))) return null;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------- pohrana ----------

const state = {
  settings: { country: 'HR', lat: 45.815, lon: 15.982, proxy: true, viz: true, volume: 0.8, kiwiRecent: [] },
  favorites: { stations: [], sdrs: [] },
  custom: [],
  memories: [],
  history: [],
};
const saveTimers = {};
function save(name) {
  clearTimeout(saveTimers[name]);
  saveTimers[name] = setTimeout(() => {
    fetch(`/api/store/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state[name]) })
      .catch(() => toast('Spremanje nije uspjelo'));
  }, 300);
}
async function loadStores() {
  await Promise.all(Object.keys(state).map(async (name) => {
    try {
      const v = await api(`/api/store/${name}`);
      if (v != null) state[name] = Array.isArray(state[name]) ? v : { ...state[name], ...v };
    } catch {}
  }));
}

// ---------- prikaz stanica ----------

const pickStation = (s) => ({
  stationuuid: s.stationuuid, name: s.name, url: s.url, url_resolved: s.url_resolved || s.url, favicon: s.favicon || '',
  tags: s.tags || '', countrycode: s.countrycode || '', state: s.state || '', codec: s.codec || '', bitrate: s.bitrate || 0,
  hls: s.hls || 0, homepage: s.homepage || '', votes: s.votes || 0, ...(s.lowBitrate ? { lowBitrate: true } : {}),
});
const isFav = (uuid) => state.favorites.stations.some((s) => s.stationuuid === uuid);

function toggleFav(st) {
  const i = state.favorites.stations.findIndex((s) => s.stationuuid === st.stationuuid);
  if (i >= 0) state.favorites.stations.splice(i, 1);
  else state.favorites.stations.push(pickStation(st));
  save('favorites');
  refreshFavButtons();
  if ($('#view-favorites').classList.contains('active')) renderFavorites();
}

function initials(name) {
  return esc(String(name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '♪');
}

function stationItem(st, { onDelete } = {}) {
  const div = document.createElement('div');
  div.className = 'item';
  div.dataset.uuid = st.stationuuid;
  const tags = (st.tags || '').split(',').filter(Boolean).slice(0, 4).join(', ');
  const parts = [st.countrycode && countryName(st.countrycode), st.state, st.codec && `${st.codec}${st.bitrate ? ' ' + st.bitrate + ' kbps' : ''}`, tags].filter(Boolean);
  div.innerHTML = `
    <div class="logo">${st.favicon ? `<img src="${esc(st.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : initials(st.name)}</div>
    <div class="meta"><div class="name" title="${esc(st.name)}">${esc(st.name)}</div><div class="sub" title="${esc(parts.join(' · '))}">${esc(parts.join(' · '))}</div></div>
    <div class="actions">
      <button class="icon-btn fav ${isFav(st.stationuuid) ? 'on' : ''}" title="Favorit">${isFav(st.stationuuid) ? '★' : '☆'}</button>
      ${onDelete ? '<button class="icon-btn del" title="Ukloni">🗑</button>' : ''}
      <button class="icon-btn play" title="Sviraj">▶</button>
    </div>`;
  const img = $('img', div);
  if (img) img.onerror = () => { img.parentElement.innerHTML = initials(st.name); };
  $('.play', div).onclick = () => player.playStation(st);
  $('.fav', div).onclick = () => toggleFav(st);
  if (onDelete) $('.del', div).onclick = () => onDelete(st);
  div.ondblclick = () => player.playStation(st);
  if (player.current && player.current.stationuuid === st.stationuuid) div.classList.add('playing');
  return div;
}

function renderStations(container, stations, { append = false, more, empty = 'Nema stanica.' } = {}) {
  if (!append) container.innerHTML = '';
  $('.more', container)?.remove();
  if (!stations.length && !append) { container.innerHTML = `<p class="loading">${esc(empty)}</p>`; return; }
  const frag = document.createDocumentFragment();
  stations.forEach((s) => frag.appendChild(stationItem(s)));
  container.appendChild(frag);
  if (more) {
    const b = document.createElement('button');
    b.className = 'btn more'; b.textContent = 'Učitaj još';
    b.onclick = () => { b.disabled = true; b.textContent = 'Učitavam…'; more(); };
    container.appendChild(b);
  }
}
const loading = (c) => { c.innerHTML = '<p class="loading">Učitavam…</p>'; };

function refreshFavButtons() {
  $$('.item[data-uuid]').forEach((d) => {
    const b = $('.fav', d); if (!b) return;
    const on = isFav(d.dataset.uuid);
    b.classList.toggle('on', on); b.textContent = on ? '★' : '☆';
  });
  const cur = player.current;
  $('#p-fav').textContent = cur && cur.stationuuid && isFav(cur.stationuuid) ? '★' : '☆';
  $('#p-fav').classList.toggle('on', !!(cur && isFav(cur.stationuuid)));
}
function markPlaying() {
  $$('.item.playing').forEach((d) => d.classList.remove('playing'));
  if (player.current) $$(`.item[data-uuid="${CSS.escape(player.current.stationuuid)}"]`).forEach((d) => d.classList.add('playing'));
}

// ---------- player ----------

const player = {
  elA: $('#audio'),        // ide kroz Web Audio (vizualizator) – lokalni proxy ili HLS
  elB: new Audio(),        // izravna reprodukcija (fallback)
  el: null,
  hls: null,
  current: null,
  ctx: null, analyser: null,
  npTimer: null,
  kiwiActive: false,

  init() {
    this.elA.crossOrigin = 'anonymous';
    for (const el of [this.elA, this.elB]) {
      el.addEventListener('playing', () => this.ui());
      el.addEventListener('pause', () => this.ui());
      el.addEventListener('waiting', () => { if (el === this.el) $('#p-title').textContent = 'Spajam…'; });
    }
    this.setVolume(state.settings.volume);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.toggle());
      navigator.mediaSession.setActionHandler('pause', () => this.toggle());
      navigator.mediaSession.setActionHandler('stop', () => this.stop());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.skip(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => this.skip(-1));
    }
  },

  ensureAudioGraph() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaElementSource(this.elA);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    src.connect(this.analyser).connect(this.ctx.destination);
  },

  stopElements() {
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    if (this.mseAbort) { this.mseAbort.abort(); this.mseAbort = null; }
    for (const el of [this.elA, this.elB]) { el.pause(); el.removeAttribute('src'); el.load(); }
    clearInterval(this.npTimer);
  },

  async playStation(st) {
    scanner.release();
    this.stopElements();
    this.current = st;
    this.kiwiActive = false;
    $('#p-name').textContent = st.name;
    $('#p-title').textContent = 'Spajam…';
    const logo = $('#p-logo');
    logo.src = st.favicon || 'icon.svg';
    logo.onerror = () => { logo.src = 'icon.svg'; };
    markPlaying(); refreshFavButtons();

    let url = st.url_resolved || st.url;
    const isHls = st.hls == 1 || /\.m3u8(\?|$)/i.test(url);
    const tryDirect = () => {
      this.el = this.elB;
      this.elB.src = url;
      return this.elB.play();
    };
    try {
      if (isHls && window.Hls && Hls.isSupported()) {
        this.ensureAudioGraph(); this.ctx.resume();
        this.el = this.elA;
        this.hls = new Hls({ lowLatencyMode: false });
        this.hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { this.hls.destroy(); this.hls = null; tryDirect().catch(() => this.fail()); } });
        this.hls.loadSource(url);
        this.hls.attachMedia(this.elA);
        await this.elA.play();
      } else if (st.lowBitrate && window.MediaSource && MediaSource.isTypeSupported('audio/mpeg')) {
        // MP3 stream niske brzine (npr. LiveATC 8 kbps): MediaSource kreće odmah, bez dugog punjenja međuspremnika
        this.ensureAudioGraph(); this.ctx.resume();
        this.el = this.elA;
        await this.playMse('/api/stream?url=' + encodeURIComponent(url));
      } else if (state.settings.proxy && !isHls) {
        this.ensureAudioGraph(); this.ctx.resume();
        this.el = this.elA;
        this.elA.src = '/api/stream?url=' + encodeURIComponent(url);
        try { await this.elA.play(); }
        catch { this.elA.removeAttribute('src'); this.elA.load(); await tryDirect(); }
      } else {
        await tryDirect();
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      try { const r = await api('/api/resolve?url=' + encodeURIComponent(st.url)); url = r.url; await tryDirect(); }
      catch { return this.fail(); }
    }

    if (st.stationuuid && !String(st.stationuuid).startsWith('custom:') && !String(st.stationuuid).startsWith('atc:')) {
      rb('url/' + st.stationuuid).catch(() => {}); // broji klik u radio-browser bazi
    }
    this.addHistory(st);
    this.mediaMeta(st.name, '');
    if (!isHls) {
      const poll = () => api('/api/nowplaying?url=' + encodeURIComponent(url)).then((np) => {
        if (this.current !== st) return;
        const t = np && np.title;
        $('#p-title').textContent = t || [st.codec, st.bitrate && st.bitrate + ' kbps'].filter(Boolean).join(' · ') || 'Uživo';
        this.mediaMeta(st.name, t || '');
      }).catch(() => {});
      poll();
      this.npTimer = setInterval(poll, 20000);
    } else {
      $('#p-title').textContent = 'Uživo (HLS)';
    }
  },

  playMse(url) {
    const ms = new MediaSource();
    const abort = new AbortController();
    this.mseAbort = abort;
    this.elA.src = URL.createObjectURL(ms);
    ms.addEventListener('sourceopen', async () => {
      const sb = ms.addSourceBuffer('audio/mpeg');
      sb.mode = 'sequence';
      const queue = [];
      const pump = () => {
        if (sb.updating || !queue.length || ms.readyState !== 'open') return;
        const t = this.elA.currentTime;
        if (sb.buffered.length && t - sb.buffered.start(0) > 60) { sb.remove(0, t - 30); return; }
        sb.appendBuffer(queue.shift());
      };
      sb.addEventListener('updateend', pump);
      try {
        const r = await fetch(url, { signal: abort.signal });
        const reader = r.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          queue.push(value); pump();
          // živi rub: ako zaostajemo više od 3 s, preskoči naprijed
          if (sb.buffered.length && sb.buffered.end(0) - this.elA.currentTime > 3) this.elA.currentTime = sb.buffered.end(0) - 0.5;
        }
      } catch {}
    }, { once: true });
    return this.elA.play();
  },

  fail() {
    $('#p-title').textContent = 'Stream trenutno ne radi';
    toast('Ne mogu reproducirati ovu stanicu – možda je izvan pogona.');
    this.ui();
  },

  addHistory(st) {
    state.history = [pickStation(st), ...state.history.filter((h) => h.stationuuid !== st.stationuuid)].slice(0, 40);
    save('history');
  },

  mediaMeta(title, artist) {
    if (!('mediaSession' in navigator)) return;
    const cur = this.current;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: artist || title, artist: artist ? title : 'RadioPlayer',
      artwork: cur && cur.favicon ? [{ src: cur.favicon }] : [],
    });
  },

  toggle() {
    if (this.kiwiActive) { scanner.toggleConnection(); return; }
    if (!this.current) { const f = state.favorites.stations[0] || state.history[0]; if (f) this.playStation(f); return; }
    if (!this.el || this.el.paused) this.playStation(this.current);   // live stream: uvijek ponovno spoji
    else { this.el.pause(); clearInterval(this.npTimer); }
  },

  stop() { this.stopElements(); this.ui(); },

  skip(dir) {
    const list = state.favorites.stations.length ? state.favorites.stations : state.history;
    if (!list.length) return;
    const i = this.current ? list.findIndex((s) => s.stationuuid === this.current.stationuuid) : -1;
    this.playStation(list[(i + dir + list.length) % list.length]);
  },

  setVolume(v) {
    this.elA.volume = this.elB.volume = v;
    scanner.kiwi.setVolume(v);
    $('#p-vol').value = v;
    $('#k-vol').value = v;
  },

  ui() {
    const playing = this.kiwiActive ? scanner.kiwi.connected : !!(this.el && !this.el.paused);
    $('#p-play').textContent = playing ? '⏸' : '▶';
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  },

  showKiwi(name, title) {
    this.stopElements();
    this.kiwiActive = true;
    this.current = null;
    markPlaying();
    $('#p-name').textContent = name;
    $('#p-title').textContent = title;
    $('#p-logo').src = 'icon.svg';
    this.ui();
  },
};

// vizualizator
function drawViz() {
  const c = $('#viz'), g = c.getContext('2d');
  const analyser = player.kiwiActive ? scanner.kiwi.analyser : player.analyser;
  g.clearRect(0, 0, c.width, c.height);
  if (state.settings.viz && analyser) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const bars = 48, w = c.width / bars;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    g.fillStyle = accent;
    for (let i = 0; i < bars; i++) {
      const v = data[Math.floor(i * data.length * 0.8 / bars)] / 255;
      const h = Math.max(1, v * c.height);
      g.fillRect(i * w + 1, c.height - h, w - 2, h);
    }
  }
  requestAnimationFrame(drawViz);
}

// ---------- države ----------

let countries = [];
async function loadCountries() {
  const list = await rb('countries', { hidebroken: true });
  const map = new Map();
  for (const c of list) {
    const code = (c.iso_3166_1 || '').toUpperCase();
    if (!code) continue;
    map.set(code, (map.get(code) || 0) + c.stationcount);
  }
  countries = [...map].map(([code, count]) => ({ code, count, name: countryName(code) || code }))
    .sort((a, b) => a.name.localeCompare(b.name, 'hr'));
  const opts = countries.map((c) => `<option value="${c.code}">${esc(c.name)} (${c.count})</option>`).join('');
  $('#local-country').innerHTML = opts;
  $('#set-country').innerHTML = opts;
  for (const id of ['#s-country', '#g-country', '#m-country']) $(id).insertAdjacentHTML('beforeend', opts);
  $('#local-country').value = state.settings.country;
  $('#set-country').value = state.settings.country;
}

// ---------- LOKALNO ----------

let localStations = [];
async function loadLocal() {
  const list = $('#local-list');
  loading(list);
  const cc = $('#local-country').value || state.settings.country;
  try {
    localStations = await rb('stations/search', { countrycode: cc, hidebroken: true, order: 'votes', reverse: true, limit: 1500 });
  } catch (e) { list.innerHTML = `<p class="loading">Greška: ${esc(e.message)}</p>`; return; }
  const states = [...new Set(localStations.map((s) => s.state.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'hr'));
  $('#local-state').innerHTML = '<option value="">Sve regije</option>' + states.map((s) => `<option>${esc(s)}</option>`).join('');
  renderLocal();
}
function renderLocal() {
  const st = $('#local-state').value, q = $('#local-filter').value.trim().toLowerCase(), order = $('#local-order').value;
  let list = localStations.filter((s) => (!st || s.state.trim() === st) && (!q || (s.name + ' ' + s.tags).toLowerCase().includes(q)));
  const cmp = { votes: (a, b) => b.votes - a.votes, clickcount: (a, b) => b.clickcount - a.clickcount, name: (a, b) => a.name.localeCompare(b.name, 'hr'), bitrate: (a, b) => b.bitrate - a.bitrate }[order];
  list = [...list].sort(cmp);
  const box = $('#local-list');
  let shown = 0;
  const page = () => { const chunk = list.slice(shown, shown + 120); renderStations(box, chunk, { append: shown > 0, more: shown + 120 < list.length ? () => { shown += 120; page(); } : null }); };
  page();
}

// ---------- PRETRAGA ----------

let searchParams = null, searchOffset = 0;
async function doSearch(append = false) {
  const box = $('#search-list');
  if (!append) {
    const order = $('#s-order').value;
    searchParams = {
      name: $('#s-name').value.trim(), countrycode: $('#s-country').value, tag: $('#s-tag').value.trim(), language: $('#s-language').value.trim().toLowerCase(),
      codec: $('#s-codec').value, bitrateMin: $('#s-bitrate').value, order, reverse: order !== 'name' && order !== 'random', hidebroken: true, limit: 100,
    };
    searchOffset = 0;
    loading(box);
  }
  try {
    const res = await rb('stations/search', { ...searchParams, offset: searchOffset });
    renderStations(box, res, { append, more: res.length === 100 ? () => { searchOffset += 100; doSearch(true); } : null, empty: 'Ništa nije pronađeno.' });
  } catch (e) { box.innerHTML = `<p class="loading">Greška: ${esc(e.message)}</p>`; }
}

// ---------- ŽANROVI ----------

let allTags = [];
function renderGenres() {
  const q = $('#g-filter').value.trim().toLowerCase();
  $('#genre-grid').innerHTML = GENRES.filter(([t, n]) => !q || t.includes(q) || n.toLowerCase().includes(q))
    .map(([tag, label, color]) => `<button class="genre" data-tag="${esc(tag)}" style="background:linear-gradient(135deg, ${color}, ${color}99)">${esc(label)}<small>${esc(tag)}</small></button>`).join('');
  $('#tag-chips').innerHTML = allTags.filter((t) => !q || t.name.includes(q)).slice(0, 250)
    .map((t) => `<button class="chip" data-tag="${esc(t.name)}">${esc(t.name)} <span class="muted">${t.stationcount}</span></button>`).join('');
}
async function loadTags() {
  try {
    allTags = (await rb('tags', { order: 'stationcount', reverse: true, limit: 600, hidebroken: true })).filter((t) => t.name.length < 30);
    $('#tag-list').innerHTML = allTags.slice(0, 400).map((t) => `<option value="${esc(t.name)}">`).join('');
  } catch {}
  renderGenres();
}
let genreTag = '', genreOffset = 0;
async function showGenre(tag, append = false) {
  const box = $('#genre-list');
  if (!append) { genreTag = tag; genreOffset = 0; loading(box); $('#genre-title').hidden = false; $('#genre-title').textContent = `Žanr: ${tag}`; $('#genre-title').scrollIntoView({ behavior: 'smooth' }); }
  try {
    const res = await rb('stations/search', { tag: genreTag, countrycode: $('#g-country').value, order: 'votes', reverse: true, hidebroken: true, limit: 100, offset: genreOffset });
    renderStations(box, res, { append, more: res.length === 100 ? () => { genreOffset += 100; showGenre(genreTag, true); } : null });
  } catch (e) { box.innerHTML = `<p class="loading">Greška: ${esc(e.message)}</p>`; }
}

// ---------- KARTA STANICA ----------

let stationMap, stationCluster;
function makeMap(id) {
  const m = L.map(id, { worldCopyJump: true }).setView([state.settings.lat || 45.8, state.settings.lon || 16], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(m);
  return m;
}
const mapStations = new Map();
async function loadStationMap() {
  if (!stationMap) {
    stationMap = makeMap('station-map');
    stationCluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45 });
    stationMap.addLayer(stationCluster);
    stationMap.on('popupopen', (e) => {
      const b = e.popup.getElement().querySelector('[data-play]');
      if (b) b.onclick = () => player.playStation(mapStations.get(b.dataset.play));
    });
  }
  $('#m-count').textContent = 'Učitavam…';
  const cc = $('#m-country').value;
  try {
    const res = await rb('stations/search', { has_geo_info: true, countrycode: cc, tag: $('#m-tag').value.trim(), hidebroken: true, order: 'votes', reverse: true, limit: cc ? 3000 : 5000 });
    stationCluster.clearLayers(); mapStations.clear();
    const markers = [];
    for (const s of res) {
      if (s.geo_lat == null || s.geo_long == null) continue;
      mapStations.set(s.stationuuid, s);
      const mk = L.circleMarker([s.geo_lat, s.geo_long], { radius: 6, color: '#ff8a3d', weight: 2, fillOpacity: 0.7 });
      mk.bindPopup(`<b>${esc(s.name)}</b><br>${esc([s.state, countryName(s.countrycode)].filter(Boolean).join(', '))}<br><span>${esc((s.tags || '').split(',').slice(0, 4).join(', '))}</span><br><button class="btn" data-play="${esc(s.stationuuid)}">▶ Sviraj</button>`);
      markers.push(mk);
    }
    stationCluster.addLayers(markers);
    $('#m-count').textContent = `${markers.length} stanica na karti`;
    if (cc && markers.length) stationMap.fitBounds(stationCluster.getBounds(), { maxZoom: 9 });
  } catch (e) { $('#m-count').textContent = 'Greška: ' + e.message; }
}

// ---------- SDR ----------

let sdrData = null, sdrMap, sdrLayer, sdrShown = 0, sdrFiltered = [];
const typeBadge = (t) => `<span class="badge ${t === 'KiwiSDR' ? 'kiwi' : t === 'OpenWebRX' ? 'owrx' : 'websdr'}">${esc(t)}</span>`;
const VHF_RE = /\b(vhf|uhf|air ?band|airband|aircraft|avia|2 ?m\b|70 ?cm|144|145|430|433|435|446|pmr|ads-?b|1090|acars|marine|rtl|dmr|pocsag|fm broadcast|repeater|\d{3,4} ?mhz)/i;
const HF_RE = /\b(hf|kv|kurzwelle|shortwave|short wave|lf|mf|vlf|0[.,]?\d*\s*-\s*30|30 ?mhz|160m|80m|40m|20m|10m)\b/i;

async function loadSdr(refresh = false) {
  $('#sdr-status').textContent = 'Učitavam popis prijemnika…';
  try {
    sdrData = await api('/api/sdr' + (refresh ? '?refresh=1' : ''));
  } catch (e) { $('#sdr-status').textContent = 'Greška: ' + e.message; return; }
  for (const r of sdrData.receivers) {
    r.dist = distanceKm(state.settings.lat, state.settings.lon, r.lat, r.lon);
    r.text = `${r.name} ${r.loc} ${r.antenna} ${r.url}`.toLowerCase();
    r.vhf = VHF_RE.test(r.name + ' ' + r.antenna);
    r.hf = r.type === 'KiwiSDR' || r.type === 'WebSDR' || HF_RE.test(r.name + ' ' + r.antenna) || !r.vhf;
  }
  renderSdr();
}
function sdrFree(r) { return r.online && (r.usersMax == null || r.usersMax === 0 || r.users < r.usersMax); }
function renderSdr() {
  if (!sdrData) return;
  const q = $('#sdr-q').value.trim().toLowerCase(), type = $('#sdr-type').value, band = $('#sdr-band').value, free = $('#sdr-free').checked, sort = $('#sdr-sort').value;
  sdrFiltered = sdrData.receivers.filter((r) => (!type || r.type === type) && (!q || q.split(/\s+/).every((w) => r.text.includes(w)))
    && (!free || sdrFree(r)) && (!band || (band === 'vhf' ? r.vhf : r.hf)));
  const cmp = {
    dist: (a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9),
    name: (a, b) => a.name.localeCompare(b.name),
    users: (a, b) => ((a.users ?? 0) / (a.usersMax || 1)) - ((b.users ?? 0) / (b.usersMax || 1)),
  }[sort];
  sdrFiltered.sort(cmp);
  const counts = sdrData.receivers.reduce((m, r) => (m[r.type] = (m[r.type] || 0) + 1, m), {});
  $('#sdr-status').textContent = `Prikazano ${sdrFiltered.length} od ${sdrData.receivers.length} prijemnika (${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}).`
    + (sdrData.errors.length ? ' Napomena: ' + sdrData.errors.join('; ') : '');
  sdrShown = 0;
  $('#sdr-list').innerHTML = '';
  pageSdr();
  if (!$('#sdr-map').hidden) drawSdrMap();
}
function pageSdr() {
  const box = $('#sdr-list');
  $('.more', box)?.remove();
  const chunk = sdrFiltered.slice(sdrShown, sdrShown + 100);
  chunk.forEach((r) => box.appendChild(sdrItem(r)));
  sdrShown += chunk.length;
  if (sdrShown < sdrFiltered.length) {
    const b = document.createElement('button'); b.className = 'btn more'; b.textContent = `Prikaži još (${sdrFiltered.length - sdrShown})`;
    b.onclick = pageSdr; box.appendChild(b);
  }
  if (!sdrFiltered.length) box.innerHTML = '<p class="loading">Nema prijemnika za zadane filtere.</p>';
}
const isSdrFav = (id) => state.favorites.sdrs.some((s) => s.id === id);
function sdrItem(r) {
  const div = document.createElement('div');
  div.className = 'item';
  const users = r.usersMax ? `<span class="badge ${r.users < r.usersMax ? 'ok' : 'bad'}">${r.users}/${r.usersMax}</span>` : '';
  const dist = r.dist != null ? `${Math.round(r.dist)} km` : '';
  div.innerHTML = `
    <div class="logo">📡</div>
    <div class="meta">
      <div class="name" title="${esc(r.name)}">${esc(r.name)}</div>
      <div class="sub">${typeBadge(r.type)} ${users} ${r.online ? '' : '<span class="badge bad">offline</span>'} ${esc([dist, r.loc].filter(Boolean).join(' · '))}</div>
      ${r.antenna ? `<div class="sub" title="${esc(r.antenna)}">Antena: ${esc(r.antenna)}</div>` : ''}
    </div>
    <div class="actions">
      <button class="icon-btn fav ${isSdrFav(r.id) ? 'on' : ''}" title="Favorit">${isSdrFav(r.id) ? '★' : '☆'}</button>
      ${r.type === 'KiwiSDR' ? '<button class="icon-btn tune" title="Slušaj u ugrađenom tuneru / skeneru">📻</button>' : ''}
      <button class="icon-btn open" title="Otvori ovdje">▣</button>
      <a class="icon-btn" href="${esc(r.url)}" target="_blank" rel="noopener" title="Otvori u novom prozoru">↗</a>
    </div>`;
  $('.open', div).onclick = () => openSdr(r);
  $('.tune', div)?.addEventListener('click', () => { showView('scanner'); scanner.connectTo(r); });
  $('.fav', div).onclick = (e) => {
    const i = state.favorites.sdrs.findIndex((s) => s.id === r.id);
    if (i >= 0) state.favorites.sdrs.splice(i, 1);
    else state.favorites.sdrs.push({ id: r.id, type: r.type, name: r.name, url: r.url, loc: r.loc, lat: r.lat, lon: r.lon, antenna: r.antenna, users: r.users, usersMax: r.usersMax, online: true });
    save('favorites');
    e.currentTarget.classList.toggle('on', i < 0); e.currentTarget.textContent = i < 0 ? '★' : '☆';
  };
  return div;
}
function drawSdrMap() {
  if (!sdrMap) {
    sdrMap = makeMap('sdr-map');
    sdrLayer = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 35 });
    sdrMap.addLayer(sdrLayer);
    if (state.settings.lat != null) L.marker([state.settings.lat, state.settings.lon], { title: 'Moja lokacija' }).addTo(sdrMap);
    sdrMap.on('popupopen', (e) => {
      const el = e.popup.getElement();
      const r = sdrData.receivers.find((x) => x.id === el.querySelector('[data-id]')?.dataset.id);
      if (!r) return;
      el.querySelector('[data-open]').onclick = () => openSdr(r);
      el.querySelector('[data-tune]')?.addEventListener('click', () => { showView('scanner'); scanner.connectTo(r); });
    });
  }
  setTimeout(() => sdrMap.invalidateSize(), 50);
  sdrLayer.clearLayers();
  const colors = { KiwiSDR: '#3db7ff', OpenWebRX: '#ffb13d', WebSDR: '#3ddc84' };
  const markers = sdrFiltered.filter((r) => r.lat != null && r.lon != null).map((r) => {
    const mk = L.circleMarker([r.lat, r.lon], { radius: 6, color: colors[r.type] || '#aaa', weight: 2, fillOpacity: 0.7 });
    mk.bindPopup(`<div data-id="${esc(r.id)}"><b>${esc(r.name)}</b><br>${esc(r.type)} · ${esc(r.loc)}${r.usersMax ? `<br>Korisnici: ${r.users}/${r.usersMax}` : ''}${r.dist != null ? `<br>${Math.round(r.dist)} km` : ''}<br>
      ${r.type === 'KiwiSDR' ? '<button class="btn" data-tune>📻 Tuner</button> ' : ''}<button class="btn" data-open>▣ Otvori</button> <a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">↗</a></div>`);
    return mk;
  });
  sdrLayer.addLayers(markers);
}
function openSdr(r) {
  player.stopElements(); player.ui();
  scanner.release();
  $('#sdr-modal-title').textContent = `${r.type}: ${r.name}`;
  $('#sdr-modal-ext').href = r.url;
  $('#sdr-frame').src = r.url;
  $('#sdr-modal').hidden = false;
}
function closeSdr() {
  $('#sdr-frame').src = 'about:blank';
  $('#sdr-modal').hidden = true;
}

// ---------- SKENER ----------

const scanner = {
  kiwi: new KiwiClient(),
  receiver: null,
  scan: null,
  scanTimer: null,
  group: 'Moje memorije',

  init() {
    const k = this.kiwi;
    k.onstatus = (st, msg) => {
      const b = $('#k-state');
      b.textContent = msg;
      b.className = 'badge ' + (st === 'connected' ? 'ok' : st === 'error' ? 'bad' : '');
      $('#k-connect').textContent = k.connected || st === 'connecting' ? 'Odspoji' : 'Spoji';
      if (st === 'connected') this.updatePlayer();
      if (st === 'error') toast(msg);
      if (st === 'closed' || st === 'error') { this.stopScan(); player.ui(); }
    };
    k.onsmeter = (db) => {
      const pct = Math.max(0, Math.min(100, (db + 130) / 90 * 100));
      $('#k-smeter-bar').style.width = pct + '%';
      $('#k-smeter').textContent = `${db.toFixed(0)} dBm  ${sUnit(db)}`;
      const thr = Number($('#k-thr').value);
      k.setMuted(($('#k-squelch').checked || this.scan) && db < thr);
    };

    $('#k-connect').onclick = () => this.toggleConnection();
    $('#k-near').onclick = () => this.nearest();
    $('#k-freq').onchange = () => this.tune();
    $('#k-mode').onchange = () => this.tune();
    $('#k-freq').addEventListener('wheel', (e) => { e.preventDefault(); this.step((e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 1)); }, { passive: false });
    $$('[data-step]').forEach((b) => { b.onclick = () => this.step(Number(b.dataset.step)); });
    $('#k-thr').oninput = () => this.thrUi();
    $('#k-vol').oninput = (e) => player.setVolume(Number(e.target.value));
    $('#k-save').onclick = () => this.saveMemory();
    $('#scan-src').onchange = () => { $('#scan-range').hidden = $('#scan-src').value !== 'range'; };
    $('#scan-btn').onclick = () => (this.scan ? this.stopScan() : this.startScan());
    $('#mem-group').onchange = () => { this.group = $('#mem-group').value; this.renderMemories(); };
    this.thrUi();

    $('#mem-group').innerHTML = ['Moje memorije', ...Object.keys(MEMORY_PRESETS)].map((g) => `<option>${esc(g)}</option>`).join('');
    if (!state.memories.length) $('#mem-group').value = this.group = Object.keys(MEMORY_PRESETS)[0];
    this.renderMemories();
    this.renderRecent();
    if (state.settings.kiwiRecent[0]) $('#k-url').value = state.settings.kiwiRecent[0].url;
    $('#k-name').textContent = state.settings.kiwiRecent[0]?.name || '';
  },

  thrUi() {
    const v = Number($('#k-thr').value);
    $('#k-thr-val').textContent = v;
    $('#k-thr-mark').style.left = Math.max(0, Math.min(100, (v + 130) / 90 * 100)) + '%';
  },

  memories() {
    return this.group === 'Moje memorije' ? state.memories : MEMORY_PRESETS[this.group].map(([f, mode, name]) => ({ f, mode, name }));
  },

  renderMemories() {
    const list = this.memories();
    const box = $('#mem-list');
    if (!list.length) { box.innerHTML = '<p class="muted small">Još nema spremljenih memorija. Ugodi frekvenciju i klikni „Spremi u memoriju“.</p>'; return; }
    box.innerHTML = list.map((m, i) => `<div class="mem" data-i="${i}"><span class="f">${Number(m.f).toFixed(m.f % 1 ? 2 : 0)}</span><span class="md">${esc(m.mode)}</span><span class="n">${esc(m.name)}</span>${this.group === 'Moje memorije' ? '<button class="x" title="Obriši">✕</button>' : ''}</div>`).join('');
    $$('.mem', box).forEach((d) => {
      d.onclick = (e) => {
        const m = list[d.dataset.i];
        if (e.target.classList.contains('x')) { state.memories.splice(d.dataset.i, 1); save('memories'); this.renderMemories(); return; }
        this.setFreq(m.f, m.mode);
        if (!this.kiwi.connected) this.toggleConnection();
      };
    });
    this.markCurrent();
  },

  markCurrent() {
    $$('#mem-list .mem').forEach((d) => {
      const m = this.memories()[d.dataset.i];
      d.classList.toggle('current', !!m && Math.abs(m.f - this.kiwi.freq) < 0.005);
    });
  },

  renderRecent() {
    $('#kiwi-recent').innerHTML = state.settings.kiwiRecent.map((r) => `<option value="${esc(r.url)}">${esc(r.name)}</option>`).join('');
  },

  setFreq(f, mode) {
    $('#k-freq').value = Number(f).toFixed(2);
    if (mode) $('#k-mode').value = mode;
    this.tune();
  },
  step(d) { this.setFreq(Math.max(0, Number($('#k-freq').value) + d)); },
  tune() {
    this.kiwi.tune(Number($('#k-freq').value), $('#k-mode').value);
    this.markCurrent();
    if (this.kiwi.connected) this.updatePlayer();
  },

  updatePlayer() {
    const name = this.receiver ? this.receiver.name : $('#k-url').value;
    player.showKiwi('KiwiSDR · ' + name, `${this.kiwi.freq.toFixed(2)} kHz ${this.kiwi.mode.toUpperCase()}${this.scan ? ' · skeniram' : ''}`);
  },

  connectTo(r) {
    this.receiver = r;
    $('#k-url').value = r.url;
    $('#k-name').textContent = `${r.name} — ${r.loc || ''}`;
    this.connect();
  },

  connect() {
    const url = $('#k-url').value.trim();
    if (!url) { toast('Upiši adresu KiwiSDR prijemnika ili klikni „Najbliži slobodni“.'); return; }
    if (!this.receiver || this.receiver.url !== url) this.receiver = { name: url, url };
    state.settings.kiwiRecent = [{ url, name: this.receiver.name }, ...state.settings.kiwiRecent.filter((r) => r.url !== url)].slice(0, 10);
    save('settings'); this.renderRecent();
    player.stopElements();
    this.kiwi.freq = Number($('#k-freq').value); this.kiwi.mode = $('#k-mode').value;
    this.kiwi.connect(url);
  },

  toggleConnection() {
    if (this.kiwi.connected || (this.kiwi.ws && this.kiwi.ws.readyState === WebSocket.CONNECTING)) { this.release(); }
    else this.connect();
  },

  release() {
    // oslobodi kanal na javnom prijemniku
    this.stopScan();
    if (this.kiwi.ws) this.kiwi.disconnect();
    $('#k-state').textContent = 'nije spojen'; $('#k-state').className = 'badge';
    $('#k-connect').textContent = 'Spoji';
    if (player.kiwiActive) { player.kiwiActive = false; player.ui(); }
  },

  async nearest() {
    if (!sdrData) await loadSdr();
    if (!sdrData) return;
    const r = sdrData.receivers.filter((x) => x.type === 'KiwiSDR' && sdrFree(x) && x.dist != null).sort((a, b) => a.dist - b.dist)[0];
    if (!r) { toast('Nema slobodnih KiwiSDR prijemnika.'); return; }
    this.connectTo(r);
  },

  saveMemory() {
    const f = Number($('#k-freq').value), mode = $('#k-mode').value;
    const name = prompt('Naziv memorije:', `${f.toFixed(2)} kHz`);
    if (name == null) return;
    state.memories.push({ f, mode, name: name || `${f} kHz` });
    state.memories.sort((a, b) => a.f - b.f);
    save('memories');
    $('#mem-group').value = this.group = 'Moje memorije';
    this.renderMemories();
  },

  startScan() {
    let list;
    if ($('#scan-src').value === 'range') {
      const from = Number($('#scan-from').value), to = Number($('#scan-to').value), step = Math.max(0.1, Number($('#scan-step').value));
      if (!(to > from)) { toast('Neispravan raspon.'); return; }
      if ((to - from) / step > 5000) { toast('Previše koraka – povećaj korak.'); return; }
      list = [];
      for (let f = from; f <= to + 1e-9; f += step) list.push({ f: Math.round(f * 100) / 100, mode: $('#k-mode').value });
    } else {
      list = this.memories();
    }
    if (!list.length) { toast('Popis za skeniranje je prazan.'); return; }
    if (!this.kiwi.connected) { this.connect(); }
    this.scan = { list, idx: -1, tunedAt: 0, lastAbove: 0, holding: false };
    $('#scan-btn').textContent = '■ Zaustavi';
    this.next();
    this.scanTimer = setInterval(() => this.tick(), 200);
  },

  next() {
    const s = this.scan;
    s.idx = (s.idx + 1) % s.list.length;
    const m = s.list[s.idx];
    s.tunedAt = performance.now(); s.holding = false;
    this.setFreq(m.f, m.mode);
  },

  tick() {
    const s = this.scan;
    if (!s || !this.kiwi.connected) return;
    const now = performance.now();
    if (now - s.tunedAt < 700) return;                // pričekaj da se S-metar smiri
    const thr = Number($('#k-thr').value);
    if (this.kiwi.smeter >= thr) { s.lastAbove = now; s.holding = true; return; }
    if (s.holding && now - s.lastAbove < Number($('#scan-hang').value) * 1000) return;
    if (s.holding || now - s.tunedAt >= Number($('#scan-dwell').value) * 1000) this.next();
  },

  stopScan() {
    clearInterval(this.scanTimer);
    if (this.scan) { this.scan = null; if (this.kiwi.connected) this.updatePlayer(); }
    $('#scan-btn').textContent = '▶ Skeniraj';
  },
};

function sUnit(dbm) {
  // S9 = -73 dBm, 6 dB po S jedinici (KV)
  if (dbm >= -73) return `S9+${Math.round(dbm + 73)}`;
  return 'S' + Math.max(0, Math.round(9 + (dbm + 73) / 6));
}

// streamovi skenera
function renderScannerChips() {
  const chips = [['atc', 'LiveATC – kontrola leta'], ...SCANNER_TAGS.map(([t, l]) => ['tag:' + t, l]), ['custom', 'Moji streamovi']];
  $('#scanner-chips').innerHTML = chips.map(([k, l]) => `<button class="chip" data-k="${esc(k)}">${esc(l)}</button>`).join('');
  $$('#scanner-chips .chip').forEach((c) => { c.onclick = () => showScannerStreams(c.dataset.k); });
}
async function showScannerStreams(k) {
  $$('#scanner-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.k === k));
  const box = $('#scanner-list');
  if (k === 'atc') {
    renderStations(box, LIVEATC.map(([mount, name, cc]) => ({ stationuuid: 'atc:' + mount, name, url: `http://d.liveatc.net/${mount}`, url_resolved: `http://d.liveatc.net/${mount}`, countrycode: cc, tags: 'atc, liveatc', codec: 'MP3', favicon: '', lowBitrate: true })));
  } else if (k === 'custom') {
    renderStations(box, state.custom, { empty: 'Nema vlastitih streamova – dodaj ih u kartici Favoriti.' });
  } else {
    loading(box);
    try { renderStations(box, await rb('stations/search', { tag: k.slice(4), tagExact: true, hidebroken: true, order: 'votes', reverse: true, limit: 200 })); }
    catch (e) { box.innerHTML = `<p class="loading">Greška: ${esc(e.message)}</p>`; }
  }
}

// ---------- FAVORITI ----------

function renderFavorites() {
  renderStations($('#fav-list'), state.favorites.stations, { empty: 'Još nema favorita – klikni ☆ pored stanice.' });
  const sb = $('#fav-sdr-list');
  sb.innerHTML = '';
  if (!state.favorites.sdrs.length) sb.innerHTML = '<p class="loading">Nema omiljenih SDR prijemnika.</p>';
  state.favorites.sdrs.forEach((r) => sb.appendChild(sdrItem({ ...r, dist: distanceKm(state.settings.lat, state.settings.lon, r.lat, r.lon) })));
  const hb = $('#history-list');
  renderStations(hb, state.history.slice(0, 20), { empty: 'Povijest je prazna.' });
  const customBox = document.createElement('div');
  customBox.className = 'list';
  if (state.custom.length) {
    const title = document.createElement('h2'); title.className = 'sub'; title.textContent = 'Vlastiti streamovi';
    const container = $('#custom-form');
    $('#custom-list')?.remove(); $('#custom-title')?.remove();
    title.id = 'custom-title'; customBox.id = 'custom-list';
    container.after(title, customBox);
    state.custom.forEach((s) => customBox.appendChild(stationItem(s, {
      onDelete: (st) => { state.custom = state.custom.filter((c) => c.stationuuid !== st.stationuuid); save('custom'); renderFavorites(); },
    })));
  } else { $('#custom-list')?.remove(); $('#custom-title')?.remove(); }
}

// ---------- POSTAVKE ----------

function initSettings() {
  const s = state.settings;
  $('#set-lat').value = s.lat ?? ''; $('#set-lon').value = s.lon ?? '';
  $('#set-proxy').checked = s.proxy; $('#set-viz').checked = s.viz;
  $('#set-country').onchange = (e) => { s.country = e.target.value; save('settings'); $('#local-country').value = s.country; loadLocal(); };
  const loc = () => {
    s.lat = Number($('#set-lat').value); s.lon = Number($('#set-lon').value); save('settings');
    if (sdrData) sdrData.receivers.forEach((r) => { r.dist = distanceKm(s.lat, s.lon, r.lat, r.lon); });
  };
  $('#set-lat').onchange = loc; $('#set-lon').onchange = loc;
  $('#set-geo').onclick = () => navigator.geolocation.getCurrentPosition(
    (p) => { $('#set-lat').value = p.coords.latitude.toFixed(4); $('#set-lon').value = p.coords.longitude.toFixed(4); loc(); toast('Lokacija postavljena.'); },
    () => toast('Lokaciju nije moguće odrediti.'));
  $('#set-proxy').onchange = (e) => { s.proxy = e.target.checked; save('settings'); };
  $('#set-viz').onchange = (e) => { s.viz = e.target.checked; save('settings'); };
  $('#set-export').onclick = () => {
    const blob = new Blob([JSON.stringify({ favorites: state.favorites, custom: state.custom, memories: state.memories }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'radioplayer-favoriti.json'; a.click();
  };
  $('#set-import').onchange = async (e) => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      for (const k of ['favorites', 'custom', 'memories']) if (d[k]) { state[k] = d[k]; save(k); }
      toast('Favoriti uvezeni.'); renderFavorites(); scanner.renderMemories();
    } catch { toast('Neispravna datoteka.'); }
  };
}

// ---------- navigacija ----------

const viewInit = {};
function showView(name) {
  $$('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (!viewInit[name]) {
    viewInit[name] = true;
    if (name === 'genres') loadTags();
    if (name === 'map') setTimeout(loadStationMap, 30);
    if (name === 'sdr' && !sdrData) loadSdr();
    if (name === 'scanner') { renderScannerChips(); showScannerStreams('atc'); }
  }
  if (name === 'favorites') renderFavorites();
  if (name === 'map' && stationMap) setTimeout(() => stationMap.invalidateSize(), 30);
  if (name === 'sdr' && sdrMap && !$('#sdr-map').hidden) setTimeout(() => sdrMap.invalidateSize(), 30);
  try { localStorage.setItem('rp-view', name); } catch {}
}

// ---------- pokretanje ----------

async function main() {
  await loadStores();
  player.init();
  scanner.init();
  initSettings();
  requestAnimationFrame(drawViz);

  $$('.nav').forEach((b) => { b.onclick = () => showView(b.dataset.view); });

  // player traka
  $('#p-play').onclick = () => player.toggle();
  $('#p-next').onclick = () => player.skip(1);
  $('#p-prev').onclick = () => player.skip(-1);
  $('#p-fav').onclick = () => player.current && toggleFav(player.current);
  $('#p-vol').oninput = (e) => { player.setVolume(Number(e.target.value)); state.settings.volume = Number(e.target.value); save('settings'); };
  let sleepTimer;
  $('#p-sleep').onchange = (e) => {
    clearTimeout(sleepTimer);
    const min = Number(e.target.value);
    if (min) { sleepTimer = setTimeout(() => { player.stop(); scanner.release(); e.target.value = '0'; toast('Automatsko gašenje.'); }, min * 60000); toast(`Gasim za ${min} min.`); }
  };
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName)) { e.preventDefault(); player.toggle(); }
    if (e.key === 'Escape' && !$('#sdr-modal').hidden) closeSdr();
  });

  // lokalno
  $('#local-country').onchange = loadLocal;
  $('#local-state').onchange = renderLocal;
  $('#local-order').onchange = renderLocal;
  $('#local-filter').oninput = renderLocal;

  // pretraga
  $('#search-form').onsubmit = (e) => { e.preventDefault(); doSearch(); };

  // žanrovi
  $('#g-filter').oninput = renderGenres;
  $('#genre-grid').onclick = (e) => { const b = e.target.closest('[data-tag]'); if (b) showGenre(b.dataset.tag); };
  $('#tag-chips').onclick = (e) => { const b = e.target.closest('[data-tag]'); if (b) showGenre(b.dataset.tag); };
  $('#g-country').onchange = () => genreTag && showGenre(genreTag);

  // karta
  $('#m-load').onclick = loadStationMap;

  // SDR
  for (const id of ['#sdr-type', '#sdr-band', '#sdr-free', '#sdr-sort']) $(id).onchange = renderSdr;
  let qt; $('#sdr-q').oninput = () => { clearTimeout(qt); qt = setTimeout(renderSdr, 200); };
  $('#sdr-refresh').onclick = () => loadSdr(true);
  $$('[data-sdrmode]').forEach((b) => {
    b.onclick = () => {
      $$('[data-sdrmode]').forEach((x) => x.classList.toggle('active', x === b));
      const map = b.dataset.sdrmode === 'map';
      $('#sdr-map').hidden = !map; $('#sdr-list').hidden = map;
      if (map) drawSdrMap();
    };
  });
  $('#sdr-modal-close').onclick = closeSdr;

  // vlastiti streamovi
  $('#custom-form').onsubmit = (e) => {
    e.preventDefault();
    const url = $('#c-url').value.trim();
    if (!/^https?:\/\//i.test(url)) { toast('URL mora počinjati s http:// ili https://'); return; }
    state.custom.push({ stationuuid: 'custom:' + Date.now(), name: $('#c-name').value.trim(), url, url_resolved: url, tags: $('#c-tags').value.trim(), favicon: '', countrycode: '', codec: '', bitrate: 0, hls: /\.m3u8/i.test(url) ? 1 : 0 });
    save('custom');
    e.target.reset();
    renderFavorites();
  };

  loadCountries().then(loadLocal).catch((e) => { $('#local-list').innerHTML = `<p class="loading">Ne mogu dohvatiti radio-browser bazu: ${esc(e.message)}</p>`; });

  let start = 'local';
  try { start = localStorage.getItem('rp-view') || 'local'; } catch {}
  if (start !== 'local' && $('#view-' + start)) showView(start);
}

main();
