/* ============ Server state ============ */
let ROLE = null;     // 'viewer' | 'admin'
let DATA = null;     // populated by boot() from /api/data

/* ============ Utilities ============ */
function esc(s){
  if(s===null||s===undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function debounce(fn, ms){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}
const REGION_COLORS = {
  "Africa":"#16a34a","Asia":"#2563eb","Far East":"#f59e0b","Middle East":"#e11d48",
  "LATAM":"#7c3aed","USA":"#0d9488","Brazil":"#059669","UK and EU":"#4338ca",
  "Australia":"#0891b2","default":"#7c3aed"
};
function regionColor(r){ return REGION_COLORS[r] || REGION_COLORS.default; }

const KPI_ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  hourglass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12M6 22h12M6 2c0 5 12 5 12 10s-12 5-12 10M18 2c0 5-12 5-12 10s12 5 12 10"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
  flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6M10 2v6.5L4.8 17a2 2 0 0 0 1.8 3h10.8a2 2 0 0 0 1.8-3L14 8.5V2"/><path d="M7.5 14h9"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v18"/><path d="M5 4h13l-3 5 3 5H5"/></svg>',
};
function kpiIcon(name){ return `<div class="kpi-icon">${KPI_ICONS[name]||''}</div>`; }

const CHART_PALETTE = ['#7c3aed','#2563eb','#0d9488','#f59e0b','#e11d48','#16a34a','#4338ca','#0891b2','#c026d3','#65a30d'];
const CHARTS_AVAILABLE = typeof Chart !== 'undefined';
if(CHARTS_AVAILABLE){
  Chart.defaults.font.family = "'Inter','Segoe UI',system-ui,sans-serif";
  Chart.defaults.color = '#6b7280';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
}
const chartRegistry = {};
function makeChart(id, config){
  const el = document.getElementById(id);
  if(!el) return;
  if(!CHARTS_AVAILABLE){
    el.style.display = 'none';
    if(!el.previousElementSibling || !el.previousElementSibling.classList.contains('chart-fallback')){
      const msg = document.createElement('div');
      msg.className = 'empty-state chart-fallback';
      msg.textContent = 'Chart library unavailable offline \u2014 open with an internet connection to see this chart.';
      el.parentNode.insertBefore(msg, el);
    }
    return;
  }
  if(chartRegistry[id]) chartRegistry[id].destroy();
  chartRegistry[id] = new Chart(el.getContext('2d'), config);
}

/* ============ Edit Mode (global) ============ */
let EDIT_MODE = false;
let DIRTY_COUNT = 0;
const TABLE_RENDERERS = [];

function markDirty(){
  DIRTY_COUNT++;
  const el = document.getElementById('dirty-indicator');
  if(el){
    el.style.display = DIRTY_COUNT>0 ? '' : 'none';
    el.textContent = `${DIRTY_COUNT} unsaved edit${DIRTY_COUNT===1?'':'s'}`;
  }
}

/* ============ Generic Table Builder ============ */
function buildTable(opts){
  // opts: {mountId, data, columns:[{key,label,sortable,render,width}], searchKeys, pageSize, filters:[{key,label}], title}
  const state = { search:'', sort:{key:null,dir:1}, page:1, filters:{} };
  const pageSize = opts.pageSize || 25;
  const mount = document.getElementById(opts.mountId);
  if(!mount) return;

  function applyFilters(){
    let rows = opts.data;
    if(state.search){
      const q = state.search.toLowerCase();
      rows = rows.filter(r => (opts.searchKeys||[]).some(k => String(r[k]||'').toLowerCase().includes(q)));
    }
    Object.entries(state.filters).forEach(([k,v])=>{
      if(v) rows = rows.filter(r => String(r[k]||'') === v);
    });
    if(state.sort.key){
      const k = state.sort.key, dir = state.sort.dir;
      rows = rows.slice().sort((a,b)=>{
        let av=a[k], bv=b[k];
        if(av===null||av===undefined) av='';
        if(bv===null||bv===undefined) bv='';
        if(typeof av === 'number' && typeof bv === 'number') return (av-bv)*dir;
        return String(av).localeCompare(String(bv))*dir;
      });
    }
    return rows;
  }

  function render(){
    const rows = applyFilters();
    const totalPages = Math.max(1, Math.ceil(rows.length/pageSize));
    if(state.page > totalPages) state.page = totalPages;
    const start = (state.page-1)*pageSize;
    const pageRows = rows.slice(start, start+pageSize);

    const filterHtml = (opts.filters||[]).map(f=>{
      const uniq = Array.from(new Set(opts.data.map(r=>r[f.key]).filter(Boolean))).sort();
      return `<select data-filter="${f.key}">
        <option value="">${esc(f.label)}: All</option>
        ${uniq.map(v=>`<option value="${esc(v)}" ${state.filters[f.key]===v?'selected':''}>${esc(v)}</option>`).join('')}
      </select>`;
    }).join('');

    mount.innerHTML = `
      <div class="controls">
        <input type="text" placeholder="Search ${esc(opts.title||'')}..." data-search value="${esc(state.search)}"/>
        ${filterHtml}
        <span class="spacer"></span>
        <span class="count-chip">${rows.length.toLocaleString()} record${rows.length===1?'':'s'}</span>
      </div>
      <div class="tbl-wrap"><table class="datatable">
        <thead><tr>
          ${opts.columns.map(c=>{
            const active = state.sort.key===c.key;
            const arrow = active ? (state.sort.dir===1?'↑':'↓') : '';
            return `<th data-key="${c.key}" style="${c.width?`width:${c.width}`:''}">${esc(c.label)} <span class="arrow">${arrow}</span></th>`;
          }).join('')}
        </tr></thead>
        <tbody>
          ${pageRows.length ? pageRows.map((r,ri)=>`<tr>${opts.columns.map(c=>{
            const canEdit = EDIT_MODE && ROLE==='admin' && !opts.readOnly && !c.render;
            if(canEdit){
              return `<td><input type="text" class="cell-edit" data-ri="${ri}" data-key="${c.key}" value="${esc(r[c.key])}"/></td>`;
            }
            return `<td>${c.render? c.render(r) : esc(r[c.key])}</td>`;
          }).join('')}</tr>`).join('')
            : `<tr><td colspan="${opts.columns.length}"><div class="empty-state">No matching records.</div></td></tr>`}
        </tbody>
      </table></div>
      <div class="pager">
        <button data-page="prev" ${state.page<=1?'disabled':''}>&larr; Prev</button>
        <span>Page ${state.page} of ${totalPages}</span>
        <button data-page="next" ${state.page>=totalPages?'disabled':''}>Next &rarr;</button>
      </div>
    `;

    mount.querySelector('[data-search]').addEventListener('input', debounce(e=>{
      state.search = e.target.value; state.page=1; render();
    }, 180));
    mount.querySelectorAll('[data-filter]').forEach(sel=>{
      sel.addEventListener('change', e=>{
        state.filters[sel.getAttribute('data-filter')] = e.target.value; state.page=1; render();
      });
    });
    mount.querySelectorAll('th[data-key]').forEach(th=>{
      th.addEventListener('click', ()=>{
        const k = th.getAttribute('data-key');
        if(state.sort.key===k) state.sort.dir *= -1;
        else { state.sort.key=k; state.sort.dir=1; }
        render();
      });
    });
    const prevBtn = mount.querySelector('[data-page="prev"]');
    const nextBtn = mount.querySelector('[data-page="next"]');
    if(prevBtn) prevBtn.addEventListener('click', ()=>{ state.page--; render(); });
    if(nextBtn) nextBtn.addEventListener('click', ()=>{ state.page++; render(); });

    if(EDIT_MODE && ROLE==='admin'){
      mount.querySelectorAll('.cell-edit').forEach(inp=>{
        inp.addEventListener('change', e=>{
          const ri = +inp.dataset.ri;
          const key = inp.dataset.key;
          const row = pageRows[ri];
          const before = row[key];
          const after = e.target.value;
          if(before === after) return;
          row[key] = after;
          inp.classList.remove('cell-saved','cell-save-error');
          inp.classList.add('cell-edited');
          markDirty();
          if(opts.table && row._id){
            saveEditToServer(opts.table, row._id, key, after, inp);
          }
        });
      });
    }
  }
  render();
  TABLE_RENDERERS.push(render);
}

/* ============ Server-backed edit saving (admin only) ============ */
async function saveEditToServer(table, id, field, value, inputEl){
  try{
    const res = await fetch('/api/data/edit', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ table, id, field, value })
    });
    if(!res.ok) throw new Error('save failed');
    inputEl.classList.remove('cell-edited');
    inputEl.classList.add('cell-saved');
  }catch(err){
    inputEl.classList.remove('cell-edited');
    inputEl.classList.add('cell-save-error');
    inputEl.title = 'Could not save to server — change is only local right now.';
  }
}

