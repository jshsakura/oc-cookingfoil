/**
 * Titled cards for the admin page: a heading bar over a body, always open.
 * A tab with many of them shows one at a time, picked from a row of chips (.box-jump).
 */

export const BOX_CSS = /* css */ `
.box{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-2xl);margin:0 0 20px;overflow:hidden}
.box>.box-h{display:flex;align-items:baseline;gap:10px;padding:13px 18px;border-bottom:1px solid var(--line);background:var(--sunk)}
.box>.box-h>h2,.box>.box-h>h3{margin:0;font-size:var(--fs-md)}
.box>.box-h .box-meta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:var(--fs-xs)}
.box>.box-b{padding:14px 18px 16px}
.box>.box-b>:first-child{margin-top:0}.box>.box-b>:last-child{margin-bottom:0}
.box-b>form.add,.box-b>.tfa{background:none;border:0;padding:0;border-radius:0}
.box-jump{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.box-jump button{padding:6px 13px;border:1px solid var(--line);border-radius:var(--r-pill);background:var(--panel);color:var(--text);font-size:var(--fs-sm);font-weight:var(--fw-bold);min-height:0}
.box-jump button:hover{background:var(--sunk)}
.box-jump button[aria-selected=true]{background:var(--text);color:var(--panel);border-color:var(--text)}
.box-fold>summary{list-style:none;cursor:pointer}.box-fold>summary::-webkit-details-marker{display:none}
.box-fold>summary::after{content:"";width:8px;height:8px;margin-left:auto;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg);transition:transform .15s}
.box-fold[open]>summary::after{transform:rotate(-135deg)}
.box-fold:not([open])>.box-h{border-bottom:0}
@media (max-width:640px){.box>.box-h{padding:11px 14px;flex-wrap:wrap;row-gap:2px}.box>.box-h .box-meta{white-space:normal}.box>.box-b{padding:12px 14px 14px}}
`;

/** A card for the page template. `key` becomes its id, for links that jump to it. `folded` starts it closed, opened by its title. */
export const box = (key, title, body, { level = "h2", meta = "", folded = false } = {}) => {
  const head = `<${level}>${title}</${level}>${meta ? `<span class="box-meta">${meta}</span>` : ""}`;
  return folded
    ? `<details class="box box-fold" id="box-${key}"><summary class="box-h">${head}</summary><div class="box-b">${body}</div></details>`
    : `<section class="box" id="box-${key}"><div class="box-h">${head}</div><div class="box-b">${body}</div></section>`;
};

export const BOX_SCRIPT = /* js */ `
// A card built by script, the same as the template's. Its body goes in .box-b.
function boxEl(key,title,meta,cls){const d=el('section',null,'box'+(cls?' '+cls:''));d.id='box-'+key;
  const h=el('div',null,'box-h');h.append(el('h3',title));if(meta)h.append(el('span',meta,'box-meta'));
  const b=el('div',null,'box-b');d.append(h,b);return d;}
`;
