/* ── URL APPS SCRIPT ── */
const CSV_URL = "https://script.google.com/macros/s/AKfycbzB-Q-i4j20i5Fv5tSY6nHiBicgw_LiK9DHrysUlLvF1CYQoqT496NScMsXtMAx_2rq/exec";

/* ── ESTADO GLOBAL ── */
let allData = [], filtered = [];
const charts = {};

/* ── MAPEAMENTO ── */
const COL_MAP = {
  'data':'data','jogo':'jogo','resultado':'resultado','pontos':'pontos',
  'local':'local','competicao':'comp','duracao':'duracao','gols':'gols',
  'gols esperados':'xg','finalizacoes':'fin_total','finalizacoes no gol':'fin_gol',
  'passes':'passes','passes certos':'passes_certos','posse':'posse',
  'posse,':'posse','posse%':'posse','recuperacoes':'recuperacoes',
  'cruzamentos':'cruz','cruzamentos certos':'cruz_certos',
  'entradas na grande area':'entradas','duelos ofensivos':'duelos_of',
  'duelos ofensivos ganhos':'duelos_of_g','gols sofridos':'gols_sof',
  'duelos defensivos':'duelos_def','duelos defensivos ganhos':'duelos_def_g',
  'duelos aereos':'duelos_aer','duelos aereos ganhos':'duelos_aer_g',
  // [25] Interceptações
  'intersecoes':'intersecoes','intersecao':'intersecoes',
  // [26] Passes para o terço final — mapeado por nome E por índice posicional
  'passes para o terco final':'passes_tf',
  'passes para terco final':'passes_tf',
  // [27] Passes para o terço final certos
  'passes para o terco final certos':'passes_tf_c',
  'passes para terco final certos':'passes_tf_c',
  // [28-31]
  'intensidade de jogo':'intensidade',
  'media de passes por posse':'passe_posse','media passes por posse':'passe_posse',
  'comprimento medio de passes':'comp_passe','comprimento medio de passe':'comp_passe',
  'ppda':'ppda','ppda ':'ppda',
};
// Sem mapeamento posicional fixo — resolvido dinamicamente no parseCSV
const REQUIRED = ['data','jogo','gols','xg','fin_gol'];

/* ── UTILITÁRIOS ── */
function nk(s){
  return String(s).toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[_\/\\]/g,' ').replace(/["%]/g,'')
    .replace(/\s+/g,' ').trim();
}
function toNum(v){if(v===null||v===undefined||v==='')return NaN;return parseFloat(String(v).replace(',','.'))}
function toDate(v){
  if(!v) return null;
  // Remove caracteres invisíveis e espaços
  v = String(v).trim().replace(/[\u00A0\u200B\uFEFF]/g,'');
  if(!v) return null;

  // Tenta parse nativo primeiro (ISO funciona direto)
  const native = new Date(v);

  // YYYY-MM-DD ou YYYY/MM/DD (ex: 2026-05-03, 2026/05/03)
  const m1 = v.match(/^(\d{4})[\-\/\.](\d{1,2})[\-\/\.](\d{1,2})/);
  if(m1) return new Date(+m1[1], +m1[2]-1, +m1[3]);

  // DD/MM/YYYY ou D/M/YYYY (ex: 03/05/2026, 3/5/2026 — AppSheets)
  const m2 = v.match(/^(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{4})/);
  if(m2) return new Date(+m2[3], +m2[2]-1, +m2[1]);

  // Fallback: native Date parse
  if(!isNaN(native)) return native;
  return null;
}
function fmtDate(d){return d?d.toLocaleDateString('pt-BR'):'';}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function sumOf(f,arr){return(arr||filtered).reduce((a,r)=>a+(isNaN(r[f])?0:r[f]),0);}
function avgOf(f,arr){const v=(arr||filtered).map(r=>r[f]).filter(x=>!isNaN(x));return v.length?v.reduce((a,b)=>a+b,0)/v.length:NaN;}
function maxBy(f){return filtered.reduce((b,r)=>{if(isNaN(r[f]))return b;if(!b||r[f]>b[f])return r;return b;},null);}

/* ── JSONP ── */
function fetchCSV(url){
  return new Promise((resolve,reject)=>{
    const cb='__fec_'+Math.random().toString(36).slice(2);
    const tid=setTimeout(()=>{cleanup();reject(new Error('Timeout'));},20000);
    function cleanup(){try{delete window[cb];}catch(e){}const el=document.getElementById(cb);if(el)el.parentNode.removeChild(el);clearTimeout(tid);}
    window[cb]=function(data){cleanup();let t=typeof data==='string'?data:String(data);t=t.replace(/\\r\\n/g,'\n').replace(/\\n/g,'\n').replace(/\\r/g,'\n');resolve(t);};
    const s=document.createElement('script');s.id=cb;
    s.onerror=()=>{cleanup();reject(new Error('Erro ao carregar script'));};
    s.src=url+(url.includes('?')?'&':'?')+'callback='+cb+'&_ts='+Date.now();
    document.head.appendChild(s);
  });
}

/* ── PARSE CSV ── */
function detectSep(t){const l=t.split('\n')[0];return(l.match(/;/g)||[]).length>(l.match(/,/g)||[]).length?';':',';}
function splitRow(row,sep){const r=[];let cur='',inQ=false;for(const c of row){if(c==='"'){inQ=!inQ;continue;}if(c===sep&&!inQ){r.push(cur);cur='';}else cur+=c;}r.push(cur);return r;}
function parseCSV(text){
  const sep=detectSep(text);
  const rows=text.split('\n').filter(r=>r.trim());
  if(rows.length<2)return[];
  const hdrs=rows[0].split(sep).map(h=>h.replace(/^"|"$/g,'').trim());
  const normHdrs=hdrs.map(nk);
  const recs=[];
  for(let i=1;i<rows.length;i++){
    const cols=splitRow(rows[i],sep);
    if(cols.every(c=>!c.trim()))continue;
    const obj={};
    // Rastrear quantas vezes cada cabeçalho normalizado já foi visto
    // para resolver colunas com nomes duplicados dinamicamente
    const seenHdrs={};
    normHdrs.forEach((h,idx)=>{
      if(!h) return;
      const val=(cols[idx]||'').replace(/^"|"$/g,'').trim();
      seenHdrs[h]=(seenHdrs[h]||0)+1;
      const occurrence=seenHdrs[h];
      // Resolver alias: se o nome aparece mais de uma vez,
      // usar sufixo _2, _3... para diferenciar
      let alias=COL_MAP[h];
      if(alias&&occurrence>1){
        // Segunda ocorrência de 'passes para o terco final' → passes_tf_c
        // (a planilha tem o mesmo nome normalizado para total e certos)
        alias=alias+'_c';
      }
      if(alias) obj[alias]=val;
      else obj[h]=val;
    });
    recs.push(obj);
  }
  return recs;
}

/* ── CARGA ── */
async function loadData(){
  showLoading(true);
  try{
    const text=await fetchCSV(CSV_URL);
    const raw=parseCSV(text);
    if(raw.length>0){const keys=Object.keys(raw[0]);const miss=REQUIRED.filter(c=>!keys.includes(c));if(miss.length){showError('Colunas não encontradas: '+miss.join(', '));showLoading(false);return;}}
    allData=raw.map(r=>({...r,
      _date        :toDate(r.data),
      _gols        :toNum(r.gols),
      _xg          :toNum(r.xg),
      _fin_gol     :toNum(r.fin_gol),
      _fin_total   :toNum(r.fin_total),
      _passes      :toNum(r.passes),
      _passes_certos:toNum(r.passes_certos),
      _posse       :toNum(r.posse),
      _recuperacoes:toNum(r.recuperacoes),
      _cruz        :toNum(r.cruz),
      _cruz_certos :toNum(r.cruz_certos),
      _entradas    :toNum(r.entradas),
      _duelos_of   :toNum(r.duelos_of),
      _duelos_of_g :toNum(r.duelos_of_g),
      _gols_sof    :toNum(r.gols_sof),
      _duelos_def  :toNum(r.duelos_def),
      _duelos_def_g:toNum(r.duelos_def_g),
      _duelos_aer  :toNum(r.duelos_aer),
      _duelos_aer_g:toNum(r.duelos_aer_g),
      _intersecoes :toNum(r.intersecoes),
      _passes_tf   :toNum(r.passes_tf),
      _passes_tf_c :toNum(r.passes_tf_c),
      _intensidade :toNum(r.intensidade),
      _passe_posse :toNum(r.passe_posse),
      _comp_passe  :toNum(r.comp_passe),
      _ppda        :toNum(r.ppda),
      _pontos      :toNum(r.pontos),
    })).filter(r=>r.jogo);
    // Debug: log datas dos últimos 3 jogos para verificar parsing
    const lastJogos = [...allData].sort((a,b)=>(b._date||0)-(a._date||0)).slice(0,3);
    lastJogos.forEach(r=>console.log('📅 Jogo:', r.jogo, '| data raw:', r.data, '| _date:', r._date));
    document.getElementById('lbl-upd').textContent='Atualizado: '+new Date().toLocaleString('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
    populateFilters();
    applyFilters();
    initComparativo();
    showLoading(false);
  }catch(e){console.error('❌ Erro loadData:',e);showError('Não foi possível carregar os dados: '+e.message);showLoading(false);}
}

/* ── FILTROS ── */
function populateFilters(){
  const sel=(id,vals,all)=>{document.getElementById(id).innerHTML=`<option value="">${all}</option>`+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');};
  sel('f-jogo',[...new Set(allData.map(r=>r.jogo).filter(Boolean))].sort(),'Todos');
  sel('f-comp',[...new Set(allData.map(r=>r.comp).filter(Boolean))].sort(),'Todas');
  // Popular local com valores reais da planilha (não hardcoded)
  sel('f-local',[...new Set(allData.map(r=>r.local).filter(Boolean))].sort(),'Todos');
}
function applyFilters(){
  const ds=document.getElementById('f-ds').value,de=document.getElementById('f-de').value;
  const jogo=document.getElementById('f-jogo').value,comp=document.getElementById('f-comp').value;
  const local=document.getElementById('f-local').value;

  filtered=allData.filter(r=>{
    if(ds&&r._date&&r._date<new Date(ds))return false;
    if(de&&r._date&&r._date>new Date(de+'T23:59'))return false;
    if(jogo&&r.jogo!==jogo)return false;
    if(comp&&r.comp!==comp)return false;
    if(local&&(r.local||'').trim()!==local)return false;
    return true;
  });
  renderAll();
}
function clearFilters(){
  ['f-ds','f-de'].forEach(id=>document.getElementById(id).value='');
  ['f-jogo','f-comp','f-local'].forEach(id=>document.getElementById(id).value='');
  applyFilters();
}

/* ── RENDER ── */
function renderAll(){

  renderKPIs();
  renderCharts();
  renderInsights();
  renderTable();
  updateComparativo();
}

/* ── KPIs ── */
function renderKPIs(){
  const gols=sumOf('_gols'),xg=sumOf('_xg'),fin=sumOf('_fin_gol'),posse=avgOf('_posse'),efic=gols-xg;
  const eficFmt=isNaN(efic)?'—':(efic>=0?'+':'')+efic.toFixed(2);
  document.getElementById('k-efic').textContent=eficFmt;
  const b=document.getElementById('k-efic-badge');
  if(!isNaN(efic)){b.textContent=efic>=0?'▲ Acima do xG':'▼ Abaixo do xG';b.className='badge '+(efic>=0?'pos':'neg');}
  document.getElementById('k-gols').textContent=isNaN(gols)?'—':gols;
  document.getElementById('k-jogos').textContent=filtered.length;
  document.getElementById('k-fin').textContent=isNaN(fin)?'—':fin;
  document.getElementById('k-posse').textContent=isNaN(posse)?'—':posse.toFixed(1)+'%';
}

/* ── GRÁFICOS ── */
Chart.defaults.font.family='DM Sans';
Chart.defaults.color='#8A93B2';
const GRID={color:'#DDE3F0'};

function group4(data,field){
  const sorted=[...data].sort((a,b)=>(a._date||0)-(b._date||0));
  const labels=[],values=[];
  for(let i=0;i<sorted.length;i+=4){
    const chunk=sorted.slice(i,i+4);
    labels.push(`J${i+1}–J${Math.min(i+4,sorted.length)}`);
    values.push(chunk.reduce((a,r)=>a+(isNaN(r[field])?0:r[field]),0));
  }
  return{labels,values};
}
function groupPts4(data){
  // Usa os dados já filtrados globalmente — sem re-filtrar internamente
  // O filtro de competição (Série B etc.) já foi aplicado pelo applyFilters()
  const sorted=[...data].sort((a,b)=>(a._date||0)-(b._date||0));
  const labels=[],values=[],colors=[];
  for(let i=0;i<sorted.length;i+=4){
    const chunk=sorted.slice(i,i+4);
    const pts=chunk.reduce((acc,r)=>acc+(isNaN(r._pontos)?0:r._pontos),0);
    labels.push(`J${i+1}–J${Math.min(i+4,sorted.length)}`);
    values.push(pts);colors.push(pts>=8?'#1aaa6eCC':'#C8102ECC');
  }
  return{labels,values,colors};
}
function destroyChart(id){if(charts[id]){charts[id].destroy();charts[id]=null;}}
function lineChart(id,labels,values,label,color){
  destroyChart(id);
  if(!labels||!labels.length) return;
  // Substituir canvas para limpar contexto WebGL/2d anterior
  const old=document.getElementById(id);
  const fresh=document.createElement('canvas');
  fresh.id=id;fresh.style.maxHeight='240px';
  old.parentNode.replaceChild(fresh,old);
  const ctx=fresh.getContext('2d');
  const grad=ctx.createLinearGradient(0,0,0,240);grad.addColorStop(0,color+'33');grad.addColorStop(1,color+'00');
  charts[id]=new Chart(ctx,{type:'line',data:{labels,datasets:[{label,data:values,borderColor:color,backgroundColor:grad,borderWidth:2.5,pointRadius:5,pointBackgroundColor:color,pointBorderColor:'#fff',pointBorderWidth:2,tension:.35,fill:true}]},options:{responsive:true,plugins:{legend:{display:false},tooltip:{mode:'index'}},scales:{x:{grid:GRID},y:{grid:GRID,beginAtZero:true,ticks:{precision:0}}}}});
}
function barChart(id,labels,values,label,color,colors){
  destroyChart(id);
  if(!labels||!labels.length) return;
  // Substituir canvas para limpar contexto anterior
  const old=document.getElementById(id);
  const fresh=document.createElement('canvas');
  fresh.id=id;fresh.style.maxHeight='240px';
  old.parentNode.replaceChild(fresh,old);
  const ctx=fresh.getContext('2d');
  const bg=colors||values.map(()=>color+'CC');const bd=colors?colors.map(c=>c.replace('CC','')):values.map(()=>color);
  charts[id]=new Chart(ctx,{type:'bar',data:{labels,datasets:[{label,data:values,backgroundColor:bg,borderColor:bd,borderWidth:1.5,borderRadius:6}]},options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{afterLabel:i=>{const v=i.raw;if(v>=8)return'✅ Bom aproveitamento';if(v>=4)return'⚠️ Aproveitamento regular';return'❌ Abaixo do esperado';}}}},scales:{x:{grid:{display:false}},y:{grid:GRID,beginAtZero:true,max:12,ticks:{precision:0,stepSize:2}}}},plugins:[{id:'metaLine',afterDraw(chart){const{ctx:c,chartArea:{left,right},scales:{y}}=chart;if(!y)return;const yp=y.getPixelForValue(8);c.save();c.beginPath();c.setLineDash([6,4]);c.strokeStyle='#E8A020';c.lineWidth=2;c.moveTo(left,yp);c.lineTo(right,yp);c.stroke();c.setLineDash([]);c.fillStyle='#E8A020';c.font='bold 11px DM Sans,sans-serif';c.fillText('Meta: 8 pts',right-72,yp-5);c.restore();}}]});
}
function renderCharts(){
  const g=group4(filtered,'_gols'),f=group4(filtered,'_fin_gol'),p=groupPts4(filtered);
  lineChart('ch-gols',g.labels,g.values,'Gols','#C8102E');
  lineChart('ch-fin',f.labels,f.values,'Finalizações no gol','#001A5E');
  barChart('ch-pts',p.labels,p.values,'Pontos','#E8A020',p.colors);
  // Se sem dados, mostrar estado vazio nos canvas
  if(!filtered.length){
    ['ch-gols','ch-fin','ch-pts'].forEach(id=>destroyChart(id));
  }
}