/* ============ Tab switching ============ */
function initTabs(){
  document.querySelectorAll('.tabbtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tabbtn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tabpanel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    });
  });
}

/* ============ Overview Tab ============ */
function daysBetween(iso){
  if(!iso) return null;
  const d = new Date(iso+'T00:00:00');
  const now = new Date();
  return Math.round((d - now)/(1000*60*60*24));
}

function renderOverview(){
  const completed = DATA.completed_registrations;
  const inprocess = DATA.inprocess_registrations;
  const allCountries = new Set([...completed.map(r=>r.country), ...inprocess.map(r=>r.country)].filter(Boolean));
  const upcoming = completed.filter(r=>{
    const d = daysBetween(r.due_date_iso);
    return d!==null && d>=0 && d<=180;
  }).sort((a,b)=> (a.due_date_iso||'').localeCompare(b.due_date_iso||''));
  const overdue = completed.filter(r=>{
    const d = daysBetween(r.due_date_iso);
    return d!==null && d<0;
  });

  const techMaster = DATA.completeness_matrix.technical.filter(r=>r.section==='Master Inventory');
  let techDone=0, techTotal=techMaster.length;
  techMaster.forEach(r=>{
    const keys=['five_ba','pnc','six_pack_tox','eco_tox','muta'];
    const filled = keys.filter(k=>r[k]).length;
    if(filled===5) techDone++;
  });
  let formDone=0, formTotal=DATA.completeness_matrix.formulation.length;
  DATA.completeness_matrix.formulation.forEach(r=>{
    if(r.six_pack_tox) formDone++;
  });
  const openItemsCount = DATA.data_generation.unmatched_review.length +
    [...completed, ...inprocess].filter(r=>r.notes).length;

  document.getElementById('kpi-strip').innerHTML = `
    <div class="kpi-card" style="--accent:var(--teal)">
      ${kpiIcon('check')}
      <div class="kpi-label">Completed Registrations</div>
      <div class="kpi-value">${completed.length.toLocaleString()}</div>
      <div class="kpi-foot">Across ${new Set(completed.map(r=>r.country)).size} countries</div>
    </div>
    <div class="kpi-card" style="--accent:var(--amber)">
      ${kpiIcon('hourglass')}
      <div class="kpi-label">In-Process Applications</div>
      <div class="kpi-value">${inprocess.length.toLocaleString()}</div>
      <div class="kpi-foot">Across ${new Set(inprocess.map(r=>r.country)).size} countries</div>
    </div>
    <div class="kpi-card" style="--accent:var(--blue)">
      ${kpiIcon('globe')}
      <div class="kpi-label">Countries Covered</div>
      <div class="kpi-value">${allCountries.size}</div>
      <div class="kpi-foot">Completed + in-process combined</div>
    </div>
    <div class="kpi-card" style="--accent:var(--rose)">
      ${kpiIcon('calendar')}
      <div class="kpi-label">Due in Next 180 Days</div>
      <div class="kpi-value">${upcoming.length}</div>
      <div class="kpi-foot">${overdue.length} past due date</div>
    </div>
    <div class="kpi-card" style="--accent:var(--purple)">
      ${kpiIcon('flask')}
      <div class="kpi-label">Technical Data Complete</div>
      <div class="kpi-value">${techDone}/${techTotal}</div>
      <div class="kpi-foot">All 5 study types on file</div>
    </div>
    <div class="kpi-card" style="--accent:var(--rose)">
      ${kpiIcon('flag')}
      <div class="kpi-label">Open Items Needing Decision</div>
      <div class="kpi-value">${openItemsCount}</div>
      <div class="kpi-foot">Unmatched products + flagged rows</div>
    </div>
  `;

  // Region distribution (completed vs inprocess)
  const regions = {};
  completed.forEach(r=>{ const k=r.region||'Other'; regions[k]=regions[k]||{c:0,i:0}; regions[k].c++; });
  inprocess.forEach(r=>{ const k=r.region||'Other'; regions[k]=regions[k]||{c:0,i:0}; regions[k].i++; });
  const maxVal = Math.max(1, ...Object.values(regions).map(v=>v.c+v.i));
  const regionRows = Object.entries(regions).sort((a,b)=>(b[1].c+b[1].i)-(a[1].c+a[1].i));
  document.getElementById('region-bars').innerHTML = regionRows.map(([name,v])=>`
    <div class="bar-row">
      <div class="lbl">${esc(name)}</div>
      <div class="bar-track">
        <div class="bar-fill-completed" style="width:${(v.c/maxVal*100).toFixed(1)}%"></div>
        <div class="bar-fill-inprocess" style="width:${(v.i/maxVal*100).toFixed(1)}%"></div>
      </div>
      <div class="bar-val">${v.c+v.i}</div>
    </div>
  `).join('') + `<div class="small-muted" style="margin-top:8px;">
      <span style="color:var(--teal);font-weight:700;">&#9632;</span> Completed &nbsp;
      <span style="color:var(--amber);font-weight:700;">&#9632;</span> In-process
    </div>`;

  // Upcoming due dates list
  document.getElementById('upcoming-list').innerHTML = upcoming.length ? upcoming.slice(0,12).map(r=>{
    const d = daysBetween(r.due_date_iso);
    const urgent = d<=60;
    return `<tr>
      <td>${esc(r.product)}</td>
      <td>${esc(r.country)}</td>
      <td><span class="badge ${urgent?'badge-rose':'badge-amber'}">${esc(r.due_date_display)}</span></td>
      <td class="small-muted">${d} days</td>
    </tr>`;
  }).join('') : `<tr><td colspan="4"><div class="empty-state">Nothing due in the next 180 days.</div></td></tr>`;

  // ---- Chart.js infographics ----
  renderStageFunnelChart(inprocess);
  renderYearlyChart(completed);
  renderTopCountriesChart(completed, inprocess);
  renderLabWorkloadChart();
  renderCompletenessDonuts(techDone, techTotal, formDone, formTotal);
}

