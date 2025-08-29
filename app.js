// SpendFree PWA v3
const LS_KEY = 'spendfree_v3';
const FACTORS = {'Daily':30.44,'Weekly':4.345,'Bi-Weekly':2.17,'Monthly':1,'Quarterly':1/3,'Half-Yearly':1/6,'Yearly':1/12};
const INR = new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2});

// ---- Library availability & fallbacks ----

function libsReady(){
  const badge = document.getElementById('libStatus');
  if (badge){
    if (window.Chart) { badge.textContent = 'Chart.js ready'; }
    else { badge.textContent = 'Chart.js missing (fallback enabled)'; }
  }
  return !!window.Chart;
}
// Simple canvas fallback if Chart.js is missing
function drawFallbackChart(values){
  const canvas = document.getElementById('kpiChart');
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.offsetWidth; const h = canvas.height = 220;
  ctx.clearRect(0,0,w,h);
  const labels = ['Income','Outflows','Contingency','Safe'];
  const max = Math.max(1, ...values);
  const barW = Math.min(80, (w-60)/values.length - 20);
  const colors = ['#3b82f6','#ef4444','#f59e0b','#22c55e'];
  values.forEach((v,i)=>{
    const x = 40 + i*(barW+20);
    const barH = (v/max)*(h-60);
    ctx.fillStyle = colors[i];
    ctx.fillRect(x, h-30-barH, barW, barH);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted') || '#888';
    ctx.fillText(labels[i], x, h-12);
  });
}


// ----- Theme -----
(function initTheme(){
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('themeToggle');
  btn.textContent = saved==='dark' ? '🌙' : '☀️';
  btn.addEventListener('click', ()=>{
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur==='dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    btn.textContent = next==='dark' ? '🌙' : '☀️';
  });
})();

// ----- IndexedDB for documents -----
let idb;
function idbOpen(){
  return new Promise((res,rej)=>{
    const req = indexedDB.open('spendfree_docs',1);
    req.onupgradeneeded = ()=>{ const db=req.result; db.createObjectStore('files',{keyPath:'id'}); };
    req.onsuccess=()=>{ idb=req.result; res(); }; req.onerror=()=>rej(req.error);
  });
}


// ----- File type guard -----
const ALLOWED_MIME_PREFIX = ['image/','text/'];
const ALLOWED_MIME_EXACT = new Set(['application/pdf']);
const ALLOWED_EXT = new Set(['.pdf','.txt','.md','.markdown','.csv','.log','.json','.png','.jpg','.jpeg','.gif','.webp','.svg','.heic','.heif','.bmp']);
function isAllowedNameType(name, type){
  type = type || '';
  const t = type.toLowerCase();
  if (ALLOWED_MIME_PREFIX.some(p=> t.startsWith(p))) return true;
  if (ALLOWED_MIME_EXACT.has(t)) return true;
  const dot = (name||'').lastIndexOf('.');
  if (dot !== -1){
    const ext = (name||'').slice(dot).toLowerCase();
    if (ALLOWED_EXT.has(ext)) return true;
  }
  return false;
}

async function saveFiles(entryId, fileList){
  // Pre-read all file ArrayBuffers BEFORE opening a transaction to avoid Firefox auto-commit issues.
  if(!fileList || !fileList.length) return;
  await idbOpen();
  const filesArr = Array.from(fileList);
  const allowed = filesArr.filter(f => isAllowedNameType(f.name, f.type));
  const skipped = filesArr.length - allowed.length;
  const recs = await Promise.all(allowed.map(async f => {
    const buf = await f.arrayBuffer();
    return { id: crypto.randomUUID(), entryId, name:f.name, type:f.type, data: buf };
  }));
  if (skipped>0) { toast(`${skipped} file(s) skipped (only text, image, or PDF allowed)`); }
  const tx = idb.transaction('files','readwrite');
  const store = tx.objectStore('files');
  for(const rec of recs){ store.put(rec); }
  await new Promise((resolve, reject)=>{
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
    tx.onabort = ()=> reject(tx.error);
  });
}
async function listFiles(entryId){
  await idbOpen(); const tx=idb.transaction('files','readonly'); const store=tx.objectStore('files');
  return new Promise((res)=>{
    const out=[]; const req=store.openCursor();
    req.onsuccess=()=>{ const cur=req.result; if(!cur) return res(out); const v=cur.value; if(v.entryId===entryId) out.push(v); cur.continue(); };
  });
}