/* ── INSIGHTS ── */
function renderInsights(){
  const grid=document.getElementById('ins-grid');
  if(!filtered.length){grid.innerHTML=`<div class="state-box"><div class="ico">🔍</div><h3>Sem dados</h3><p>Ajuste os filtros.</p></div>`;return;}
  const mxGols=maxBy('_gols'),mxFin=maxBy('_fin_gol'),mxDefG=maxBy('_duelos_def_g');
  const totalGols=sumOf('_gols'),totalFin=sumOf('_fin_gol'),totalPts=sumOf('_pontos');
  const conv=totalFin>0?(totalGols/totalFin*100):0,aprov=filtered.length>0?(totalPts/(filtered.length*3)*100):0;
  const items=[
    {lbl:'Jogo com mais gols marcados',val:mxGols?mxGols.jogo:'—',det:mxGols?`${mxGols._gols} gols · ${fmtDate(mxGols._date)}`:''},
    {lbl:'Jogo com mais finalizações no gol',val:mxFin?mxFin.jogo:'—',det:mxFin?`${mxFin._fin_gol} finalizações · ${fmtDate(mxFin._date)}`:''},
    {lbl:'Jogo com mais duelos defensivos ganhos',val:mxDefG?mxDefG.jogo:'—',det:mxDefG?`${mxDefG._duelos_def_g} duelos · ${fmtDate(mxDefG._date)}`:''},
    {lbl:'Média de gols por jogo',val:(totalGols/filtered.length).toFixed(2),det:`Em ${filtered.length} jogo(s) analisado(s)`},
    {lbl:'Taxa de conversão (gols / finalizações)',val:conv.toFixed(1)+'%',det:`${totalGols} gols em ${totalFin} finalizações no gol`},
    {lbl:'Aproveitamento geral',val:aprov.toFixed(1)+'%',det:`${totalPts} pts de ${filtered.length*3} possíveis`},
  ];
  grid.innerHTML=items.map(i=>`<div class="ins-item"><div class="ins-lbl">${esc(i.lbl)}</div><div class="ins-val">${esc(i.val)}</div><div class="ins-det">${esc(i.det)}</div></div>`).join('');
}

