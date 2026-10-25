/** List pagination and verification controls shared by content pages. */
export const LIST_HELPERS_CSS = /* css */ `.pg-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:0 0 12px}.pg-bar[hidden]{display:none}
.pg-q{flex:1 1 200px;min-width:0;max-width:340px}.pg-per{flex:none}
.pg-info{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.pg-nav{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
.pg-n{min-width:38px;padding-left:10px;padding-right:10px;font-variant-numeric:tabular-nums}
.pg-n[aria-current="page"]{background:var(--text);color:var(--bg);border-color:var(--text)}
.pg-gap{color:var(--faint)}
@media (max-width:600px){.pg-q{max-width:none;flex-basis:100%}.pg-nav{margin-left:0;width:100%;justify-content:center}}
`;

export const LIST_HELPERS_SCRIPT = /* js */ `
const mb=(n)=>n==null?'—':(n/1048576).toFixed(1)+' MB';
// ── paged lists: search, how many per page, page buttons ──────────────
// The data is already in the browser, so this only slices it. A list of ten or fewer shows no bar.
const PG_SIZES=[10,25,50,100],pgState={};
function pgSize(key,def){try{const v=Number(localStorage.getItem('pg-'+key));if(PG_SIZES.includes(v))return v;}catch(e){}return def;}
function pgPages(page,pages){const out=[];let last=0;
  for(let n=1;n<=pages;n++){if(n===1||n===pages||Math.abs(n-page)<=1){if(last&&n-last>1)out.push(0);out.push(n);last=n;}}return out;}
// mount: the element the rows go in. opts: key, items, match(item,q), def, render(slice,filtered), placeholder
function paged(mount,opts){
  const st=pgState[opts.key]||(pgState[opts.key]={q:'',page:1,per:pgSize(opts.key,opts.def||25)});
  let bar=document.getElementById(mount.id+'-bar');
  if(!bar){bar=el('div',null,'pg-bar');bar.id=mount.id+'-bar';mount.before(bar);}
  const run=()=>{
    const q=st.q.trim().toLowerCase();
    const list=q?opts.items.filter((it)=>opts.match(it,q)):opts.items;
    const pages=Math.max(1,Math.ceil(list.length/st.per));if(st.page>pages)st.page=pages;
    const from=(st.page-1)*st.per;
    opts.render(list.slice(from,from+st.per),list,q);
    bar.hidden=opts.items.length<=PG_SIZES[0];bar.replaceChildren();if(bar.hidden)return;
    const find=el('input',null,'pg-q');find.type='search';find.value=st.q;find.placeholder=opts.placeholder||topText('pg.search');find.setAttribute('aria-label',topFill('pg.searchLabel',{label:opts.label||topText('pg.list')}));
    find.addEventListener('input',()=>{st.q=find.value;st.page=1;run();find.focus();});
    const per=el('select',null,'pg-per');per.setAttribute('aria-label',topFill('pg.perLabel',{label:opts.label||topText('pg.list')}));
    for(const n of PG_SIZES){const o=el('option',topFill('pg.per',{n}));o.value=n;per.append(o);}per.value=st.per;
    per.addEventListener('change',()=>{st.per=Number(per.value);st.page=1;try{localStorage.setItem('pg-'+opts.key,String(st.per));}catch(e){}run();});
    const info=el('span',list.length?topFill('pg.range',{from:from+1,to:Math.min(list.length,from+st.per),total:num(list.length)}):topText('pg.none'),'pg-info');
    const nav=el('div',null,'pg-nav');nav.setAttribute('role','navigation');nav.setAttribute('aria-label',topFill('pg.pagesLabel',{label:opts.label||topText('pg.list')}));
    const go=(n)=>{st.page=n;run();};
    const prev=btn(topText('fp.prev'),()=>go(st.page-1));prev.disabled=st.page<=1;
    const next=btn(topText('fp.next'),()=>go(st.page+1));next.disabled=st.page>=pages;
    nav.append(prev);
    if(pages>1)for(const n of pgPages(st.page,pages)){
      if(!n){nav.append(el('span','…','pg-gap'));continue;}
      const b=btn(String(n),()=>go(n));b.dataset.noicon='1';b.setAttribute('aria-label',topFill('pg.page',{n}));b.classList.add('pg-n');
      if(n===st.page)b.setAttribute('aria-current','page');nav.append(b);}
    nav.append(next);
    bar.append(find,per,info,nav);};
  run();}
function verifyPill(name,on,onClick){const b=el('button',null,'hb-verify');b.type='button';
  b.setAttribute('aria-pressed',String(Boolean(on)));b.setAttribute('aria-label',topFill('pg.verifiedLabel',{name}));
  b.title=on?topText('pg.unverifyHint'):topText('pg.verifyHint');
  b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/></svg>';b.append(el('span',on?topText('pg.verified'):topText('pg.unverified')));
  b.addEventListener('click',()=>{b.disabled=true;onClick(!on);});return b;}
`;
