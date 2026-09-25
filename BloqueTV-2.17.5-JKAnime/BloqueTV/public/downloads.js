import { displayText } from './display-text.js';
const localId=()=>window.crypto?.randomUUID?.()||`local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const ACTIVE=new Set(['preparing','requested','ready','starting','transferring']);
const LABELS={preparing:'Comprobando fuente',requested:'Esperando al navegador',ready:'Lista para iniciar',starting:'Conectando',transferring:'Transfiriendo',transferred:'Transferido al navegador',interrupted:'Interrumpida',error:'No se pudo descargar',cancelled:'Cancelada',expired:'Sesión caducada',legacy:'Enviada anteriormente'};
export function formatBytes(value) {
  if(!Number.isFinite(Number(value))||value===null) return 'Tamaño no indicado';
  const n=Number(value);if(n<1024)return `${n} B`;
  const i=Math.min(3,Math.floor(Math.log(n)/Math.log(1024)));
  return `${(n/1024**i).toFixed(i>1?1:0)} ${['B','KB','MB','GB'][i]}`;
}

export function createDownloads({esc,toast,onChange}) {
  const escText=value=>esc(displayText(value));
  let entries=[];try {const data=JSON.parse(localStorage.getItem('nexus2:downloads')||'[]');if(Array.isArray(data))entries=data.filter(x=>x&&typeof x.url==='string').map(x=>({...x,id:x.id||localId(),state:x.state||'legacy'}));}catch{}
  let filter='all',polling=false,dialog=null,preparing=null;
  const persist=()=>{try{localStorage.setItem('nexus2:downloads',JSON.stringify(entries));}catch{}onChange?.(entries.filter(x=>ACTIVE.has(x.state)).length);};
  const active=x=>ACTIVE.has(x.state);
  const request=async(url,options={})=>{const res=await fetch(url,options);const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.error||'No se pudo conectar con el servidor.'),{status:res.status});return data;};
  function help() {
    const d=document.createElement('dialog');d.className='nexus-dialog';d.innerHTML=`<div class="dialog-head"><div><span class="eyebrow">EN TU DISPOSITIVO</span><h2>Descargas del navegador</h2></div><button class="icon-button" aria-label="Cerrar">×</button></div><p>Al iniciar una descarga, BloqueTV entrega el archivo al navegador que estás usando.</p><div class="browser-shortcut"><kbd>Ctrl</kbd> + <kbd>J</kbd><span>Chrome, Edge y Firefox en Windows</span></div><p>En móvil, abre el menú del navegador y elige <strong>Descargas</strong>. En Mac, usa el menú del navegador.</p><p class="muted">Desde ese panel puedes ver el archivo guardado y abrir su carpeta. BloqueTV muestra la transferencia al navegador; la ubicación y el guardado final los gestiona tu navegador.</p><button class="btn btn-primary help-close">Entendido</button>`;
    document.body.append(d);d.querySelectorAll('button').forEach(b=>b.onclick=()=>d.close());d.addEventListener('close',()=>d.remove());d.showModal();
  }
  function row(x) {
    const percent=x.totalSegments?Math.floor((x.segments||0)/x.totalSegments*100):x.contentLength?Math.min(100,Math.floor((x.bytes||0)/x.contentLength*100)):null;
    const inFlight=active(x);const transferred=x.state==='transferred';
    return `<article class="transfer-row" data-transfer="${esc(x.id)}"><div class="transfer-icon ${transferred?'done':''}">${transferred?'✓':x.state==='error'?'!':'↓'}</div><div class="transfer-copy"><div class="transfer-title"><h3>${escText(x.title||x.filename||'Video')}</h3><span class="transfer-status ${esc(x.state)}">${esc(LABELS[x.state]||x.state)}</span></div><p>${escText(x.filename||x.source||'Video')} <span>· ${new Date(x.at).toLocaleDateString('es-DO',{day:'numeric',month:'short'})}</span></p>${inFlight||transferred?`<progress max="100" ${percent!==null||transferred?`value="${transferred?100:percent}"`:''} aria-label="Progreso de transferencia"></progress><div class="transfer-metrics"><span>${formatBytes(x.bytes||0)}${x.contentLength?` de ${formatBytes(x.contentLength)}`:''}${x.totalSegments?` · ${x.segments||0}/${x.totalSegments} fragmentos`:''}</span><span>${x.state==='transferring'&&x.speed?`${formatBytes(x.speed)}/s`:transferred?'Entrega finalizada':percent!==null?`${percent}%`:''}</span></div>`:''}${x.error?`<p class="transfer-error">${escText(x.error)}</p>`:''}${x.state==='requested'&&Date.now()-x.at>15000?'<p class="muted">Si no se inició, permite las descargas en el navegador y pulsa Reintentar.</p>':''}</div><div class="transfer-actions">${inFlight?`<button data-cancel="${esc(x.id)}" data-focus="cancel-${esc(x.id)}" class="btn btn-ghost">Cancelar</button>${x.state==='requested'?`<button data-retry="${esc(x.id)}" data-focus="retry-${esc(x.id)}" class="text-button">Reintentar</button>`:''}`:`<button data-retry="${esc(x.id)}" data-focus="retry-${esc(x.id)}" class="btn btn-ghost">${transferred||x.state==='legacy'?'Descargar otra vez':'Reintentar'}</button><button data-remove="${esc(x.id)}" data-focus="remove-${esc(x.id)}" class="text-button" aria-label="Quitar ${escText(x.title)} del historial">Quitar</button>`}</div></article>`;
  }
  function refresh() {
    const root=document.querySelector('#downloadCenter');if(!root)return;
    const focus=document.activeElement?.dataset.focus;
    const list=entries.filter(x=>filter==='all'||filter==='active'&&active(x)||filter==='done'&&['transferred','legacy'].includes(x.state)||filter==='issues'&&!active(x)&&!['transferred','legacy'].includes(x.state));
    root.querySelector('#transferList').innerHTML=list.length?list.map(row).join(''):`<div class="downloads-empty"><div class="empty-symbol">↓</div><h2>${entries.length?'No hay descargas en esta vista':'Tus videos, también para llevar'}</h2><p>${entries.length?'Las transferencias aparecerán aquí según su estado.':'Abre un video y pulsa Descargar, o añade aquí un enlace directo.'}</p></div>`;
    root.querySelector('#downloadTotal').textContent=entries.length;
    root.querySelector('#downloadActive').textContent=entries.filter(active).length;
    root.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.filter===filter);b.setAttribute('aria-pressed',String(b.dataset.filter===filter));});
    root.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>cancelEntry(b.dataset.cancel));
    root.querySelectorAll('[data-retry]').forEach(b=>b.onclick=async()=>{const x=entries.find(e=>e.id===b.dataset.retry);if(!x)return;if(active(x)){await cancelEntry(x.id);if(active(x))return;}open({url:x.url,type:x.type,pageUrl:x.pageUrl,label:x.source},x.title);});
    root.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{entries=entries.filter(x=>x.id!==b.dataset.remove);persist();refresh();});
    if(focus)root.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
  }
  async function cancelEntry(id) {
    const x=entries.find(x=>x.id===id);if(!x)return;
    try {if(x.jobId)Object.assign(x,await request(`/api/download-cancel?id=${encodeURIComponent(x.jobId)}`,{method:'POST'}),{id});else x.state='cancelled';persist();refresh();toast('Transferencia cancelada.');}
    catch(e){toast(e.message);}
  }
  function render(container) {
    container.innerHTML=`<section id="downloadCenter"><div class="workspace-heading"><div><span class="eyebrow">TU BLOQUETV / DESCARGAS</span><h1>Centro de descargas</h1><p>De tu pantalla a tu dispositivo. Todo en un mismo lugar.</p></div><button id="browserHelp" class="btn btn-ghost">Mi navegador ↗</button></div><div class="download-overview"><div><span class="overview-icon">↓</span><div><strong id="downloadActive">0</strong><span>en curso</span></div></div><div><span class="overview-icon">▤</span><div><strong id="downloadTotal">0</strong><span>en el historial</span></div></div><div class="destination-info"><span class="status-dot ok"></span><div><strong>Gestor del navegador</strong><span>Guarda en la carpeta que tengas configurada</span></div></div></div><form id="directDownloadForm" class="direct-download-form"><label for="directDownloadUrl">Añadir un enlace de video</label><div><input id="directDownloadUrl" type="url" required placeholder="https://…/video.mp4 o una fuente HLS" autocomplete="url"><button class="btn btn-primary">Preparar descarga <span>↓</span></button></div></form><div class="download-toolbar"><div class="segmented" aria-label="Filtrar descargas"><button data-filter="all" class="active">Todas</button><button data-filter="active">En curso</button><button data-filter="done">Transferidas</button><button data-filter="issues">Incidencias</button></div><button id="clearDownloads" class="text-button">Limpiar historial</button></div><div id="transferList"></div><p class="download-footnote">El progreso indica los datos entregados al navegador. Consulta su panel de descargas para confirmar que el archivo se guardó. Puedes seguir explorando BloqueTV mientras se transfiere.</p></section>`;
    container.querySelector('#browserHelp').onclick=help;
    container.querySelector('#directDownloadForm').onsubmit=e=>{e.preventDefault();const value=container.querySelector('#directDownloadUrl').value.trim();open({url:value,type:/\.m3u8(?:[?#]|$)/i.test(value)?'hls':'file',label:'Enlace directo'},'BloqueTV');};
    container.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;refresh();});
    container.querySelector('#clearDownloads').onclick=()=>{const removed=entries.filter(x=>!active(x));entries=entries.filter(active);persist();refresh();if(removed.length)toast('Historial limpiado; los archivos de tu dispositivo se conservan.');};
    refresh();
  }
  async function open(source,title='Video') {
    title=displayText(title,'Video');
    if(!source?.url)return toast('La fuente no tiene un enlace descargable.');
    if(source.type==='youtube')return toast('Este enlace de YouTube no admite descarga desde BloqueTV.');
    let valid;try {valid=new URL(source.url);}catch{return toast('Usa un enlace HTTP o HTTPS válido.');}
    if(!['http:','https:'].includes(valid.protocol)||valid.username||valid.password)return toast('Usa un enlace HTTP o HTTPS público.');
    const duplicate=entries.find(x=>x.url===source.url&&active(x));
    if(duplicate)return toast('Esta fuente ya tiene una descarga pendiente. Revísala en Descargas.');
    dialog?.close();const controller=new AbortController();preparing=controller;
    const d=document.createElement('dialog');dialog=d;d.className='nexus-dialog';
    d.innerHTML=`<div class="dialog-head"><div><span class="eyebrow">DESCARGA NATIVA</span><h2>Preparar video</h2></div><button class="icon-button" id="closeDownloadDialog" aria-label="Cerrar">×</button></div><p class="dialog-video-title">${escText(title)}</p><div id="downloadPreparation" aria-live="polite"><div class="preparing-download"><span class="loader-dot"></span><div><strong>Comprobando la fuente</strong><p>Verificando formato y disponibilidad…</p></div></div></div>`;
    document.body.append(d);d.querySelector('#closeDownloadDialog').onclick=()=>d.close();d.addEventListener('close',()=>{controller.abort();d.remove();if(dialog===d)dialog=null;});d.showModal();
    const params=new URLSearchParams({url:source.url,filename:title});if(source.pageUrl)params.set('referer',source.pageUrl);
    try {
      const info=await request(`/api/download-info?${params}`,{signal:controller.signal});if(!d.open)return;
      const box=d.querySelector('#downloadPreparation');
      box.innerHTML=`<div class="prepared-file"><div class="file-symbol">↓</div><div><strong>${escText(info.filename)}</strong><span>${info.kind==='hls'?'HLS · video por fragmentos':'Archivo de video'} · ${formatBytes(info.contentLength)}</span></div></div><dl class="download-facts"><div><dt>Destino</dt><dd>Descargas de tu navegador</dd></div><div><dt>Reanudación</dt><dd>${info.resumable?'Disponible si la fuente mantiene el enlace':'Reiniciar si se interrumpe'}</dd></div></dl>${info.kind==='hls'?'<p class="muted">Los fragmentos se unirán durante la descarga. El tamaño total puede no estar disponible.</p>':''}<a id="startNativeDownload" class="btn btn-primary download-start" href="${esc(info.downloadUrl)}" download="${esc(info.filename)}">↓ Iniciar descarga en el navegador</a><p class="dialog-note">Puedes revisar la transferencia desde el centro de descargas de BloqueTV.</p>`;
      box.querySelector('#startNativeDownload').onclick=e=>{
        if(entries.some(x=>x.jobId===info.id)){e.preventDefault();return;}
        const entry={...info,id:info.id,jobId:info.id,title,source:source.provider||source.label||valid.hostname,url:source.url,type:source.type||'file',pageUrl:source.pageUrl||'',at:Date.now(),state:'requested',bytes:0};
        entries=[entry,...entries].slice(0,100);persist();refresh();toast('Solicitud enviada. Revisa Descargas para ver el progreso.');setTimeout(()=>d.close(),150);
      };
      box.querySelector('#startNativeDownload').focus();
    }catch(e){if(controller.signal.aborted)return;d.querySelector('#downloadPreparation').innerHTML=`<div class="download-failure"><strong>No se pudo preparar este video</strong><p>${escText(e.message)}</p></div><p class="muted">Cierra este aviso y elige otro servidor dentro del reproductor.</p>`;}
    finally{if(preparing===controller)preparing=null;}
  }
  async function poll() {
    if(polling)return;const pending=entries.filter(x=>x.jobId&&(active(x)||x.state==='interrupted'));
    if(!pending.length)return;polling=true;
    try {
      await Promise.allSettled(pending.map(async x=>{
        try {const status=await request(`/api/download-status?id=${encodeURIComponent(x.jobId)}`,{signal:AbortSignal.timeout(8000)});const before=x.state;const id=x.id;Object.assign(x,status,{id});if(status.state==='ready'&&before==='requested')x.state='requested';if(before!==x.state&&x.state==='transferred')toast(`Transferencia finalizada: ${x.title}`);x.pollErrors=0;}
        catch(e){if(e.status===404){x.state='expired';x.error='El servidor se reinició o la sesión caducó. Puedes reintentar.';}else{x.pollErrors=(x.pollErrors||0)+1;if(x.pollErrors>4)x.error='No se pudo consultar el progreso. Comprueba el panel del navegador.';}}
      }));persist();refresh();
    }finally{polling=false;}
  }
  setInterval(poll,1500);persist();poll();
  return {open,render,help};
}