/* ── TABELA ── */
function renderTable(){
  const head=document.getElementById('tbl-head'),body=document.getElementById('tbl-body');
  if(!filtered.length){head.innerHTML='';body.innerHTML=`<tr><td colspan="99"><div class="state-box"><div class="ico">📋</div><h3>Nenhum registro</h3><p>Sem partidas para os filtros selecionados.</p></div></td></tr>`;return;}
  const cols=[
    {lbl:'Data',fmt:r=>fmtDate(r._date)},
    {lbl:'Jogo',fmt:r=>`<td class="td-jogo">${esc(r.jogo||'')}</td>`,raw:true},
    {lbl:'Resultado',fmt:r=>{const v=(r.resultado||'').toLowerCase();let cls='tag-e',txt=r.resultado||'—';if(v.includes('vit'))cls='tag-v';else if(v.includes('der'))cls='tag-d';return`<td><span class="tag ${cls}">${esc(txt)}</span></td>`;},raw:true},
    {lbl:'Pts',fmt:r=>isNaN(r._pontos)?'—':r._pontos},
    {lbl:'Local',fmt:r=>{const v=(r.local||'').toLowerCase();const cls=v.includes('man')?'tag-m':'tag-f';return`<td><span class="tag ${cls}">${esc(r.local||'—')}</span></td>`;},raw:true},
    {lbl:'Competição',fmt:r=>`<td><span class="tag tag-comp">${esc(r.comp||'')}</span></td>`,raw:true},
    {lbl:'Gols',fmt:r=>isNaN(r._gols)?'—':r._gols},
    {lbl:'xG',fmt:r=>isNaN(r._xg)?'—':r._xg},
    {lbl:'Fin. Total',fmt:r=>isNaN(r._fin_total)?'—':r._fin_total},
    {lbl:'Fin. Gol',fmt:r=>isNaN(r._fin_gol)?'—':r._fin_gol},
    {lbl:'Posse %',fmt:r=>isNaN(r._posse)?'—':r._posse+'%'},
    {lbl:'Gols Sof.',fmt:r=>isNaN(r._gols_sof)?'—':r._gols_sof},
    {lbl:'Duelos Def.G',fmt:r=>isNaN(r._duelos_def_g)?'—':r._duelos_def_g},
    {lbl:'PPDA',fmt:r=>(r.ppda&&r.ppda!=='')?r.ppda:'—'},
  ];
  head.innerHTML=`<tr>${cols.map(c=>`<th>${c.lbl}</th>`).join('')}</tr>`;
  // Ordena por data desc; jogos sem data ficam no final
  const sorted=[...filtered].sort((a,b)=>{
    if(!a._date && !b._date) return 0;
    if(!a._date) return 1;   // sem data vai pro final
    if(!b._date) return -1;
    return b._date - a._date;
  });
  body.innerHTML=sorted.map(r=>`<tr>${cols.map(c=>c.raw?c.fmt(r):`<td>${c.fmt(r)}</td>`).join('')}</tr>`).join('');
}

/* ════════════════════════════════════════════════════════════
   COMPARATIVO
   ════════════════════════════════════════════════════════════ */

/* Paleta de cores dos jogos */
const JOGO_CORES = ['#003299','#C8102E','#E8A020','#1aaa6e'];
const JOGO_CORES_SOFT = ['rgba(0,50,153,.15)','rgba(200,16,46,.12)','rgba(232,160,32,.15)','rgba(26,170,110,.12)'];

/* Métricas disponíveis */
const METRICAS = [
  // H-K: Ataque
  {key:'_gols',         lbl:'Gols',                       dir:'max'},
  {key:'_xg',           lbl:'Gols Esperados (xG)',         dir:'max'},
  {key:'_fin_total',    lbl:'Finalizações',                dir:'max'},
  {key:'_fin_gol',      lbl:'Finalizações no Gol',         dir:'max'},
  // L-N: Passes / Posse
  {key:'_passes',       lbl:'Passes',                      dir:'max'},
  {key:'_passes_certos',lbl:'Passes Certos',               dir:'max'},
  {key:'_posse',        lbl:'Posse %',                     dir:'max'},
  // O: Recuperações
  {key:'_recuperacoes', lbl:'Recuperações',                dir:'max'},
  // P-Q: Cruzamentos
  {key:'_cruz',         lbl:'Cruzamentos',                 dir:'max'},
  {key:'_cruz_certos',  lbl:'Cruzamentos Certos',          dir:'max'},
  // R: Entradas
  {key:'_entradas',     lbl:'Entradas na Grande Área',     dir:'max'},
  // S-T: Duelos Ofensivos
  {key:'_duelos_of',    lbl:'Duelos Ofensivos',            dir:'max'},
  {key:'_duelos_of_g',  lbl:'Duelos Ofensivos Ganhos',    dir:'max'},
  // U: Gols Sofridos
  {key:'_gols_sof',     lbl:'Gols Sofridos',               dir:'min'},
  // V-W: Duelos Defensivos
  {key:'_duelos_def',   lbl:'Duelos Defensivos',           dir:'max'},
  {key:'_duelos_def_g', lbl:'Duelos Defensivos Ganhos',   dir:'max'},
  // X-Y: Duelos Aéreos
  {key:'_duelos_aer',   lbl:'Duelos Aéreos',               dir:'max'},
  {key:'_duelos_aer_g', lbl:'Duelos Aéreos Ganhos',       dir:'max'},
  // Z[25]: Interceptações
  {key:'_intersecoes',  lbl:'Interceptações',              dir:'max'},
  // AA[26]: Passes Terço Final
  {key:'_passes_tf',    lbl:'Passes Terço Final',          dir:'max'},
  // AB[27]: Passes Terço Final Certos
  {key:'_passes_tf_c',  lbl:'Passes Terço Final Certos',  dir:'max'},
  // AC-AD-AE-AF
  {key:'_intensidade',  lbl:'Intensidade de Jogo',         dir:'max'},
  {key:'_passe_posse',  lbl:'Média Passes por Posse',      dir:'max'},
  {key:'_comp_passe',   lbl:'Comprimento Médio de Passe',  dir:'max'},
  {key:'_ppda',         lbl:'PPDA',                        dir:'min'},
];

const RADAR_METRICAS = [
  {key:'_gols',         lbl:'Gols'},
  {key:'_fin_gol',      lbl:'Fin. Gol'},
  {key:'_posse',        lbl:'Posse %'},
  {key:'_duelos_def_g', lbl:'Duelos Def.G'},
  {key:'_passes_certos',lbl:'Passes Certos'},
  {key:'_xg',           lbl:'xG'},
];

/* Estado do comparativo */
let selJogos = [null, null, null, null]; // painel A
let multiSel = new Set();               // painel B
let multiMetrica = '_gols';             // painel B

