/**
 * Every admin table is drawn by Tabulator (MIT, vendored from node_modules and served
 * behind the admin sign-in). Panels still build plain <tr> rows; table() lifts each cell
 * into the grid, so a row keeps its buttons and listeners. On a narrow screen the grid
 * keeps the first column and the actions, and folds the rest under a toggle per row.
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const resolve = createRequire(import.meta.url).resolve;
const VENDOR = {
  "tabulator.min.js": ["tabulator-tables/dist/js/tabulator.min.js", "text/javascript"],
  "tabulator.min.css": ["tabulator-tables/dist/css/tabulator.min.css", "text/css"],
};
const cache = new Map();

/** GET /admin/vendor/:file, for a signed-in admin. */
export function sendVendor(req, res) {
  const v = VENDOR[req.params.file];
  if (!v) return res.status(404).send("not found");
  if (!cache.has(req.params.file)) cache.set(req.params.file, fs.readFileSync(resolve(v[0])));
  res.set("Cache-Control", "private, max-age=86400").type(v[1]).send(cache.get(req.params.file));
}

export const GRID_HEAD = `<link rel="stylesheet" href="/admin/vendor/tabulator.min.css"><script src="/admin/vendor/tabulator.min.js"></script>`;

export const GRID_CSS = /* css */ `
.grid-mount{min-width:0;max-width:100%}
.tabulator{max-width:100%;background:var(--panel);border:1px solid var(--line);border-radius:14px;font-size:13px;color:var(--text);margin:0 0 20px}
.tabulator .tabulator-header{background:var(--sunk);border-bottom:1px solid var(--line);color:var(--muted);font-weight:600}
.tabulator .tabulator-header .tabulator-col{background:transparent;border-right:0}
.tabulator .tabulator-header .tabulator-col .tabulator-col-content{padding:9px 12px}
.tabulator .tabulator-tableholder .tabulator-table{background:transparent;color:var(--text)}
.tabulator-row,.tabulator-row.tabulator-row-even{background:var(--panel);border-bottom:1px solid var(--line);min-height:42px}
.tabulator-row:last-child{border-bottom:0}
.tabulator-row.tabulator-selectable:hover,.tabulator-row:hover{background:var(--sunk)}
.tabulator-row .tabulator-cell{display:inline-flex;align-items:center;padding:8px 12px;border-right:0}
.tabulator-row .tabulator-cell .gc{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.gc>*{max-width:100%;overflow:hidden;text-overflow:ellipsis}
.gc .muted,.gc .sub{display:block;font-size:12px;color:var(--muted)}
.gc .row-actions{display:flex;gap:6px;justify-content:flex-end}
.gc .xline{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.gc.ip,.gc.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.gc.dim{color:var(--muted)}
.tabulator .tabulator-row.tabulator-group{background:var(--sunk);border-bottom:1px solid var(--line);border-top:0;padding:8px 12px;font-weight:700;color:var(--text)}
.tabulator .tabulator-row.tabulator-group:hover{background:var(--sunk);cursor:default}
.tabulator .tabulator-row.tabulator-group .tabulator-group-toggle{display:none}
.tabulator .tabulator-row.tabulator-group span{color:var(--muted);margin-left:0}
.tabulator-row .tabulator-responsive-collapse{border:0;padding:0 12px 10px 40px}
.tabulator-row .tabulator-responsive-collapse table{display:table;width:100%;border:0;background:none;border-radius:0;font-size:13px}
.tabulator-row .tabulator-responsive-collapse tr{display:table-row;border:0;background:none;margin:0;padding:0}
.tabulator-row .tabulator-responsive-collapse td{display:table-cell;width:auto;border:0;padding:4px 10px 4px 0;vertical-align:top;white-space:normal}
.tabulator-row .tabulator-responsive-collapse td *{flex-wrap:wrap;white-space:normal}
.tabulator-row .tabulator-responsive-collapse td::before{content:none}
.tabulator-row .tabulator-responsive-collapse td:first-child{color:var(--muted);white-space:nowrap;width:1%;padding-top:5px}
.tabulator-row .tabulator-responsive-collapse td:first-child strong{font-weight:500}
.tabulator-row .tabulator-responsive-collapse .row-actions{display:flex;flex-wrap:wrap;gap:6px}
.tabulator-row .tabulator-cell .tabulator-responsive-collapse-toggle{background:var(--sunk);color:var(--text);border:1px solid var(--line);width:22px;height:22px;border-radius:7px}
.tabulator-row .tabulator-cell .tabulator-responsive-collapse-toggle svg{stroke:var(--text)}
.tabulator-row.live,.tabulator-row.live:hover{background:rgba(var(--accent-rgb),.06)}
`;

