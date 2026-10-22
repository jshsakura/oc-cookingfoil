/**
 * Every admin table is drawn by AG Grid Community (MIT, vendored from node_modules and served
 * behind the admin sign-in). Panels still build plain <tr> rows; table() lifts each cell into
 * the grid, so a row keeps its buttons and listeners. Rows are one fixed height, every column
 * but the buttons sorts by what its text means (a date, "3분 전", "1.2 GB", a number, else the
 * text), a long list pages, and a narrow screen scrolls the columns sideways.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// The package exports no dist paths, so its folder is found from its main entry.
const req = createRequire(import.meta.url);
const resolve = (p) => {
  const [name, ...rest] = p.split("/");
  let dir = path.dirname(req.resolve(name));
  while (path.basename(dir) !== name) dir = path.dirname(dir);
  return path.join(dir, ...rest);
};
const VENDOR = {
  "ag-grid.min.js": ["ag-grid-community/dist/ag-grid-community.min.js", "text/javascript"],
};
const cache = new Map();

/** GET /admin/vendor/:file, for a signed-in admin. */
export function sendVendor(req, res) {
  const v = VENDOR[req.params.file];
  if (!v) return res.status(404).send("not found");
  if (!cache.has(req.params.file)) cache.set(req.params.file, fs.readFileSync(resolve(v[0])));
  res.set("Cache-Control", "private, max-age=86400").type(v[1]).send(cache.get(req.params.file));
}

export const GRID_HEAD = `<script src="/admin/vendor/ag-grid.min.js"></script>`;

export const GRID_CSS = /* css */ `
.grid-mount{min-width:0;max-width:100%;margin:0 0 20px}
/* A list that has not arrived yet: rows that shimmer in its place. Anything rendered into it (rows, a card,
   an empty note) replaces them. */
[data-skel]:empty{min-height:212px;border-radius:14px;margin:0 0 20px;
  background:linear-gradient(90deg,transparent 0,rgba(127,127,127,.10) 50%,transparent 100%) 0 0/40% 100% no-repeat,
    repeating-linear-gradient(var(--panel) 0 44px,var(--panel) 44px 52px) ;
  -webkit-mask:repeating-linear-gradient(#000 0 44px,transparent 44px 52px);mask:repeating-linear-gradient(#000 0 44px,transparent 44px 52px);
  animation:skel-sweep 1.2s ease-in-out infinite}
@keyframes skel-sweep{from{background-position:-40% 0,0 0}to{background-position:140% 0,0 0}}
@media (prefers-reduced-motion:reduce){[data-skel]:empty{animation:none}}
.grid-tools{display:flex;gap:8px;align-items:center;margin:0 0 8px}.grid-tools input{flex:1;min-width:0;max-width:360px}
.grid-tools{flex-wrap:wrap}.grid-tools select.grid-sort{width:auto;max-width:220px}
.grid-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 8px}
.grid-chips-label{font-size:12px;color:var(--muted);margin-right:2px}
.grid-chip{height:30px;padding:0 12px;border-radius:100px;font-size:12.5px;font-weight:600;background:var(--sunk);border:1px solid transparent;color:var(--text)}
.grid-chip[aria-pressed="true"]{background:rgba(var(--accent-rgb),.16);border-color:rgba(var(--accent-rgb),.5);color:var(--text)}
.grid-tools .grid-count{margin-left:auto;color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
.ag-theme-cook{border-radius:14px}
.ag-cell{display:flex;align-items:center;overflow:hidden;line-height:1.35}
/* Only as tall as its rows: no blank block under a short list. */
.grid-mount .ag-grid-scrolling-rows.ag-layout-auto-height{min-height:0!important}
.ag-cell .gc{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.gc>*{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gc .muted,.gc .sub{display:block;font-size:12px;color:var(--muted);line-height:1.3}
.gc .row-actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:nowrap}
.gc .xline,.gc .pills{display:flex;flex-wrap:nowrap;gap:6px;align-items:center}
.gc.ip,.gc.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.gc.dim{color:var(--muted)}
.ag-cell button.ib,.ag-cell .row-actions button{height:34px}
.ag-cell select{padding-top:6px;padding-bottom:6px}
.ag-full-width-row .grid-group{display:flex;align-items:center;gap:8px;height:100%;padding:0 14px;font-size:12.5px;font-weight:700;color:var(--muted);letter-spacing:.02em}
.ag-full-width-row .grid-group .muted{font-weight:500;color:var(--muted)}
.ag-cell.tall{align-items:flex-start;padding-top:9px;padding-bottom:9px;line-height:1.4}
.ag-cell.tall .gc,.ag-cell.tall .gc>*{white-space:normal;overflow:visible}.ag-cell.tall .gc .xline{flex-wrap:wrap}
.ag-header-cell-text{font-size:12px;letter-spacing:.02em}
/* Scrollbars in the page's colours, thin, in both themes. */
.grid-mount *{scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
.grid-mount ::-webkit-scrollbar{width:8px;height:8px}.grid-mount ::-webkit-scrollbar-track{background:transparent}
.grid-mount ::-webkit-scrollbar-thumb{background:var(--line2);border-radius:8px}.grid-mount ::-webkit-scrollbar-thumb:hover{background:var(--muted)}
.ag-row.live{background:rgba(var(--accent-rgb),.06)}
`;

