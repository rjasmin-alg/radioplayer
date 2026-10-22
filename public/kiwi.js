// Minimalni KiwiSDR klijent: WebSocket "SND" kanal, nekomprimirani 16-bitni PCM, S-metar.
'use strict';

const KIWI_PASSBAND = {
  am: [-4900, 4900], amn: [-2500, 2500], usb: [300, 2700], lsb: [-2700, -300], cw: [300, 700], nbfm: [-6000, 6000],
};

class KiwiClient {
  constructor() {
    this.ws = null;
    this.ctx = null;
    this.gain = null;
    this.analyser = null;
    this.rate = 12000;
    this.nextTime = 0;
    this.volume = 0.8;
    this.muted = false;
    this.smeter = -127;
    this.freq = 6070;
    this.mode = 'am';
    this.onstatus = () => {};
    this.onsmeter = () => {};
    this.keepalive = null;
  }

  get connected() { return this.ws && this.ws.readyState === WebSocket.OPEN; }

  connect(httpUrl) {
    this.disconnect();
    let u;
    try { u = new URL(httpUrl.includes('://') ? httpUrl : 'http://' + httpUrl); } catch { this.onstatus('error', 'Neispravna adresa'); return; }
    const wsUrl = `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/kiwi/${Date.now()}/SND`;

    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.gain.connect(this.analyser).connect(this.ctx.destination);
    }
    this.ctx.resume();
    this.applyGain();

    this.onstatus('connecting', 'Spajam…');
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send('SET auth t=kiwi p=#');
      ws.send('SET compression=0');
      ws.send('SET AR OK in=12000 out=44100');
      ws.send('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
      ws.send('SET squelch=0 max=0');
      ws.send('SET ident_user=RadioPlayer');
      this.tune(this.freq, this.mode);
      this.keepalive = setInterval(() => this.connected && ws.send('SET keepalive'), 5000);
      this.onstatus('connected', 'Spojen');
    };
    ws.onmessage = (e) => this.handle(new Uint8Array(e.data));
    ws.onerror = () => this.onstatus('error', 'Greška veze (prijemnik možda ne dopušta vanjske klijente)');
    ws.onclose = () => {
      if (this.ws === ws) { clearInterval(this.keepalive); this.ws = null; this.onstatus('closed', 'Veza zatvorena'); }
    };
  }

  disconnect() {
    clearInterval(this.keepalive);
    if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch {} }
    this.nextTime = 0;
  }

  tune(freqKHz, mode) {
    this.freq = Number(freqKHz);
    this.mode = mode || this.mode;
    const [lo, hi] = KIWI_PASSBAND[this.mode] || KIWI_PASSBAND.am;
    if (this.connected) this.ws.send(`SET mod=${this.mode} low_cut=${lo} high_cut=${hi} freq=${this.freq.toFixed(3)}`);
  }

  setVolume(v) { this.volume = v; this.applyGain(); }
  setMuted(m) { if (m !== this.muted) { this.muted = m; this.applyGain(); } }
  applyGain() { if (this.gain) this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.03); }

  handle(b) {
    const tag = String.fromCharCode(b[0], b[1], b[2]);
    if (tag === 'MSG') {
      const text = new TextDecoder().decode(b.subarray(4));
      for (const part of text.split(' ')) {
        const [k, v] = part.split('=');
        if (k === 'sample_rate' || k === 'audio_rate') { if (k === 'sample_rate') this.rate = Number(v) || this.rate; }
        else if (k === 'too_busy') this.onstatus('error', 'Prijemnik je pun (svi kanali zauzeti)');
        else if (k === 'badp' && v === '1') this.onstatus('error', 'Prijemnik traži lozinku');
        else if (k === 'down') this.onstatus('error', 'Prijemnik je trenutno nedostupan');
        else if (k === 'inactivity_timeout') this.onstatus('closed', 'Isteklo vrijeme neaktivnosti');
      }
      return;
    }
    if (tag !== 'SND') return;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.smeter = 0.1 * dv.getUint16(8) - 127;
    this.onsmeter(this.smeter);

    const n = (b.byteLength - 10) >> 1;
    if (n <= 0 || !this.ctx) return;
    const buf = this.ctx.createBuffer(1, n, this.rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = dv.getInt16(10 + i * 2) / 32768;

    const now = this.ctx.currentTime;
    if (this.nextTime < now || this.nextTime > now + 1.5) this.nextTime = now + 0.25; // jitter buffer
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    src.start(this.nextTime);
    this.nextTime += buf.duration;
  }
}

window.KiwiClient = KiwiClient;