function renderStageFunnelChart(inprocess){
  const order = ['In Process','Application Submitted','Renewal In Progress','Planned'];
  const counts = order.map(s => inprocess.filter(r=>r.stage===s).length);
  makeChart('chart-stagefunnel', {
    type:'doughnut',
    data:{ labels: order, datasets:[{ data: counts, backgroundColor:['#94a3b8','#2563eb','#f59e0b','#7c3aed'], borderWidth:3, borderColor:'#fff' }] },
    options:{ maintainAspectRatio:false, cutout:'62%', plugins:{ legend:{ position:'bottom' } } }
  });
}

function renderYearlyChart(completed){
  const byYear = {};
  completed.forEach(r=>{ if(r.year){ byYear[r.year] = (byYear[r.year]||0)+1; } });
  const years = Object.keys(byYear).map(Number).sort((a,b)=>a-b).filter(y=>y>=2015);
  makeChart('chart-yearly', {
    type:'bar',
    data:{ labels: years, datasets:[{ label:'Registrations completed', data: years.map(y=>byYear[y]), backgroundColor:'#0d9488', borderRadius:6, maxBarThickness:34 }] },
    options:{ maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ y:{ beginAtZero:true, grid:{color:'#f1f1f7'} }, x:{ grid:{display:false} } } }
  });
}

