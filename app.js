'use strict';

// === INYECTADO: Helpers de validación y PDF + envío por Gmail (GAS) ===
function __isValidTcsEmail(v){
  const domain = (window.TCS_DOMAIN || "@tcs.com").toLowerCase();
  const s = String(v||'').trim().toLowerCase();
  if(!/\S+@\S+\.\S+/.test(s)) return false;
  return s.endsWith(domain);
}
function __isValidFullName(v){
  const s = String(v||'').trim();
  return s.split(/\s+/).filter(p=>p.length>=2).length >= 2;
}
function __blobToDataURL(blob){
  return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(blob); });
}
async function __buildPdfBlob({items, answers, scorePct, passed, startedAt, finishedAt, userEmail, fullName}){
  const { jsPDF } = window.jspdf || {};
  if(!jsPDF) throw new Error('jsPDF no encontrado');
  const doc = new jsPDF({unit:'pt', format:'a4'});
  const pad=(n)=> String(n).padStart(2,'0');
  const dt=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const left=48, width=500, line=18; let y=64;
  doc.setFontSize(16); doc.text('Reporte de Examen (42 preguntas)', left, y); y+=26;
  doc.setFontSize(11);
  doc.text(`Nombre: ${fullName||'-'}`, left, y); y+=line;
  doc.text(`Correo: ${userEmail||'-'}`, left, y); y+=line;
  doc.text(`Inicio: ${dt(startedAt)}  |  Fin: ${dt(finishedAt)}`, left, y); y+=line;
  doc.text(`Puntaje: ${scorePct.toFixed(2)}%  |  Estado: ${passed?'APROBADO':'DESAPROBADO'}`, left, y); y+=24;
  (items||[]).forEach((it,i)=>{
    const need=(it.answer_letters||[]).slice().sort();
    const got =((answers||[])[i]||[]).slice().sort();
    const ok = JSON.stringify(need)===JSON.stringify(got);
    const qline = `${i+1}. ${it.question||''}`;
    const givenText=(it.options||[]).filter(o=>got.includes(o.label)).map(o=>`${(o.label||'').toUpperCase()}) ${o.text||''}`).join(' | ')||'—';
    const corrText =(it.options||[]).filter(o=>need.includes(o.label)).map(o=>`${(o.label||'').toUpperCase()}) ${o.text||''}`).join(' | ')||'—';
    doc.setFont(undefined, 'normal');
    doc.splitTextToSize(qline, width).forEach(t=>{ doc.text(t, left, y); y+=line;});
    doc.setFontSize(10);
    doc.text(`Marcadas: ${givenText}`, left, y); y+=line;
    doc.text(`Correctas: ${corrText}    => ${ok?'✓':'✗'}`, left, y); y+=line+6;
    if(y>760){ doc.addPage(); y=64; }
  });
  return doc.output('blob');
}
async function __sendResultsViaGmail({ pdfBlob, userEmail, fullName, scorePct, passed }) {
  const endpoint = String(window.GAS_ENDPOINT||"").trim();
  if(!endpoint){ throw new Error("Configura window.GAS_ENDPOINT en index.html"); }
  const dataUrl = await __blobToDataURL(pdfBlob);
  const subject = `${fullName} - desarrollo seguro - ${userEmail}`;
  const payload = { subject, message: `Puntaje: ${scorePct.toFixed(2)}% | Estado: ${passed ? "APROBADO" : "DESAPROBADO"}`, filename: "reporte_examen.pdf", base64: dataUrl };
  await fetch(endpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  try{ if(window.__diag) window.__diag('Correo enviado vía Gmail (Apps Script).'); }catch(_){}
}


/** ========= CONFIG ========= */
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000; // 2h

/** ========= HELPERS ========= */
const $ = (id)=>document.getElementById(id);
const escapeHtml = (s)=> String(s).replace(/[&<>\"']/g, c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
}[c]));
const pad = (n)=> String(n).padStart(2,'0');
const shuffle = (arr)=>{ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; };
const pickN = (arr,n)=> shuffle(arr).slice(0,n);
const flattenBank = (x)=>{ const out=[]; (function w(y){ Array.isArray(y) ? y.forEach(w) : out.push(y)})(x); return out; };
const diag = (msg)=>{ const el=$('diag'); if(el){ el.textContent += msg + "\n"; } console.log('[diag]', msg); };