/* ── Tabs ── */
function switchTab(id, btn) {
  document.querySelectorAll('.comp-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.comp-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(id).classList.add('active');
  if(id==='tabB') renderMulti();
  if(id==='tabD'){ buildBlocosCompChips(); buildBlocosGrid(); renderBlocosD(); buildJJCompChips(); buildJJMetricChips(); }
}

/* ── Init ── */
function initComparativo() {
  buildJogosSelectors();
  buildMultiChips();
  buildMultiMetricaSel();
  buildBlocosCompChips();
  buildBlocosMetricChips();
  buildBlocosGrid();
  buildJJCompChips();
  buildJJMetricChips();
}

function updateComparativo() {
  buildJogosSelectors();
  buildMultiChips();
  renderCompA();
  renderMulti();
  buildBlocosCompChips();
  buildBlocosMetricChips();
  buildBlocosGrid();
  if(blocoSelecionado!==null) renderBlocosD();
  buildJJCompChips();
  buildJJMetricChips();
}

/* ────────── PAINEL A ────────── */
function buildJogosSelectors() {
  // Ordena por data mais recente primeiro
  const jogosSorted = [...allData].sort((a,b)=>(b._date||0)-(a._date||0));
  const seen = new Set();
  const jogosDisponiveis = jogosSorted.map(r=>r.jogo).filter(j=>{if(!j||seen.has(j))return false;seen.add(j);return true;});
  const wrap = document.getElementById('jogos-selectors');
  wrap.innerHTML = '';
  for(let i=0;i<4;i++){
    const div=document.createElement('div');div.className='jogo-sel-wrap';
    const label=document.createElement('label');
    const dot=document.createElement('span');dot.className='dot';dot.style.background=JOGO_CORES[i];
    label.appendChild(dot);label.appendChild(document.createTextNode(` Jogo ${i+1}`));
    const sel=document.createElement('select');
    sel.innerHTML=`<option value="">— Selecione —</option>`+jogosDisponiveis.map(j=>`<option value="${esc(j)}" ${selJogos[i]===j?'selected':''}>${esc(j)}</option>`).join('');
    sel.onchange=e=>{selJogos[i]=e.target.value||null;renderCompA();};
    div.appendChild(label);div.appendChild(sel);wrap.appendChild(div);
  }
  renderCompA();
}

function renderCompA() {
  const output = document.getElementById('comp-a-output');
  const jogos = selJogos.map(nome=>nome?allData.find(r=>r.jogo===nome):null).filter(Boolean);
  if(jogos.length<2){
    output.innerHTML=`<div class="state-box" style="padding:30px"><div class="ico">⚔️</div><h3>Selecione ao menos 2 jogos</h3><p>Use os seletores acima para comparar até 4 partidas.</p></div>`;
    return;
  }

  // Tabela comparativa
  const metricsRows = METRICAS.map(m=>{
    const vals = jogos.map(j=>j[m.key]);
    const validos = vals.filter(v=>!isNaN(v));
    const bestVal = validos.length? (m.dir==='max'?Math.max(...validos):Math.min(...validos)) : null;
    const worstVal = validos.length>1? (m.dir==='max'?Math.min(...validos):Math.max(...validos)) : null;
    return {m, vals, bestVal, worstVal};
  });

  // Cabeçalho
  const nJogos = jogos.length;
  const gridCols = `180px ${jogos.map(()=>'1fr').join(' ')}`;

  let html = `<div class="comp-grid" style="grid-template-columns:${gridCols};">`;
  // Header row
  html += `<div class="comp-head-cell metric-hd">Métrica</div>`;
  jogos.forEach((j,i)=>{
    const cor = JOGO_CORES[selJogos.indexOf(j.jogo)];
    html += `<div class="comp-head-cell" style="border-top:3px solid ${cor};">${esc(j.jogo)}<br><span style="font-size:.6rem;opacity:.7">${fmtDate(j._date)}</span></div>`;
  });

  metricsRows.forEach(({m,vals,bestVal,worstVal})=>{
    html += `<div class="comp-row" style="display:contents;">`;
    html += `<div class="comp-cell metric">${m.lbl}</div>`;
    vals.forEach(v=>{
      let cls='draw';
      if(!isNaN(v)&&bestVal!==null&&v===bestVal&&bestVal!==worstVal)cls='best';
      else if(!isNaN(v)&&worstVal!==null&&v===worstVal&&bestVal!==worstVal&&vals.filter(x=>x===worstVal).length<vals.length)cls='worst';
      const display = isNaN(v)?'—':(m.lbl.includes('%')?v.toFixed(1)+'%':v);
      html += `<div class="comp-cell val ${cls}">${display}</div>`;
    });
    html += `</div>`;
  });

  html += `</div>`;

  // Radar chart
  html += `<div class="radar-wrap"><canvas id="ch-radar" style="max-width:420px;max-height:380px;"></canvas></div>`;
  html += `<div class="radar-legend" id="radar-legend"></div>`;

  output.innerHTML = html;

  // Build radar
  setTimeout(()=>{
    const ctx = document.getElementById('ch-radar');
    if(!ctx) return;
    destroyChart('ch-radar');

    // Normalizar: max de cada métrica nos dados totais
    const radarDatasets = jogos.map((j,idx)=>{
      const realIdx = selJogos.indexOf(j.jogo);
      const data = RADAR_METRICAS.map(m=>{
        const allVals = allData.map(r=>r[m.key]).filter(v=>!isNaN(v));
        const maxV = allVals.length?Math.max(...allVals):1;
        const v = j[m.key];
        return isNaN(v)?0:Math.round((v/maxV)*100);
      });
      return {
        label: j.jogo,
        data,
        borderColor: JOGO_CORES[realIdx],
        backgroundColor: JOGO_CORES_SOFT[realIdx],
        borderWidth: 2,
        pointBackgroundColor: JOGO_CORES[realIdx],
        pointRadius: 4,
      };
    });

    charts['ch-radar'] = new Chart(ctx, {
      type:'radar',
      data:{labels:RADAR_METRICAS.map(m=>m.lbl), datasets:radarDatasets},
      options:{
        responsive:true,
        plugins:{legend:{display:false}},
        scales:{r:{
          beginAtZero:true,max:100,
          ticks:{display:false},
          grid:{color:'#DDE3F0'},
          pointLabels:{font:{family:'DM Sans',size:11},color:'#4A5578'},
        }},
      }
    });

    // Legenda radar
    const legEl = document.getElementById('radar-legend');
    if(legEl) legEl.innerHTML = jogos.map((j,i)=>{
      const realIdx = selJogos.indexOf(j.jogo);
      return `<div class="radar-legend-item"><div class="radar-legend-dot" style="background:${JOGO_CORES[realIdx]}"></div>${esc(j.jogo)}</div>`;
    }).join('');
  },50);
}

/* ────────── PAINEL B ────────── */
function buildMultiChips(){
  // Ordena por data mais recente primeiro
  const jogosSorted2 = [...allData].sort((a,b)=>(b._date||0)-(a._date||0));
  const seen2 = new Set();
  const jogosDisponiveis = jogosSorted2.map(r=>r.jogo).filter(j=>{if(!j||seen2.has(j))return false;seen2.add(j);return true;});
  const wrap = document.getElementById('multi-chip-list');
  if(!wrap) return;
  // Limpa seleções que não existem mais
  multiSel.forEach(s=>{ if(!jogosDisponiveis.includes(s)) multiSel.delete(s); });
  wrap.innerHTML = jogosDisponiveis.map(j=>{
    const sel = multiSel.has(j);
    return `<span class="multi-chip ${sel?'selected':''}" onclick="toggleMultiChip(this,'${esc(j)}')">${esc(j)}${sel?'<span class="chip-x">×</span>':''}</span>`;
  }).join('');
}

function toggleMultiChip(el, nome) {
  if(multiSel.has(nome)){ multiSel.delete(nome); el.classList.remove('selected'); el.querySelector('.chip-x')&&el.querySelector('.chip-x').remove(); }
  else { multiSel.add(nome); el.classList.add('selected'); const x=document.createElement('span');x.className='chip-x';x.textContent='×';el.appendChild(x); }
  renderMulti();
}

function buildMultiMetricaSel(){
  const wrap = document.getElementById('multi-metric-sel');
  if(!wrap) return;
  wrap.innerHTML = METRICAS.map(m=>`<span class="metric-chip ${m.key===multiMetrica?'selected':''}" onclick="selectMultiMetrica('${m.key}',this)">${m.lbl}</span>`).join('');
}

function selectMultiMetrica(key, el){
  multiMetrica = key;
  document.querySelectorAll('.metric-chip').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  renderMulti();
}

function renderMulti(){
  if(!document.getElementById('ch-multi')) return;
  const jogos = [...multiSel].map(nome=>allData.find(r=>r.jogo===nome)).filter(Boolean);
  destroyChart('ch-multi');
  if(jogos.length<2){return;}
  const m = METRICAS.find(x=>x.key===multiMetrica)||METRICAS[0];
  const labels = jogos.map(j=>j.jogo);
  const values = jogos.map(j=>isNaN(j[m.key])?0:j[m.key]);
  const maxV = Math.max(...values);
  const colors = values.map(v=>v===maxV?'#1aaa6eCC':'#003299CC');
  const ctx = document.getElementById('ch-multi').getContext('2d');
  charts['ch-multi'] = new Chart(ctx,{
    type:'bar',
    data:{labels,datasets:[{label:m.lbl,data:values,backgroundColor:colors,borderRadius:6,borderWidth:0}]},
    options:{
      indexAxis:'y',
      responsive:true,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:i=>`${m.lbl}: ${i.raw}`}}},
      scales:{x:{grid:GRID,beginAtZero:true},y:{grid:{display:false},ticks:{font:{size:11}}}},
    }
  });
}

/* ────────── PAINEL C ────────── */
function getPeriodStats(ds, de){
  if(!ds||!de) return null;
  const d1=new Date(ds), d2=new Date(de+'T23:59');
  const data = allData.filter(r=>r._date&&r._date>=d1&&r._date<=d2);
  if(!data.length) return null;
  return {
    data,
    n: data.length,
    gols: sumOf('_gols',data),
    gols_sof: sumOf('_gols_sof',data),
    xg: sumOf('_xg',data),
    fin_gol: sumOf('_fin_gol',data),
    posse: avgOf('_posse',data),
    duelos_def_g: sumOf('_duelos_def_g',data),
    pontos: sumOf('_pontos',data),
    passes_certos: sumOf('_passes_certos',data),
  };
}