function renderTopCountriesChart(completed, inprocess){
  const counts = {};
  [...completed, ...inprocess].forEach(r=>{ if(r.country) counts[r.country] = (counts[r.country]||0)+1; });
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).reverse();
  makeChart('chart-topcountries', {
    type:'bar',
    data:{ labels: top.map(t=>t[0]), datasets:[{ label:'Total registrations', data: top.map(t=>t[1]), backgroundColor:'#f59e0b', borderRadius:6, maxBarThickness:18 }] },
    options:{ indexAxis:'y', maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ x:{ beginAtZero:true, grid:{color:'#f1f1f7'} }, y:{ grid:{display:false} } } }
  });
}

function renderLabWorkloadChart(){
  const counts = {};
  DATA.completeness_matrix.technical.forEach(r=>{ if(r.lab){ const l=r.lab.trim(); counts[l]=(counts[l]||0)+1; } });
  DATA.completeness_matrix.formulation.forEach(r=>{ if(r.lab){ const l=r.lab.trim(); counts[l]=(counts[l]||0)+1; } });
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8).reverse();
  makeChart('chart-labworkload', {
    type:'bar',
    data:{ labels: top.map(t=>t[0]), datasets:[{ label:'Products handled', data: top.map(t=>t[1]), backgroundColor: top.map((_,i)=>CHART_PALETTE[i%CHART_PALETTE.length]), borderRadius:6, maxBarThickness:16 }] },
    options:{ indexAxis:'y', maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ x:{ beginAtZero:true, grid:{color:'#f1f1f7'} }, y:{ grid:{display:false}, ticks:{font:{size:10.5}} } } }
  });
}

function renderCompletenessDonuts(techDone, techTotal, formDone, formTotal){
  makeChart('chart-donut-tech', {
    type:'doughnut',
    data:{ labels:['Complete','Remaining'], datasets:[{ data:[techDone, Math.max(0,techTotal-techDone)], backgroundColor:['#7c3aed','#efe6ff'], borderWidth:0 }] },
    options:{ maintainAspectRatio:false, cutout:'72%', plugins:{ legend:{display:false}, tooltip:{enabled:true} } }
  });
  document.getElementById('donut-tech-label').innerHTML = `<div class="pct">${techTotal? Math.round(techDone/techTotal*100):0}%</div><div class="lbl">${techDone}/${techTotal} complete</div>`;

  makeChart('chart-donut-form', {
    type:'doughnut',
    data:{ labels:['Complete','Remaining'], datasets:[{ data:[formDone, Math.max(0,formTotal-formDone)], backgroundColor:['#0d9488','#dcf7f2'], borderWidth:0 }] },
    options:{ maintainAspectRatio:false, cutout:'72%', plugins:{ legend:{display:false}, tooltip:{enabled:true} } }
  });
  document.getElementById('donut-form-label').innerHTML = `<div class="pct">${formTotal? Math.round(formDone/formTotal*100):0}%</div><div class="lbl">${formDone}/${formTotal} complete</div>`;
}