// CSV helpers
function csvEscape(v){ const s = String(v ?? ''); return `"${s.replace(/"/g,'""')}"`; }
function buildCsvReport(items, answers){
  const header = [
    'Nro','Pregunta','Tipo','Opciones (label:text)',
    'Correctas (letras)','Marcadas (letras)','Estado',
    'Respuesta correcta (expandida)','Justificacion'
  ];
  const rows = [header];
  for(let i=0;i<items.length;i++){
    const it = items[i]||{};
    const qn = it.numero || (i+1);
    const tipo = (Array.isArray(it.answer_letters) && it.answer_letters.length>1) ? 'Multiple' : 'Unica';
    const opciones = (it.options||[]).map(o=>`${(o.label||'').toUpperCase()}: ${o.text||''}`).join(' | ');
    const correctas = (it.answer_letters||[]).slice().sort();
    const marcadas = (answers[i]||[]).slice().sort();
    const estado = JSON.stringify(correctas)===JSON.stringify(marcadas) ? 'Correcta' : 'Incorrecta';
    const correctasTexto = (it.options||[]).filter(o=>correctas.includes(o.label)).map(o=>`${o.label.toUpperCase()}. ${o.text||''}`).join(' | ');
    const just = it.justificacion ? String(it.justificacion) : '';
    rows.push([ qn, it.question||'', tipo, opciones, correctas.join(','), marcadas.join(','), estado, correctasTexto, just ].map(csvEscape));
  }
  return rows.map(r=>r.join(',')).join('\r\n');
}

/** ========= STATE ========= */
let EXAM = {
  items: [], i: 0, answers: [], deadline: 0, timerId: null, reportBlob: null,
  recording: { rec:null, chunks:[], stream:null, stopped:false }
};