export const GRID_SCRIPT = /* js */ `
// On a phone the columns that do not fit fold under each row; wider, they only get narrower.
const GRID_NARROW=matchMedia('(max-width:720px)');
GRID_NARROW.addEventListener('change',()=>{for(const m of document.querySelectorAll('.grid-mount'))
  if(m._grid&&m._build&&m._grid._narrow!==GRID_NARROW.matches){m._grid.destroy();m._grid=null;m._build();}});
// One cell of a built row, moved into the grid with its classes, title and listeners.
function gridCell(td){const d=el('div',null,'gc'+(td.className?' '+td.className:''));if(td.title)d.title=td.title;
  while(td.firstChild)d.append(td.firstChild);return d;}
// A column holding buttons must fit them; a hidden tab has no layout to measure, so count them. 0: none.
// The actions sit in one line, so their widths add up; elsewhere buttons wrap, so the widest one counts.
const gridButton=(b)=>b.classList.contains('ib')&&!GRID_NARROW.matches?40:Math.max(86,(b.textContent.trim().length||1)*12+54);
function gridButtonWidth(data,i,inLine){let w=0;for(const r of data){const bs=r._n[i]?[...r._n[i].querySelectorAll('button,a.btn')]:[];if(!bs.length)continue;
  w=Math.max(w,(inLine?bs.reduce((s,b)=>s+gridButton(b),0)+(bs.length-1)*6:Math.max(...bs.map(gridButton)))+32);}
  return w;}
// mount: id of the box the grid goes in. cols: column titles, '' for the actions column.
// rows: <tr> elements. A row whose only cell spans the table starts a group under that heading.
function table(mount,cols,rows,empty){const m=$(mount);
  if(m._grid){m._grid.destroy();m._grid=null;}if(m._wait){m._wait.disconnect();m._wait=null;}m.replaceChildren();
  if(!rows.length){m.append(el('div',empty,'empty'));return;}
  const data=[],heads=new Map();let group=null;
  for(const r of rows){const cs=[...r.children];
    if(cs.length===1&&cs[0].colSpan>1){group='g'+heads.size;heads.set(group,gridCell(cs[0]));continue;}
    data.push({_k:data.length,_g:group,_n:cs.map(gridCell),_cls:r.className,_ds:{...r.dataset}});}
  // Width follows what a column holds: long text gets room, short numbers do not.
  const avg=(i)=>{let n=0;for(const r of data)n+=Math.min(60,(r._n[i]?.textContent||'').length);return n/Math.max(1,data.length);};
  const grow=(i)=>Math.min(4,Math.max(0.6,Math.max(avg(i),cols[i].length*1.6)/12));
  // On a phone the column that stays is the one with the most to say among the first three.
  const lead=[0,1,2].filter((i)=>i<cols.length&&cols[i]!=='').sort((x,y)=>avg(y)-avg(x))[0]??0;
  const columnsFor=(narrow)=>cols.map((title,i)=>{const act=title===''&&i===cols.length-1,bw=gridButtonWidth(data,i,act);
    // A folded column shows only when it has a title, so the actions get a blank one on a phone.
    return {title:act&&narrow?'\u00a0':title,field:'_c'+i,headerSort:false,resizable:!act,vertAlign:'middle',
      // Hidden from the highest number down: a phone keeps the lead column and folds the rest, actions too.
      responsive:i===lead?0:act?(narrow?cols.length+1:0):i+1,
      ...(act?{width:Math.max(60,bw),minWidth:Math.max(60,bw),widthGrow:0,hozAlign:'right'}
        :{minWidth:Math.max(i===lead?140:92,title.length*15+28,Math.min(130,avg(i)*7+24),bw),widthGrow:grow(i)}),
      formatter:(cell)=>{const n=cell.getData()._n[i];if(!n)return '';const e=cell.getElement();
        if(e&&e.dataset){e.dataset.label=title;if(!act&&n.textContent.length>24)e.title=n.textContent.trim();}return n;}};});
  const t=el('div');m.append(t);m.classList.add('grid-mount');
  const build=()=>{const narrow=GRID_NARROW.matches;
    const g=new Tabulator(t,{data,index:'_k',layout:'fitColumns',renderVertical:'basic',
    responsiveLayout:narrow?'collapse':false,responsiveLayoutCollapseStartOpen:false,
    columns:narrow?[{formatter:'responsiveCollapse',width:38,minWidth:38,headerSort:false,resizable:false,hozAlign:'center',vertAlign:'middle',responsive:0},...columnsFor(true)]:columnsFor(false),
    ...(heads.size?{groupBy:'_g',groupToggleElement:false,groupHeader:(v)=>heads.get(v)||''}:{}),
    rowFormatter:(row)=>{const e=row.getElement(),d=row.getData();
      for(const c of String(d._cls||'').split(' '))if(c)e.classList.add(c);Object.assign(e.dataset,d._ds);}});
    // A narrow grid moves a column's cells into each row's fold; widening it shows the column
    // again without formatting its cells anew, so the cells are taken back here.
    g.on('columnVisibilityChanged',(col,visible)=>{if(!visible)return;const i=Number(String(col.getField()).slice(2));
      for(const c of col.getCells()){const e=c.getElement(),n=c.getData()._n[i];if(n&&n.parentNode!==e)e.replaceChildren(n);}});
    m._grid=g;g._narrow=narrow;};
  m._build=build;
  // A grid laid out inside a hidden tab gets no widths and clipped rows: wait until it shows.
  if(t.offsetWidth){build();return;}
  const ro=new ResizeObserver(()=>{if(!t.isConnected){ro.disconnect();return;}if(t.offsetWidth){ro.disconnect();build();}});ro.observe(t);
  m._wait=ro;}
`;