/* ============ Registrations Tab ============ */
function renderRegistrations(){
  const completed = DATA.completed_registrations.map(r=>({...r, status:'Completed'}));
  const inprocess = DATA.inprocess_registrations.map(r=>({...r, status:'In Process', party:r.customer}));

  buildTable({
    mountId:'completed-table', data:completed, title:'completed registrations', table:'completed_registrations',
    searchKeys:['region','country','party','product','trade_name'],
    filters:[{key:'region',label:'Region'},{key:'country',label:'Country'}],
    pageSize:25,
    columns:[
      {key:'region',label:'Region'},
      {key:'country',label:'Country'},
      {key:'party',label:'Party / Customer'},
      {key:'product',label:'Product'},
      {key:'trade_name',label:'Trade Name / Approval #'},
      {key:'reg_date_display',label:'Registration Date'},
      {key:'due_date_display',label:'Due Date', render:r=>{
        const d = daysBetween(r.due_date_iso);
        if(d!==null && d<0) return `<span class="badge badge-rose">${esc(r.due_date_display)}</span>`;
        if(d!==null && d<=180) return `<span class="badge badge-amber">${esc(r.due_date_display)}</span>`;
        return esc(r.due_date_display || '—');
      }},
    ]
  });

  buildTable({
    mountId:'inprocess-table', data:inprocess, title:'in-process registrations', table:'inprocess_registrations',
    searchKeys:['region','country','customer','product','category'],
    filters:[{key:'region',label:'Region'},{key:'stage',label:'Stage'}],
    pageSize:25,
    columns:[
      {key:'region',label:'Region'},
      {key:'country',label:'Country'},
      {key:'customer',label:'Customer'},
      {key:'product',label:'Product'},
      {key:'date_display',label:'Application Date'},
      {key:'stage',label:'Stage', render:r=>{
        const map={'Planned':'badge-purple','Application Submitted':'badge-blue','Renewal In Progress':'badge-amber','In Process':'badge-gray'};
        return `<span class="badge ${map[r.stage]||'badge-gray'}">${esc(r.stage)}</span>`;
      }},
    ]
  });

  // Kanban view
  const stages = ['Planned','In Process','Application Submitted','Renewal In Progress'];
  const kb = document.getElementById('kanban-board');
  kb.innerHTML = stages.map(stage=>{
    const items = inprocess.filter(r=>r.stage===stage);
    const shown = items.slice(0,8);
    return `<div class="kanban-col">
      <h4><span>${esc(stage)}</span><span class="badge badge-gray">${items.length}</span></h4>
      ${shown.map(r=>`<div class="kanban-card" style="border-left-color:${regionColor(r.region)}">
        <div class="p">${esc(r.product)}</div>
        <div class="m">${esc(r.country||'')} &middot; ${esc(r.customer||'Unknown')}</div>
        <div class="m">${esc(r.date_display||'')}</div>
      </div>`).join('')}
      ${items.length>8?`<div class="kanban-more">+${items.length-8} more</div>`:''}
      ${items.length===0?'<div class="small-muted">None</div>':''}
    </div>`;
  }).join('');
}

/* ============ Data Generation Tab ============ */
function statusBadge(status){
  if(!status) return `<span class="badge badge-gray">—</span>`;
  const s = status.toLowerCase();
  if(s.includes('finalized')||s.includes('available')||s.includes('complete')) return `<span class="badge badge-green">${esc(status)}</span>`;
  if(s.includes('inprocess')||s.includes('in process')||s.includes('under evaluation')) return `<span class="badge badge-amber">${esc(status)}</span>`;
  if(s.includes('to be')||s.includes('not available')) return `<span class="badge badge-rose">${esc(status)}</span>`;
  return `<span class="badge badge-blue">${esc(status)}</span>`;
}