/** ========= APP ========= */
document.addEventListener('DOMContentLoaded', () => {

  // === INYECTADO: Envío automático de PDF al mostrar resultados ===
  const __results = document.getElementById('results');
  if(__results){
    const __observer = new MutationObserver(async ()=>{
      try{
        const visible = getComputedStyle(__results).display !== 'none';
        if(!visible) return;
        // Intento de construir nota a partir de variables conocidas del app original
        // Buscamos estructuras comunes: EXAM (si existe) y helpers disponibles
        let items = (typeof EXAM!=='undefined' && EXAM.items) ? EXAM.items : (typeof window.TODAS!=='undefined' ? (Array.isArray(window.TODAS)?window.TODAS:[]) : []);
        let answers = (typeof EXAM!=='undefined' && EXAM.answers) ? EXAM.answers : [];
        let total = (items||[]).length || (Number(document.getElementById('qTotal')?.textContent)||42);
        // Calcular correctas si podemos
        let correct = 0;
        if(items && items.length && answers && answers.length){
          for(let i=0;i<items.length;i++){
            const need=(items[i].answer_letters||[]).slice().sort();
            const got =(answers[i]||[]).slice().sort();
            if(JSON.stringify(need)===JSON.stringify(got)) correct++;
          }
        } else {
          correct = 0; // fallback si no es accesible
        }
        const scorePct = total ? (correct/total)*100 : 0;
        const passed = total ? (correct >= Math.ceil(0.7*total)) : false;
        const startedAt = (typeof EXAM!=='undefined' && EXAM.startedAt) ? EXAM.startedAt : (window.__EXTRA_USER?.startedAt || new Date());
        const finishedAt = new Date();
        const userEmail = window.__EXTRA_USER?.email || '';
        const fullName  = window.__EXTRA_USER?.fullName || '';

        // No reenviar si ya lo hicimos
        if(__results.__mailSent) return;
        const pdfBlob = await __buildPdfBlob({ items, answers, scorePct, passed, startedAt, finishedAt, userEmail, fullName });
        await __sendResultsViaGmail({ pdfBlob, userEmail, fullName, scorePct, passed });
        __results.__mailSent = true;
      }catch(e){ console.error('Error al enviar PDF por Gmail:', e); }
    });
    __observer.observe(__results, { attributes:true, attributeFilter:['style','class'] });
  }


  // === INYECTADO: Capturar nombre y correo al iniciar ===
  document.getElementById('btnStart')?.addEventListener('click', ()=>{
    const em = String(__emailInput?.value||'').trim();
    const nm = String(__nameInput?.value||'').trim();
    if(!__isValidTcsEmail(em)) { alert('Ingresa un correo TCS válido (p.ej., usuario@tcs.com)'); return; }
    if(!__isValidFullName(nm)) { alert('Ingresa tu nombre y apellido completos'); return; }
    try{ window.__EXTRA_USER = { email: em, fullName: nm, startedAt: new Date() }; }catch(_){ window.__EXTRA_USER = { email: em, fullName: nm, startedAt: new Date() }; }
  }, { capture: true });


  // === INYECTADO: Validación de correo y nombre para habilitar "Empezar examen" ===
  window.__diag = (msg)=>{ try{ const el=document.getElementById('diag'); if(el){ el.textContent += msg + "\n"; } }catch(_){}};
  const __emailInput = document.getElementById('studentEmail');
  const __nameInput  = document.getElementById('studentFullName');
  const __btnStart   = document.getElementById('btnStart');
  function __refreshStart(){ const ok = __isValidTcsEmail(__emailInput?.value) && __isValidFullName(__nameInput?.value); if(__btnStart) __btnStart.disabled = !ok; }
  __emailInput?.addEventListener('input', __refreshStart);
  __nameInput?.addEventListener('input', __refreshStart);
  __refreshStart();

  diag('DOM listo');

  const welcome = $('welcome'), exam = $('exam'), results = $('results');
  const qTitle=$('qTitle'), qText=$('qText'), options=$('options'), qIndex=$('qIndex'), qTotal=$('qTotal'), modePill=$('modePill');
  const btnStart=$('btnStart'), btnNext=$('btnNext'), btnFinish=$('btnFinish'), btnRestart=$('btnRestart');
  const timerEl=$('timer'), bar=$('bar'), scoreEl=$('score'), passStatus=$('passStatus');
  const btnCam=$('btnCam'), cam=$('cam'), btnRecord=$('btnRecord'), btnExport=$('btnExport');

  const BANK = (typeof TODAS !== 'undefined') ? TODAS : (typeof window!=='undefined' ? window.TODAS : undefined);

  // Seguridad del contexto (requerido para cámara/grabación)
  const isSecure = location.protocol==='https:' || location.hostname==='localhost' || location.hostname==='127.0.0.1';
  if(!isSecure){ diag('Aviso: No es contexto seguro. Cámara/Grabación pueden fallar. Usa HTTPS o localhost.'); }
  btnCam && (btnCam.disabled = !isSecure);
  btnRecord && (btnRecord.disabled = !isSecure);

  // ========== Cámara ==========
  btnCam?.addEventListener('click', async ()=>{
    try{
      const stream = await navigator.mediaDevices.getUserMedia({video:true,audio:false});
      cam.srcObject=stream; cam.style.display='block';
      btnCam.disabled=true; btnCam.textContent='Cámara activa';
      diag('Cámara activada');
    }catch(e){ alert('No se pudo activar la cámara: '+e.message); }
  });

  // ========== Grabación (pantalla + audio) ==========
  btnRecord?.addEventListener('click', async ()=>{
    // Si ya está grabando, paramos y esperamos flush
    if(EXAM.recording.rec && EXAM.recording.rec.state!=='inactive'){
      await stopRecording(); // espera a onstop para que se llenen los chunks
      btnRecord.textContent='Grabación lista';
      btnRecord.disabled=true;
      return;
    }
    try{
      const display = await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
      EXAM.recording.stream = display;
      EXAM.recording.chunks = [];
      EXAM.recording.stopped = false;

      // mimeType fallback por compatibilidad
      let mime = 'video/webm; codecs=vp9,opus';
      if(!MediaRecorder.isTypeSupported?.(mime)){
        mime = 'video/webm;codecs=vp8,opus';
      }
      if(!MediaRecorder.isTypeSupported?.(mime)){
        mime = 'video/webm';
      }

      const rec = new MediaRecorder(display,{mimeType:mime});
      rec.ondataavailable = e=>{ if(e.data && e.data.size>0) EXAM.recording.chunks.push(e.data); };
      rec.onstop = ()=>{ EXAM.recording.stopped = true; diag('Grabación detenida (onstop)'); };
      rec.start();
      EXAM.recording.rec = rec;
      btnRecord.textContent='Detener grabación';
      diag('Grabación iniciada');
    }catch(e){ alert('No se pudo iniciar la grabación: '+e.message); }
  });

  async function stopRecording(){
    const rec = EXAM?.recording?.rec;
    if(!rec || rec.state==='inactive'){ return; }
    diag('Deteniendo grabación...');
    await new Promise(res=>{
      const done = ()=>{ rec.removeEventListener('stop', done); res(); };
      try{ rec.addEventListener('stop', done, {once:true}); rec.stop(); }
      catch(_){ res(); }
    });
    try{ EXAM.recording.stream?.getTracks?.().forEach(t=>t.stop()); }catch(_){}
  }

  // ========== Empezar examen ==========
  btnStart?.addEventListener('click', ()=>{
    const flat = flattenBank(BANK || []);
    if(!flat.length){ alert('No hay banco de preguntas cargado.'); return; }

    EXAM.items = pickN(flat, 42);
    EXAM.i = 0;
    EXAM.answers = Array(EXAM.items.length).fill(null);
    qTotal.textContent = String(EXAM.items.length);

    const qs = new URLSearchParams(location.search);
    const overrideMin = parseInt(qs.get('mins'));
    const duration = Number.isFinite(overrideMin) ? overrideMin*60*1000 : DEFAULT_DURATION_MS;
    EXAM.deadline = Date.now()+duration;

    startTimer();
    welcome.style.display='none';
    results.style.display='none';
    exam.style.display='block';
    renderQuestion();
  });

  // ========== Navegación de preguntas ==========
  btnNext?.addEventListener('click', (e)=>{
    e.preventDefault();
    const selected = [...options.querySelectorAll('input:checked')].map(x=>x.value);
    if(selected.length===0){ alert('Selecciona al menos una opción.'); return; }
    EXAM.answers[EXAM.i] = selected.sort();
    if(EXAM.i === EXAM.items.length-1){ finalize('manual'); }
    else { EXAM.i++; renderQuestion(); }
  });

  btnFinish?.addEventListener('click', (e)=>{
    e.preventDefault();
    if(confirm('¿Deseas finalizar el examen? No podrás volver atrás.')) finalize('manual');
  });

  btnRestart?.addEventListener('click', ()=> location.reload());

  // ========== Exportaciones ==========
  $('btnDownload')?.addEventListener('click', async ()=>{
    // Si aún no paró, párala y espera
    if(EXAM?.recording?.rec && EXAM.recording.rec.state!=='inactive'){
      await stopRecording();
    }
    const chunks = EXAM?.recording?.chunks || [];
    if(!chunks.length){ alert('No hay grabación disponible. Si estabas grabando, espera 1–2 segundos y vuelve a intentar.'); return; }
    const blob = new Blob(chunks, {type:'video/webm'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `examen-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.webm`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 10000);
  });

  $('btnExport')?.addEventListener('click', ()=>{
    if(!EXAM.reportBlob){ alert('Aún no hay reporte. Finaliza un examen para generar el CSV.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(EXAM.reportBlob);
    a.download = `reporte-examen-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 10000);
  });

  $('btnExportPDF')?.addEventListener('click', ()=>{
    if(!EXAM.items?.length){ alert('Aún no hay reporte. Finaliza un examen para generar el PDF.'); return; }
    const scoreText = $('score')?.textContent || '';
    const passText = $('passStatus')?.textContent || '';
    exportPDF(EXAM.items, EXAM.answers, scoreText, passText);
  });

  // ========== Render pregunta ==========
  function renderQuestion(){
    const item = EXAM.items[EXAM.i];
    qIndex.textContent = String(EXAM.i+1);
    qTitle.textContent = `Pregunta ${EXAM.i+1}`;
    qText.textContent = item.question;
    const multi = (item.answer_letters||[]).length>1;
    modePill.textContent = multi ? 'Selección múltiple' : 'Única respuesta';
    const opts = shuffle((item.options||[]).map(o=>({label:o.label, text:o.text})));
    options.innerHTML = '';
    opts.forEach(o=>{
      const type = multi ? 'checkbox' : 'radio';
      options.insertAdjacentHTML('beforeend',
        `<label class="opt"><input type="${type}" name="q" value="${o.label}"><div><strong>${o.label.toUpperCase()}.</strong> ${escapeHtml(o.text||'')}</div></label>`);
    });
    btnNext.textContent = (EXAM.i===EXAM.items.length-1) ? 'Finalizar →' : 'Continuar →';
  }

  // ========== Temporizador ==========
  function startTimer(){
    const totalMs = Math.max(EXAM.deadline - Date.now(), 0);
    tick();
    EXAM.timerId = setInterval(tick, 1000);
    function tick(){
      const left = Math.max(EXAM.deadline - Date.now(), 0);
      const s = Math.floor(left/1000)%60, m=Math.floor(left/(60*1000))%60, h=Math.floor(left/(60*60*1000));
      timerEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
      bar.style.width = `${Math.max(0, Math.min(1, 1 - (left/(totalMs||1))))*100}%`;
      timerEl.style.background = left < 5*60*1000 ? 'rgba(239,68,68,.2)' : '';
      if(left<=0){ finalize('time'); }
    }
  }

  // ========== Finalizar y puntaje ==========
  async function finalize(reason){
    clearInterval(EXAM.timerId);

    // 1) Parar grabación (si estaba activa) y cámara
    await stopRecording();
    try{
      if(cam && cam.srcObject){ cam.srcObject.getTracks().forEach(t=>t.stop()); cam.srcObject=null; }
      cam.style.display='none';
    }catch(_){}

    // 2) Calcular nota
    const total = EXAM.items.length;
    let correct = 0;
    for(let i=0;i<total;i++){
      const need = (EXAM.items[i].answer_letters||[]).slice().sort();
      const got  = (EXAM.answers[i]||[]).slice().sort();
      if(JSON.stringify(need)===JSON.stringify(got)) correct++;
    }
    const nota = (correct/total)*20;
    scoreEl.textContent = `${nota.toFixed(2)} / 20 (aciertos: ${correct}/${total})`;

    // 70% para aprobar
    const required = Math.ceil(0.7 * total);
    const pass = correct >= required;
    if(passStatus){
      passStatus.textContent = pass
        ? `Aprobado ✅ ¡Felicitaciones! (${correct}/${total}, requiere ${required})`
        : `No aprobado ❌ (${correct}/${total}, requiere ${required})`;
      passStatus.style.background = pass ? 'rgba(34,197,94,.18)' : 'rgba(239,68,68,.18)';
      passStatus.style.borderColor = pass ? 'rgba(34,197,94,.45)' : 'rgba(239,68,68,.45)';
    }

    // 3) Construir CSV para exportación
    try{
      const csv = buildCsvReport(EXAM.items, EXAM.answers);
      EXAM.reportBlob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    }catch(e){
      console.error('CSV build error', e);
      EXAM.reportBlob = null;
    }

    // 4) Mostrar resultados
    exam.style.display='none';
    results.style.display='block';
  }

  // ========== Generar PDF simple (sin justificación) ==========
  
function exportPDF(items, answers, scoreText, passText){
  const rows = items.map((it, i)=>{
    const correctLetters = (it.answer_letters||[]).slice().sort();
    const givenLetters = (answers[i]||[]).slice().sort();
    const isCorrect = JSON.stringify(correctLetters) === JSON.stringify(givenLetters);
    const correctText = (it.options||[])
       .filter(o=>correctLetters.includes(o.label))
       .map(o=>`${o.label.toUpperCase()}. ${escapeHtml(o.text||'')}`)
       .join(' | ');
    const givenText = (it.options||[])
       .filter(o=>givenLetters.includes(o.label))
       .map(o=>`${o.label.toUpperCase()}. ${escapeHtml(o.text||'')}`)
       .join(' | ') || '—';
    const estado = isCorrect ? 'Correcta' : 'Incorrecta';
    return { num: i+1, q: it.question||'', givenText, correctText, estado };
  });

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>Reporte de examen</title>
    <style>
      body{font-family:system-ui,Segoe UI,Roboto,Arial;padding:24px}
      h1{margin:0 0 8px} .muted{color:#555}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:12px;vertical-align:top}
      th{background:#f3f4f6}
      .pill{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid #ccc;font-size:12px}
    </style></head><body>
    <h1>Reporte de examen</h1>
    <div class="muted">Nota: <strong>${escapeHtml(scoreText)}</strong></div>
    <div class="pill" style="margin-top:6px">${escapeHtml(passText||'')}</div>
    <table>
      <thead><tr><th>#</th><th>Pregunta</th><th>Respuesta dada</th><th>Respuesta correcta</th><th>Estado</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td>${r.num}</td>
        <td>${escapeHtml(r.q)}</td>
        <td>${escapeHtml(r.givenText)}</td>
        <td>${escapeHtml(r.correctText)}</td>
        <td>${escapeHtml(r.estado)}</td>
      </tr>`).join('')}</tbody>
    </table>
    <script>window.print();</script>
  </body></html>`;

  const w = window.open('', '_blank');
  if(!w){ alert('Permite ventanas emergentes para exportar a PDF.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
});