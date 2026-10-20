/**
 * Every admin table is drawn by AG Grid Community (MIT, vendored from node_modules and served
 * behind the admin sign-in). Panels still build plain <tr> rows; table() lifts each cell into
 * the grid, so a row keeps its buttons and listeners. Rows are one fixed height, columns sort
 * by their text, a long list pages, and a narrow screen scrolls the columns sideways.
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
.grid-tools{display:flex;gap:8px;align-items:center;margin:0 0 8px}.grid-tools input{flex:1;min-width:0;max-width:360px}
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
.ag-full-width-row .grid-group{display:flex;align-items:center;gap:8px;height:100%;padding:0 14px;background:var(--sunk);font-weight:700}
.ag-full-width-row .grid-group .muted{font-weight:500;color:var(--muted)}
.ag-cell.tall{align-items:flex-start;padding-top:9px;padding-bottom:9px;line-height:1.4}
.ag-cell.tall .gc,.ag-cell.tall .gc>*{white-space:normal;overflow:visible}.ag-cell.tall .gc .xline{flex-wrap:wrap}
.ag-row.live{background:rgba(var(--accent-rgb),.06)}
`;

export const GRID_SCRIPT = /* js */ `
if(window.agGrid&&agGrid.ModuleRegistry&&agGrid.AllCommunityModule)agGrid.ModuleRegistry.registerModules([agGrid.AllCommunityModule]);
const GRID_ROW=52,GRID_PAGE=50;
const GRID_THEME=window.agGrid?agGrid.themeQuartz.withParams({
  backgroundColor:'var(--panel)',foregroundColor:'var(--text)',headerBackgroundColor:'var(--sunk)',headerTextColor:'var(--muted)',
  borderColor:'var(--line)',rowHoverColor:'var(--sunk)',oddRowBackgroundColor:'var(--panel)',accentColor:'var(--accent)',
  chromeBackgroundColor:'var(--panel)',fontFamily:'inherit',fontSize:13,headerFontSize:12.5,headerFontWeight:600,
  wrapperBorderRadius:14,spacing:6,cellHorizontalPadding:12,rowBorder:{color:'var(--line)'},columnBorder:false,
  inputBackgroundColor:'var(--sunk)',inputBorder:false}):undefined;
const GRID_TEXT={page:'쪽',to:'-',of:'/',more:'더',firstPage:'처음',previousPage:'이전',nextPage:'다음',lastPage:'끝',
  pageSizeSelectorLabel:'한 쪽에',noRowsToShow:'찾은 것이 없습니다.',ariaRowSelect:'',ariaSortableColumn:'눌러서 정렬합니다'};
// One cell of a built row, moved into the grid with its classes, title and listeners.
function gridCell(td){const d=el('div',null,'gc'+(td.className?' '+td.className:''));if(td.title)d.title=td.title;
  while(td.firstChild)d.append(td.firstChild);return d;}
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
// opts.search adds a box that filters the rows; opts.paging=false keeps every row on one page
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
    const base={headerName:title,colId:'c'+i,suppressMovable:true,resizable:!act,sortable:!act&&!groups&&!controls,
      ...(opts.tall?{autoHeight:true,wrapText:true,cellClass:'tall'}:{}),
      valueGetter:(p)=>p.data?._n?.[i]?.textContent.trim()||'',
      cellRenderer:(p)=>{const n=p.data?._n?.[i];if(!n)return '';if(!act&&!n.title&&n.textContent.trim().length>24)n.title=n.textContent.trim();return n;}};
    if(act)return {...base,width:Math.max(56,controls),minWidth:Math.max(56,controls),cellStyle:{justifyContent:'flex-end'}};
    if(controls)return {...base,width:Math.max(controls,title.length*14+32),minWidth:controls};
    const w=fit(i);if(w)return {...base,width:Math.max(w,title.length*14+32),minWidth:Math.max(72,title.length*14+24)};
    return {...base,flex:Math.min(4,Math.max(1,avg(i)/10)),minWidth:Math.max(140,title.length*14+32)};});
  const many=!groups&&opts.paging!==false&&items.length>GRID_PAGE;
  let tools=null;
  if(opts.search&&items.length>10){tools=el('div',null,'grid-tools');const q=el('input');q.type='search';
    q.placeholder=opts.placeholder||'이름으로 찾기';q.setAttribute('aria-label',(opts.label||'목록')+' 찾기');
    q.addEventListener('input',()=>m._grid?.setGridOption('quickFilterText',q.value));tools.append(q);m.append(tools);}
  const box=el('div');m.append(box);
  m._grid=agGrid.createGrid(box,{theme:GRID_THEME,rowData:data,columnDefs,domLayout:'autoHeight',
    rowHeight:GRID_ROW,headerHeight:40,suppressCellFocus:true,suppressColumnVirtualisation:true,enableCellTextSelection:true,
    localeText:GRID_TEXT,overlayNoRowsTemplate:'<span>찾은 것이 없습니다.</span>',
    getRowId:(p)=>p.data._id||'k'+p.data._k,
    getRowClass:(p)=>p.data._cls||'',
    isFullWidthRow:(p)=>!!p.rowNode.data?._head,fullWidthCellRenderer:(p)=>p.data._head,
    ...(many?{pagination:true,paginationPageSize:GRID_PAGE,paginationPageSizeSelector:[25,50,100]}:{})});}
`;