async function deleteFilesForEntry(entryId){
  await idbOpen();
  const files = await listFiles(entryId); // pre-read in separate txn
  if(!files.length) return;
  const tx = idb.transaction('files','readwrite');
  const store = tx.objectStore('files');
  for(const f of files){ store.delete(f.id); }
  await new Promise((resolve, reject)=>{
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
    tx.onabort = ()=> reject(tx.error);
  });
}
function openBlobInNewTab(rec){
  const blob = new Blob([rec.data], {type:rec.type||'application/octet-stream'});
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(()=> URL.revokeObjectURL(url), 60_000);
}


// ----- Docs cache & helpers -----
const docCache = new Map();
async function refreshDocCount(entryId){
  const files = await listFiles(entryId);
  docCache.set(entryId, files.length);
  return files.length;
}
async function getAllFilesRecords(){
  await idbOpen();
  return new Promise((resolve, reject)=>{
    const tx = idb.transaction('files','readonly');
    const store = tx.objectStore('files');
    const out = [];
    const req = store.openCursor();
    req.onsuccess = ()=>{
      const cur = req.result;
      if(!cur){ resolve(out); return; }
      out.push(cur.value);
      cur.continue();
    };
    req.onerror = ()=> reject(req.error);
  });
}
function bufToB64(buf){
  const bytes = new Uint8Array(buf);
  let binary = ''; for (let i=0;i<bytes.byteLength;i++){ binary += String.fromCharCode(bytes[i]); }
  return btoa(binary);
}
function b64ToBuf(b64){
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for(let i=0;i<len;i++){ bytes[i] = binary.charCodeAt(i); }
  return bytes.buffer;
}

// ----- Store -----
const store = { settings:{ refMonth: toYYYYMM(new Date()), contingencyFixed: 0 }, incomes:[], outflows:[], contingencies:[], sources:[] };
function save(){ localStorage.setItem(LS_KEY, JSON.stringify(store)); }
function load(){
  const s = localStorage.getItem(LS_KEY);
  if(s){ const o=JSON.parse(s); Object.assign(store.settings,o.settings||{}); store.incomes=o.incomes||[]; store.outflows=o.outflows||[]; store.contingencies=o.contingencies||[]; store.sources=o.sources||[]; }
}
function uid(){ return crypto.randomUUID(); }