function renderPeriodo(){
  const p1s=document.getElementById('p1-ds').value,p1e=document.getElementById('p1-de').value;
  const p2s=document.getElementById('p2-ds').value,p2e=document.getElementById('p2-de').value;
  const out=document.getElementById('periodo-output');

  if(!p1s||!p1e||!p2s||!p2e){
    out.innerHTML=`<div class="state-box" style="padding:24px"><div class="ico">📅</div><h3>Preencha as datas dos dois períodos</h3></div>`;
    return;
  }
  const s1=getPeriodStats(p1s,p1e),s2=getPeriodStats(p2s,p2e);
  if(!s1||!s2){
    out.innerHTML=`<div class="state-box" style="padding:24px"><div class="ico">⚠️</div><h3>Sem dados em um dos períodos</h3><p>Verifique as datas selecionadas.</p></div>`;
    return;
  }

  const fmtPer=(ds,de)=>`${new Date(ds).toLocaleDateString('pt-BR')} → ${new Date(de+'T23:59').toLocaleDateString('pt-BR')}`;

  const linhas = [
    {lbl:'Jogos',k:'n',fmt:v=>v,dir:'neu'},
    {lbl:'Gols marcados',k:'gols',fmt:v=>v,dir:'max'},
    {lbl:'Gols sofridos',k:'gols_sof',fmt:v=>v,dir:'min'},
    {lbl:'xG',k:'xg',fmt:v=>v.toFixed(2),dir:'max'},
    {lbl:'Finalizações no Gol',k:'fin_gol',fmt:v=>v,dir:'max'},
    {lbl:'Média Posse %',k:'posse',fmt:v=>isNaN(v)?'—':v.toFixed(1)+'%',dir:'max'},
    {lbl:'Duelos Def. Ganhos',k:'duelos_def_g',fmt:v=>v,dir:'max'},
    {lbl:'Pontos',k:'pontos',fmt:v=>v,dir:'max'},
    {lbl:'Passes Certos',k:'passes_certos',fmt:v=>v,dir:'max'},
  ];

  const cardHTML = (stats, label, cor, ds, de) => {
    const rows = linhas.map(l=>{
      const v1=stats===s1?s1[l.k]:s2[l.k];
      const v2=stats===s1?s2[l.k]:s1[l.k];
      let cls='';
      if(l.dir==='max'&&!isNaN(v1)&&!isNaN(v2)){if(v1>v2)cls='melhor';else if(v1<v2)cls='pior';}
      if(l.dir==='min'&&!isNaN(v1)&&!isNaN(v2)){if(v1<v2)cls='melhor';else if(v1>v2)cls='pior';}
      let delta='';
      if(l.dir!=='neu'&&!isNaN(v1)&&!isNaN(v2)&&v2!==0){
        const pct=((v1-v2)/Math.abs(v2)*100);
        const sign=pct>=0?'+':'';
        const dcls=l.dir==='max'?(pct>=0?'pos':'neg'):(pct<=0?'pos':'neg');
        delta=`<span class="periodo-delta ${dcls}">${sign}${pct.toFixed(1)}%</span>`;
      }
      return `<div class="periodo-stat"><span class="periodo-stat-lbl">${l.lbl}</span><span class="periodo-stat-val ${cls}">${typeof l.fmt(stats[l.k])==='string'?l.fmt(stats[l.k]):l.fmt(stats[l.k])}${delta}</span></div>`;
    }).join('');
    return `<div class="periodo-card"><h4 style="color:${cor}">${label}<br><span style="font-size:.68rem;color:var(--t3);font-family:'DM Sans'">${fmtPer(ds,de)} · ${stats.n} jogo(s)</span></h4>${rows}</div>`;
  };

  // Gráfico de barras comparativo
  const metricsComp = linhas.filter(l=>l.dir!=='neu');
  const labelsComp = metricsComp.map(l=>l.lbl);
  const vals1 = metricsComp.map(l=>isNaN(s1[l.k])?0:s1[l.k]);
  const vals2 = metricsComp.map(l=>isNaN(s2[l.k])?0:s2[l.k]);

  out.innerHTML = `
    <div class="periodo-results">
      ${cardHTML(s1,'Período 1','#003299',p1s,p1e)}
      ${cardHTML(s2,'Período 2','#C8102E',p2s,p2e)}
    </div>
    <div class="periodo-chart-wrap">
      <p class="sec-title" style="font-size:.86rem;margin-bottom:12px;">Comparativo Visual <span class="pill">Períodos</span></p>
      <canvas id="ch-periodo" style="max-height:280px;"></canvas>
    </div>`;

  setTimeout(()=>{
    const ctx=document.getElementById('ch-periodo');
    if(!ctx) return;
    destroyChart('ch-periodo');
    charts['ch-periodo']=new Chart(ctx,{
      type:'bar',
      data:{labels:labelsComp,datasets:[
        {label:'Período 1',data:vals1,backgroundColor:'rgba(0,50,153,.75)',borderRadius:5,borderWidth:0},
        {label:'Período 2',data:vals2,backgroundColor:'rgba(200,16,46,.7)',borderRadius:5,borderWidth:0},
      ]},
      options:{
        responsive:true,
        plugins:{legend:{position:'top',labels:{font:{family:'DM Sans',size:11}}}},
        scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{grid:GRID,beginAtZero:true}},
      }
    });
  },50);
}

/* ════════════════════════════════════════════════════════════
   PAINEL D — BLOCOS DE 4 JOGOS
   ════════════════════════════════════════════════════════════ */

let blocosMetrica = '_gols';
let blocoSelecionado = null; // índice do bloco (0-based)
let blocosComps = new Set();  // competições selecionadas no filtro D

// Métricas disponíveis para Painel D (subconjunto legível)
const BLOCOS_METRICAS = [
  {key:'_gols',         lbl:'Gols'},
  {key:'_xg',           lbl:'xG'},
  {key:'_fin_total',    lbl:'Finalizações'},
  {key:'_fin_gol',      lbl:'Fin. no Gol'},
  {key:'_passes',       lbl:'Passes'},
  {key:'_passes_certos',lbl:'Passes Certos'},
  {key:'_posse',        lbl:'Posse %'},
  {key:'_recuperacoes', lbl:'Recuperações'},
  {key:'_cruz',         lbl:'Cruzamentos'},
  {key:'_cruz_certos',  lbl:'Cruz. Certos'},
  {key:'_entradas',     lbl:'Entradas Área'},
  {key:'_duelos_of',    lbl:'Duelos Of.'},
  {key:'_duelos_of_g',  lbl:'Duelos Of. G'},
  {key:'_gols_sof',     lbl:'Gols Sofridos'},
  {key:'_duelos_def',   lbl:'Duelos Def.'},
  {key:'_duelos_def_g', lbl:'Duelos Def. G'},
  {key:'_duelos_aer',   lbl:'Duelos Aéreos'},
  {key:'_duelos_aer_g', lbl:'Duelos Aér. G'},
  {key:'_intersecoes',  lbl:'Interceptações'},
  {key:'_passes_tf',    lbl:'Passes T. Final'},
  {key:'_passes_tf_c',  lbl:'Passes T.F. C'},
  {key:'_intensidade',  lbl:'Intensidade'},
  {key:'_passe_posse',  lbl:'Passes/Posse'},
  {key:'_comp_passe',   lbl:'Comp. Passe'},
  {key:'_ppda',         lbl:'PPDA'},
  {key:'_pontos',       lbl:'Pontos'},
];

// Retorna todas as competições únicas da planilha
function getCompsDisponiveis() {
  return [...new Set(allData.map(r=>r.comp).filter(Boolean))].sort();
}

// Detecta Série B pelo nome normalizado
function isSerieB(comp) {
  if(!comp) return false;
  const c = comp.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  return c.includes('serie b') || c.includes('serieb');
}

// Constrói chips de filtro de competição
function buildBlocosCompChips() {
  const wrap = document.getElementById('blocos-comp-chips');
  if(!wrap) return;
  const comps = getCompsDisponiveis();

  // Na primeira carga: pré-selecionar Série B se existir, senão todas
  if(blocosComps.size === 0) {
    const sb = comps.find(isSerieB);
    if(sb) blocosComps.add(sb);
    else comps.forEach(c=>blocosComps.add(c));
  }

  // Guardar lista para acesso por índice (evita problema de aspas no onclick)
  window._blocosCompsLista = comps;
  wrap.innerHTML = comps.map((c,idx) => {
    const sel = blocosComps.has(c);
    const sb = isSerieB(c);
    return `<span class="comp-filter-chip ${sel?'selected':''}"
      style="${sb&&sel?'background:var(--blue);border-color:var(--blue);':''}${sb&&!sel?'border-color:var(--blue);color:var(--blue);':''}"
      onclick="toggleBlocoCompIdx(${idx})" title="${c}">
      ${sb?'⭐ ':''}${c}
    </span>`;
  }).join('');

  updateBlocosCompInfo();
}

function toggleBlocoCompIdx(idx) {
  const comp = (window._blocosCompsLista||[])[idx];
  if(!comp) return;
  toggleBlocoComp(comp);
}

function toggleBlocoComp(comp) {
  if(blocosComps.has(comp)) {
    if(blocosComps.size > 1) blocosComps.delete(comp);
  } else {
    blocosComps.add(comp);
  }
  blocoSelecionado = null;
  buildBlocosCompChips();
  buildBlocosGrid();
  renderBlocosD();
}

function updateBlocosCompInfo() {
  const info = document.getElementById('blocos-comp-info');
  if(!info) return;
  const total = getJogosCrono().length;
  const compsStr = [...blocosComps].join(', ');
  info.textContent = `${total} jogo(s) encontrado(s) em: ${compsStr}`;
}

// Retorna jogos filtrados pelas competições selecionadas, em ordem cronológica
function getJogosCrono() {
  // Parte dos dados já filtrados globalmente (filtered),
  // aplicando ADICIONALMENTE o filtro de competição próprio do Painel D
  const base = blocosComps.size > 0
    ? allData.filter(r => blocosComps.has(r.comp))  // usa allData pois Painel D tem filtro próprio
    : allData;
  const seen = new Set();
  return [...base]
    .sort((a,b)=>(a._date||0)-(b._date||0))
    .filter(r=>{
      if(!r.jogo||seen.has(r.jogo)) return false;
      seen.add(r.jogo);
      return true;
    });
}

// Divide jogos em blocos de 4
function getBlocos() {
  const jogos = getJogosCrono();
  const blocos = [];
  for(let i=0;i<jogos.length;i+=4){
    blocos.push(jogos.slice(i,i+4));
  }
  return blocos;
}

function buildBlocosMetricChips() {
  const wrap = document.getElementById('blocos-metric-chips');
  if(!wrap) return;
  wrap.innerHTML = BLOCOS_METRICAS.map(m=>
    `<span class="bloco-chip-m ${m.key===blocosMetrica?'selected':''}"
      onclick="selectBlocoMetrica('${m.key}',this)">${m.lbl}</span>`
  ).join('');
}

function selectBlocoMetrica(key, el) {
  blocosMetrica = key;
  document.querySelectorAll('.bloco-chip-m').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  renderBlocosD();
}