function renderDataGen(){
  const dg = DATA.data_generation;

  buildTable({
    mountId:'fivebatch-table', data:dg.five_batch, title:'5-batch & lab projects', table:'five_batch',
    searchKeys:['product','lab','status','section','sample_sent_to'],
    filters:[{key:'section',label:'Section'}],
    pageSize:20,
    columns:[
      {key:'section',label:'Section'},
      {key:'product',label:'Product'},
      {key:'sample_sent_to',label:'Sample Sent To / Notes'},
      {key:'status',label:'Current Status', render:r=>statusBadge(r.status)},
    ]
  });

  // Physchem: flatten product -> parameters into rows
  const physchemRows = [];
  dg.physchem.forEach(p=>{
    p.parameters.forEach(param=>{
      physchemRows.push({ product: p.product, parameter: param.parameter, study_no: param.study_no, status: param.status });
    });
  });
  buildTable({
    mountId:'physchem-table', data:physchemRows, title:'physchem parameters', readOnly:true,
    searchKeys:['product','parameter','study_no'],
    filters:[{key:'product',label:'Product'}],
    pageSize:15,
    columns:[
      {key:'product',label:'Product'},
      {key:'parameter',label:'Parameter'},
      {key:'study_no',label:'Study No.'},
      {key:'status',label:'Status', render:r=>statusBadge(r.status)},
    ]
  });

  buildTable({
    mountId:'tox-table', data:dg.tox, title:'tox studies', table:'tox',
    searchKeys:['product','status','notes'],
    pageSize:20,
    columns:[
      {key:'product',label:'Product'},
      {key:'status',label:'Status', render:r=>statusBadge(r.status)},
      {key:'notes',label:'Notes', render:r=>esc(r.notes||'—')},
    ]
  });

  buildTable({
    mountId:'columbia-table', data:dg.columbia_project, title:'colombia project', table:'columbia_project',
    searchKeys:['product','status'],
    pageSize:10,
    columns:[
      {key:'product',label:'Product'},
      {key:'status',label:'Status', render:r=>statusBadge(r.status)},
    ]
  });

  const fc = dg.flonicamid;
  document.getElementById('flonicamid-tree').innerHTML = `
    ${fc.overall_note?`<div class="note-box">${esc(fc.overall_note)}</div>`:''}
    ${fc.products.map(p=>`
      <div class="tree-product">${esc(p.name)}</div>
      <div class="tree">
        ${p.sections.map(s=>`
          <div class="tree-section">${esc(s.name)}</div>
          <ul class="tree-items">${s.items.map(it=>`<li>${esc(it)}</li>`).join('')}</ul>
        `).join('')}
      </div>
    `).join('')}
  `;
}

/* ============ Open Items & Country Notes Tab ============ */
function renderOpenItems(){
  const dg = DATA.data_generation;

  buildTable({
    mountId:'unmatched-table', data:dg.unmatched_review, title:'unmatched products', table:'unmatched_review',
    searchKeys:['source_sheet','product','status','why_flagged'],
    filters:[{key:'source_sheet',label:'Source'}],
    pageSize:15,
    columns:[
      {key:'source_sheet',label:'Source'},
      {key:'product',label:'Product / Item'},
      {key:'status',label:'In-Progress Status'},
      {key:'why_flagged',label:'Why Flagged / Recommended Action'},
    ]
  });

  const flagged = [...DATA.completed_registrations, ...DATA.inprocess_registrations]
    .filter(r=>r.notes)
    .map(r=>({...r, customer: r.customer || r.party}));
  buildTable({
    mountId:'flagged-table', data:flagged, title:'flagged registrations', readOnly:true,
    searchKeys:['region','country','customer','product','notes'],
    filters:[{key:'region',label:'Region'}],
    pageSize:15,
    columns:[
      {key:'region',label:'Region'},
      {key:'country',label:'Country'},
      {key:'customer',label:'Party / Customer'},
      {key:'product',label:'Product'},
      {key:'notes',label:'Notes / Flag'},
    ]
  });

  const kenya = DATA.country_notes.kenya;
  document.getElementById('country-notes').innerHTML = `
    <div class="card">
      <div class="section-title" style="margin-top:0;"><span class="dot" style="background:var(--green)"></span>Kenya &mdash; Registration Strategy</div>
      <div class="note-box">${esc(kenya.intro)}</div>
      <p class="small-muted" style="font-size:13.5px;color:var(--text);margin:10px 0;">${esc(kenya.body)}</p>
      <ul class="tree-items" style="margin-left:0;">
        ${kenya.items.map(it=>`<li>${esc(it)}</li>`).join('')}
      </ul>
    </div>
  `;
}

/* ============ Completeness Matrix Tab ============ */
function dot(val){
  if(!val) return `<span class="dotcheck no">&ndash;</span>`;
  if(val==='√') return `<span class="dotcheck yes" title="Complete">&#10003;</span>`;
  return `<span class="dotcheck partial" title="${esc(val)}">&#10003;</span>`;
}

function noteBadge(r){
  return r.active_notes ? `<span class="badge badge-purple" title="${esc(r.active_notes)}">&#9998; update</span>` : '';
}

