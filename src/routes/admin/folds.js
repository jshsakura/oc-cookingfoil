/**
 * Folding sections for the admin page, so a long tab reads as a list of headings.
 * A fold remembers whether it was left open, in this browser only, also across
 * the re-renders the settings list does after every save.
 */

export const FOLD_CSS = /* css */ `
details.fold{background:var(--panel);border:1px solid var(--line);border-radius:16px;margin:0 0 12px}
details.fold>summary{display:flex;align-items:center;gap:10px;padding:14px 18px;cursor:pointer;list-style:none;border-radius:16px}
details.fold>summary::-webkit-details-marker{display:none}
details.fold>summary:hover{background:var(--sunk)}
details.fold>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
details.fold>summary::after{content:"";flex:none;margin-left:auto;width:8px;height:8px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:translateY(-2px) rotate(45deg);transition:transform .15s}
details.fold[open]>summary::after{transform:translateY(2px) rotate(-135deg)}
details.fold>summary>h2,details.fold>summary>h3{margin:0;font-size:15px}
details.fold>summary .fold-meta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:12.5px;font-weight:500}
details.fold>.fold-b{padding:2px 18px 16px}
details.fold>.fold-b>:first-child{margin-top:0}
.fold-b>form.add,.fold-b>.tfa{background:none;border:0;padding:0;border-radius:0}
@media (prefers-reduced-motion:reduce){details.fold>summary::after{transition:none}}
@media (max-width:640px){details.fold>summary{padding:12px 14px}details.fold>.fold-b{padding:2px 14px 14px}details.fold>summary .fold-meta{display:none}}
`;

/** A fold for the page template. `key` names it for the remembered open state. */
export const fold = (key, title, body, { open = false, level = "h2", meta = "" } = {}) =>
  `<details class="fold" data-fold="${key}" data-fold-default="${open ? "open" : ""}"${open ? " open" : ""}>` +
  `<summary><${level}>${title}</${level}>${meta ? `<span class="fold-meta">${meta}</span>` : ""}</summary>` +
  `<div class="fold-b">${body}</div></details>`;

export const FOLD_SCRIPT = /* js */ `
function foldIsOpen(key,def){try{const v=localStorage.getItem('fold-'+key);if(v)return v==='1';}catch(e){}return def;}
function foldWatch(d,key){d.addEventListener('toggle',()=>{try{localStorage.setItem('fold-'+key,d.open?'1':'0');}catch(e){}});}
// A fold built by script: the same look as the template's, open the way it was left.
function foldEl(key,title,meta,def,cls){const d=el('details',null,'fold'+(cls?' '+cls:''));d.dataset.fold=key;d.open=foldIsOpen(key,def);
  const s=el('summary');s.append(el('h3',title));if(meta)s.append(el('span',meta,'fold-meta'));d.append(s);foldWatch(d,key);return d;}
for(const d of document.querySelectorAll('details.fold[data-fold]')){d.open=foldIsOpen(d.dataset.fold,d.dataset.foldDefault==='open');foldWatch(d,d.dataset.fold);}
`;