function buildBlocosGrid() {
  const wrap = document.getElementById('blocos-grid');
  if(!wrap) return;
  const blocos = getBlocos();
  if(!blocos.length){ wrap.innerHTML='<span style="color:var(--t3);font-size:.82rem;">Sem dados suficientes.</span>'; return; }

  wrap.innerHTML = blocos.map((bloco,i)=>{
    const d1 = bloco[0]._date ? bloco[0]._date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) : '';
    const d2 = bloco[bloco.length-1]._date ? bloco[bloco.length-1]._date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) : '';
    let cls = '';
    if(blocoSelecionado===i) cls='selected-b1';
    else if(blocoSelecionado!==null && i===blocoSelecionado+1) cls='selected-b2';
    const jogosNomes = bloco.map(j=>{ const pts = isNaN(j._pontos)?'':' ('+j._pontos+'pts)'; return j.jogo+pts; }).join(' | ');
    return `<div class="bloco-chip ${cls}" onclick="selecionarBloco(${i})" title="${jogosNomes}">
      <span>Bloco ${i+1}</span>
      <span class="chip-num">${d1}→${d2}</span>
      <span class="chip-num">${bloco.length} jogo(s)</span>
    </div>`;
  }).join('');
  updateBlocosCompInfo();
}

function selecionarBloco(idx) {
  blocoSelecionado = idx;
  buildBlocosGrid();
  renderBlocosD();
}

function calcBlocoStats(bloco) {
  const stats = {};
  BLOCOS_METRICAS.forEach(m=>{
    const vals = bloco.map(j=>j[m.key]).filter(v=>!isNaN(v)&&v!==null);
    stats[m.key] = {
      total: vals.reduce((a,b)=>a+b,0),
      media: vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : NaN,
      n: vals.length,
    };
  });
  return stats;
}

function renderBlocosD() {
  const out = document.getElementById('blocos-output');
  if(!out) return;
  const blocos = getBlocos();

  if(blocoSelecionado===null || blocoSelecionado>=blocos.length){
    out.innerHTML=`<div class="state-box" style="padding:28px"><div class="ico">📈</div>
      <h3>Selecione um bloco acima</h3>
      <p>Clique em um bloco para comparar com o seguinte.</p></div>`;
    return;
  }

  const b1 = blocos[blocoSelecionado];
  const b2idx = blocoSelecionado+1;
  const hasB2 = b2idx < blocos.length;
  const b2 = hasB2 ? blocos[b2idx] : null;

  const s1 = calcBlocoStats(b1);
  const s2 = hasB2 ? calcBlocoStats(b2) : null;

  const m = BLOCOS_METRICAS.find(x=>x.key===blocosMetrica)||BLOCOS_METRICAS[0];
  const isMin = m.key==='_gols_sof'||m.key==='_ppda';

  // Labels dos blocos
  const fmtBloco = (bloco,idx) => {
    const d1=bloco[0]._date?bloco[0]._date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'';
    const d2=bloco[bloco.length-1]._date?bloco[bloco.length-1]._date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'';
    return `Bloco ${idx+1} (${d1}–${d2})`;
  };
  const lbl1 = fmtBloco(b1, blocoSelecionado);
  const lbl2 = hasB2 ? fmtBloco(b2, b2idx) : null;

  // Cards de stats para a métrica selecionada
  const fmtVal = (v,decimals=2) => isNaN(v)?'—':v.toFixed(decimals);
  const stat1 = s1[m.key];
  const stat2 = s2 ? s2[m.key] : null;

  const media1 = stat1.media;
  const media2 = stat2 ? stat2.media : NaN;
  let diffHtml = '';
  if(!isNaN(media1)&&!isNaN(media2)&&media2!==0){
    const pct = ((media1-media2)/Math.abs(media2)*100);
    const better = isMin ? pct<=0 : pct>=0;
    const sign = pct>=0?'+':'';
    diffHtml = `<span class="bloco-delta ${better?'pos':'neg'}">${sign}${pct.toFixed(1)}%</span>`;
  }

  // Gerar cards resumo
  const cardHTML = (bloco, stats, lbl, cor, idx) => {
    const lines = BLOCOS_METRICAS.slice(0,10).map(mm=>{
      const v1 = stats[mm.key].media;
      const v2 = s2 ? s2[mm.key].media : NaN;
      const isMinM = mm.key==='_gols_sof'||mm.key==='_ppda';
      let cls = 'neutro';
      if(!isNaN(v1)&&!isNaN(v2)&&hasB2){
        if(isMinM) cls = v1<v2?'melhor':v1>v2?'pior':'neutro';
        else cls = v1>v2?'melhor':v1<v2?'pior':'neutro';
        if(idx===1) cls = cls==='melhor'?'pior':cls==='pior'?'melhor':'neutro'; // inverter para bloco 2
      }
      return `<div class="blocos-stat-line">
        <span class="blocos-stat-lbl">${mm.lbl}</span>
        <span class="blocos-stat-val ${idx===0?cls:'neutro'}">${isNaN(v1)?'—':v1.toFixed(2)}</span>
      </div>`;
    }).join('');
    return `<div class="blocos-stat-card">
      <h4 style="color:${cor};display:flex;align-items:center;gap:8px;">
        <span style="width:10px;height:10px;border-radius:3px;background:${cor};display:inline-block;flex-shrink:0;"></span>
        ${esc(lbl)}<br>
        <span style="font-family:'DM Sans';font-size:.72rem;color:var(--t3);font-weight:400">${bloco.length} jogos · Média ${m.lbl}: <strong style="color:${cor}">${fmtVal(stats[m.key].media)}</strong>${idx===0?diffHtml:''}</span>
      </h4>
      ${lines}
      <div style="font-size:.68rem;color:var(--t3);margin-top:8px;">Mostrando média das 10 primeiras métricas</div>
    </div>`;
  };

  let cardsHTML = `<div class="blocos-stats-row">
    ${cardHTML(b1,s1,lbl1,'#003299',0)}
    ${hasB2 ? cardHTML(b2,s2,lbl2,'#C8102E',1) : `<div class="blocos-stat-card" style="display:flex;align-items:center;justify-content:center;"><p style="color:var(--t3);font-size:.85rem">Não há bloco seguinte.</p></div>`}
  </div>`;

  // Gráfico de linhas — média de cada bloco para a métrica selecionada
  // Mostra TODOS os blocos com linha + destaque nos blocos selecionados
  const allBlocoStats = blocos.map(b=>calcBlocoStats(b));
  const allMedias = allBlocoStats.map(s=>isNaN(s[m.key].media)?null:parseFloat(s[m.key].media.toFixed(3)));
  const chartLabels = blocos.map((_,i)=>`Bloco ${i+1}`);

  // Pontos destacados
  const pointColors = blocos.map((_,i)=>{
    if(i===blocoSelecionado) return '#003299';
    if(hasB2&&i===b2idx) return '#C8102E';
    return 'rgba(0,50,153,0.3)';
  });
  const pointRadius = blocos.map((_,i)=>(i===blocoSelecionado||i===b2idx)?7:4);
  const pointBorder = blocos.map((_,i)=>(i===blocoSelecionado||i===b2idx)?'#fff':'#fff');

  out.innerHTML = `
    <div class="bloco-legenda">
      <div class="bloco-legenda-item"><div class="bloco-legenda-dot" style="background:#003299"></div>${esc(lbl1)}</div>
      ${hasB2?`<div class="bloco-legenda-item"><div class="bloco-legenda-dot" style="background:#C8102E"></div>${esc(lbl2)}</div>`:''}
    </div>
    ${cardsHTML}
    <div class="blocos-chart-wrap">
      <p class="sec-title" style="font-size:.86rem;margin-bottom:14px;">
        Evolução da Média — ${esc(m.lbl)} <span class="pill">por bloco de 4 jogos</span>
      </p>
      <canvas id="ch-blocos" style="max-height:320px;"></canvas>
    </div>`;

  // Renderizar gráfico de linhas
  setTimeout(()=>{
    const ctx = document.getElementById('ch-blocos');
    if(!ctx) return;
    destroyChart('ch-blocos');

    // Segmento colorido: linha azul para bloco selecionado → vermelho para próximo
    const grad = ctx.getContext('2d').createLinearGradient(0,0,0,320);
    grad.addColorStop(0,'rgba(0,50,153,.18)');
    grad.addColorStop(1,'rgba(0,50,153,.01)');

    charts['ch-blocos'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartLabels,
        datasets: [
          // Linha de fundo — todos os blocos
          {
            label: m.lbl+' (média)',
            data: allMedias,
            borderColor: 'rgba(0,50,153,0.5)',
            backgroundColor: grad,
            borderWidth: 2,
            pointBackgroundColor: pointColors,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: pointRadius,
            pointHoverRadius: 8,
            tension: 0.35,
            fill: true,
          },
          // Dataset fantasma para destaque bloco 1 (linha tracejada entre os dois)
          ...(hasB2 ? [{
            label: `${lbl1} → ${lbl2}`,
            data: allMedias.map((v,i)=>
              (i===blocoSelecionado||i===b2idx) ? v : null
            ),
            borderColor: '#E8A020',
            borderWidth: 2.5,
            borderDash: [6,4],
            pointBackgroundColor: allMedias.map((_,i)=>
              i===blocoSelecionado?'#003299':i===b2idx?'#C8102E':'transparent'
            ),
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: allMedias.map((_,i)=>(i===blocoSelecionado||i===b2idx)?8:0),
            tension: 0,
            fill: false,
            spanGaps: false,
          }] : []),
        ],
      },
      options: {
        responsive: true,
        interaction: { mode:'index', intersect:false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { font:{family:'DM Sans',size:11}, boxWidth:12, padding:16 }
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const v = ctx.raw;
                if(v===null) return null;
                const i = ctx.dataIndex;
                const tag = i===blocoSelecionado?' ◀ Bloco selecionado':hasB2&&i===b2idx?' ◀ Próximo bloco':'';
                return ` ${ctx.dataset.label.split('(')[0].trim()}: ${v===null?'—':v.toFixed(2)}${tag}`;
              }
            }
          },
          annotation: {},
        },
        scales: {
          x: { grid: GRID, ticks:{ font:{size:11} } },
          y: {
            grid: GRID,
            beginAtZero: m.key!=='_ppda'&&m.key!=='_comp_passe'&&m.key!=='_posse',
            ticks: { precision:2 },
          }
        }
      }
    });
  }, 50);
}