function renderMatrix(){
  buildTable({
    mountId:'technical-matrix', data:DATA.completeness_matrix.technical, title:'technical products', table:'technical',
    searchKeys:['product','lab','active_notes'],
    filters:[{key:'section',label:'Section'},{key:'lab',label:'Lab'}],
    pageSize:20,
    columns:[
      {key:'product',label:'Product'},
      {key:'lab',label:'Lab'},
      {key:'year',label:'Year'},
      {key:'five_ba',label:'5 Batch', render:r=>dot(r.five_ba)},
      {key:'pnc',label:'PnC', render:r=>dot(r.pnc)},
      {key:'six_pack_tox',label:'6-Pack Tox', render:r=>dot(r.six_pack_tox)},
      {key:'eco_tox',label:'Eco Tox', render:r=>dot(r.eco_tox)},
      {key:'muta',label:'Muta', render:r=>dot(r.muta)},
      {key:'active_notes',label:'Update', render:noteBadge},
    ]
  });
  buildTable({
    mountId:'formulation-matrix', data:DATA.completeness_matrix.formulation, title:'formulation products', table:'formulation',
    searchKeys:['product','lab','active_notes'],
    filters:[{key:'lab',label:'Lab'}],
    pageSize:20,
    columns:[
      {key:'product',label:'Product'},
      {key:'lab',label:'Lab'},
      {key:'year',label:'Year'},
      {key:'five_ba',label:'5 Batch', render:r=>dot(r.five_ba)},
      {key:'pnc',label:'PnC', render:r=>dot(r.pnc)},
      {key:'six_pack_tox',label:'6-Pack Tox', render:r=>dot(r.six_pack_tox)},
      {key:'eco_tox',label:'Eco Tox', render:r=>dot(r.eco_tox)},
      {key:'muta',label:'Muta', render:r=>dot(r.muta)},
      {key:'active_notes',label:'Update', render:noteBadge},
    ]
  });
}

/* ============ View toggles (table/kanban) ============ */
function initViewToggle(){
  document.querySelectorAll('.pill-toggle[data-toggle-group]').forEach(group=>{
    const groupName = group.getAttribute('data-toggle-group');
    group.querySelectorAll('button').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        group.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll(`[data-view-for="${groupName}"]`).forEach(el=>{
          el.style.display = el.getAttribute('data-view') === btn.getAttribute('data-view') ? '' : 'none';
        });
      });
    });
  });
}

/* ============ Settings Tab: Data Sources & Edit Mode ============ */
let ORIGINAL_DATA_SNAPSHOT = null;