// ----- Helpers -----
const qs = (s)=>document.querySelector(s);
function toYYYYMM(d){ const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`; }
function fromMonthInput(v){ if(!v) return null; const [y,m]=v.split('-').map(Number); return new Date(y,m-1,1); }
function refMonthDate(){ const [y,m]=store.settings.refMonth.split('-').map(Number); return new Date(y,m-1,1); }
function inWindow(ref, start, dur){ if(!start||!dur) return false; const s=fromMonthInput(start); const e=new Date(s); e.setMonth(e.getMonth()+Number(dur)); return ref>=s && ref<e; }
const round2 = n => Math.round((Number(n||0) + Number.EPSILON) * 100) / 100;
const allowedRec = ['Daily','Weekly','Bi-Weekly','Monthly','Quarterly','Half-Yearly','Yearly','One-Time'];

// ----- Monthly Portion -----
function monthlyPortion(entry, ref, type, incomeTotalForCont=0){
  const { amount, recurrence, startMonth, durationMonths } = entry;
  if(amount === '' || amount === null || amount === undefined) return 0;
  if(type==='cont' && Number(amount) <= 1){
    return recurrence==='One-Time'
      ? (inWindow(ref,startMonth,durationMonths) ? round2(Number(amount) * incomeTotalForCont) : 0)
      : round2(Number(amount) * incomeTotalForCont);
  }
  const amt = Number(amount);
  if(recurrence === 'One-Time'){
    return inWindow(ref,startMonth,durationMonths) ? round2(amt / Number(durationMonths)) : 0;
  }
  const f = FACTORS[recurrence] ?? 1; return round2(amt * f);
}

// ----- Compute KPIs -----
function compute(){
  const ref = refMonthDate();
  const incomeParts = store.incomes.map(e => monthlyPortion(e, ref, 'inc'));
  const incomeTotal = round2(incomeParts.reduce((a,b)=>a+b,0));
  const outParts = store.outflows.map(e => monthlyPortion(e, ref, 'out'));
  const outflowTotal = round2(outParts.reduce((a,b)=>a+b,0));
  const contParts = store.contingencies.map(e => monthlyPortion(e, ref, 'cont', incomeTotal));
  const contAlloc = round2(store.contingencies.reduce((s,e,i)=> s + ((Number(e.amount)<=1)? contParts[i] : 0), 0));
  const contGoals = round2(store.contingencies.reduce((s,e,i)=> s + ((Number(e.amount)>1)? contParts[i] : 0), 0));
  const contFixed = round2(Number(store.settings.contingencyFixed||0));
  const contTotal = round2(contFixed + contAlloc + contGoals);
  const safe = round2(incomeTotal - (outflowTotal + contTotal));
  return { incomeTotal, outflowTotal, contFixed, contAlloc, contGoals, contTotal, safe };
}

// ----- Rendering -----
let chart;
function render(){
  const { incomeTotal, outflowTotal, contFixed, contAlloc, contGoals, contTotal, safe } = compute();
  qs('#kpi-income').textContent = INR.format(incomeTotal);
  qs('#kpi-outflow').textContent = INR.format(outflowTotal);
  qs('#kpi-cont').textContent = INR.format(contTotal);
  qs('#kpi-cont-fixed').textContent = INR.format(contFixed);
  qs('#kpi-cont-alloc').textContent = INR.format(contAlloc);
  qs('#kpi-cont-goals').textContent = INR.format(contGoals);
  qs('#kpi-safe').textContent = INR.format(safe);
  updateChart(incomeTotal, outflowTotal, contTotal, safe);

  renderTable('tbl-income', store.incomes, 'inc');
  // Auto-select first source if sources exist (for scenario 2)
  const autoSelectFirst = store.sources.length > 0;
  populateSourceSelects(null, autoSelectFirst);
  renderTable('tbl-outflow', store.outflows, 'out');
  renderTable('tbl-cont', store.contingencies, 'cont');
  renderTable('tbl-source', store.sources, 'src');

  qs('#refMonth').value = store.settings.refMonth;
  qs('#contFixed').value = store.settings.contingencyFixed;
}
function renderTable(id, rows, type){
  const el = qs('#'+id);
  const headers = type==='src'
    ? ['Name','Type','Note?','Docs?','Docs','', '', '']
    : (type==='inc'
        ? ['Title','Amount','Recurrence','Note?','Has Docs?','Monthly Portion','', '', '']
        : ['Title','Amount','Recurrence','Note?','Has Docs?','Monthly Portion','', '', '']);
  el.innerHTML = `<thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>`;
  const body = document.createElement('tbody'); const ref = refMonthDate(); const incTotal = compute().incomeTotal;
  rows.forEach((r,idx)=>{
    const mp = (type==='src') ? 0 : monthlyPortion(r, ref, type==='cont'?'cont':'row', incTotal);
    const tr = document.createElement('tr');
    if(type==='src'){
      tr.innerHTML = `
        <td>${r.name||''}</td>
        <td>${r.type||''}</td>
        <td>${(r.note && r.note.trim())?'Yes':'No'}</td>
        <td><button class="btn ghost" data-docs="${r.id}">Open</button></td>
        <td><button class="btn ghost" data-view="${type}:${r.id}">View</button></td>
        <td><button class="btn" data-edit="${type}:${r.id}">Edit</button></td>
        <td><button class="btn danger" data-del="${type}:${r.id}">Delete</button></td>`;
    } else {
      const amtLabel = (type==='cont' && Number(r.amount)<=1) ? (Number(r.amount)*100).toFixed(2)+'%' : INR.format(Number(r.amount||0));
      tr.innerHTML = `
        <td>${r.title||''}</td>
        <td class="num">${amtLabel}</td>
        <td>${r.recurrence||''}</td>
        <td>${(r.note && r.note.trim())?'Yes':'No'}</td>
        <td>${mp > 0 ? 'Yes' : 'No'}</td>
        <td class="num">${INR.format(mp)}</td>
        <td><button class="btn ghost" data-view="${type}:${r.id}">View</button></td>
        <td><button class="btn" data-edit="${type}:${r.id}">Edit</button></td>
        <td><button class="btn danger" data-del="${type}:${r.id}">Delete</button></td>`;
    }
    body.appendChild(tr);

    // Docs row underneath
    const cols = headers.length;
    const trDocs = document.createElement('tr');
    trDocs.innerHTML = `<td colspan="${cols}"><div class="docs-list" data-docs-list="${r.id}"></div></td>`;
    body.appendChild(trDocs);
    populateDocs(r.id);
  });
  el.appendChild(body);
  el.querySelectorAll('[data-view]').forEach(b=> b.addEventListener('click', onView));
  el.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', onEdit));
  el.querySelectorAll('[data-docs]').forEach(b=> b.addEventListener('click', onDocs));
  el.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', onDelete));
}
async function populateDocs(entryId){
  const wrap = document.querySelector(`[data-docs-list="${entryId}"]`);
  if(!wrap) return;
  await displayAttachmentsWithRemove(wrap, entryId, false);
}
async function deleteFile(fileId){
  await idbOpen();
  const tx = idb.transaction('files','readwrite');
  const store = tx.objectStore('files');
  store.delete(fileId);
  await new Promise((resolve, reject)=>{
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
    tx.onabort = ()=> reject(tx.error);
  });
}

// ----- Display attachments with remove buttons -----
async function displayAttachmentsWithRemove(wrap, entryId, modal = false) {
  if(!wrap) return;
  const files = await listFiles(entryId);
  if(!files.length){
    wrap.innerHTML = `<span class="muted small">No documents</span>`;
    return;
  }
  
  wrap.innerHTML = '';
  for(const rec of files){
    const div = document.createElement('div');
    div.className = 'docs-item';
    div.innerHTML = `
      <div class="stack" style="gap: 8px; align-items: center;">
        <a href="#" class="doc-link" data-file-id="${rec.id}" data-entry-id="${entryId}">${escapeHtml(rec.name)}</a>
        <button type="button" class="btn ghost small doc-remove" data-file-id="${rec.id}" data-entry-id="${entryId}" title="Remove document">×</button>
      </div>
    `;
    wrap.appendChild(div);
  }
  
  // Add event listeners for remove buttons
  wrap.querySelectorAll('.doc-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const fileId = btn.dataset.fileId;
      const entryId = btn.dataset.entryId;
      if(confirm('Remove this document?')) {
        await deleteFile(fileId);
        await refreshDocCount(entryId);
        // Refresh the display
        await displayAttachmentsWithRemove(wrap, entryId, modal);
      }
    });
  });
  
  // Add event listeners for document links
  wrap.querySelectorAll('.doc-link').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const fileId = link.dataset.fileId;
      const entryId = link.dataset.entryId;
      const files = await listFiles(entryId);
      const rec = files.find(f => f.id === fileId);
      if(rec) {
        openBlobInNewTab(rec);
      }
    });
  });
}

// ----- Chart -----

function updateChart(a,b,c,d){
  const values = [a,b,c,d];
  if (window.Chart){
    const ctx = qs('#kpiChart');
    const colors = ['#3b82f6','#ef4444','#f59e0b','#22c55e'];
    if(!chart){
      chart = new Chart(ctx, { type:'bar', data:{ labels:['Income','Outflows','Contingency','Safe-to-Spend'], datasets:[{ data: values, backgroundColor: colors }] }, options:{ responsive:true, scales:{ y:{ beginAtZero:true }}}});
    } else {
      chart.data.datasets[0].data = values; chart.update();
    }
  } else {
    drawFallbackChart(values);
  }
}

// ----- Forms / Validation -----
function bindForms(){
  ['income','outflow','cont','source'].forEach(kind=>{
    const form = qs('#form-'+kind);
    if(!form) return;
    if(form.querySelector('select[name=recurrence]')) showOneTimeToggles(form);
    populateSourceSelects(form);
    form.querySelectorAll('[data-add-source]').forEach(b=> b.addEventListener('click', quickAddSource));

    // Styled attach & live file list
    const fileInput = form.querySelector('input[name=files]');
    const list = form.querySelector('.attach-list');
    if(fileInput && list){
      fileInput.addEventListener('change', ()=>{
        const files = Array.from(fileInput.files||[]);
        const allowed = files.filter(f=> isAllowedNameType(f.name, f.type));
        const blocked = files.filter(f=> !isAllowedNameType(f.name, f.type));

        list.innerHTML = '';
    // chips with inline remove (pre-save)
    allowed.forEach((f, idx)=>{
      const li = document.createElement('li'); li.className='chip';
      const span = document.createElement('span'); span.textContent = f.name;
      const btn = document.createElement('button'); btn.type='button'; btn.className='chip-close'; btn.textContent='×';
      btn.title='Remove from selection';
      btn.addEventListener('click', ()=>{
        const dt = new DataTransfer();
        const files = Array.from(fileInput.files||[]);
        files.forEach((file, i)=>{ if(i!==idx) dt.items.add(file); });
        fileInput.files = dt.files;
        // re-run refresh
        const ev = new Event('change'); fileInput.dispatchEvent(ev);
      });
      li.appendChild(span); li.appendChild(btn); list.appendChild(li);
    });
    if(blocked.length){
      const li=document.createElement('li'); li.textContent=`Blocked: ${blocked.map(x=>x.name).join(', ')}`; li.style.opacity='0.6'; list.appendChild(li);
    }
      });
    }

    form.addEventListener('submit', async e=>{
      e.preventDefault();
      const obj = readForm(form, kind);
      if(!validateForm(obj, kind)) return;
      obj.id = uid();
      if(kind==='income') store.incomes.push(obj);
      if(kind==='outflow') store.outflows.push(obj);
      if(kind==='cont') store.contingencies.push(obj);
      if(kind==='source'){ store.sources.push(obj); }

      const files = fileInput ? fileInput.files : null;
      if(files && files.length){ await saveFiles(obj.id, files); await refreshDocCount(obj.id); } // ensure saved before render
      form.reset(); if(list) list.innerHTML=''; save(); render(); toast('Added');
      
      // Auto-select logic for sources
      if (kind === 'source') {
        // Check if this is the first source being added
        const isFirstSource = store.sources.length === 1;
        // Re-populate source selects with auto-selection
        populateSourceSelects(null, isFirstSource);
      }
    });
  });

  qs('#refMonth').addEventListener('change', e=>{ store.settings.refMonth=e.target.value; save(); render(); });
  qs('#contFixed').addEventListener('change', e=>{ store.settings.contingencyFixed=Number(e.target.value||0); save(); render(); });

  // Excel I/O

  // CSV per-sheet

  qs('#btn-export-json').addEventListener('click', exportJSON);
  qs('#file-import-json').addEventListener('change', (e)=>{ const f=e.target.files[0]; if(f) importJSON(f); });
  // Google Drive event listeners removed

  qs('#btn-clear').addEventListener('click', ()=>{ if(confirm('Reset all data?')){ localStorage.removeItem(LS_KEY); location.reload();
migrateSourcesLinkage(); } });
}
function showOneTimeToggles(form){
  const rec = form.querySelector('select[name=recurrence]');
  const toggle = ()=> form.querySelectorAll('.one-time-only').forEach(el => el.style.display = (rec.value==='One-Time')?'block':'none');
  rec.addEventListener('change', toggle); toggle();
}
function readForm(form, kind){
  const fd = new FormData(form);
  const o = Object.fromEntries(fd.entries());
  if(kind!=='source'){
    o.title = (o.title||'').trim();
    o.amount = o.amount!=='' ? Number(o.amount) : '';
    // Source linkage
    if (o.sourceId === '') o.sourceId = undefined;
    if(kind==='cont' || kind==='income' || kind==='outflow'){
      // normalize sourceId
    }
    if(o.recurrence!=='One-Time'){ o.startMonth=''; o.durationMonths=''; }
  }else{
    o.name = (o.name||'').trim(); o.type=(o.type||'').trim(); o.note=(o.note||'').trim();
  }
  return o;
}
function validateForm(obj, kind){
  if(kind==='source'){ if(!obj.name) return toast('Source name required','error'), false; return true; }
  if(!obj.title) return toast('Title required','error'), false;
  const amount = Number(obj.amount||0);
  if(isNaN(amount) || amount<0) return toast('Amount must be ≥ 0','error'), false;
  if(!allowedRec.includes(obj.recurrence)) return toast('Invalid recurrence','error'), false;
  if(obj.recurrence==='One-Time'){
    if(!obj.startMonth) return toast('Start Month required for One-Time','error'), false;
    if(!(obj.durationMonths>0)) return toast('Duration must be ≥ 1','error'), false;
  }
  if(kind==='cont' && amount<=1 && amount<0) return toast('Percent must be ≥ 0','error'), false;
  return true;
}

// ----- Modals (View / Edit / Duplicate) -----
function onView(e){
  const [type,id] = e.currentTarget.dataset.view.split(':');
  const obj = findById(type,id);
  const entries = (type==='src') ? [
    ['Name',obj.name],['Type',obj.type],['Note',(obj.note||'')]
  ] : (function(){ 
    const srcName = obj.sourceId ? (store.sources.find(s=> s.id===obj.sourceId)?.name || '') : '';
    return [
      ['Title',obj.title],
      ['Amount',(type==='cont' && Number(obj.amount)<=1) ? (Number(obj.amount)*100).toFixed(2)+'%' : INR.format(Number(obj.amount||0))],
      ['Source', srcName],
      ['Recurrence',obj.recurrence],
      ['Start Month',obj.startMonth||''],
      ['Duration',obj.durationMonths||''],
      ['Note',(obj.note||'')]
    ];
  })();
  const extras = (obj.recurrence==='One-Time' && type!=='src') ? `<button class="btn ghost" data-dup="${type}:${obj.id}">Duplicate window…</button>` : '';
  const filesBtn = `<button class="btn ghost" data-docs="${obj.id}">Open documents</button>`;
  openModal('View', `<div class="grid-2">${entries.map(e=>`<div><div class="muted">${e[0]}</div><div>${escapeHtml(e[1]||'')}</div></div>`).join('')}</div><div class="stack" style="margin-top:10px">${filesBtn}${extras}</div>`, false);
  qs('#modal [data-docs]')?.addEventListener('click', onDocs);
  qs('#modal [data-dup]')?.addEventListener('click', onDuplicate);
}

function onEdit(e){
  const [type,id] = e.currentTarget.dataset.edit.split(':');
  const obj = findById(type,id);
  const form = (type==='inc')? formTemplate('income', obj) : (type==='out')? formTemplate('outflow', obj) : (type==='cont')? formTemplate('cont', obj) : formTemplate('source', obj);
  openModal('Edit', form, true, async ()=>{
    const f = qs('#modal form');
    if(type==='src'){
      obj.name=f.name.value.trim(); obj.type=f.type.value.trim(); obj.note=f.note.value.trim();
      const files=f.querySelector('input[name=files]').files; if(files.length) await saveFiles(obj.id, files);
    }else{
      const updated = readForm(f, type==='cont'?'cont':(type==='inc'?'income':'outflow'));
      if(!validateForm(updated, type==='cont'?'cont':(type==='inc'?'income':'outflow'))) return false;
      Object.assign(obj, updated);
      const files=f.querySelector('input[name=files]').files; if(files.length) await saveFiles(obj.id, files);
    }
    save(); render(); toast('Saved'); return true;
  });
  (async ()=>{
    const dlg = document.getElementById('modal');
    const f = dlg.querySelector('form');
    bindAttachPicker(f);
    populateSourceSelects(f);
    const wrap = dlg.querySelector('[data-docs-list="'+obj.id+'"]');
    if(wrap){
      await displayAttachmentsWithRemove(wrap, obj.id, true);
    }
  })();
}
function onDelete(e){
  const [type,id] = e.currentTarget.dataset.del.split(':');
  if(!confirm('Delete this item?')) return;
  if(type==='inc') store.incomes = store.incomes.filter(x=>x.id!==id);
  if(type==='out') store.outflows = store.outflows.filter(x=>x.id!==id);
  if(type==='cont') store.contingencies = store.contingencies.filter(x=>x.id!==id);
  if(type==='src') store.sources = store.sources.filter(x=>x.id!==id);
  deleteFilesForEntry(id).then(()=>{ save(); render(); toast('Deleted'); });
}
function onDocs(e){
  const id = e.currentTarget.dataset.docs;
  (async ()=>{
    const files = await listFiles(id);
    if(!files.length) return toast('No documents attached');
    // Build chooser UI
    const items = files.map(f => `<div class="stack"><span class="badge">${escapeHtml(f.name||'Unnamed')}</span><button class="btn ghost" data-open="${f.id}">Open</button></div>`).join('');
    openModal('Documents', `<div class="docs-list">`+items+`</div>`, false);
    const dlg = document.getElementById('modal');
    dlg.querySelectorAll('[data-open]').forEach(btn => {
      const fid = btn.getAttribute('data-open');
      const rec = files.find(x=> x.id === fid);
      btn.addEventListener('click', ()=> openBlobInNewTab(rec));
    });
  })();
}
function onDuplicate(e){
  const [type,id] = e.currentTarget.dataset.dup.split(':');
  const obj = findById(type,id);
  const month = prompt('Duplicate window to which month? (YYYY-MM)', store.settings.refMonth);
  if(!month) return;
  const dur = prompt('Duration (months)', obj.durationMonths||1);
  if(!(Number(dur)>0)) return toast('Duration must be ≥ 1','error');
  const copy = {...obj, id: uid(), startMonth: month, durationMonths: Number(dur)};
  if(type==='inc') store.incomes.push(copy);
  if(type==='out') store.outflows.push(copy);
  if(type==='cont') store.contingencies.push(copy);
  save(); render(); toast('Duplicated');
}
function formTemplate(kind, obj){
  if(kind==='source'){
    return `<form class="grid-2">
      <input name="name" value="${escapeAttr(obj.name||'')}" required>
      <input name="type" value="${escapeAttr(obj.type||'')}" required>
      <textarea name="note" rows="2">${escapeHtml(obj.note||'')}</textarea>
      <label class="file attach"><input type="file" name="files" multiple hidden><span class="btn ghost">📎 Attach files</span></label>
      <ul class="attach-list"></ul>
    </form>`;
  }
  const isCont = kind==='cont';
  const amtPh = isCont ? 'Amount (₹) or % (0.10 for 10%)' : 'Amount (₹)';
  return `<form class="grid-2 need-validate">
    <input name="title" value="${escapeAttr(obj.title||'')}" required>
    <input name="amount" type="number" step="0.01" value="${escapeAttr(obj.amount)}" placeholder="${amtPh}" ${isCont?'min="0.00"':'min="0.01"'} required>
    <div class="stack"><select name="sourceId"></select><button type="button" class="btn ghost small" data-add-source>+ Add Source</button></div>
    <select name="recurrence" required>${Object.keys(FACTORS).concat('One-Time').map(k=>`<option ${obj.recurrence===k?'selected':''}>${k}</option>`).join('')}</select>
    <input name="startMonth" type="month" class="one-time-only" value="${obj.startMonth||''}">
    <input name="durationMonths" type="number" min="1" class="one-time-only" value="${obj.durationMonths||''}">
    <textarea name="note" rows="2" placeholder="Note (optional)">${escapeHtml(obj.note||'')}</textarea>
    <div><div class="muted small">Existing documents</div><div class="docs-list" data-docs-list="${obj.id}"></div></div>
    <label class="file attach"><input type="file" name="files" multiple hidden accept="image/*,application/pdf,text/*"><span class="btn ghost">📎 Attach more files</span></label>
    <ul class="attach-list"></ul>
  </form>`;
}
function findById(type,id){
  if(type==='inc') return store.incomes.find(x=>x.id===id);
  if(type==='out') return store.outflows.find(x=>x.id===id);
  if(type==='cont') return store.contingencies.find(x=>x.id===id);
  if(type==='src') return store.sources.find(x=>x.id===id);
}


// ----- Modal infra -----
function openModal(title, innerHTML, editable=false, onSave=null){
  const dlg = document.getElementById('modal');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const saveBtn = document.getElementById('modal-save');
  if(!dlg || !titleEl || !bodyEl || !saveBtn){ console.error('Modal elements missing'); return; }
  titleEl.textContent = title || 'View';
  bodyEl.innerHTML = innerHTML || '';
  saveBtn.hidden = !editable;
  if (editable){
    saveBtn.onclick = async ()=>{
      try{
        if(onSave){
          const ok = await onSave();
          if(ok!==false) dlg.close();
        }else{
          dlg.close();
        }
      }catch(e){ console.error(e); }
    };
    // If the modal contains a recurrence select, toggle one-time fields
    const f = dlg.querySelector('form');
    const rec = f?.querySelector('select[name=recurrence]');
    if(rec){
      const toggle = ()=> f.querySelectorAll('.one-time-only').forEach(el=> el.style.display = (rec.value==='One-Time')?'block':'none');
      rec.addEventListener('change', toggle); toggle();
    }
  } else {
    saveBtn.onclick = null;
  }
  dlg.showModal();
}

// ----- Attach picker binder (shared Add & Edit) -----
function bindAttachPicker(root){
  const fileInput = root.querySelector('input[name=files]');
  const list = root.querySelector('.attach-list');
  if(!fileInput || !list) return;
  const refresh = ()=>{
    const files = Array.from(fileInput.files||[]);
    const allowed = files.filter(f=> isAllowedNameType(f.name, f.type));
    const blocked = files.filter(f=> !isAllowedNameType(f.name, f.type));
    list.innerHTML = '';
    // chips with inline remove (pre-save)
    allowed.forEach((f, idx)=>{
      const li = document.createElement('li'); li.className='chip';
      const span = document.createElement('span'); span.textContent = f.name;
      const btn = document.createElement('button'); btn.type='button'; btn.className='chip-close'; btn.textContent='×';
      btn.title='Remove from selection';
      btn.addEventListener('click', ()=>{
        const dt = new DataTransfer();
        const files = Array.from(fileInput.files||[]);
        files.forEach((file, i)=>{ if(i!==idx) dt.items.add(file); });
        fileInput.files = dt.files;
        // re-run refresh
        const ev = new Event('change'); fileInput.dispatchEvent(ev);
      });
      li.appendChild(span); li.appendChild(btn); list.appendChild(li);
    });
    if(blocked.length){
      const li=document.createElement('li'); li.textContent=`Blocked: ${blocked.map(x=>x.name).join(', ')}`; li.style.opacity='0.6'; list.appendChild(li);
    }
  };
  fileInput.addEventListener('change', refresh);
}

// ----- Toasts -----
function toast(msg, type='ok'){
  const s = qs('#status'); s.textContent = msg;
  s.style.color = (type==='error')?'#ef4444':'var(--muted)';
  setTimeout(()=>{ s.textContent='Ready'; s.style.color=''; }, 2000);
}


function populateSourceSelects(root, autoSelectFirst = false){
  const selects = (root || document).querySelectorAll('select[name=sourceId]');
  selects.forEach(sel=>{
    const cur = sel.value;
    sel.innerHTML = '<option value="">(No Source)</option>' + store.sources.map(s=> `<option value="${s.id}">${escapeHtml(s.name||'Untitled')}</option>`).join('');
    
    // Auto-select logic
    if (autoSelectFirst && store.sources.length > 0) {
      sel.value = store.sources[0].id;
    } else if (cur) {
      sel.value = cur;
    }
  });
}
function quickAddSource(){
  const name = prompt('New source name (e.g., Employer/Client)');
  if(!name) return;
  const src = { id: uid(), name: name.trim(), type: 'Unknown', note: '' };
  store.sources.push(src); save();
  
  // Auto-select logic for quick add
  const isFirstSource = store.sources.length === 1;
  populateSourceSelects(null, isFirstSource);
  render(); toast('Source added');
}

// ----- Tabs -----
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    qs('#'+btn.dataset.tab).classList.add('active');
  });
});

// Excel features removed


// ----- JSON Import/Export (entire dataset) -----


async function exportJSON(){
  const payload = { settings: store.settings, incomes: store.incomes, outflows: store.outflows, contingencies: store.contingencies, sources: store.sources, attachments: [] };
  try{
    const files = await getAllFilesRecords();
    payload.attachments = files.map(f=> ({ id:f.id, entryId:f.entryId, name:f.name, type:f.type, dataB64: bufToB64(f.data) }));
  }catch(e){ console.warn('Attachment export failed', e); }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `SpendFree_${store.settings.refMonth}.json`;
  a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 5000);
}



// ----- Migration: link incomes to sources via sourceId -----
function migrateSourcesLinkage(){
  try{
    store.sources = store.sources || [];
    const byName = new Map(store.sources.map(s=> [ (s.name||'').trim().toLowerCase(), s ]));
    for(const inc of (store.incomes||[])){
      if(!inc.sourceId){
      }
    }
  }catch(e){ console.warn('migrateSourcesLinkage failed', e); }
}
function importJSON(file){
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const obj = JSON.parse(reader.result);
      if(!obj || !obj.settings) throw new Error('Invalid data');
      store.settings = Object.assign({ refMonth: store.settings.refMonth, contingencyFixed: 0 }, obj.settings||{});
      store.incomes = Array.isArray(obj.incomes)? obj.incomes: [];
      store.outflows = Array.isArray(obj.outflows)? obj.outflows: [];
      store.contingencies = Array.isArray(obj.contingencies)? obj.contingencies: [];
      store.sources = Array.isArray(obj.sources)? obj.sources: [];
      save();
      if (Array.isArray(obj.attachments) && obj.attachments.length){
        await idbOpen();
        const tx = idb.transaction('files','readwrite');
        const storeFiles = tx.objectStore('files');
        for(const rec of obj.attachments){
          try{
            const data = b64ToBuf(rec.dataB64);
            storeFiles.put({ id: rec.id || uid(), entryId: rec.entryId, name: rec.name, type: rec.type, data });
          }catch(err){ console.warn('Skip bad attachment', err); }
        }
        await new Promise((resolve,reject)=>{ tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error); });
      }
      migrateSourcesLinkage();
      save(); render(); toast('Data imported');
    }catch(e){ console.error(e); toast('Import failed: invalid JSON','error'); }
  };
  reader.readAsText(file);
}

// Google Drive functionality removed

// ----- Utilities -----
function escapeHtml(s){ s = (s===undefined||s===null)? '' : String(s); return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function escapeAttr(s){ return escapeHtml(s); }

libsReady();
// ----- Init -----
load();
migrateSourcesLinkage();
bindForms();
render();

// PWA install