/* ════════════════════════════════════════════════════════════
   GRÁFICO JOGO A JOGO
   ════════════════════════════════════════════════════════════ */

let jjComps = new Set();
let jjMetrica = '_gols';
window._jjCompsLista = [];

function buildJJCompChips() {
  const wrap = document.getElementById('jj-comp-chips');
  if(!wrap) return;
  const comps = getCompsDisponiveis();
  window._jjCompsLista = comps;

  // Pré-selecionar Série B na primeira carga
  if(jjComps.size === 0) {
    const sb = comps.find(isSerieB);
    if(sb) jjComps.add(sb);
    else comps.forEach(c=>jjComps.add(c));
  }

  wrap.innerHTML = comps.map((c,idx)=>{
    const sel = jjComps.has(c);
    const sb = isSerieB(c);
    return `<span class="jj-comp-chip ${sel?'selected':''} ${sb?'serie-b-chip':''}"
      onclick="toggleJJCompIdx(${idx})">
      ${sb?'⭐ ':''}${esc(c)}
    </span>`;
  }).join('');

  renderJJ();
}

function toggleJJCompIdx(idx) {
  const comp = (window._jjCompsLista||[])[idx];
  if(!comp) return;
  if(jjComps.has(comp)) {
    if(jjComps.size > 1) jjComps.delete(comp);
  } else {
    jjComps.add(comp);
  }
  buildJJCompChips();
}

function buildJJMetricChips() {
  const wrap = document.getElementById('jj-metric-chips');
  if(!wrap) return;
  wrap.innerHTML = BLOCOS_METRICAS.map(m=>{
    const sel = m.key === jjMetrica;
    return `<span class="bloco-chip-m ${sel?'selected':''}"
      onclick="selectJJMetrica('${m.key}',this)">${m.lbl}</span>`;
  }).join('');
}

function selectJJMetrica(key, el) {
  jjMetrica = key;
  document.querySelectorAll('#jj-metric-chips .bloco-chip-m').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  renderJJ();
}

function renderJJ() {
  const ctx = document.getElementById('ch-jj');
  if(!ctx) return;
  destroyChart('ch-jj');

  // Jogos filtrados pelas competições JJ, em ordem cronológica
  const seen = new Set();
  const jogos = [...allData]
    .sort((a,b)=>(a._date||0)-(b._date||0))
    .filter(r=>{
      if(!r.jogo||seen.has(r.jogo)) return false;
      if(jjComps.size>0 && !jjComps.has(r.comp)) return false;
      seen.add(r.jogo);
      return true;
    });

  if(!jogos.length) return;

  const m = BLOCOS_METRICAS.find(x=>x.key===jjMetrica) || BLOCOS_METRICAS[0];
  // Usar nome do jogo como label do eixo X (abreviado para caber)
  const labels = jogos.map(j=>{
    const nome = j.jogo||'';
    // Abreviação: remove placar (ex: " 2:1") e limita a 18 chars
    return nome.replace(/\s+\d+:\d+\s*$/,'').slice(0,18);
  });
  const values = jogos.map(j=>isNaN(j[m.key])?null:j[m.key]);
  const jogoNomes = jogos.map(j=>j.jogo||'');
  const jogoDatas = jogos.map(j=>j._date?j._date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'');
  const jogoResultados = jogos.map(j=>j.resultado||'');
  const jogoComps = jogos.map(j=>j.comp||'');

  // Cores dos pontos por resultado
  const ptColors = jogos.map(j=>{
    const r=(j.resultado||'').toLowerCase();
    if(r.includes('vit')) return '#1aaa6e';
    if(r.includes('der')) return '#C8102E';
    return '#E8A020';
  });

  // Gradiente de fundo
  const grd = ctx.getContext('2d').createLinearGradient(0,0,0,340);
  grd.addColorStop(0,'rgba(0,50,153,.15)');
  grd.addColorStop(1,'rgba(0,50,153,.01)');

  // Média geral
  const validVals = values.filter(v=>v!==null);
  const media = validVals.length ? validVals.reduce((a,b)=>a+b,0)/validVals.length : null;

  charts['ch-jj'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: m.lbl,
          data: values,
          borderColor: '#003299',
          backgroundColor: grd,
          borderWidth: 2.5,
          pointBackgroundColor: ptColors,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 9,
          tension: 0.3,
          fill: true,
          spanGaps: false,
        },
        // Linha de média
        ...(media!==null ? [{
          label: `Média (${media.toFixed(2)})`,
          data: values.map(v=>v!==null?media:null),
          borderColor: '#E8A020',
          borderWidth: 1.5,
          borderDash: [6,4],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          spanGaps: true,
          tension: 0,
        }] : []),
      ],
    },
    options: {
      responsive: true,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            font:{family:'DM Sans',size:11},
            boxWidth:12, padding:16,
            generateLabels: chart => {
              const def = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              // Adicionar legenda dos pontos coloridos
              def.push(
                {text:'Vitória', fillStyle:'#1aaa6e', strokeStyle:'#1aaa6e', lineWidth:0, pointStyle:'circle'},
                {text:'Empate', fillStyle:'#E8A020', strokeStyle:'#E8A020', lineWidth:0, pointStyle:'circle'},
                {text:'Derrota', fillStyle:'#C8102E', strokeStyle:'#C8102E', lineWidth:0, pointStyle:'circle'},
              );
              return def;
            }
          }
        },
        tooltip: {
          callbacks: {
            title: items => {
              const i = items[0].dataIndex;
              return jogoNomes[i] || labels[i];
            },
            beforeBody: items => {
              const i = items[0].dataIndex;
              const parts = [];
              if(jogoDatas[i]) parts.push('📅 '+jogoDatas[i]);
              if(jogoComps[i]) parts.push('🏆 '+jogoComps[i]);
              if(jogoResultados[i]) parts.push('⚽ '+jogoResultados[i]);
              return parts;
            },
            label: item => {
              if(item.raw===null) return null;
              return ` ${m.lbl}: ${item.raw}`;
            },
            afterBody: items => {
              const i = items[0].dataIndex;
              if(media!==null){
                const v = values[i];
                if(v===null) return [];
                const diff = v - media;
                const sign = diff>=0?'+':'';
                return [`↔ vs média: ${sign}${diff.toFixed(2)}`];
              }
              return [];
            }
          },
          backgroundColor: 'rgba(13,27,62,.92)',
          titleFont: {family:'Syne',size:12,weight:'bold'},
          bodyFont: {family:'DM Sans',size:11},
          padding: 12,
          cornerRadius: 8,
        }
      },
      scales: {
        x: {
          grid: GRID,
          ticks: {
            font:{size:10},
            maxRotation: 45,
            minRotation: 45,
            autoSkip: false,
          }
        },
        y: {
          grid: GRID,
          beginAtZero: jjMetrica!=='_ppda'&&jjMetrica!=='_comp_passe'&&jjMetrica!=='_posse',
          ticks: { precision: 1 }
        }
      }
    }
  });
}

/* ════════════════════════════════════════════════════════════
   EXPORTAÇÃO PDF
   ════════════════════════════════════════════════════════════ */