export const GRID_SCRIPT = /* js */ `
if(window.agGrid&&agGrid.ModuleRegistry&&agGrid.AllCommunityModule)agGrid.ModuleRegistry.registerModules([agGrid.AllCommunityModule]);
const GRID_ROW=52,GRID_PAGE=20;
const GRID_THEME=window.agGrid?agGrid.themeQuartz.withParams({
  backgroundColor:'var(--panel)',foregroundColor:'var(--text)',headerBackgroundColor:'var(--panel)',headerTextColor:'var(--muted)',headerColumnResizeHandleColor:'transparent',headerRowBorder:{color:'var(--line)'},
  borderColor:'var(--line)',rowHoverColor:'var(--sunk)',oddRowBackgroundColor:'var(--panel)',accentColor:'var(--accent)',
  chromeBackgroundColor:'var(--panel)',fontFamily:'inherit',fontSize:13,headerFontSize:12.5,headerFontWeight:600,
  wrapperBorderRadius:14,spacing:6,cellHorizontalPadding:12,rowBorder:{color:'var(--line)'},columnBorder:false,
  inputBackgroundColor:'var(--sunk)',inputBorder:false}):undefined;
const GRID_TEXT={page:'쪽',to:'-',of:'/',more:'더',firstPage:'처음',previousPage:'이전',nextPage:'다음',lastPage:'끝',
  pageSizeSelectorLabel:'한 쪽에',noRowsToShow:'찾은 것이 없습니다.',ariaRowSelect:'',ariaSortableColumn:'눌러서 정렬합니다'};
// One cell of a built row, moved into the grid with its classes, title and listeners.
function gridCell(td){const d=el('div',null,'gc'+(td.className?' '+td.className:''));if(td.title)d.title=td.title;
  while(td.firstChild)d.append(td.firstChild);return d;}
// What a cell sorts by. data-sort wins; else a date, "3분 전", a size or a number read from the text; else the text.
// Empty cells ("", "—") give null and sort last in either direction.
const GRID_UNIT={B:1,KB:1024,MB:1048576,GB:1073741824,TB:1099511627776};
const GRID_AGO={'초':1,'분':60,'시간':3600,'일':86400};
function gridKey(n){if(!n)return null;const at=n.querySelector?.('[data-sort]')||n;
  if(at.dataset?.sort!=null&&at.dataset.sort!=='')return Number(at.dataset.sort);
  const sel=n.querySelector?.('select');const t=(sel?sel.selectedOptions[0]?.textContent:n.textContent||'').trim();
  if(!t||t==='—'||t==='-')return null;
  let m=t.match(/^(?:(\\d{4})\\.\\s+)?(\\d{1,2})\\.\\s+(\\d{1,2})\\.(?:\\s*(오전|오후)\\s*(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?/);
  if(m){let h=Number(m[5]||0);if(m[4]==='오후'&&h<12)h+=12;if(m[4]==='오전'&&h===12)h=0;
    return new Date(Number(m[1]||new Date().getFullYear()),Number(m[2])-1,Number(m[3]),h,Number(m[6]||0),Number(m[7]||0)).getTime();}
  if((m=t.match(/^(\\d{4})-(\\d{2})-(\\d{2})(?:[ T](\\d{2}):(\\d{2}))?/)))return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]||0),Number(m[5]||0)).getTime();
  if(t==='방금'||t==='지금')return Date.now();
  if((m=t.match(/^(\\d+)\\s*(초|분|시간|일)\\s*전/)))return Date.now()-Number(m[1])*GRID_AGO[m[2]]*1000;
  if((m=t.match(/^(-?[\\d,]*\\.?\\d+)\\s*(B|KB|MB|GB|TB)\\b/i)))return Number(m[1].replace(/,/g,''))*GRID_UNIT[m[2].toUpperCase()];
  if((m=t.match(/^(-?[\\d,]*\\.?\\d+)\\s*(%|개|장|건|명|대|초|ms)?(\\s*\\(.*\\))?$/)))return Number(m[1].replace(/,/g,''));
  return t;}
function gridCompare(a,b,_na,_nb,desc){const x=gridKey(_na?.data?._n?.[this.i]),y=gridKey(_nb?.data?._n?.[this.i]);
  if(x==null||y==null)return x==null&&y==null?0:(x==null)!==desc?1:-1;
  if(typeof x==='number'&&typeof y==='number')return x-y;
  if(typeof x==='number')return -1;if(typeof y==='number')return 1;
  return x.localeCompare(y,'ko',{numeric:true});}
// A column holding buttons or selects must fit them in one line.
let gridCtx=null;
const gridText=(s,mono)=>{gridCtx??=document.createElement('canvas').getContext('2d');
  gridCtx.font=mono?'12px ui-monospace,SFMono-Regular,Menlo,monospace':'600 13px '+getComputedStyle(document.body).fontFamily;
  return gridCtx.measureText(s).width;};
const gridButton=(b)=>b.classList.contains('ib')?40:gridText(b.textContent.trim(),false)+(b.querySelector('svg')?52:34);
const gridSelect=(s)=>Math.max(...[...s.options].map((o)=>gridText(o.textContent.trim(),false)),0)+60;
function gridControlsWidth(data,i){let w=0;for(const r of data){const n=r._n[i];if(!n)continue;
  const cs=[...n.querySelectorAll('button,a.btn,select')];if(!cs.length)continue;
  w=Math.max(w,cs.reduce((s,c)=>s+(c.tagName==='SELECT'?gridSelect(c):gridButton(c)),0)+(cs.length-1)*6+28);}
  return w;}
// mount: id of the box the grid goes in. cols: column titles, '' for the actions column.
// rows: <tr> elements. A row whose only cell spans the table starts a group under that heading.
// opts.noFilter lists column titles that get no chip filter (the page already filters by them); opts.search adds a box that filters the rows; opts.paging=false keeps every row on one page
// (for a list the server already pages); opts.tall lets a row grow to hold lists inside its cells.
function table(mount,cols,rows,empty,opts={}){const m=$(mount);
  if(m._grid){m._grid.destroy();m._grid=null;}m.replaceChildren();m.classList.add('grid-mount');
  if(!rows.length){m.append(el('div',empty,'empty'));return;}
  const data=[];let groups=false;
  for(const r of rows){const cs=[...r.children];
    if(cs.length===1&&cs[0].colSpan>1){groups=true;const h=gridCell(cs[0]);h.className='grid-group';data.push({_k:data.length,_head:h});continue;}
    data.push({_k:data.length,_n:cs.map(gridCell),_cls:r.className,_id:r.dataset.id});}
  const items=data.filter((d)=>!d._head);
  const avg=(i)=>{let n=0;for(const r of items)n+=Math.min(60,(r._n[i]?.textContent||'').trim().length);return n/Math.max(1,items.length);};
  // A column of short values (ids, sizes, dates) is never cut: as wide as its widest value.
  const fit=(i)=>{let w=0;for(const r of items){const n=r._n[i],s=(n?.textContent||'').trim();if(s.length>28)return 0;
    if(s)w=Math.max(w,gridText(s,n.classList.contains('mono')));}return w?Math.ceil(w)+30:0;};
  const columnDefs=cols.map((title,i)=>{const act=title===''&&i===cols.length-1,controls=gridControlsWidth(items,i);
    const base={headerName:title,colId:'c'+i,suppressMovable:true,resizable:!act,sortable:!act,comparator:gridCompare.bind({i}),
      ...(opts.tall?{autoHeight:true,wrapText:true,cellClass:'tall'}:{}),
      valueGetter:(p)=>p.data?._n?.[i]?.textContent.trim()||'',
      cellRenderer:(p)=>{const n=p.data?._n?.[i];if(!n)return '';if(!act&&!n.title&&n.textContent.trim().length>24)n.title=n.textContent.trim();return n;}};
    // The buttons stay pinned in sight while long columns scroll under them.
    if(act)return {...base,pinned:'right',width:Math.max(56,controls),minWidth:Math.max(56,controls),cellStyle:{justifyContent:'flex-end'}};
    if(controls)return {...base,width:Math.max(controls,title.length*14+32),minWidth:controls};
    const w=fit(i);if(w)return {...base,width:Math.max(w,title.length*14+32),minWidth:Math.max(72,title.length*14+24)};
    // Long text shares the spare width; it is cut only past what a cell can reasonably hold.
    const text=Math.max(...items.map((r)=>gridText((r._n[i]?.textContent||'').trim().slice(0,60),false)),0)+30;
    return {...base,flex:Math.min(4,Math.max(1,avg(i)/10)),minWidth:Math.max(140,title.length*14+32,Math.min(text,320))};});
  // The grid always fills its width: with no long-text column, the widest plain one takes the rest.
  if(!columnDefs.some((c)=>c.flex)){const pick=columnDefs.filter((c,i)=>!(cols[i]===''&&i===cols.length-1)&&!gridControlsWidth(items,i))
    .sort((a,b)=>(b.width||0)-(a.width||0))[0];if(pick){pick.minWidth=pick.width;delete pick.width;pick.flex=1;}}
  const many=!groups&&opts.paging!==false&&items.length>GRID_PAGE;
  const tools=el('div',null,'grid-tools');
  if(opts.search&&items.length>10){const q=el('input');q.type='search';
    q.placeholder=opts.placeholder||'이름으로 찾기';q.setAttribute('aria-label',(opts.label||'목록')+' 찾기');
    q.addEventListener('input',()=>m._grid?.setGridOption('quickFilterText',q.value));tools.append(q);}
  // "○○순": every sortable column offers its orders by what it holds, and the pick outlives a redraw.
  const orders=gridOrders(cols,columnDefs,items);
  const pick=el('select','', 'grid-sort');pick.setAttribute('aria-label',(opts.label||'목록')+' 정렬');
  pick.append(new Option('기본 순서',''));for(const o of orders)pick.append(new Option(o.label,o.key));
  if(orders.length&&items.length>1)tools.append(pick);
  // Filters for a column with a handful of values (상태, 역할, 기종), as chips like the client's.
  m._filters??={};const filters=gridFilters(cols,columnDefs,items).filter((f)=>!(opts.noFilter||[]).includes(f.title));
  for(const f of Object.keys(m._filters))if(!filters.some((x)=>x.col===f))delete m._filters[f];
  const chipRows=filters.map((f)=>{const row=el('div',null,'grid-chips');row.append(el('span',f.title,'grid-chips-label'));
    for(const v of ['',...f.values]){const b=el('button',v||'전체','grid-chip');b.type='button';
      b.setAttribute('aria-pressed',String((m._filters[f.col]??'')===v));
      b.addEventListener('click',()=>{if(v)m._filters[f.col]=v;else delete m._filters[f.col];
        for(const c of row.querySelectorAll('.grid-chip'))c.setAttribute('aria-pressed',String(c===b));
        flat();m._grid?.onFilterChanged();});row.append(b);}
    return row;});
  if(tools.children.length){const n=el('span','', 'grid-count');tools.append(n);m.append(tools);}
  for(const r of chipRows)m.append(r);
  const box=el('div');m.append(box);
  const filtered=()=>Object.keys(m._filters).length>0;
  // A grouped list goes flat while it is sorted or filtered: its headings would no longer fit the rows under them.
  const flat=()=>{if(!groups||!m._grid)return;const sorted=m._grid.getColumnState().some((c)=>c.sort);
    m._grid.setGridOption('rowData',sorted||filtered()?items:data);};
  const count=()=>{const n=tools.querySelector('.grid-count');if(!n||!m._grid)return;let shown=0;
    m._grid.forEachNodeAfterFilter((r)=>{if(!r.data?._head)shown++;});n.textContent=shown===items.length?items.length+'개':shown+' / '+items.length+'개';};
  m._grid=agGrid.createGrid(box,{theme:GRID_THEME,rowData:data,columnDefs,domLayout:'autoHeight',
    rowHeight:GRID_ROW,headerHeight:40,suppressCellFocus:true,suppressColumnVirtualisation:true,enableCellTextSelection:true,
    localeText:GRID_TEXT,overlayNoRowsTemplate:'<span>찾은 것이 없습니다.</span>',
    getRowId:(p)=>p.data._id||'k'+p.data._k,
    getRowClass:(p)=>p.data._cls||'',
    isExternalFilterPresent:filtered,
    doesExternalFilterPass:(r)=>!r.data?._head&&Object.entries(m._filters).every(([c,v])=>gridText0(r.data._n[Number(c)])===v),
    onSortChanged:(e)=>{const s=e.api.getColumnState().find((c)=>c.sort);const key=s?s.colId+':'+s.sort:'';
      m._sort=key;pick.value=[...pick.options].some((o)=>o.value===key)?key:'';flat();},
    onModelUpdated:count,
    isFullWidthRow:(p)=>!!p.rowNode.data?._head,fullWidthCellRenderer:(p)=>p.data._head,
    ...(many?{pagination:true,paginationPageSize:GRID_PAGE,paginationPageSizeSelector:[20,50,100]}:{})});
  const apply=(key)=>{const [colId,sort]=key?key.split(':'):[];
    m._grid.applyColumnState({state:colId?[{colId,sort}]:[],defaultState:{sort:null}});};
  pick.addEventListener('change',()=>apply(pick.value));
  if(m._sort&&[...pick.options].some((o)=>o.value===m._sort))apply(m._sort);
  if(filtered()){flat();m._grid.onFilterChanged();}
  count();}
const gridText0=(n)=>{const sel=n?.querySelector?.('select');return (sel?sel.selectedOptions[0]?.textContent:n?.textContent||'').trim();};
// What a column holds, from its sort keys: 'date', 'ago', 'number' or 'text' (null when it is empty or not sortable).
function gridKind(items,i){let kind=null;for(const r of items){const n=r._n[i],k=gridKey(n);if(k==null)continue;
  const t=gridText0(n);const now=typeof k==='number'&&/전$/.test(t)?'ago':typeof k==='number'&&k>1e12?'date':typeof k==='number'?'number':'text';
  if(kind&&kind!==now)return 'text';kind=now;}return kind;}
function gridOrders(cols,defs,items){const out=[];
  defs.forEach((d,i)=>{if(!d.sortable||!cols[i])return;const t=cols[i],k=gridKind(items,i),c=d.colId;
    if(k==='date'||k==='ago')out.push({label:t+' 최근순',key:c+':desc'},{label:t+' 오래된순',key:c+':asc'});
    else if(k==='number')out.push({label:t+' 큰순',key:c+':desc'},{label:t+' 작은순',key:c+':asc'});
    else if(k==='text')out.push({label:t+' 가나다순',key:c+':asc'},{label:t+' 역순',key:c+':desc'});});
  return out;}
function gridFilters(cols,defs,items){if(items.length<4)return [];const out=[];
  defs.forEach((d,i)=>{if(!d.sortable||!cols[i]||gridKind(items,i)!=='text')return;
    const vals=new Map();for(const r of items){const v=gridText0(r._n[i]);if(v&&v!=='—')vals.set(v,(vals.get(v)||0)+1);}
    if(vals.size<2||vals.size>6||[...vals.keys()].some((v)=>v.length>14))return;
    if([...vals.values()].every((n)=>n===1))return;
    out.push({col:String(i),title:cols[i],values:[...vals.keys()].sort((a,b)=>vals.get(b)-vals.get(a))});});
  return out;}
`;
