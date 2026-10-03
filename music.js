/* Player de música do Relógio: biblioteca, equalizador, boost, modos de reprodução.
   Roda 100% no navegador (Web Audio API). Configurações ficam em localStorage['relogio-audio']. */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);

  // Elementos duplicados: cada controle existe no card da tela inicial e espelhado na aba Arquivos.
  const PF_MAP = {
    musicTitle:'pfMusicTitle', musicCount:'pfMusicCount', musicCover:'pfMusicCover',
    musicSeek:'pfMusicSeek', musicCurrentTime:'pfMusicCurrentTime', musicDuration:'pfMusicDuration',
    musicPlay:'pfMusicPlay', musicPrev:'pfMusicPrev', musicNext:'pfMusicNext',
    musicBack:'pfMusicBack', musicFwd:'pfMusicFwd', musicShuffle:'pfMusicShuffle',
    musicRepeat:'pfMusicRepeat', musicMute:'pfMusicMute', cardVolume:'pfVolume',
    cardVolumeVal:'pfVolumeVal', musicModes:'pfMusicModes'
  };
  function els(id){ const a = $(id), b = PF_MAP[id] && $(PF_MAP[id]); const out = []; if(a) out.push(a); if(b) out.push(b); return out; }
  function setText(id, text){ els(id).forEach(e => { e.textContent = text; }); }
  function setVal(id, v, exceptEl){ els(id).forEach(e => { if(e !== exceptEl) e.value = v; }); }
  function toggleCls(id, cls, on){ els(id).forEach(e => e.classList.toggle(cls, on)); }
  function bindClick(id, fn){ els(id).forEach(e => { e.onclick = fn; }); }
  function bindInput(id, fn){ els(id).forEach(e => { e.oninput = fn; }); }
  function setCover(url){
    els('musicCover').forEach(c => {
      if(url){ c.style.backgroundImage = 'url("' + url + '")'; c.textContent = ''; }
      else { c.style.backgroundImage = ''; c.textContent = '🎵'; }
    });
  }
  const audio = $('audioPlayer');
  if(!audio) return;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d) => (v === null || v === '' || !Number.isFinite(+v)) ? d : +v;
  const fmtDb = v => (v > 0 ? '+' : '') + v + 'dB';
  function fmtTime(sec){
    if(!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  // Volume: o controle vai de 0 a 100 mas a curva é quadrática, então o começo é fino e o fim chega a 800%.
  const pctToSlider = p => Math.round(100 * Math.sqrt(clamp(p, 0, 800) / 800));
  const sliderToPct = s => { const p = Math.round(800 * Math.pow(clamp(s, 0, 100) / 100, 2)); return Math.abs(p - 100) <= 4 ? 100 : p; };

  // ---------- configurações ----------
  const KEY = 'relogio-audio';
  const BANDS = [
    {f:60,    type:'lowshelf',  label:'60Hz'},
    {f:230,   type:'peaking',   label:'230Hz'},
    {f:910,   type:'peaking',   label:'910Hz'},
    {f:3600,  type:'peaking',   label:'3.6kHz'},
    {f:14000, type:'highshelf', label:'14kHz'}
  ];
  const PRESETS = {
    custom:     {label:'Personalizado'},
    flat:       {label:'Plano',       g:[0, 0, 0, 0, 0]},
    bass:       {label:'Grave forte', g:[9, 6, 1, -1, -1]},
    treble:     {label:'Agudos',      g:[-2, -1, 0, 5, 8]},
    vocal:      {label:'Vocal',       g:[-3, 0, 4, 4, 1]},
    rock:       {label:'Rock',        g:[6, 3, -1, 3, 6]},
    pop:        {label:'Pop',         g:[-1, 3, 4, 2, -1]},
    electronic: {label:'Eletrônica',  g:[7, 4, 0, 2, 6]},
    classical:  {label:'Clássica',    g:[4, 3, -2, 3, 4]}
  };
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const defaults = {vol:100, bass:0, virt:0, eq:[0, 0, 0, 0, 0], preset:'flat', speed:1, shuffle:false, repeat:'off', limiter:false};
  let cfg = {...defaults};
  try{
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if(s && typeof s === 'object') cfg = {...defaults, ...s};
  }catch(e){}
  cfg.vol = clamp(num(cfg.vol, 100), 0, 100);          // o boost acima de 100% nunca é restaurado sozinho
  cfg.bass = clamp(num(cfg.bass, 0), 0, 100);
  cfg.virt = clamp(num(cfg.virt, 0), 0, 100);
  cfg.eq = (Array.isArray(cfg.eq) && cfg.eq.length === 5) ? cfg.eq.map(n => clamp(Math.round(num(n, 0)), -12, 12)) : [0, 0, 0, 0, 0];
  if(!PRESETS[cfg.preset]) cfg.preset = 'custom';
  if(!SPEEDS.includes(+cfg.speed)) cfg.speed = 1;
  cfg.speed = +cfg.speed;
  if(!['off', 'all', 'one'].includes(cfg.repeat)) cfg.repeat = 'off';
  cfg.shuffle = !!cfg.shuffle;
  cfg.limiter = !!cfg.limiter;
  let volPct = cfg.vol;                                 // volume em uso (pode passar de 100 nesta sessão)
  let muted = false, fadeMul = 1;

  function saveCfg(){
    try{ localStorage.setItem(KEY, JSON.stringify({...cfg, vol:Math.min(volPct, 100)})); }catch(e){}
  }

  // ---------- Web Audio: cadeia de efeitos ----------
  let actx = null, g = null, graphFailed = false;

  function ensureGraph(){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC || graphFailed) return false;
    if(g){ if(actx.state === 'suspended') actx.resume().catch(() => {}); return true; }
    let src = null;
    try{
      actx = new AC();
      src = actx.createMediaElementSource(audio);
      const n = {};
      n.up = actx.createGain();
      n.up.channelCount = 2; n.up.channelCountMode = 'explicit'; n.up.channelInterpretation = 'speakers';   // mono vira estéreo
      n.split = actx.createChannelSplitter(2);
      n.merge = actx.createChannelMerger(2);
      n.negR = actx.createGain(); n.negR.gain.value = -1;
      n.side = actx.createGain();                                   // L - R (o que só existe no estéreo)
      n.wide = actx.createGain(); n.wide.gain.value = 0;            // virtualizador: quanto do "lado" é somado
      n.negWide = actx.createGain(); n.negWide.gain.value = -1;
      n.bass = actx.createBiquadFilter(); n.bass.type = 'lowshelf'; n.bass.frequency.value = 110;
      n.bands = BANDS.map(b => {
        const f = actx.createBiquadFilter();
        f.type = b.type; f.frequency.value = b.f;
        if(b.type === 'peaking') f.Q.value = 1;
        return f;
      });
      n.master = actx.createGain();
      n.comp = actx.createDynamicsCompressor();
      n.comp.threshold.value = -6; n.comp.knee.value = 0; n.comp.ratio.value = 20;
      n.comp.attack.value = 0.003; n.comp.release.value = 0.12;
      n.mSplit = actx.createChannelSplitter(2);
      n.anL = actx.createAnalyser(); n.anR = actx.createAnalyser();
      n.anL.fftSize = 512; n.anR.fftSize = 512;

      src.connect(n.up); n.up.connect(n.split);
      n.split.connect(n.merge, 0, 0); n.split.connect(n.merge, 1, 1);
      n.split.connect(n.side, 0);
      n.split.connect(n.negR, 1); n.negR.connect(n.side);
      n.side.connect(n.wide);
      n.wide.connect(n.merge, 0, 0);
      n.wide.connect(n.negWide); n.negWide.connect(n.merge, 0, 1);
      let prev = n.merge;
      [n.bass].concat(n.bands).forEach(node => { prev.connect(node); prev = node; });
      prev.connect(n.master);
      n.mSplit.connect(n.anL, 0); n.mSplit.connect(n.anR, 1);
      g = n;
      routeOutput();
      audio.volume = 1;
      applyAll();
      return true;
    }catch(e){
      graphFailed = true; g = null;
      try{ if(src) src.connect(actx.destination); }catch(_){}
      console.warn('Equalizador indisponível neste navegador:', e);
      return false;
    }
  }

  function routeOutput(){
    try{ g.master.disconnect(); }catch(e){}
    try{ g.comp.disconnect(); }catch(e){}
    if(cfg.limiter){ g.master.connect(g.comp); g.comp.connect(actx.destination); }
    else g.master.connect(actx.destination);
    g.master.connect(g.mSplit);
  }

  function setParam(p, v){
    try{ p.setTargetAtTime(v, actx.currentTime, 0.015); }catch(e){ try{ p.value = v; }catch(_){} }
  }
  const volGain = () => (muted ? 0 : volPct / 100) * fadeMul;

  function applyAll(){
    if(!g){ audio.volume = clamp(volGain(), 0, 1); return; }
    setParam(g.master.gain, volGain());
    setParam(g.bass.gain, cfg.bass * 0.24);                 // 0 a +24 dB
    g.bands.forEach((f, i) => setParam(f.gain, cfg.eq[i]));
    setParam(g.wide.gain, cfg.virt / 100 * 1.2);
  }
  function changed(){ ensureGraph(); applyAll(); saveCfg(); }

  // ---------- botões redondos (knobs) ----------
  function makeKnob(el, o){
    const NS = 'http://www.w3.org/2000/svg', R = 34, CX = 44, CY = 44;
    const C = 2 * Math.PI * R, L = C * 270 / 360;
    const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for(const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    el.innerHTML = '';
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', o.label);
    el.setAttribute('aria-valuemin', o.min); el.setAttribute('aria-valuemax', o.max);
    const svg = mk('svg', {viewBox:'0 0 88 88'});
    const common = {cx:CX, cy:CY, r:R, fill:'none', 'stroke-width':6, 'stroke-linecap':'round', transform:'rotate(135 ' + CX + ' ' + CY + ')'};
    const track = mk('circle', {...common, class:'knob-track', 'stroke-dasharray':L + ' ' + C});
    const prog = mk('circle', {...common, class:'knob-prog', 'stroke-dasharray':'0 ' + C});
    const dot = mk('circle', {r:6, class:'knob-dot', cx:CX, cy:CY});
    const txt = mk('text', {x:CX, y:CY + 3, 'text-anchor':'middle', class:'knob-val'});
    const cap = mk('text', {x:CX, y:CY + 17, 'text-anchor':'middle', class:'knob-cap'});
    cap.textContent = o.label;
    [track, prog, dot, txt, cap].forEach(x => svg.appendChild(x));
    el.appendChild(svg);

    let value = o.value;
    function render(){
      const f = (value - o.min) / (o.max - o.min);
      prog.setAttribute('stroke-dasharray', (L * f) + ' ' + C);
      const th = (-135 + f * 270) * Math.PI / 180;
      dot.setAttribute('cx', CX + R * Math.sin(th)); dot.setAttribute('cy', CY - R * Math.cos(th));
      txt.textContent = o.format(value);
      el.setAttribute('aria-valuenow', value); el.setAttribute('aria-valuetext', o.format(value));
    }
    function commit(v){
      v = clamp(Math.round(v / o.step) * o.step, o.min, o.max);
      if(v === value) return;
      value = v; render(); o.onChange(v);
    }
    let dragging = false;
    function fromPointer(e){
      const r = svg.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const a = Math.atan2(dx, -dy) * 180 / Math.PI;         // 0 = topo, positivo = horário
      let f;
      if(Math.abs(a) > 135) f = ((value - o.min) / (o.max - o.min)) > 0.5 ? 1 : 0;   // zona morta: gruda na ponta mais próxima
      else f = (a + 135) / 270;
      commit(o.min + f * (o.max - o.min));
    }
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); dragging = true;
      try{ el.setPointerCapture(e.pointerId); }catch(_){}
      el.focus(); fromPointer(e);
    });
    el.addEventListener('pointermove', e => { if(dragging) fromPointer(e); });
    const end = () => { dragging = false; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', e => {
      const big = Math.max(o.step, (o.max - o.min) / 10);
      const map = {ArrowUp:o.step, ArrowRight:o.step, ArrowDown:-o.step, ArrowLeft:-o.step, PageUp:big, PageDown:-big};
      if(e.key in map){ e.preventDefault(); commit(value + map[e.key]); }
      else if(e.key === 'Home'){ e.preventDefault(); commit(o.min); }
      else if(e.key === 'End'){ e.preventDefault(); commit(o.max); }
    });
    el.addEventListener('dblclick', () => commit(o.def));
    render();
    return {set(v){ value = clamp(v, o.min, o.max); render(); }, get(){ return value; }};
  }

  // ---------- volume (com boost) ----------
  let knobVol, knobBass, knobVirt;
  function syncVolumeUI(exceptEl){
    const s = pctToSlider(volPct);
    if(knobVol && exceptEl !== 'knob') knobVol.set(s);
    setVal('cardVolume', s, exceptEl === 'knob' ? null : exceptEl);
    setText('cardVolumeVal', volPct + '%');
    toggleCls('cardVolumeVal', 'hot', volPct > 200);
    setText('musicMute', (muted || volPct === 0) ? '🔇' : (volPct < 40 ? '🔈' : '🔊'));
    $('volWarn').textContent = volPct > 200
      ? '⚠ Acima de 200% o som distorce. Volume alto demais pode machucar seus ouvidos e o alto-falante ou fone.'
      : (volPct > 100 ? 'Boost ativo: acima de 100% o áudio é amplificado digitalmente.' : '');
  }
  function setVolume(pct, exceptEl){
    volPct = clamp(Math.round(pct), 0, 800);
    if(volPct > 0) muted = false;
    if(!ensureGraph()) volPct = Math.min(volPct, 100);      // sem Web Audio não dá pra passar de 100%
    syncVolumeUI(exceptEl);
    applyAll(); saveCfg();
  }

  // ---------- equalizador ----------
  function syncEqUI(){
    cfg.eq.forEach((v, i) => { $('eqBand' + i).value = v; $('eqDb' + i).textContent = fmtDb(v); });
    $('eqPreset').value = cfg.preset;
    if(knobBass) knobBass.set(cfg.bass);
    if(knobVirt) knobVirt.set(cfg.virt);
    $('eqLimiter').classList.toggle('on', cfg.limiter);
    $('eqLimiter').textContent = 'Limitador: ' + (cfg.limiter ? 'ligado' : 'desligado');
    $('eqSpeed').value = String(cfg.speed);
  }
  function buildEqUI(){
    knobVol = makeKnob($('knobVolume'), {label:'Volume', min:0, max:100, step:1, value:pctToSlider(volPct), def:pctToSlider(100),
      format:v => sliderToPct(v) + '%', onChange:v => setVolume(sliderToPct(v), 'knob')});
    knobBass = makeKnob($('knobBass'), {label:'Grave', min:0, max:100, step:1, value:cfg.bass, def:0,
      format:v => v + '%', onChange:v => { cfg.bass = v; changed(); }});
    knobVirt = makeKnob($('knobVirt'), {label:'Virtualizador', min:0, max:100, step:1, value:cfg.virt, def:0,
      format:v => v + '%', onChange:v => { cfg.virt = v; changed(); }});

    const sel = $('eqPreset');
    Object.keys(PRESETS).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = PRESETS[k].label; sel.appendChild(o); });
    sel.onchange = () => {
      cfg.preset = sel.value;
      if(PRESETS[cfg.preset].g) cfg.eq = PRESETS[cfg.preset].g.slice();
      syncEqUI(); changed();
    };
    for(let i = 0; i < 5; i++){
      $('eqHz' + i).textContent = BANDS[i].label;
      $('eqBand' + i).oninput = e => {
        cfg.eq[i] = clamp(Math.round(+e.target.value), -12, 12);
        cfg.preset = 'custom'; sel.value = 'custom';
        $('eqDb' + i).textContent = fmtDb(cfg.eq[i]);
        ensureGraph(); applyAll();
      };
      $('eqBand' + i).onchange = () => saveCfg();
    }
    SPEEDS.forEach(s => { const o = document.createElement('option'); o.value = String(s); o.textContent = s + '×'; $('eqSpeed').appendChild(o); });
    $('eqSpeed').onchange = e => { cfg.speed = +e.target.value; applyRate(); saveCfg(); };
    $('eqLimiter').onclick = () => { cfg.limiter = !cfg.limiter; ensureGraph(); if(g) routeOutput(); syncEqUI(); saveCfg(); };
    $('eqReset').onclick = () => {
      cfg.bass = 0; cfg.virt = 0; cfg.eq = [0, 0, 0, 0, 0]; cfg.preset = 'flat'; cfg.limiter = false;
      volPct = 100; muted = false;
      ensureGraph(); if(g) routeOutput();
      syncEqUI(); syncVolumeUI(); applyAll(); saveCfg();
    };
    bindInput('cardVolume', e => setVolume(sliderToPct(+e.target.value), e.target));
    bindClick('musicMute', () => { muted = !muted; ensureGraph(); syncVolumeUI(); applyAll(); });

    const seg = 12;
    ['meterL', 'meterR'].forEach(id => { const m = $(id); m.innerHTML = ''; for(let i = 0; i < seg; i++) m.appendChild(document.createElement('i')); });
  }

  // ---------- medidores de nível ----------
  const SEGS = 12;
  let meterRAF = 0, mbuf = null;
  const eqVisible = () => $('toolWidget').classList.contains('open') && $('paneEq').style.display === 'block';
  function peakOf(an){
    if(!mbuf || mbuf.length !== an.fftSize) mbuf = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(mbuf);
    let p = 0;
    for(let i = 0; i < mbuf.length; i++){ const v = Math.abs(mbuf[i] - 128); if(v > p) p = v; }
    return p / 128;
  }
  function paintMeter(id, level){
    const segs = $(id).children, lit = Math.round(clamp(level, 0, 1) * SEGS);
    for(let i = 0; i < segs.length; i++) segs[i].className = i < lit ? (i >= SEGS - 2 ? 'on hot' : 'on') : '';
  }
  function meterLoop(){
    meterRAF = 0;
    if(!g || audio.paused || !eqVisible()){ paintMeter('meterL', 0); paintMeter('meterR', 0); return; }
    paintMeter('meterL', peakOf(g.anL)); paintMeter('meterR', peakOf(g.anR));
    meterRAF = requestAnimationFrame(meterLoop);
  }
  function startMeters(){ if(!meterRAF && g && !audio.paused && eqVisible()) meterRAF = requestAnimationFrame(meterLoop); }
  const onVisibleChange = () => { $('toolWidget').classList.toggle('wide', $('paneEq').style.display === 'block'); startMeters(); };
  new MutationObserver(onVisibleChange).observe($('paneEq'), {attributes:true, attributeFilter:['style']});
  new MutationObserver(startMeters).observe($('toolWidget'), {attributes:true, attributeFilter:['class']});

  // ---------- tags ID3 (título, artista, álbum, capa) ----------
  const readBuf = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(blob); });
  const syncsafe = (b, p) => ((b[p] & 0x7f) << 21) | ((b[p + 1] & 0x7f) << 14) | ((b[p + 2] & 0x7f) << 7) | (b[p + 3] & 0x7f);
  const u32 = (b, p) => ((b[p] * 16777216) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]);
  function decodeBytes(enc, bytes){
    try{
      if(typeof TextDecoder === 'undefined') throw 0;
      if(enc === 1){
        let le = true, b = bytes;
        if(b[0] === 0xFE && b[1] === 0xFF){ le = false; b = b.subarray(2); }
        else if(b[0] === 0xFF && b[1] === 0xFE){ b = b.subarray(2); }
        return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b);
      }
      if(enc === 2) return new TextDecoder('utf-16be').decode(bytes);
      if(enc === 3) return new TextDecoder('utf-8').decode(bytes);
      return new TextDecoder('iso-8859-1').decode(bytes);
    }catch(e){ let s = ''; for(let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }
  }
  const frameText = d => decodeBytes(d[0], d.subarray(1)).replace(/\u0000[\s\S]*$/, '').trim();
  function parseApic(d){
    const enc = d[0]; let p = 1, mime = '';
    while(p < d.length && d[p] !== 0){ mime += String.fromCharCode(d[p]); p++; }
    p += 2;                                                  // fim do mime + tipo da imagem
    if(enc === 1 || enc === 2){ while(p + 1 < d.length && !(d[p] === 0 && d[p + 1] === 0)) p += 2; p += 2; }
    else { while(p < d.length && d[p] !== 0) p++; p++; }
    if(p >= d.length) return null;
    const img = d.subarray(p);
    let type = mime.toLowerCase();
    if(type === 'image/jpg' || type.indexOf('image/') !== 0) type = '';
    if(!type) type = (img[0] === 0x89 && img[1] === 0x50) ? 'image/png' : 'image/jpeg';
    return {blob:new Blob([img], {type})};
  }
  async function readTags(file){
    try{
      const head = new Uint8Array(await readBuf(file.slice(0, 10)));
      if(head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
      const ver = head[3];
      if(ver < 3 || ver > 4) return {};
      const total = Math.min(syncsafe(head, 6), 6 * 1024 * 1024);
      const buf = new Uint8Array(await readBuf(file.slice(10, 10 + total)));
      let p = 0;
      if(head[5] & 0x40) p = ver === 4 ? syncsafe(buf, 0) : u32(buf, 0) + 4;    // pula cabeçalho estendido
      const out = {};
      while(p + 10 <= buf.length && buf[p] !== 0){
        const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
        const size = ver === 4 ? syncsafe(buf, p + 4) : u32(buf, p + 4);
        const start = p + 10, end = start + size;
        if(size <= 0 || end > buf.length) break;
        const d = buf.subarray(start, end);
        if(id === 'TIT2') out.title = frameText(d);
        else if(id === 'TPE1') out.artist = frameText(d);
        else if(id === 'TALB') out.album = frameText(d);
        else if(id === 'APIC' && !out.cover) out.cover = parseApic(d);
        p = end;
      }
      return out;
    }catch(e){ return {}; }
  }

  // ---------- Media Session (controles na tela de bloqueio e teclas de mídia) ----------
  function setupMediaSession(){
    if(!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const on = (a, fn) => { try{ ms.setActionHandler(a, fn); }catch(e){} };
    on('play', () => audio.play().catch(() => {}));
    on('pause', () => audio.pause());
    on('previoustrack', () => goPrev());
    on('nexttrack', () => goNext(false));
    on('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
    on('seekforward', () => { audio.currentTime = audio.currentTime + 10; });
    on('seekto', d => { if(d && d.seekTime != null) audio.currentTime = d.seekTime; });
  }
  function updateMediaMetadata(m){
    if(!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try{
      navigator.mediaSession.metadata = new MediaMetadata({title:m.title || '', artist:m.artist || '', album:m.album || '',
        artwork:m.cover ? [{src:m.cover, sizes:'512x512', type:m.coverType || 'image/jpeg'}] : []});
    }catch(e){}
  }
  function updatePosition(){
    if(!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !isFinite(audio.duration) || !audio.duration) return;
    try{ navigator.mediaSession.setPositionState({duration:audio.duration, playbackRate:audio.playbackRate || 1, position:Math.min(audio.currentTime, audio.duration)}); }catch(e){}
  }

  // ---------- lista e ordem de reprodução ----------
  let files = [], idx = 0, history = [], queue = [], objUrl = null, coverUrl = null, tagToken = 0, filterText = '';
  const ab = {a:null, b:null};
  const isAudioFile = f => (f.type && f.type.indexOf('audio/') === 0) || /\.(mp3|m4a|aac|wav|ogg|opus|flac|wma)$/i.test(f.name);
  const trackName = f => f.name.replace(/\.[^/.]+$/, '');

  function rebuildQueue(exclude){
    queue = files.map((_, i) => i).filter(i => i !== exclude);
    for(let i = queue.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); const t = queue[i]; queue[i] = queue[j]; queue[j] = t; }
  }
  function resetOrder(){ history = []; if(cfg.shuffle) rebuildQueue(idx); else queue = []; }

  function pickNext(auto){
    const n = files.length;
    if(!n) return -1;
    if(cfg.shuffle){
      if(!queue.length){
        if(auto && cfg.repeat !== 'all') return -1;
        rebuildQueue(n > 1 ? idx : -1);
      }
      return queue.length ? queue.pop() : -1;
    }
    let i = idx + 1;
    if(i >= n){ if(auto && cfg.repeat !== 'all') return -1; i = 0; }
    return i;
  }
  function goNext(auto){
    const i = pickNext(auto);
    if(i < 0){ stopAtEnd(); return; }
    history.push(idx); if(history.length > 200) history.shift();
    idx = i; load();
  }
  function goPrev(){
    if(!files.length) return;
    if(audio.currentTime > 3){ audio.currentTime = 0; return; }
    if(cfg.shuffle && history.length) idx = history.pop();
    else idx = (idx - 1 + files.length) % files.length;
    load();
  }
  function stopAtEnd(){
    audio.pause(); setPlayIcon(false);
    setText('musicCount', 'Fim da lista');
  }
  function setPlayIcon(playing){ setText('musicPlay', playing ? '⏸' : '▶'); }

  function showMeta(t){
    const f = files[idx];
    const title = t.title || (f ? trackName(f) : '');
    setText('musicTitle', title);
    const parts = [];
    if(t.artist) parts.push(t.artist);
    if(files.length > 1) parts.push('Faixa ' + (idx + 1) + ' de ' + files.length);
    setText('musicCount', parts.join(' · '));
    if(coverUrl){ URL.revokeObjectURL(coverUrl); coverUrl = null; }
    if(t.cover && t.cover.blob) coverUrl = URL.createObjectURL(t.cover.blob);
    setCover(coverUrl);
    updateMediaMetadata({title:title, artist:t.artist, album:t.album, cover:coverUrl, coverType:t.cover && t.cover.blob && t.cover.blob.type});
  }

  function load(){
    const f = files[idx];
    if(!f) return;
    ensureGraph();
    if(objUrl) URL.revokeObjectURL(objUrl);
    objUrl = URL.createObjectURL(f);
    audio.src = objUrl;
    applyRate();
    ab.a = ab.b = null; updateAB();
    setVal('musicSeek', 0); setText('musicCurrentTime', '0:00'); setText('musicDuration', '0:00');
    showMeta({});
    const token = ++tagToken;
    readTags(f).then(t => { if(token === tagToken) showMeta(t); });
    audio.play().catch(() => {});
    renderList();
  }

  function setFiles(list){
    const found = Array.from(list).filter(isAudioFile).sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
    if(!found.length){ $('musicListInfo').textContent = 'Nenhum arquivo de áudio encontrado nessa seleção.'; return; }
    files = found;
    idx = cfg.shuffle ? Math.floor(Math.random() * files.length) : 0;
    resetOrder();
    const rel = files[0].webkitRelativePath;
    $('musicListInfo').textContent = (rel ? 'Pasta: ' + rel.split('/')[0] + ' · ' : '') + files.length + (files.length === 1 ? ' música' : ' músicas');
    load();
  }

  function renderList(){
    const box = $('musicList');
    box.innerHTML = '';
    if(!files.length) return;
    const q = filterText.trim().toLowerCase();
    let shown = 0;
    files.forEach((f, i) => {
      const name = trackName(f);
      if(q && name.toLowerCase().indexOf(q) < 0) return;
      shown++;
      const row = document.createElement('div');
      row.className = 'music-row' + (i === idx ? ' current' : '');
      const label = document.createElement('span');
      label.textContent = (i === idx ? '▶ ' : '') + name;
      const del = document.createElement('button');
      del.textContent = '✕'; del.setAttribute('aria-label', 'Remover da lista');
      del.onclick = ev => { ev.stopPropagation(); removeTrack(i); };
      row.appendChild(label); row.appendChild(del);
      row.onclick = () => { history.push(idx); idx = i; if(cfg.shuffle) queue = queue.filter(x => x !== i); load(); };
      box.appendChild(row);
    });
    if(!shown){ const e = document.createElement('div'); e.className = 'dc-sub'; e.textContent = 'Nada encontrado.'; box.appendChild(e); }
  }

  function removeTrack(i){
    files.splice(i, 1);
    if(!files.length){
      audio.pause(); audio.removeAttribute('src'); audio.load();
      idx = 0; history = []; queue = [];
      setText('musicTitle', 'Nenhuma música — abra Arquivos');
      setText('musicCount', ''); setPlayIcon(false);
      $('musicListInfo').textContent = '';
      showMetaEmpty(); renderList();
      return;
    }
    if(i < idx) idx--;
    else if(i === idx){ idx = Math.min(idx, files.length - 1); resetOrder(); load(); return; }
    resetOrder();
    setText('musicCount', files.length > 1 ? 'Faixa ' + (idx + 1) + ' de ' + files.length : '');
    renderList();
  }
  function showMetaEmpty(){
    if(coverUrl){ URL.revokeObjectURL(coverUrl); coverUrl = null; }
    setCover(null);
  }

  // ---------- modos de reprodução ----------
  const REPEAT_LABEL = {off:'Tocar a lista uma vez', all:'Repetir a lista', one:'Repetir a música'};
  let sleepEnd = false;
  function applyRate(){
    audio.defaultPlaybackRate = cfg.speed; audio.playbackRate = cfg.speed;
    ['preservesPitch', 'webkitPreservesPitch', 'mozPreservesPitch'].forEach(k => { if(k in audio) audio[k] = true; });
  }
  function updateLoop(){ audio.loop = cfg.repeat === 'one' && !sleepEnd; }
  function updateModeUI(){
    const shuffleTitle = 'Aleatório: ' + (cfg.shuffle ? 'ligado' : 'desligado');
    els('musicShuffle').forEach(s => {
      s.classList.toggle('on', cfg.shuffle); s.setAttribute('aria-pressed', String(cfg.shuffle)); s.title = shuffleTitle;
    });
    const repeatTitle = 'Repetição: ' + REPEAT_LABEL[cfg.repeat] + ' (toque para mudar)';
    els('musicRepeat').forEach(r => {
      r.classList.toggle('on', cfg.repeat !== 'off');
      r.textContent = cfg.repeat === 'one' ? '🔂' : '🔁';
      r.title = repeatTitle; r.setAttribute('aria-label', repeatTitle);
    });
    setText('musicModes', (cfg.shuffle ? 'Aleatório' : 'Em ordem') + ' · ' + REPEAT_LABEL[cfg.repeat]);
    updateLoop();
  }
  bindClick('musicShuffle', () => { cfg.shuffle = !cfg.shuffle; resetOrder(); updateModeUI(); saveCfg(); });
  bindClick('musicRepeat', () => { cfg.repeat = {off:'all', all:'one', one:'off'}[cfg.repeat]; updateModeUI(); saveCfg(); });

  // ---------- trecho A–B ----------
  function updateAB(){
    $('abStatus').textContent = ab.a == null ? 'Sem trecho definido'
      : 'A ' + fmtTime(ab.a) + (ab.b != null ? ' → B ' + fmtTime(ab.b) : ' → defina o B');
  }
  $('abSetA').onclick = () => { if(!audio.src) return; ab.a = audio.currentTime; if(ab.b != null && ab.b <= ab.a) ab.b = null; updateAB(); };
  $('abSetB').onclick = () => { if(!audio.src) return; if(ab.a == null) ab.a = 0; if(audio.currentTime > ab.a){ ab.b = audio.currentTime; } updateAB(); };
  $('abClear').onclick = () => { ab.a = ab.b = null; updateAB(); };

  // ---------- timer de sono ----------
  let sleepAt = 0, sleepHandle = 0, fadeHandle = 0;
  function sleepStatus(t){ $('sleepStatus').textContent = t; }
  function cancelSleep(){
    clearInterval(sleepHandle); sleepHandle = 0; sleepAt = 0; sleepEnd = false;
    $('eqSleep').value = '0'; sleepStatus(''); updateLoop();
  }
  function fadeOutAndPause(){
    clearInterval(fadeHandle);
    let steps = 30;
    fadeHandle = setInterval(() => {
      steps--; fadeMul = Math.max(0, steps / 30); applyAll();
      if(steps <= 0){ clearInterval(fadeHandle); audio.pause(); fadeMul = 1; applyAll(); }
    }, 100);
  }
  function tickSleep(){
    const left = sleepAt - Date.now();
    if(left <= 0){ cancelSleep(); fadeOutAndPause(); return; }
    sleepStatus('Desliga em ' + fmtTime(left / 1000));
  }
  $('eqSleep').onchange = e => {
    const v = e.target.value;
    clearInterval(sleepHandle); sleepHandle = 0; sleepAt = 0; sleepEnd = false;
    if(v === 'end'){ sleepEnd = true; sleepStatus('Desliga quando a faixa terminar'); }
    else if(v !== '0'){ sleepAt = Date.now() + (+v) * 60000; sleepHandle = setInterval(tickSleep, 1000); tickSleep(); }
    else sleepStatus('');
    updateLoop();
  };

  // ---------- eventos do áudio ----------
  let seekDragging = false;
  audio.addEventListener('play', () => { setPlayIcon(true); ensureGraph(); startMeters(); if('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
  audio.addEventListener('pause', () => { setPlayIcon(false); if('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });
  audio.addEventListener('timeupdate', () => {
    if(ab.b != null && audio.currentTime >= ab.b){ audio.currentTime = ab.a != null ? ab.a : 0; return; }
    if(seekDragging) return;
    setText('musicCurrentTime', fmtTime(audio.currentTime));
    if(audio.duration) setVal('musicSeek', (audio.currentTime / audio.duration) * 100);
  });
  audio.addEventListener('loadedmetadata', () => { setText('musicDuration', fmtTime(audio.duration)); updatePosition(); });
  audio.addEventListener('seeked', updatePosition);
  audio.addEventListener('ratechange', updatePosition);
  audio.addEventListener('ended', () => {
    if(sleepEnd){ cancelSleep(); setPlayIcon(false); return; }
    if(cfg.repeat === 'one'){ audio.currentTime = 0; audio.play().catch(() => {}); return; }
    goNext(true);
  });
  els('musicSeek').forEach(el => {
    el.addEventListener('input', () => { seekDragging = true; });
    el.addEventListener('change', e => {
      if(audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
      seekDragging = false;
    });
  });

  // ---------- botões do card, da biblioteca e espelhados em Arquivos ----------
  bindClick('musicPlay', () => {
    if(!audio.src) return;
    ensureGraph();
    if(audio.paused) audio.play().catch(() => {}); else audio.pause();
  });
  bindClick('musicNext', () => { if(files.length) goNext(false); });
  bindClick('musicPrev', () => goPrev());
  bindClick('musicBack', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
  bindClick('musicFwd', () => { audio.currentTime = audio.currentTime + 10; });
  $('musicChoose').onclick = () => $('musicFileInput').click();
  $('musicPickFolder').onclick = () => $('musicFolderInput').click();
  $('musicFileInput').onchange = e => { setFiles(e.target.files); e.target.value = ''; };
  $('musicFolderInput').onchange = e => { setFiles(e.target.files); e.target.value = ''; };
  $('musicSearch').oninput = e => { filterText = e.target.value; renderList(); };

  // ---------- início ----------
  buildEqUI();
  syncEqUI();
  syncVolumeUI();
  applyRate();
  updateModeUI();
  updateAB();
  applyAll();
  setupMediaSession();
})();
