/**
 * Icons on every admin button and the page's shared motion.
 *
 * The icon is added after the fact, from the button's own label, so the
 * label, the id and the accessible name stay exactly as each panel wrote
 * them. Buttons that panels build later are picked up by an observer.
 * Motion never holds a click: nothing sits over the page, buttons stay
 * pressable mid-transition, and prefers-reduced-motion turns it all off.
 */
import { icon } from "../../views/icons.js";

// First match wins. [pattern on the label, icon name]
const BY_LABEL = [
  [/복사/, "copy"],
  [/삭제|빼기|지우|폐기|비우/, "trash"],
  [/해제/, "unlock"],
  [/다운로드/, "download"],
  [/올리기|올립니다|업로드/, "upload"],
  [/되돌리/, "undo"],
  [/새로 고침|갱신|다시 스캔|다시 읽기|다시 고르기|재시도|다시 시작|검사|지금 확인/, "refresh"],
  [/가져오기|받기/, "download"],
  [/시작|실행/, "play"],
  [/멈추|중지/, "stop"],
  [/맞추기/, "search"],
  [/찾기|검색/, "search"],
  [/시험|보내기/, "send"],
  [/로그인|들어가기/, "login"],
  [/폴더/, "folder"],
  [/파일/, "file"],
  [/변환/, "shrink"],
  [/저장/, "save"],
  [/추가|만들기|정하기|등록$/, "plus"],
  [/^(취소|닫기)$/, "x"],
  [/^이전$/, "chevleft"],
  [/^다음$/, "chevright"],
  [/확인|승인|했습니다/, "check"],
];
// A label nothing matches gets no icon, rather than an arrow that says nothing.
const NAMES = [...new Set(BY_LABEL.map(([, n]) => n))];

export const POLISH_CSS = /* css */ `
/* Buttons: an icon in front of the label, and a press that gives a little. */
button:not(.ib):not(.icon-btn)>.bi{width:1.1em;height:1.1em;margin-right:6px;vertical-align:-.2em}
button:not(:disabled){transition:background-color .15s,border-color .15s,color .15s,box-shadow .15s,transform .1s}
button:not(:disabled):active{transform:scale(.97)}
button[aria-busy="true"]{cursor:progress}
button[aria-busy="true"]>.bi{animation:polish-spin .8s linear infinite}
@keyframes polish-spin{to{transform:rotate(360deg)}}

/* The selected tab is one pill that slides to the next tab. */
nav.tabs{position:relative}
nav.tabs a{position:relative;z-index:1;transition:color .2s}
nav.tabs.has-pill a[aria-current="page"]{background:transparent;box-shadow:none}
.tab-pill{position:absolute;left:0;top:0;z-index:0;border-radius:var(--r-lg);background:var(--panel);box-shadow:0 1px 3px var(--shadow),0 0 0 1px var(--line2);pointer-events:none;
  transition:transform .28s cubic-bezier(.3,.8,.3,1),width .28s cubic-bezier(.3,.8,.3,1),height .28s cubic-bezier(.3,.8,.3,1)}

/* A section fades in as its tab opens. */
section[id^="tab-"]:not([hidden]){animation:polish-in .26s ease both}
@keyframes polish-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

dialog[open]{animation:polish-pop .2s ease both}
dialog[open]::backdrop{animation:polish-fade .2s ease both}
@keyframes polish-pop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
@keyframes polish-fade{from{opacity:0}to{opacity:1}}

.toast{transform:translate(-50%,14px);transition:opacity .2s,transform .2s}
.toast.show{transform:translate(-50%,0)}

@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
  .tab-pill{transition:none}
}`;

export const POLISH_SCRIPT = /* js */ `
;(function(){
var SVG={${NAMES.map((n) => `${JSON.stringify(n)}:${JSON.stringify(icon(n, "ico bi"))}`).join(",")}};
var RULES=[${BY_LABEL.map(([re, n]) => `[${re},${JSON.stringify(n)}]`).join(",")}];
var SKIP='.ib,.icon-btn,[aria-pressed],[role=tab],[role=menuitem],[role=menuitemcheckbox],[data-kind],[data-noicon]';
function pick(b){
  if(b.id==='ra-prev')return 'chevleft';if(b.id==='ra-next')return 'chevright';
  var t=(b.textContent||'').trim();if(!t)return null;
  if(/^[0-9]+$/.test(t))return null;
  for(var i=0;i<RULES.length;i++)if(RULES[i][0].test(t))return RULES[i][1];
  return null;
}
function decorate(b){
  if(b.matches(SKIP)||b.querySelector('svg'))return;
  var n=pick(b);if(!n)return;
  b.insertAdjacentHTML('afterbegin',SVG[n]);
}
function scan(root){
  if(root.nodeType!==1)return;
  if(root.tagName==='BUTTON')decorate(root);
  var all=root.querySelectorAll?root.querySelectorAll('button'):[];
  for(var i=0;i<all.length;i++)decorate(all[i]);
}
scan(document.body);
// Panels rebuild their buttons after every load, and textContent drops the icon: put it back.
new MutationObserver(function(list){
  for(var i=0;i<list.length;i++){
    var m=list[i];
    if(m.target.tagName==='BUTTON')decorate(m.target);
    for(var j=0;j<m.addedNodes.length;j++)scan(m.addedNodes[j]);
  }
}).observe(document.body,{childList:true,subtree:true});

// Sliding tab pill.
var nav=document.querySelector('nav.tabs');
if(nav){
  var pill=document.createElement('span');pill.className='tab-pill';pill.setAttribute('aria-hidden','true');
  nav.prepend(pill);
  var place=function(){
    var a=nav.querySelector('a[aria-current="page"]');
    if(!a||!a.offsetWidth){nav.classList.remove('has-pill');pill.style.width='0';return;}
    pill.style.width=a.offsetWidth+'px';pill.style.height=a.offsetHeight+'px';
    pill.style.transform='translate('+a.offsetLeft+'px,'+a.offsetTop+'px)';
    nav.classList.add('has-pill');
  };
  new MutationObserver(place).observe(nav,{attributes:true,subtree:true,attributeFilter:['aria-current']});
  // A resize moves the pill at once: sliding from the old size would stretch the page sideways for a moment.
  addEventListener('resize',function(){pill.style.transition='none';place();requestAnimationFrame(function(){requestAnimationFrame(function(){pill.style.transition='';});});});
  addEventListener('hashchange',function(){requestAnimationFrame(place);});
  // The first placement must not slide in from the corner.
  pill.style.transition='none';place();requestAnimationFrame(function(){requestAnimationFrame(function(){pill.style.transition='';});});
}
})();`;
