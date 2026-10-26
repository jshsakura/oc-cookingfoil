/**
 * Admin navigation helpers that sit beside the menus without owning any panel:
 *   - the 업로드 entry in the header, so the common "add a file" task is one tap away on every screen
 *     (retro and homebrew included) and always leads to the one upload page
 *   - edge fades on the menus that scroll sideways on a phone, so a clipped row reads as "more this way",
 *     and the open page is brought into view when the row is clipped
 * The sub-page rows themselves (library, homebrew, settings ...) stay where their panels declare them.
 */

export const NAV_CSS = /* css */ `
.up-entry{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 14px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--panel);color:var(--text);font:700 13px inherit;font-family:inherit;text-decoration:none;white-space:nowrap}
.up-entry:hover{border-color:var(--text)}
.up-entry svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.up-entry[aria-current="page"]{background:var(--text);color:var(--panel);border-color:var(--text)}
@media (max-width:640px){.hdr-right{gap:10px}.lang-btn{padding:0 12px;gap:4px}.lang-btn .chev{display:none}.up-entry{padding:0}.up-entry .up-entry-t{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
.subtabs{display:flex;gap:4px;margin:0 0 18px;border-bottom:1px solid var(--line);overflow-x:auto}
/* The sidebar lists these tasks already: the page does not repeat them as a tab row. */
#retro-subtabs,#homebrew-subtabs{display:none}
.subtabs button{flex:none;border:none;border-bottom:2px solid transparent;border-radius:0;background:none;padding:10px 14px;margin-bottom:-1px;color:var(--muted);font-weight:var(--fw-bold);white-space:nowrap}
.subtabs button[aria-selected="true"]{color:var(--text);border-bottom-color:var(--text)}
.subtabs button:hover{color:var(--text)}
.subtabs{--fade:34px}
.subtabs.fade-l{-webkit-mask-image:linear-gradient(to right,transparent 0,#000 var(--fade));mask-image:linear-gradient(to right,transparent 0,#000 var(--fade))}
.subtabs.fade-r{-webkit-mask-image:linear-gradient(to left,transparent 0,#000 var(--fade));mask-image:linear-gradient(to left,transparent 0,#000 var(--fade))}
.subtabs.fade-l.fade-r{-webkit-mask-image:linear-gradient(to right,transparent 0,#000 var(--fade),#000 calc(100% - var(--fade)),transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 var(--fade),#000 calc(100% - var(--fade)),transparent 100%)}
.subtabs{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){.subtabs{scroll-behavior:auto}}
.lib-ops{margin-top:28px}
.lib-ops .sub-h{margin-top:0}
`;

export const NAV_SCRIPT = /* js */ `
(function(){
  var entry=document.getElementById('up-entry');
  // The upload entry is a real page now: /admin/upload.
  function syncEntry(){if(!entry)return;
    if(location.pathname==='/admin/upload')entry.setAttribute('aria-current','page');else entry.removeAttribute('aria-current');}
  addEventListener('hashchange',syncEntry);addEventListener('popstate',syncEntry);syncEntry();

  // A row that scrolls sideways fades at the edge that still hides something.
  function hint(row){
    function update(){
      var max=row.scrollWidth-row.clientWidth;
      row.classList.toggle('fade-l',max>2&&row.scrollLeft>2);
      row.classList.toggle('fade-r',max>2&&row.scrollLeft<max-2);}
    function reveal(){
      var on=row.querySelector('[aria-current="page"]:not([hidden]),[aria-selected="true"]');
      if(!on||row.scrollWidth<=row.clientWidth)return;
      row.scrollLeft=Math.max(0,on.offsetLeft-(row.clientWidth-on.offsetWidth)/2);}
    row.addEventListener('scroll',update,{passive:true});
    if(window.ResizeObserver)new ResizeObserver(update).observe(row);
    addEventListener('resize',update);
    new MutationObserver(function(){reveal();update();}).observe(row,{subtree:true,attributes:true,attributeFilter:['aria-current','aria-selected','hidden']});
    reveal();update();}
  function scan(){var rows=document.querySelectorAll('.subtabs');for(var i=0;i<rows.length;i++)if(!rows[i].dataset.hinted){rows[i].dataset.hinted='1';hint(rows[i]);}}
  scan();
  // Tab pages show and hide: a row that was hidden has no width until its page opens.
  addEventListener('hashchange',function(){requestAnimationFrame(function(){var rows=document.querySelectorAll('.subtabs');
    for(var i=0;i<rows.length;i++)rows[i].dispatchEvent(new Event('scroll'));});});
})();
`;