function renderSettings(){
  const sources = [
    { name:'Registration Tracker.xlsx', feeds:'Overseas Registrations (completed + in-process), Open Items (flagged rows)', location:'02_Country_Registrations/', sharepoint:'https://heranba1-my.sharepoint.com/personal/pratikmahavarkar_heranba_com/Documents/Pratik/HERANBA/HIL Registration/02_Country_Registrations/Registration Tracker.xlsx' },
    { name:'Data Package Tracker.xlsx', feeds:'Data Generation (5-Batch, Physchem, Tox, Colombia, Flonicamid), Completeness Matrix, Open Items (unmatched products)', location:'01_Data_Package/', sharepoint:'https://heranba1-my.sharepoint.com/personal/pratikmahavarkar_heranba_com/Documents/Pratik/HERANBA/HIL Registration/01_Data_Package/Data Package Tracker.xlsx' },
    { name:'Kenya - Registration Strategy.docx', feeds:'Open Items &amp; Notes (Country Notes)', location:'03_Country_Notes/', sharepoint:null },
  ];
  document.getElementById('data-sources-list').innerHTML = `
    <div class="tbl-wrap"><table class="datatable">
      <thead><tr><th>Source File</th><th>Feeds Into</th><th>Folder</th><th>Status</th></tr></thead>
      <tbody>
        ${sources.map(s=>`<tr>
          <td><strong>${esc(s.name)}</strong></td>
          <td>${s.feeds}</td>
          <td class="small-muted">${esc(s.location)}</td>
          <td>${s.sharepoint ? `<a href="${esc(s.sharepoint)}" target="_blank" rel="noopener" class="badge badge-green" style="text-decoration:none;">&#10003; Found on SharePoint</a>` : `<span class="badge badge-gray">Local workspace only</span>`}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <div class="small-muted" style="margin-top:10px;">Data last synced from Excel ${esc(DATA.meta.generated)} &middot; ${esc(DATA.meta.source_note||'')}${DATA.meta.overrides_count ? ` &middot; ${DATA.meta.overrides_count} manual edit${DATA.meta.overrides_count===1?'':'s'} currently applied on top` : ''}</div>
  `;
}

function applyEditsToDashboard(){
  TABLE_RENDERERS.length = 0;
  renderOverview();
  renderRegistrations();
  renderDataGen();
  renderMatrix();
  renderOpenItems();
}

function exportEditedData(){
  const blob = new Blob([JSON.stringify(DATA, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'HIL_Dashboard_edited_data_' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function resetAllEdits(){
  if(ROLE==='admin'){
    // Clear server-side overrides for everyone, then reload the merged dataset fresh.
    try{
      await fetch('/api/data/reset', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    }catch(err){ /* fall through to local-only reset below */ }
  }
  await loadDataAndRender();
  DIRTY_COUNT = 0;
  const el = document.getElementById('dirty-indicator');
  if(el) el.style.display = 'none';
}

function initSettings(){
  renderSettings();
  const editSection = document.getElementById('edit-mode-section');
  if(ROLE !== 'admin'){
    if(editSection) editSection.style.display = 'none';
    return;
  }
  if(editSection) editSection.style.display = '';
  const toggle = document.getElementById('edit-mode-toggle');
  toggle.addEventListener('change', e=>{
    EDIT_MODE = e.target.checked;
    document.body.classList.toggle('edit-mode-on', EDIT_MODE);
    TABLE_RENDERERS.forEach(fn=>fn());
  });
  document.getElementById('apply-edits-btn').addEventListener('click', applyEditsToDashboard);
  document.getElementById('export-edits-btn').addEventListener('click', exportEditedData);
  document.getElementById('reset-edits-btn').addEventListener('click', ()=>{
    if(confirm('Discard all edits (yours and everyone else\'s) and restore the data from the last Excel sync? This affects what everyone sees.')){
      toggle.checked = false;
      EDIT_MODE = false;
      document.body.classList.remove('edit-mode-on');
      resetAllEdits();
    }
  });
}

/* ============ Live clock ============ */
function tickClock(){
  const el = document.getElementById('live-clock');
  if(!el) return;
  const now = new Date();
  const dayDate = now.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  el.innerHTML = `<span class="cw-time">${esc(time)}</span><span class="cw-date">${esc(dayDate)}</span>`;
}

/* ============ Auth + boot ============ */
function showLogin(message){
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('role-bar').style.display = 'none';
  const err = document.getElementById('login-error');
  if(message){ err.textContent = message; err.style.display = ''; }
  else { err.style.display = 'none'; }
}
function hideLogin(){
  document.getElementById('login-overlay').classList.add('hidden');
}
function showRoleBar(){
  const bar = document.getElementById('role-bar');
  const pill = document.getElementById('role-label');
  pill.textContent = ROLE === 'admin' ? 'Admin' : 'Viewer';
  pill.classList.toggle('role-admin', ROLE === 'admin');
  bar.style.display = 'flex';
}

async function loadDataAndRender(){
  const res = await fetch('/api/data');
  if(res.status === 401){ showLogin(); return false; }
  if(!res.ok){ showLogin('Could not load dashboard data. Try refreshing.'); return false; }
  const payload = await res.json();
  DATA = payload;
  ROLE = payload.meta && payload.meta._role || ROLE;
  ORIGINAL_DATA_SNAPSHOT = JSON.parse(JSON.stringify(DATA));
  TABLE_RENDERERS.length = 0;
  renderOverview();
  renderRegistrations();
  renderDataGen();
  renderMatrix();
  renderOpenItems();
  initSettings();
  showRoleBar();
  return true;
}

async function boot(){
  initTabs();
  initViewToggle();
  tickClock();
  setInterval(tickClock, 1000);

  const sessionRes = await fetch('/api/session');
  if(sessionRes.ok){
    const s = await sessionRes.json();
    ROLE = s.role;
    hideLogin();
    await loadDataAndRender();
  } else {
    showLogin();
  }

  document.getElementById('login-form').addEventListener('submit', async e=>{
    e.preventDefault();
    const password = document.getElementById('login-password').value;
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Checking…';
    try{
      const res = await fetch('/api/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ password })
      });
      if(!res.ok){
        showLogin('Incorrect password. Try again.');
        return;
      }
      const s = await res.json();
      ROLE = s.role;
      hideLogin();
      document.getElementById('login-password').value = '';
      await loadDataAndRender();
    } catch(err){
      showLogin('Could not reach the server. Try again.');
    } finally {
      btn.disabled = false; btn.textContent = 'Enter Dashboard';
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async ()=>{
    await fetch('/api/logout', { method:'POST' });
    ROLE = null; DATA = null;
    showLogin();
  });
}

/* ============ Init ============ */
document.addEventListener('DOMContentLoaded', boot);