async function exportPDF(){
  const btn=document.querySelector('.btn-pdf');
  btn.classList.add('loading');
  showPdfOverlay('Preparando exportação…',5);

  try{
    const {jsPDF}=window.jspdf;
    const pdf=new jsPDF({orientation:'p',unit:'mm',format:'a4'});
    const W=210,M=14,CW=W-M*2;

    // ── Capa / header ──
    pdf.setFillColor(0,26,94);pdf.rect(0,0,W,38,'F');
    pdf.setTextColor(255,255,255);
    pdf.setFont('helvetica','bold');pdf.setFontSize(16);
    pdf.text('Fortaleza Esporte Clube',M,16);
    pdf.setFontSize(8);pdf.setFont('helvetica','normal');
    pdf.setTextColor(180,190,220);
    pdf.text('PERFORMANCE ANALYTICS DASHBOARD · CIFEC — CENTRO DE INTELIGÊNCIA',M,22);
    pdf.setTextColor(255,255,255);
    pdf.setFontSize(8);
    const now=new Date().toLocaleString('pt-BR');
    pdf.text(`Gerado em: ${now}`,W-M,22,{align:'right'});

    // Filtros ativos
    const ativos=[];
    const fComp=document.getElementById('f-comp').value;
    const fLocal=document.getElementById('f-local').value;
    const fDs=document.getElementById('f-ds').value;
    const fDe=document.getElementById('f-de').value;
    if(fComp)ativos.push(`Competição: ${fComp}`);
    if(fLocal)ativos.push(`Local: ${fLocal}`);
    if(fDs)ativos.push(`De: ${new Date(fDs).toLocaleDateString('pt-BR')}`);
    if(fDe)ativos.push(`Até: ${new Date(fDe).toLocaleDateString('pt-BR')}`);
    pdf.setFontSize(7.5);pdf.setTextColor(200,210,235);
    if(ativos.length) pdf.text('Filtros: '+ativos.join(' · '),M,29);
    else pdf.text(`Todos os jogos · ${filtered.length} partida(s) analisada(s)`,M,29);

    let y=46;

    // ── KPIs ──
    showPdfOverlay('Capturando KPIs…',20);
    pdf.setTextColor(13,27,62);pdf.setFont('helvetica','bold');pdf.setFontSize(10);
    pdf.text('Indicadores de Performance',M,y);y+=6;

    const kpiW=(CW-9)/4;
    const kpis=[
      {lbl:'Eficiência Ataque',val:document.getElementById('k-efic').textContent,cor:[200,16,46]},
      {lbl:'Total de Gols',val:document.getElementById('k-gols').textContent,cor:[0,50,153]},
      {lbl:'Fin. no Gol',val:document.getElementById('k-fin').textContent,cor:[232,160,32]},
      {lbl:'Média Posse',val:document.getElementById('k-posse').textContent,cor:[26,170,110]},
    ];
    kpis.forEach((k,i)=>{
      const x=M+i*(kpiW+3);
      pdf.setFillColor(242,245,251);pdf.roundedRect(x,y,kpiW,20,2,2,'F');
      pdf.setDrawColor(...k.cor);pdf.setLineWidth(.8);pdf.line(x,y,x+kpiW,y);
      pdf.setTextColor(...k.cor);pdf.setFont('helvetica','bold');pdf.setFontSize(14);
      pdf.text(k.val,x+kpiW/2,y+12,{align:'center'});
      pdf.setTextColor(138,147,178);pdf.setFont('helvetica','normal');pdf.setFontSize(6.5);
      pdf.text(k.lbl,x+kpiW/2,y+17,{align:'center'});
    });
    y+=26;

    // ── Gráficos ──
    showPdfOverlay('Capturando gráficos…',40);
    const canvases=[
      {id:'ch-gols',lbl:'Gols a cada 4 jogos'},
      {id:'ch-fin',lbl:'Finalizações no Gol a cada 4 jogos'},
      {id:'ch-pts',lbl:'Pontos Série B a cada 4 jogos'},
    ];
    const gW=(CW-8)/3;
    pdf.setTextColor(13,27,62);pdf.setFont('helvetica','bold');pdf.setFontSize(10);
    pdf.text('Evolução por Bloco de 4 Jogos',M,y);y+=5;

    for(let ci=0;ci<canvases.length;ci++){
      const {id,lbl}=canvases[ci];
      const canvas=document.getElementById(id);
      if(canvas){
        const img=canvas.toDataURL('image/png',1);
        const x=M+ci*(gW+4);
        pdf.setFillColor(255,255,255);pdf.roundedRect(x,y,gW,40,2,2,'F');
        pdf.addImage(img,'PNG',x+1,y+6,gW-2,32);
        pdf.setTextColor(74,85,120);pdf.setFont('helvetica','normal');pdf.setFontSize(6.5);
        pdf.text(lbl,x+gW/2,y+4,{align:'center'});
      }
    }
    y+=46;

    // ── Insights ──
    showPdfOverlay('Capturando insights…',60);
    pdf.setTextColor(13,27,62);pdf.setFont('helvetica','bold');pdf.setFontSize(10);
    pdf.text('Insights Automáticos',M,y);y+=5;
    const insItems=document.querySelectorAll('.ins-item');
    const insW=(CW-10)/3;
    let col=0,rowStart=y;
    insItems.forEach((el,i)=>{
      const lbl=el.querySelector('.ins-lbl')?.textContent||'';
      const val=el.querySelector('.ins-val')?.textContent||'';
      const det=el.querySelector('.ins-det')?.textContent||'';
      const x=M+col*(insW+5);
      pdf.setFillColor(242,245,251);pdf.roundedRect(x,rowStart,insW,22,2,2,'F');
      pdf.setDrawColor(0,50,153);pdf.setLineWidth(.5);pdf.line(x,rowStart,x,rowStart+22);
      pdf.setTextColor(138,147,178);pdf.setFont('helvetica','bold');pdf.setFontSize(6);
      pdf.text(lbl.toUpperCase(),x+3,rowStart+6);
      pdf.setTextColor(13,27,62);pdf.setFont('helvetica','bold');pdf.setFontSize(9);
      pdf.text(val,x+3,rowStart+13);
      pdf.setTextColor(74,85,120);pdf.setFont('helvetica','normal');pdf.setFontSize(6.5);
      pdf.text(det,x+3,rowStart+19,{maxWidth:insW-6});
      col++;
      if(col>=3){col=0;rowStart+=26;}
    });
    y=rowStart+(col>0?28:2);

    // ── Tabela ──
    showPdfOverlay('Montando tabela…',80);
    if(y>230){pdf.addPage();y=14;}
    pdf.setTextColor(13,27,62);pdf.setFont('helvetica','bold');pdf.setFontSize(10);
    pdf.text('Registro de Partidas',M,y);y+=5;

    const tCols=[
      {lbl:'Data',w:18,get:r=>fmtDate(r._date)},
      {lbl:'Jogo',w:54,get:r=>r.jogo||''},
      {lbl:'Result.',w:14,get:r=>r.resultado||'—'},
      {lbl:'Pts',w:8,get:r=>isNaN(r._pontos)?'—':String(r._pontos)},
      {lbl:'Comp.',w:22,get:r=>r.comp||''},
      {lbl:'Gols',w:10,get:r=>isNaN(r._gols)?'—':String(r._gols)},
      {lbl:'xG',w:10,get:r=>isNaN(r._xg)?'—':String(r._xg)},
      {lbl:'Fin.G',w:10,get:r=>isNaN(r._fin_gol)?'—':String(r._fin_gol)},
      {lbl:'Posse%',w:13,get:r=>isNaN(r._posse)?'—':r._posse+'%'},
      {lbl:'PPDA',w:13,get:r=>r.ppda||'—'},
    ];
    const rowH=6;
    // Cabeçalho da tabela
    pdf.setFillColor(0,26,94);pdf.rect(M,y,CW,rowH+1,'F');
    let tx=M+1;
    tCols.forEach(c=>{
      pdf.setTextColor(255,255,255);pdf.setFont('helvetica','bold');pdf.setFontSize(6);
      pdf.text(c.lbl,tx,y+4.5);tx+=c.w;
    });
    y+=rowH+1;

    // Ordena por data desc; jogos sem data ficam no final
  const sorted=[...filtered].sort((a,b)=>{
    if(!a._date && !b._date) return 0;
    if(!a._date) return 1;   // sem data vai pro final
    if(!b._date) return -1;
    return b._date - a._date;
  });
    sorted.forEach((r,idx)=>{
      if(y>278){pdf.addPage();y=14;}
      const even=idx%2===0;
      if(even)pdf.setFillColor(242,245,251);else pdf.setFillColor(255,255,255);
      pdf.rect(M,y,CW,rowH,'F');
      tx=M+1;
      const res=(r.resultado||'').toLowerCase();
      tCols.forEach(c=>{
        let txtColor=[74,85,120];
        if(c.lbl==='Result.'){if(res.includes('vit'))txtColor=[14,122,74];else if(res.includes('der'))txtColor=[181,19,46];}
        pdf.setTextColor(...txtColor);pdf.setFont('helvetica','normal');pdf.setFontSize(6);
        const txt=c.get(r).slice(0,c.lbl==='Jogo'?38:20);
        pdf.text(txt,tx,y+4.2);tx+=c.w;
      });
      y+=rowH;
    });

    // ── Rodapé ──
    const pages=pdf.getNumberOfPages();
    for(let p=1;p<=pages;p++){
      pdf.setPage(p);
      pdf.setFillColor(0,26,94);pdf.rect(0,287,W,10,'F');
      pdf.setTextColor(180,190,220);pdf.setFont('helvetica','normal');pdf.setFontSize(6.5);
      pdf.text('Fortaleza Esporte Clube · CIFEC — Centro de Inteligência · Dados via Google Sheets',M,293);
      pdf.text(`Pág. ${p} / ${pages}`,W-M,293,{align:'right'});
    }

    showPdfOverlay('Salvando PDF…',95);
    pdf.save(`Fortaleza_EC_Dashboard_${new Date().toISOString().slice(0,10)}.pdf`);
    showPdfOverlay('Concluído!',100);
    setTimeout(()=>hidePdfOverlay(),800);
  }catch(e){
    hidePdfOverlay();
    alert('Erro ao gerar PDF: '+e.message);
  }finally{
    btn.classList.remove('loading');
  }
}

function showPdfOverlay(msg,pct){
  const el=document.getElementById('pdf-overlay');
  el.classList.add('show');
  document.getElementById('pdf-status').textContent=msg;
  document.getElementById('pdf-prog-bar').style.width=pct+'%';
}
function hidePdfOverlay(){document.getElementById('pdf-overlay').classList.remove('show');}

/* ── UI HELPERS ── */
function showLoading(v){document.getElementById('overlay').classList.toggle('hidden',!v);}
function showError(msg){showLoading(false);document.getElementById('tbl-body').innerHTML=`<tr><td colspan="99"><div class="state-box"><div class="ico">⚠️</div><h3>Erro ao carregar dados</h3><p>${esc(msg)}</p></div></td></tr>`;}

/* ── INIT ── */
loadData();