(function(){
  const $ = id => document.getElementById(id);
  const timeEl = $('time'), dateEl = $('date');
  const layersContainer = $('layersContainer');
  const panel = $('panel'), overlay = $('overlay');
  const gearBtn = $('gearBtn'), closePanel = $('closePanel'), fsBtn = $('fsBtn');
  const clockWrap = $('clockWrap');

  const defaults = {
    fmt24:'24', showSeconds:true, showDate:true, accentSeconds:true,
    accent:'#7dd3fc', theme:'dark', bg:'#0a0a0a', fg:'#f5f5f5',
    font:"'Segoe UI', system-ui, sans-serif", locale:'pt-BR', useCustomColors:false,
    scale:100, mode:'digital', tz1:'', tz2:'', dynamicWallpaper:false,
    bgImage:'', textImage:'',
    bgFilter:{brightness:100, contrast:100, saturate:100, blur:0, overlay:35, fit:'cover', posX:50, posY:50,
      hue:0, gray:0, sepia:0, vignette:0, grain:0, zoom:100, rotate:0, invert:0, flipH:false, flipV:false},
    layers:[],
    appointments:[]
  };

  let state = {...defaults};
  try{
    const saved = localStorage.getItem('relogio-settings');
    if(saved) state = {...state, ...JSON.parse(saved)};
  }catch(e){}

  function save(){
    try{ localStorage.setItem('relogio-settings', JSON.stringify(state)); }catch(e){}
  }

  const accentColors = ['#7dd3fc','#f472b6','#a78bfa','#34d399','#fbbf24','#fb7185','#94a3b8','#ffffff'];

  function buildSwatches(){
    const wrap = $('accentSwatches');
    wrap.innerHTML = '';
    accentColors.forEach(c=>{
      const s = document.createElement('div');
      s.className = 'swatch' + (state.accent===c ? ' active':'');
      s.style.background = c;
      s.onclick = ()=>{ state.accent=c; applyState(); save(); };
      wrap.appendChild(s);
    });
  }

  function applyState(){
    const root = document.documentElement;
    root.style.setProperty('--accent', state.accent);
    root.style.setProperty('--font-clock', state.font);
    root.style.setProperty('--clock-scale', state.scale / 100);

    if(state.theme==='system'){
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', state.theme);
    }

    if(state.useCustomColors){
      root.style.setProperty('--bg', state.bg);
      root.style.setProperty('--fg', state.fg);
    } else {
      root.style.removeProperty('--bg');
      root.style.removeProperty('--fg');
    }

    $('fmt24').value = state.fmt24;
    $('themeSelect').value = state.theme;
    $('fontSelect').value = state.font;
    $('localeSelect').value = state.locale;
    $('bgColor').value = state.bg;
    $('fgColor').value = state.fg;
    $('scaleRange').value = state.scale;
    $('scaleValue').textContent = state.scale + '%';
    $('toggleSeconds').classList.toggle('on', state.showSeconds);
    $('toggleDate').classList.toggle('on', state.showDate);
    $('toggleAccentSeconds').classList.toggle('on', state.accentSeconds);
    $('modeSelect').value = state.mode;
    $('tz1').value = state.tz1;
    $('tz2').value = state.tz2;
    $('toggleWallpaper').classList.toggle('on', state.dynamicWallpaper);
    document.getElementById('time').style.display = state.mode==='analog' ? 'none' : '';
    document.getElementById('analogClock').style.display = state.mode==='analog' ? 'block' : 'none';

    applyBgImage();
    syncBgControls();
    renderLayers();
    $('bgImageMsg').textContent = state.bgImage ? 'Imagem definida ✓' : 'Nenhuma imagem definida.';

    if(state.textImage){
      timeEl.style.backgroundImage = `url(${state.textImage})`;
      timeEl.classList.add('text-image-fill');
    } else {
      timeEl.style.backgroundImage = '';
      timeEl.classList.remove('text-image-fill');
    }
    $('textImageMsg').textContent = state.textImage ? 'Imagem definida ✓' : 'Nenhuma imagem definida.';

    buildSwatches();
  }

  function pad(n){ return n.toString().padStart(2,'0'); }

  const RING_C = 2 * Math.PI * 140;
  const ringEl = $('ringProgress');
  ringEl.style.strokeDasharray = RING_C;

  function tick(){
    const now = new Date();
    let h = now.getHours();
    let ampm = '';
    if(state.fmt24==='12'){
      ampm = h>=12 ? ' PM' : ' AM';
      h = h % 12; if(h===0) h=12;
    }
    const m = pad(now.getMinutes());
    const s = pad(now.getSeconds());

    let html = `${state.fmt24==='12'?h:pad(h)}:${m}`;
    if(state.showSeconds){
      html += state.accentSeconds
        ? `<span class="accent">:${s}</span>`
        : `:${s}`;
    }
    html += ampm ? `<span style="font-size:.4em;opacity:.7;"> ${ampm.trim()}</span>` : '';
    timeEl.innerHTML = html;

    if(state.showDate){
      dateEl.style.display='';
      dateEl.textContent = now.toLocaleDateString(state.locale, {
        weekday:'long', day:'numeric', month:'long'
      });
    } else {
      dateEl.style.display='none';
    }

    const progress = (now.getSeconds()*1000 + now.getMilliseconds()) / 60000;
    ringEl.style.strokeDashoffset = RING_C * (1 - progress);
  }
  tick();
  setInterval(tick, 250);

  // Panel open/close
  function openPanel(){ panel.classList.add('open'); overlay.classList.add('show'); }
  function closePanelFn(){ panel.classList.remove('open'); overlay.classList.remove('show'); }
  gearBtn.onclick = openPanel;
  closePanel.onclick = closePanelFn;
  overlay.onclick = closePanelFn;

  // Fullscreen + tela sempre acesa + trava de orientação (celular)
  let wakeLock = null;
  async function enterFullscreenExtras(){
    try{
      if(screen.orientation && screen.orientation.lock){
        await screen.orientation.lock('landscape').catch(()=>{});
      }
    }catch(e){}
    try{
      if('wakeLock' in navigator){
        wakeLock = await navigator.wakeLock.request('screen');
      }
    }catch(e){}
  }
  function exitFullscreenExtras(){
    if(wakeLock){ wakeLock.release().catch(()=>{}); wakeLock=null; }
    try{ if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }catch(e){}
  }
  async function toggleFullscreen(){
    if(!document.fullscreenElement){
      await document.documentElement.requestFullscreen().catch(()=>{});
    } else {
      document.exitFullscreen().catch(()=>{});
    }
  }
  document.addEventListener('fullscreenchange', ()=>{
    if(document.fullscreenElement) enterFullscreenExtras();
    else exitFullscreenExtras();
  });
  document.addEventListener('visibilitychange', async ()=>{
    if(document.visibilityState==='visible' && document.fullscreenElement && !wakeLock && 'wakeLock' in navigator){
      try{ wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
    }
  });
  fsBtn.onclick = toggleFullscreen;
  clockWrap.onclick = toggleFullscreen;
  document.addEventListener('keydown', e=>{
    if(e.key.toLowerCase()==='f') toggleFullscreen();
    if(e.key==='Escape' && panel.classList.contains('open')) closePanelFn();
  });

  // Controls
  $('scaleRange').oninput = e=>{
    state.scale = parseInt(e.target.value, 10);
    $('scaleValue').textContent = state.scale + '%';
    document.documentElement.style.setProperty('--clock-scale', state.scale / 100);
  };
  $('scaleRange').onchange = ()=> save();

  $('fmt24').onchange = e=>{ state.fmt24=e.target.value; save(); };
  $('modeSelect').onchange = e=>{ state.mode=e.target.value; applyState(); save(); };
  $('tz1').onchange = e=>{ state.tz1=e.target.value; save(); };
  $('tz2').onchange = e=>{ state.tz2=e.target.value; save(); };
  $('toggleWallpaper').onclick = ()=>{ state.dynamicWallpaper=!state.dynamicWallpaper; applyState(); save(); };
  $('themeSelect').onchange = e=>{ state.theme=e.target.value; applyState(); save(); };
  $('fontSelect').onchange = e=>{ state.font=e.target.value; applyState(); save(); };
  $('localeSelect').onchange = e=>{ state.locale=e.target.value; save(); };
  $('bgColor').oninput = e=>{ state.bg=e.target.value; state.useCustomColors=true; applyState(); save(); };
  $('fgColor').oninput = e=>{ state.fg=e.target.value; state.useCustomColors=true; applyState(); save(); };

  $('toggleSeconds').onclick = ()=>{ state.showSeconds=!state.showSeconds; applyState(); save(); };
  $('toggleDate').onclick = ()=>{ state.showDate=!state.showDate; applyState(); save(); };
  $('toggleAccentSeconds').onclick = ()=>{ state.accentSeconds=!state.accentSeconds; applyState(); save(); };

  applyState();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }

  // Instalação
  const installBtn = $('installBtn'), installMsg = $('installMsg');
  let deferredPrompt = null;

  function setInstallState(){
    if(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone){
      installBtn.style.display = 'none';
      installMsg.textContent = 'Já instalado ✓';
      return;
    }
    if(deferredPrompt){
      installBtn.style.display = '';
      installMsg.textContent = '';
    } else {
      installBtn.style.display = '';
      installMsg.textContent = 'Se o botão não abrir o instalador, use o ícone ⛶/+ na barra de endereço do navegador.';
    }
  }

  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    setInstallState();
  });

  window.addEventListener('appinstalled', ()=>{
    deferredPrompt = null;
    setInstallState();
  });

  installBtn.onclick = async ()=>{
    if(deferredPrompt){
      deferredPrompt.prompt();
      const {outcome} = await deferredPrompt.userChoice;
      deferredPrompt = null;
      setInstallState();
    } else {
      installMsg.textContent = 'Procure o ícone de instalar (⛶ ou +) na barra de endereço do navegador.';
    }
  };

  setInstallState();

  // Modo flutuante (Picture-in-Picture) — funciona em Chrome/Edge desktop e Android
  const pipBtn = $('pipBtn'), pipMsg = $('pipMsg');
  const pipCanvas = document.createElement('canvas');
  pipCanvas.width = 480; pipCanvas.height = 220;
  const pipCtx = pipCanvas.getContext('2d');
  const pipVideo = document.createElement('video');
  pipVideo.muted = true; pipVideo.playsInline = true; pipVideo.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;';
  document.body.appendChild(pipVideo);
  let pipInterval = null;

  function pipColor(varName, fallback){
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
  }

  function drawPipFrame(){
    const now = new Date();
    let h = now.getHours(), ampm = '';
    if(state.fmt24==='12'){ ampm = h>=12 ? ' PM':' AM'; h = h%12; if(h===0) h=12; }
    let text = `${state.fmt24==='12'?h:pad(h)}:${pad(now.getMinutes())}`;
    if(state.showSeconds) text += `:${pad(now.getSeconds())}`;
    text += ampm;
    const bg = pipColor('--bg', '#0a0a0a'), fg = pipColor('--fg', '#f5f5f5');
    pipCtx.fillStyle = bg;
    pipCtx.fillRect(0, 0, pipCanvas.width, pipCanvas.height);
    pipCtx.fillStyle = fg;
    pipCtx.textAlign = 'center'; pipCtx.textBaseline = 'middle';
    pipCtx.font = `700 64px "Segoe UI", system-ui, sans-serif`;
    pipCtx.fillText(text, pipCanvas.width/2, pipCanvas.height/2);
  }

  async function togglePip(){
    if(document.pictureInPictureElement){
      await document.exitPictureInPicture();
      return;
    }
    if(!document.pictureInPictureEnabled){
      pipMsg.textContent = 'Modo flutuante não é suportado neste navegador. Funciona no Chrome ou Edge.';
      return;
    }
    drawPipFrame();
    pipVideo.srcObject = pipCanvas.captureStream(2);
    try{
      await pipVideo.play();
      await pipVideo.requestPictureInPicture();
      pipInterval = setInterval(drawPipFrame, 1000);
      pipMsg.textContent = 'Janela flutuante ativa.';
    }catch(err){
      pipMsg.textContent = 'Não foi possível abrir: ' + err.message;
    }
  }

  pipVideo.addEventListener('leavepictureinpicture', ()=>{
    if(pipInterval) clearInterval(pipInterval);
    pipMsg.textContent = 'Fica por cima de outros apps/janelas, inclusive fora do navegador. Tecla P alterna.';
  });

  pipBtn.onclick = togglePip;

  // ---------- Fusos horários extras ----------
  const tzList = [
    ['', 'Nenhum'], ['America/Sao_Paulo','São Paulo'], ['America/New_York','Nova York'],
    ['Europe/Lisbon','Lisboa'], ['Europe/London','Londres'], ['Asia/Tokyo','Tóquio'],
    ['Australia/Sydney','Sydney'], ['America/Los_Angeles','Los Angeles']
  ];
  [$('tz1'), $('tz2')].forEach(sel=>{
    tzList.forEach(([v,label])=>{
      const o = document.createElement('option'); o.value=v; o.textContent=label; sel.appendChild(o);
    });
  });

  function updateExtraClocks(){
    const box = $('extraClocks'); box.innerHTML='';
    [state.tz1, state.tz2].forEach(tz=>{
      if(!tz) return;
      const label = tzList.find(t=>t[0]===tz)?.[1] || tz;
      const t = new Date().toLocaleTimeString('pt-BR', {timeZone:tz, hour:'2-digit', minute:'2-digit'});
      const el = document.createElement('span');
      el.textContent = `${label}: ${t}`;
      box.appendChild(el);
    });
  }

  // ---------- Relógio analógico ----------
  const ticksG = $('ticks');
  for(let i=0;i<12;i++){
    const ang = i*30*Math.PI/180;
    const x1 = 100+80*Math.sin(ang), y1 = 100-80*Math.cos(ang);
    const x2 = 100+90*Math.sin(ang), y2 = 100-90*Math.cos(ang);
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',x1); line.setAttribute('y1',y1);
    line.setAttribute('x2',x2); line.setAttribute('y2',y2);
    line.setAttribute('class','tick'); line.setAttribute('stroke-width', i%3===0?3:1.5);
    ticksG.appendChild(line);
  }
  function updateAnalog(){
    if(state.mode!=='analog') return;
    const now = new Date();
    const h = now.getHours()%12, m = now.getMinutes(), s = now.getSeconds();
    const hDeg = h*30 + m*0.5, mDeg = m*6, sDeg = s*6;
    $('hourHand').setAttribute('transform', `rotate(${hDeg} 100 100)`);
    $('minHand').setAttribute('transform', `rotate(${mDeg} 100 100)`);
    $('secHand').setAttribute('transform', `rotate(${sDeg} 100 100)`);
  }

  // ---------- Papel de parede dinâmico ----------
  function updateWallpaper(){
    if(!state.dynamicWallpaper) return;
    const hr = new Date().getHours();
    let bg,fg;
    if(hr>=6 && hr<11){ bg='#0b1a2e'; fg='#eaf4ff'; }       // manhã: azul-marinho claro
    else if(hr>=11 && hr<17){ bg='#0d1524'; fg='#f0f6ff'; } // tarde: azul-marinho neutro
    else if(hr>=17 && hr<20){ bg='#1c1024'; fg='#ffd9a0'; } // entardecer: roxo/laranja escuro
    else { bg='#05050a'; fg='#e8e8f0'; }                    // noite: quase preto
    document.documentElement.style.setProperty('--bg', bg);
    document.documentElement.style.setProperty('--fg', fg);
  }

  // ---------- Cards do painel: data, dia do ano, fuso horário ----------
  function updateDashCards(){
    const now = new Date();
    $('cardDateWeekday').textContent = now.toLocaleDateString(state.locale, {weekday:'long'});
    $('cardDateFull').textContent = now.toLocaleDateString(state.locale, {day:'numeric', month:'long', year:'numeric'});

    const start = new Date(now.getFullYear(),0,0);
    const diff = now - start;
    const dayOfYear = Math.floor(diff/86400000);
    const totalDays = (new Date(now.getFullYear(),11,31)).getDate()===31 ? (isLeapYear(now.getFullYear())?366:365) : 365;
    $('yearProgressLabel').textContent = `${dayOfYear} / ${totalDays}`;
    $('yearProgressBar').style.width = (dayOfYear/totalDays*100)+'%';
    $('yearProgressRemaining').textContent = `${totalDays-dayOfYear} dias restantes`;

    const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMin = -now.getTimezoneOffset();
    const offsetH = (offsetMin>=0?'+':'-') + Math.floor(Math.abs(offsetMin)/60);
    $('tzLabel').textContent = `UTC${offsetH}`;
    $('tzSub').textContent = tzName;
  }
  function isLeapYear(y){ return (y%4===0 && y%100!==0) || y%400===0; }
  setInterval(updateDashCards, 60000);
  updateDashCards();

  // ---------- Próximos compromissos ----------
  function renderAppointments(){
    const now = new Date();
    const upcoming = state.appointments
      .filter(a=> new Date(a.datetime) >= now)
      .sort((a,b)=> new Date(a.datetime)-new Date(b.datetime))
      .slice(0,3);
    const list = $('apptList');
    if(upcoming.length===0){
      list.innerHTML = '<div class="dc-sub">Nenhum compromisso hoje</div>';
      return;
    }
    list.innerHTML = upcoming.map(a=>{
      const d = new Date(a.datetime);
      const dateLabel = d.toLocaleDateString(state.locale,{day:'2-digit',month:'2-digit'}) + ' ' + d.toLocaleTimeString(state.locale,{hour:'2-digit',minute:'2-digit'});
      return `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:6px;gap:6px;">
        <div><div class="dc-sub" style="opacity:0.9;">${a.title}</div><div class="dc-sub">${dateLabel}</div></div>
        <button data-id="${a.id}" class="apptDelete" style="background:none;border:none;color:var(--panel-fg);opacity:0.5;cursor:pointer;font-size:14px;flex-shrink:0;">✕</button>
      </div>`;
    }).join('');
    list.querySelectorAll('.apptDelete').forEach(btn=>{
      btn.onclick = ()=>{
        state.appointments = state.appointments.filter(a=>a.id!==btn.dataset.id);
        renderAppointments(); save();
      };
    });
  }
  $('apptAddBtn').onclick = ()=>{
    $('apptForm').style.display = $('apptForm').style.display==='none' ? 'block' : 'none';
  };
  $('apptSave').onclick = ()=>{
    const title = $('apptTitle').value.trim();
    const dt = $('apptDatetime').value;
    if(!title || !dt) return;
    state.appointments.push({id:Date.now().toString(), title, datetime:dt});
    $('apptTitle').value=''; $('apptDatetime').value='';
    $('apptForm').style.display='none';
    renderAppointments(); save();
  };
  renderAppointments();
  setInterval(renderAppointments, 60000);

  // ---------- Bateria (quando o navegador suportar) ----------
  if('getBattery' in navigator){
    navigator.getBattery().then(bat=>{
      function renderBattery(){
        const pct = Math.round(bat.level*100);
        $('batteryPct').textContent = pct+'%';
        $('batteryBar').style.width = pct+'%';
        $('batterySub').textContent = bat.charging ? 'Carregando' : 'Descarregando';
      }
      renderBattery();
      bat.addEventListener('levelchange', renderBattery);
      bat.addEventListener('chargingchange', renderBattery);
    }).catch(()=>{});
  }

  // ---------- Clima + nascer/pôr do sol (Open-Meteo, sem chave, sem servidor) ----------
  if('geolocation' in navigator){
    navigator.geolocation.getCurrentPosition(async pos=>{
      const {latitude, longitude} = pos.coords;
      try{
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        $('weatherTemp').textContent = Math.round(data.current.temperature_2m)+'°';
        $('weatherDesc').textContent = weatherCodeLabel(data.current.weather_code);
        $('sunrise').textContent = data.daily.sunrise[0].slice(11,16);
        $('sunset').textContent = data.daily.sunset[0].slice(11,16);
        try{
          const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&language=pt`);
          const geo = await geoRes.json();
          if(geo.results && geo.results[0]) $('weatherCity').textContent = geo.results[0].name;
          else $('weatherCity').textContent = 'Sua localização';
        }catch(e){ $('weatherCity').textContent = 'Sua localização'; }
      }catch(e){ $('weatherCity').textContent = 'Indisponível'; }
    }, ()=>{ $('weatherCity').textContent = 'Localização não permitida'; });
  } else {
    $('weatherCity').textContent = 'Não suportado';
  }
  function weatherCodeLabel(code){
    if(code===0) return 'Céu limpo';
    if([1,2,3].includes(code)) return 'Parcialmente nublado';
    if([45,48].includes(code)) return 'Neblina';
    if([51,53,55,61,63,65,80,81,82].includes(code)) return 'Chuva';
    if([71,73,75,77,85,86].includes(code)) return 'Neve';
    if([95,96,99].includes(code)) return 'Tempestade';
    return 'Nublado';
  }

  // ---------- Player de música (arquivos locais do seu celular/PC) ----------
  const audioPlayer = $('audioPlayer');
  let musicFiles = [], musicIndex = 0;
  $('musicChoose').onclick = ()=> $('musicFileInput').click();
  $('musicFileInput').onchange = e=>{
    musicFiles = Array.from(e.target.files);
    if(musicFiles.length){
      musicIndex = 0;
      loadMusic();
    }
  };
  function loadMusic(){
    const file = musicFiles[musicIndex];
    if(!file) return;
    audioPlayer.src = URL.createObjectURL(file);
    $('musicTitle').textContent = file.name.replace(/\.[^/.]+$/, '');
    $('musicCount').textContent = musicFiles.length>1 ? `Faixa ${musicIndex+1} de ${musicFiles.length}` : '';
    $('musicSeek').value = 0;
    $('musicCurrentTime').textContent = '0:00';
    $('musicDuration').textContent = '0:00';
    audioPlayer.play();
    $('musicPlay').textContent = '⏸';
    $('musicCover').style.animation = 'spin 3s linear infinite';
  }
  $('musicPlay').onclick = ()=>{
    if(!audioPlayer.src) return;
    if(audioPlayer.paused){ audioPlayer.play(); $('musicPlay').textContent='⏸'; $('musicCover').style.animation='spin 3s linear infinite'; }
    else { audioPlayer.pause(); $('musicPlay').textContent='▶'; $('musicCover').style.animation='none'; }
  };
  $('musicNext').onclick = ()=>{
    if(!musicFiles.length) return;
    musicIndex = (musicIndex+1)%musicFiles.length; loadMusic();
  };
  $('musicPrev').onclick = ()=>{
    if(!musicFiles.length) return;
    musicIndex = (musicIndex-1+musicFiles.length)%musicFiles.length; loadMusic();
  };
  audioPlayer.addEventListener('ended', ()=>{ if(musicFiles.length>1) $('musicNext').onclick(); else { $('musicPlay').textContent='▶'; $('musicCover').style.animation='none'; } });

  function fmtTime(sec){
    if(!isFinite(sec)) return '0:00';
    const m = Math.floor(sec/60), s = Math.floor(sec%60);
    return m+':'+String(s).padStart(2,'0');
  }
  let seekDragging = false;
  audioPlayer.addEventListener('timeupdate', ()=>{
    if(seekDragging) return;
    $('musicCurrentTime').textContent = fmtTime(audioPlayer.currentTime);
    if(audioPlayer.duration) $('musicSeek').value = (audioPlayer.currentTime/audioPlayer.duration)*100;
  });
  audioPlayer.addEventListener('loadedmetadata', ()=>{
    $('musicDuration').textContent = fmtTime(audioPlayer.duration);
  });
  $('musicSeek').addEventListener('input', ()=>{ seekDragging = true; });
  $('musicSeek').addEventListener('change', e=>{
    if(audioPlayer.duration) audioPlayer.currentTime = (e.target.value/100)*audioPlayer.duration;
    seekDragging = false;
  });

  // extend the main tick loop
  setInterval(()=>{ updateExtraClocks(); updateAnalog(); updateWallpaper(); }, 1000);
  updateExtraClocks(); updateAnalog(); updateWallpaper();

  // ---------- Widget de ferramentas (despertador / timer / cronômetro) ----------
  const toolWidget = $('toolWidget');
  function openTool(tab){
    toolWidget.classList.add('open');
    document.querySelectorAll('.tool-tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
    document.querySelectorAll('.tool-pane').forEach(p=>p.style.display='none');
    $('pane'+tab.charAt(0).toUpperCase()+tab.slice(1)).style.display='block';
  }
  $('openAlarm').onclick = ()=>openTool('alarm');
  $('openTimer').onclick = ()=>openTool('timer');
  $('openStopwatch').onclick = ()=>openTool('stopwatch');

  function showView(view){
    document.querySelectorAll('.nav-item').forEach(b=> b.classList.toggle('active', b.dataset.view===view));
    if(view==='clock'){
      toolWidget.classList.remove('open');
      clockWrap.style.display='';
    } else if(view==='settings' || view==='files'){
      openPanel();
      document.querySelector('.nav-item[data-view="clock"]').classList.add('active');
      if(view==='files'){
        const backupGroup = $('exportBtn').closest('.group');
        if(backupGroup) backupGroup.scrollIntoView({behavior:'smooth', block:'center'});
      }
    } else {
      clockWrap.style.display='none';
      openTool(view);
    }
  }
  document.querySelectorAll('.nav-item').forEach(btn=>{
    btn.onclick = ()=> showView(btn.dataset.view);
  });
  $('alarmIconBtn').onclick = ()=> showView('alarm');
  $('toolClose').onclick = ()=> showView('clock');
  document.querySelectorAll('.tool-tab').forEach(b=> b.onclick = ()=>openTool(b.dataset.tab));

  function beep(){
    try{
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.15;
      o.start(); setTimeout(()=>{ o.stop(); ctx.close(); }, 500);
    }catch(e){}
  }

  // Despertador
  let alarmActive = false, alarmFiredMinute = null;
  $('alarmToggle').onclick = ()=>{
    alarmActive = !alarmActive;
    $('alarmToggle').textContent = alarmActive ? 'Desativar' : 'Ativar';
    $('alarmStatus').textContent = alarmActive ? `Tocará às ${$('alarmTime').value || '--:--'}` : '';
  };
  setInterval(()=>{
    if(!alarmActive) return;
    const now = new Date();
    const hm = pad(now.getHours())+':'+pad(now.getMinutes());
    if(hm === $('alarmTime').value && alarmFiredMinute !== hm){
      alarmFiredMinute = hm;
      beep();
      $('alarmStatus').textContent = '⏰ Alarme! ' + hm;
      openTool('alarm');
      document.body.style.animation = 'none';
    }
  }, 1000);

  // Timer (contagem regressiva)
  let timerSeconds = 5*60, timerRunning = false, timerHandle = null;
  function renderTimer(){
    const m = Math.floor(timerSeconds/60), s = timerSeconds%60;
    $('timerDisplay').textContent = pad(m)+':'+pad(s);
  }
  $('timerMinutes').oninput = e=>{ if(!timerRunning){ timerSeconds = (parseInt(e.target.value,10)||1)*60; renderTimer(); } };
  $('timerStart').onclick = ()=>{
    if(timerRunning){
      clearInterval(timerHandle); timerRunning=false; $('timerStart').textContent='Iniciar';
    } else {
      timerRunning=true; $('timerStart').textContent='Pausar';
      timerHandle = setInterval(()=>{
        timerSeconds--;
        if(timerSeconds<=0){ clearInterval(timerHandle); timerRunning=false; $('timerStart').textContent='Iniciar'; beep(); timerSeconds=0; }
        renderTimer();
      },1000);
    }
  };
  $('timerReset').onclick = ()=>{
    clearInterval(timerHandle); timerRunning=false; $('timerStart').textContent='Iniciar';
    timerSeconds = (parseInt($('timerMinutes').value,10)||5)*60; renderTimer();
  };
  renderTimer();

  // Cronômetro
  let swMs = 0, swRunning = false, swHandle = null, swLast = 0;
  function renderSw(){
    const totalMs = swMs;
    const m = Math.floor(totalMs/60000), s = Math.floor((totalMs%60000)/1000), d = Math.floor((totalMs%1000)/100);
    $('swDisplay').textContent = pad(m)+':'+pad(s)+'.'+d;
  }
  $('swStart').onclick = ()=>{
    if(swRunning){
      clearInterval(swHandle); swRunning=false; $('swStart').textContent='Iniciar';
    } else {
      swRunning=true; $('swStart').textContent='Pausar'; swLast = Date.now();
      swHandle = setInterval(()=>{
        const now=Date.now(); swMs += now-swLast; swLast=now; renderSw();
      },100);
    }
  };
  $('swReset').onclick = ()=>{ clearInterval(swHandle); swRunning=false; swMs=0; $('swStart').textContent='Iniciar'; renderSw(); };
  renderSw();

  // ---------- Backup: exportar / importar configurações ----------
  $('exportBtn').onclick = ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='relogio-config.json'; a.click();
    URL.revokeObjectURL(url);
  };
  $('importBtn').onclick = ()=> $('importFile').click();
  $('importFile').onchange = e=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const imported = JSON.parse(reader.result);
        state = {...defaults, ...imported};
        applyState(); save();
      }catch(err){ alert('Arquivo inválido.'); }
    };
    reader.readAsText(file);
  };

  // ---------- Atalhos de teclado extras ----------
  document.addEventListener('keydown', e=>{
    if(panel.contains(document.activeElement) && document.activeElement.tagName!=='BODY') return;
    if(e.key==='ArrowUp'){ state.scale=Math.min(200,state.scale+5); applyState(); save(); }
    if(e.key==='ArrowDown'){ state.scale=Math.max(40,state.scale-5); applyState(); save(); }
    if(e.key.toLowerCase()==='a'){ state.mode = state.mode==='analog'?'digital':'analog'; applyState(); save(); }
  });

  document.addEventListener('keydown', e=>{
    if(e.key.toLowerCase()==='p' && !panel.contains(document.activeElement)) togglePip();
  });

  // ---------- Imagem de fundo / imagem dentro do texto ----------
  function resizeImageFile(file, maxDim, quality){
    return new Promise((resolve, reject)=>{
      const img = new Image();
      const reader = new FileReader();
      reader.onload = ()=>{
        img.onload = ()=>{
          let w = img.width, h = img.height;
          if(w > h && w > maxDim){ h = h*(maxDim/w); w = maxDim; }
          else if(h > maxDim){ w = w*(maxDim/h); h = maxDim; }
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  $('bgImageChoose').onclick = ()=> $('bgImageInput').click();
  $('bgImageInput').onchange = async e=>{
    const file = e.target.files[0]; if(!file) return;
    $('bgImageMsg').textContent = 'Processando...';
    try{
      state.bgImage = await resizeImageFile(file, 1600, 0.75);
      applyState(); save();
    }catch(err){ $('bgImageMsg').textContent = 'Não foi possível carregar essa imagem.'; }
  };
  $('bgImageRemove').onclick = ()=>{ state.bgImage=''; applyState(); save(); };

  $('textImageChoose').onclick = ()=> $('textImageInput').click();
  $('textImageInput').onchange = async e=>{
    const file = e.target.files[0]; if(!file) return;
    $('textImageMsg').textContent = 'Processando...';
    try{
      state.textImage = await resizeImageFile(file, 900, 0.8);
      applyState(); save();
    }catch(err){ $('textImageMsg').textContent = 'Não foi possível carregar essa imagem.'; }
  };
  $('textImageRemove').onclick = ()=>{ state.textImage=''; applyState(); save(); };

  // ---------- Filtros da imagem de fundo ----------
  function filterCss(f){
    return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) hue-rotate(${f.hue}deg) grayscale(${f.gray}%) sepia(${f.sepia}%) blur(${f.blur}px) invert(${f.invert}%)`;
  }

  // Textura de grão gerada uma vez localmente (sem download)
  let grainDataUrl = null;
  function getGrainDataUrl(){
    if(grainDataUrl) return grainDataUrl;
    const cv = document.createElement('canvas'); cv.width=140; cv.height=140;
    const cx = cv.getContext('2d');
    const id = cx.createImageData(140,140);
    for(let i=0;i<id.data.length;i+=4){
      const v = Math.random()*255;
      id.data[i]=v; id.data[i+1]=v; id.data[i+2]=v; id.data[i+3]=255;
    }
    cx.putImageData(id,0,0);
    grainDataUrl = cv.toDataURL('image/png');
    return grainDataUrl;
  }

  function applyBgImage(){
    const f = state.bgFilter;
    const img = $('bgImg');
    if(state.bgImage){
      img.src = state.bgImage;
      img.style.display = 'block';
      img.style.objectFit = f.fit;
      img.style.objectPosition = f.posX+'% '+f.posY+'%';
      img.style.filter = filterCss(f);
      img.style.transform = `scale(${(f.zoom/100)*(f.flipH?-1:1)}, ${(f.zoom/100)*(f.flipV?-1:1)}) rotate(${f.rotate}deg)`;
      img.style.transformOrigin = 'center center';
      $('bgOverlay').style.opacity = f.overlay/100;
      $('bgVignette').style.opacity = f.vignette/100;
      const grainEl = $('bgGrain');
      grainEl.style.backgroundImage = `url(${getGrainDataUrl()})`;
      grainEl.style.opacity = f.grain/100 * 0.5;
    } else {
      img.style.display = 'none';
      $('bgOverlay').style.opacity = 0;
      $('bgVignette').style.opacity = 0;
      $('bgGrain').style.opacity = 0;
    }
  }
  function syncBgControls(){
    const f = state.bgFilter;
    $('bgBrightness').value=f.brightness; $('vBrightness').textContent=f.brightness+'%';
    $('bgContrast').value=f.contrast; $('vContrast').textContent=f.contrast+'%';
    $('bgSaturate').value=f.saturate; $('vSaturate').textContent=f.saturate+'%';
    $('bgBlur').value=f.blur; $('vBlur').textContent=f.blur+'px';
    $('bgOverlayRange').value=f.overlay; $('vOverlay').textContent=f.overlay+'%';
    $('bgPosX').value=f.posX; $('vPosX').textContent=f.posX+'%';
    $('bgPosY').value=f.posY; $('vPosY').textContent=f.posY+'%';
    $('bgFit').value=f.fit;
    $('bgHue').value=f.hue; $('vHue').textContent=f.hue+'°';
    $('bgGray').value=f.gray; $('vGray').textContent=f.gray+'%';
    $('bgSepia').value=f.sepia; $('vSepia').textContent=f.sepia+'%';
    $('bgVignetteRange').value=f.vignette; $('vVignette').textContent=f.vignette+'%';
    $('bgGrainRange').value=f.grain; $('vGrain').textContent=f.grain+'%';
    $('bgZoom').value=f.zoom; $('vZoom').textContent=f.zoom+'%';
    $('bgRotate').value=f.rotate; $('vRotate').textContent=f.rotate+'°';
    $('bgInvert').classList.toggle('on', f.invert>0);
    $('bgFlipH').classList.toggle('on', f.flipH);
    $('bgFlipV').classList.toggle('on', f.flipV);
  }
  const bgSliderMap = {
    bgBrightness:['brightness','vBrightness','%'], bgContrast:['contrast','vContrast','%'],
    bgSaturate:['saturate','vSaturate','%'], bgBlur:['blur','vBlur','px'],
    bgOverlayRange:['overlay','vOverlay','%'], bgPosX:['posX','vPosX','%'], bgPosY:['posY','vPosY','%']
  };
  Object.keys(bgSliderMap).forEach(id=>{
    const [key, out, unit] = bgSliderMap[id];
    $(id).oninput = e=>{
      state.bgFilter[key] = parseInt(e.target.value,10);
      $(out).textContent = e.target.value+unit;
      applyBgImage();
    };
    $(id).onchange = ()=> save();
  });
  $('bgFit').onchange = e=>{ state.bgFilter.fit=e.target.value; applyBgImage(); save(); };

  const bgSliderMap2 = {
    bgHue:['hue','vHue','°'], bgGray:['gray','vGray','%'], bgSepia:['sepia','vSepia','%'],
    bgVignetteRange:['vignette','vVignette','%'], bgGrainRange:['grain','vGrain','%'],
    bgZoom:['zoom','vZoom','%'], bgRotate:['rotate','vRotate','°']
  };
  Object.keys(bgSliderMap2).forEach(id=>{
    const [key, out, unit] = bgSliderMap2[id];
    $(id).oninput = e=>{
      state.bgFilter[key] = parseInt(e.target.value,10);
      $(out).textContent = e.target.value+unit;
      applyBgImage();
    };
    $(id).onchange = ()=> save();
  });
  $('bgInvert').onclick = ()=>{ state.bgFilter.invert = state.bgFilter.invert>0?0:100; applyBgImage(); syncBgControls(); save(); };
  $('bgFlipH').onclick = ()=>{ state.bgFilter.flipH = !state.bgFilter.flipH; applyBgImage(); syncBgControls(); save(); };
  $('bgFlipV').onclick = ()=>{ state.bgFilter.flipV = !state.bgFilter.flipV; applyBgImage(); syncBgControls(); save(); };

  const bgPresets = {
    none:   {brightness:100,contrast:100,saturate:100,hue:0,gray:0,sepia:0,vignette:0,grain:0,overlay:35},
    bw:     {gray:100,contrast:115},
    vintage:{sepia:35,contrast:95,saturate:85,vignette:30,grain:20},
    warm:   {saturate:120,brightness:106,sepia:12,hue:352},
    cool:   {saturate:105,brightness:100,hue:12,contrast:105},
    dramatic:{contrast:140,saturate:70,vignette:45},
    faded:  {contrast:80,saturate:70,brightness:112,overlay:12},
    cinema: {contrast:115,saturate:90,sepia:10,vignette:35},
    polaroid:{sepia:20,contrast:95,saturate:112,vignette:15,grain:15}
  };
  document.querySelectorAll('.preset-chip').forEach(chip=>{
    chip.onclick = ()=>{
      const p = bgPresets[chip.dataset.preset];
      state.bgFilter = {...defaults.bgFilter, ...p};
      applyBgImage(); syncBgControls(); save();
    };
  });

  // ---------- Imagens soltas (camadas arrastáveis) ----------
  const editModeBtn = $('editModeBtn');
  const layerToolbar = $('layerToolbar');
  let selectedLayerId = null;

  function renderLayers(){
    layersContainer.innerHTML = '';
    state.layers.forEach(layer=>{
      const el = document.createElement('img');
      el.src = layer.src;
      el.className = 'layer-img';
      el.dataset.id = layer.id;
      el.style.left = layer.x+'%';
      el.style.top = layer.y+'%';
      el.style.width = layer.scale+'px';
      el.style.transform = `translate(-50%,-50%) rotate(${layer.rotation}deg)`;
      el.style.opacity = layer.opacity/100;
      el.style.zIndex = layer.z;
      el.style.filter = filterCss(layer.filters);
      el.style.border = layer.borderW ? `${layer.borderW}px solid #fff` : 'none';
      el.style.borderRadius = (layer.borderRadius||0)+'%';
      layersContainer.appendChild(el);
    });
  }

  function selectLayer(id){
    selectedLayerId = id;
    const layer = state.layers.find(l=>l.id===id);
    if(!layer){ layerToolbar.classList.remove('open'); return; }
    layerToolbar.classList.add('open');
    $('layerScale').value = layer.scale;
    $('layerRotation').value = layer.rotation;
    $('layerOpacity').value = layer.opacity;
    const f = layer.filters;
    $('lyBrightness').value=f.brightness; $('lyContrast').value=f.contrast; $('lySaturate').value=f.saturate;
    $('lyHue').value=f.hue; $('lyGray').value=f.gray; $('lySepia').value=f.sepia; $('lyBlur').value=f.blur;
    $('lyBorder').value=layer.borderW; $('lyRadius').value=layer.borderRadius;
    $('lyInvert').classList.toggle('on', f.invert>0);
  }

  let dragInfo = null;
  layersContainer.addEventListener('pointerdown', e=>{
    if(!document.body.classList.contains('edit-mode')) return;
    const el = e.target.closest('.layer-img');
    if(!el) return;
    selectLayer(el.dataset.id);
    dragInfo = {id: el.dataset.id, startX:e.clientX, startY:e.clientY};
    el.setPointerCapture(e.pointerId);
  });
  layersContainer.addEventListener('pointermove', e=>{
    if(!dragInfo) return;
    const layer = state.layers.find(l=>l.id===dragInfo.id);
    if(!layer) return;
    const dxPct = (e.clientX-dragInfo.startX)/window.innerWidth*100;
    const dyPct = (e.clientY-dragInfo.startY)/window.innerHeight*100;
    layer.x = Math.min(100, Math.max(0, layer.x+dxPct));
    layer.y = Math.min(100, Math.max(0, layer.y+dyPct));
    dragInfo.startX = e.clientX; dragInfo.startY = e.clientY;
    renderLayers();
  });
  layersContainer.addEventListener('pointerup', ()=>{ if(dragInfo){ dragInfo=null; save(); } });

  editModeBtn.onclick = ()=>{
    document.body.classList.toggle('edit-mode');
    editModeBtn.classList.toggle('active');
    const active = document.body.classList.contains('edit-mode');
    editModeBtn.textContent = active ? '🖼 Desativar modo de edição' : '🖼 Ativar modo de edição';
    if(!active){ layerToolbar.classList.remove('open'); selectedLayerId=null; }
  };

  $('addLayerBtn').onclick = ()=> $('layerImageInput').click();
  $('layerImageInput').onchange = async e=>{
    const file = e.target.files[0]; if(!file) return;
    try{
      const src = await resizeImageFile(file, 900, 0.85);
      const maxZ = state.layers.reduce((m,l)=>Math.max(m,l.z),0);
      state.layers.push({id:Date.now().toString(), src, x:50, y:50, scale:220, rotation:0, opacity:100, z:maxZ+1,
        filters:{brightness:100,contrast:100,saturate:100,hue:0,gray:0,sepia:0,blur:0,invert:0}, borderW:0, borderRadius:0});
      if(!document.body.classList.contains('edit-mode')) editModeBtn.click();
      applyState(); save();
    }catch(err){}
  };

  ['layerScale','layerRotation','layerOpacity'].forEach(id=>{
    $(id).oninput = e=>{
      const layer = state.layers.find(l=>l.id===selectedLayerId);
      if(!layer) return;
      const prop = id==='layerScale'?'scale':id==='layerRotation'?'rotation':'opacity';
      layer[prop] = parseInt(e.target.value,10);
      renderLayers();
    };
    $(id).onchange = ()=> save();
  });
  $('layerFront').onclick = ()=>{
    const layer = state.layers.find(l=>l.id===selectedLayerId);
    if(!layer) return;
    const maxZ = state.layers.reduce((m,l)=>Math.max(m,l.z),0);
    layer.z = maxZ+1; renderLayers(); save();
  };
  $('layerDelete').onclick = ()=>{
    state.layers = state.layers.filter(l=>l.id!==selectedLayerId);
    selectedLayerId=null; layerToolbar.classList.remove('open');
    renderLayers(); save();
  };

  $('layerMoreBtn').onclick = ()=> $('layerExtra').classList.toggle('open');

  const laySliderMap = {
    lyBrightness:'brightness', lyContrast:'contrast', lySaturate:'saturate',
    lyHue:'hue', lyGray:'gray', lySepia:'sepia', lyBlur:'blur'
  };
  Object.keys(laySliderMap).forEach(id=>{
    $(id).oninput = e=>{
      const layer = state.layers.find(l=>l.id===selectedLayerId);
      if(!layer) return;
      layer.filters[laySliderMap[id]] = parseInt(e.target.value,10);
      renderLayers();
    };
    $(id).onchange = ()=> save();
  });
  $('lyBorder').oninput = e=>{
    const layer = state.layers.find(l=>l.id===selectedLayerId);
    if(!layer) return;
    layer.borderW = parseInt(e.target.value,10);
    renderLayers();
  };
  $('lyBorder').onchange = ()=> save();
  $('lyRadius').oninput = e=>{
    const layer = state.layers.find(l=>l.id===selectedLayerId);
    if(!layer) return;
    layer.borderRadius = parseInt(e.target.value,10);
    renderLayers();
  };
  $('lyRadius').onchange = ()=> save();
  $('lyInvert').onclick = ()=>{
    const layer = state.layers.find(l=>l.id===selectedLayerId);
    if(!layer) return;
    layer.filters.invert = layer.filters.invert>0?0:100;
    $('lyInvert').classList.toggle('on', layer.filters.invert>0);
    renderLayers(); save();
  };
})();
