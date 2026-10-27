/** File upload page and its batch workflow, shared by the legacy shell. */
import { guessUpload } from "./upload-guess.js";
import { failureKind, hasBatches, splitUnits, tally, tallyFiles, trimHistory, unitsToSend } from "./upload-flow.js";
import { top, topPh } from "./top-i18n.js";

export const UPLOAD_HTML = /* html */ `<section id="tab-upload" hidden>
  <div class="hd"><h2>${top("s.upload")}</h2></div>
  <p class="muted up-lead" id="up-lead">${top("u.lead")}</p>
  <div class="up-drop" id="up-drop" tabindex="0" role="button" data-top-label="u.dropAria" aria-label="올릴 파일 고르기">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
    <b id="up-drop-t">${top("u.dropT")}</b>
    <span id="up-chosen"></span>
    <div class="pick">
      <button type="button" id="up-file-btn">${top("u.pickFiles")}</button>
      <button type="button" id="up-dir-btn">${top("u.pickDir")}</button>
    </div>
    <input type="file" id="up-file" multiple hidden>
    <input type="file" id="up-dir" webkitdirectory hidden>
  </div>
  <div class="up-guess" id="up-guess" hidden>
    <p id="up-guess-t" aria-live="polite"></p>
    <button type="button" id="up-change">${top("u.change")}</button>
  </div>
  <div id="up-kinds" role="group" data-top-label="u.kindsAria" aria-label="올릴 곳" hidden>
  <p class="up-group">${top("u.grpSwitch")}</p>
  <div class="up-kinds">
    <button type="button" data-kind="game"><b>${top("u.kGame")}</b><span>${top("u.kGameD")}</span></button>
    <button type="button" data-kind="patch"><b>${top("u.kPatch")}</b><span>${top("u.kPatchD")}</span></button>
    <button type="button" data-kind="save"><b>${top("u.kSave")}</b><span>${top("u.kSaveD")}</span></button>
    <button type="button" data-kind="homebrew"><b>${top("u.kHomebrew")}</b><span>${top("u.kHomebrewD")}</span></button>
    <button type="button" data-kind="port"><b>${top("u.kPort")}</b><span>${top("u.kPortD")}</span></button>
    <button type="button" data-kind="client"><b>${top("u.kClient")}</b><span>${top("u.kClientD")}</span></button>
    <button type="button" data-kind="retro" data-pick="retro"><b>${top("u.kRetro")}</b><span>${top("u.kRetroD")}</span></button>
  </div>
  <div id="up-systems-wrap" hidden>
  <p class="up-group">${top("u.grpRetro")}</p>
  <div class="up-kinds up-systems" id="up-systems" data-skel></div>
  </div>
  </div>
  <p class="muted up-hint" id="up-hint"></p>
  <div id="up-note"></div>
  <form class="up" id="up-form" hidden>
    <label id="up-system-l" hidden>기종<select id="up-system"></select></label>
    <label id="up-target-l" hidden>대상<select id="up-target"><option value="">게임</option></select></label>
    <label id="up-game-l" hidden>${top("gp.find")}<input id="up-game" autocomplete="off" ${topPh("gp.ph")}></label>
    <label id="up-name-l" hidden>이름<input id="up-name" maxlength="100" autocomplete="off"></label>
    <label class="check" id="up-required-l" hidden><input type="checkbox" id="up-required"> 이 패치 없이는 게임이 실행되지 않습니다 (필수)</label>
    <label id="up-savetype-l" hidden>세이브 종류<select id="up-savetype"><option value="">백업 .meta 를 따르거나 어느 쪽에나 적용합니다</option><option value="device">본체 공용 세이브</option><option value="account">계정 세이브</option></select></label>
    <details class="up-more" id="up-desc-l" hidden><summary>설명 넣기 (선택)</summary>
      <label>영어 설명 (다른 언어의 기본값)<textarea id="up-desc" maxlength="2000"></textarea></label>
      <label>한국어 설명<textarea id="up-desc-ko" maxlength="2000"></textarea></label>
    </details>
    <p class="up-plan" id="up-plan"></p>
    <div class="bar" id="up-bar" hidden><i></i></div>
    <div class="up-go"><button type="submit" class="primary" id="up-go">${top("u.go")}</button><button type="button" id="up-clear">${top("u.reset")}</button><span class="muted" id="up-progress"></span></div>
  </form>
  <p class="muted up-foot">${top("u.foot")} <a href="#library">${top("up.seeFiles")}</a></p>
  <p class="up-sum" id="up-sum" role="status" aria-live="polite" hidden></p>
  <div class="up-log" id="up-log" role="list" data-top-label="u.resultsAria" aria-label="올린 결과"></div>
</section>`;

export const UPLOAD_SCRIPT = /* js */ `
const upQuery=new URLSearchParams(location.search);
let upPending=['patch','save'].includes(upQuery.get('kind'))&&upQuery.get('app')?{kind:upQuery.get('kind'),app:upQuery.get('app')}:null;
// The page opens on the file chooser. What the names say is a suggestion shown next to it; the
// kinds and consoles only appear once files are picked, and only as many as the suggestion needs.
const upT=(k,v)=>{let s=topText('u.'+k);if(v)for(const x in v)s=s.split('{'+x+'}').join(v[x]);return s;};
const UP_KIND_KEY={game:'kGame',patch:'kPatch',save:'kSave',homebrew:'kHomebrew',port:'kPort',client:'kClient',retro:'kRetro'};
const UP_HINT_KEY={game:'hGame',retro:'hRetro',patch:'hPatch',save:'hSave',homebrew:'hHomebrew',client:'hClient',port:'hPort'};
let upKind=null,upInfo=null,upFiles=[],upPaths=null,upSystems=[],upGuess=null,upPreset=false,upOpen=false,upAllSys=false,upBusy=false;
let upUnits=[],upHistory=[],upDone=[];
${guessUpload.toString()}
${splitUnits.toString()}
${unitsToSend.toString()}
${tally.toString()}
${failureKind.toString()}
${tallyFiles.toString()}
${hasBatches.toString()}
${trimHistory.toString()}
// The entry names of a .zip, read from its central directory (no unpacking); null when it can't be read.
async function zipNames(file){
  try{const tail=Math.min(file.size,65557);const v=new DataView(await file.slice(file.size-tail).arrayBuffer());
    let end=-1;for(let i=tail-22;i>=0;i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
    if(end<0)return null;
    const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),off=v.getUint32(end+16,true);
    if(off===0xffffffff||size>8e6)return null;
    const cd=new DataView(await file.slice(off,off+size).arrayBuffer());const dec=new TextDecoder();const out=[];
    for(let p=0,i=0;i<count&&p+46<=size;i++){
      if(cd.getUint32(p,true)!==0x02014b50)return null;
      const nl=cd.getUint16(p+28,true),xl=cd.getUint16(p+30,true),cl=cd.getUint16(p+32,true);
      out.push(dec.decode(new Uint8Array(cd.buffer,p+46,nl)));p+=46+nl+xl+cl;}
    return out;}catch{return null;}}
// Files dropped on the page, with their paths when a folder was among them.
async function droppedFiles(dt){
  const entries=[...dt.items].map((i)=>i.webkitGetAsEntry?i.webkitGetAsEntry():null).filter(Boolean);
  const plain=[...dt.files];
  if(!entries.length||entries.every((x)=>x.isFile))return {files:plain,paths:null};
  const files=[],paths=[];
  const read=(r)=>new Promise((res,rej)=>r.readEntries(res,rej));
  async function walk(en,pre){
    if(en.isFile){files.push(await new Promise((res,rej)=>en.file(res,rej)));paths.push(pre+en.name);return;}
    const r=en.createReader();for(let b=await read(r);b.length;b=await read(r))for(const x of b)await walk(x,pre+en.name+'/');}
  for(const en of entries)await walk(en,'');
  return {files,paths};}
const upSysName=(id)=>(upInfo?.systems||[]).find((x)=>x.id===id)?.name||'';
function upKindName(kind){const sys=upSysName($('up-system').value);return kind==='retro'&&sys?upT('kRetro')+' · '+sys:upT(UP_KIND_KEY[kind]);}
// What the names say that the chosen kind (or console) does not match; '' when they agree or say nothing.
function upMismatch(){
  if(!upGuess||!upGuess.kind||!upKind)return '';
  const same=upGuess.kind===upKind||(upKind==='port'&&upGuess.kind==='homebrew');
  if(!same)return upKindName(upGuess.kind);
  const sys=$('up-system').value;
  if(upKind==='retro'&&sys&&upSystems.length&&!upSystems.includes(sys))return upSystems.map(upSysName).join(', ');
  return '';}
function upPlanText(){
  const app=$('up-target').value;
  if(!upKind)return '';
  if(upKind==='game')return upT('pGame',{n:upFiles.length||1});
  if(upKind==='retro'){const s=upSysName($('up-system').value);return s?upT('pRetro',{sys:s}):upT('pRetroNone');}
  if(upKind==='patch')return upT(app?'pPatchApp':'pPatch');
  if(upKind==='save')return upT(app?'pSaveApp':'pSave');
  return upT({homebrew:'pHomebrew',port:'pPort',client:'pClient'}[upKind]);}
function upHintText(){
  if(!upKind)return '';
  const app=$('up-target').value;
  let h=app&&(upKind==='patch'||upKind==='save')?upT(upKind==='patch'?'hPatchApp':'hSaveApp'):upT(UP_HINT_KEY[upKind]);
  if(upKind==='game'&&upFiles.length>1)h+=' '+upT('seq',{n:upFiles.length});
  return h;}
// One place draws the whole page from its state, so a language switch or a retry never leaves part of it stale.
function upRender(){
  const n=upFiles.length,size=upFiles.reduce((a,f)=>a+f.size,0),sys=$('up-system').value;
  $('up-drop').classList.toggle('has',n>0);
  $('up-drop-t').textContent=upT(n?'dropT2':'dropT');
  $('up-chosen').textContent=n?(upPaths?upPaths[0].split('/')[0]+'/ · ':'')+(n===1?upFiles[0].name:upT('filesN',{n}))+' · '+(size/1048576).toFixed(1)+' MB':'';
  $('up-lead').hidden=n>0||upPreset;
  $('up-form').hidden=!(n||$('up-target').value);
  // The suggestion and the choices.
  const showGuess=n>0&&!upPreset;
  const forced=!upKind||(upKind==='retro'&&!sys);
  const chooser=showGuess&&(upOpen||forced);
  $('up-guess').hidden=!showGuess;$('up-kinds').hidden=!chooser;
  $('up-change').hidden=forced;$('up-change').textContent=upT(chooser?'fold':'change');
  $('up-change').setAttribute('aria-expanded',String(chooser));
  const mm=upMismatch();
  let gt='',warn=false;
  if(showGuess){
    if(mm){gt=upT('mismatch',{kind:mm});warn=true;}
    else if(upGuess&&upGuess.mixed){gt=upT('guessMixed');warn=!upKind;}
    else if(!upKind){gt=upT('guessUnknown');warn=true;}
    else if(upGuess&&upGuess.kind===upKind&&upKind==='retro'&&upSystems.length>1&&!sys){gt=upT('guessAmbig');warn=true;}
    else if(upGuess&&(upGuess.kind===upKind||(upKind==='port'&&upGuess.kind==='homebrew')))gt=upT('guessed',{kind:upKindName(upKind)});
    else gt=upT('picked',{kind:upKindName(upKind)});}
  $('up-guess-t').textContent=gt;$('up-guess').classList.toggle('warn',warn);
  // Kind buttons: a console tile is pressed only when that console is the chosen one.
  for(const b of document.querySelectorAll('#up-kinds [data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===upKind&&(!b.dataset.system||b.dataset.system===sys)));
  const retro=chooser&&upKind==='retro';$('up-systems-wrap').hidden=!retro;
  const folded=upKind==='retro'&&Boolean(sys)&&!upAllSys,cands=upKind==='retro'&&!sys&&upSystems.length>0&&!upAllSys;
  $('up-systems').classList.toggle('folded',folded);$('up-systems').classList.toggle('cands',cands);
  for(const b of $('up-systems').querySelectorAll('[data-system]'))b.classList.toggle('cand',upSystems.includes(b.dataset.system));
  const more=$('up-systems').querySelector('.up-more-sys');if(more){more.textContent=upT('otherSys');more.hidden=!(folded||cands);}
  // The form.
  const ps=upKind==='patch'||upKind==='save';
  $('up-name-l').hidden=$('up-target-l').hidden=!ps;
  $('up-game-l').hidden=!ps||$('up-target').value!=='';
  $('up-desc-l').hidden=!ps;
  $('up-savetype-l').hidden=!(upKind==='save'&&$('up-target').value==='');
  $('up-required-l').hidden=!(upKind==='patch'&&$('up-target').value==='');
  $('up-hint').textContent=upHintText()+(upPreset&&n&&mm?' '+upT('mismatch',{kind:mm}):'');
  $('up-plan').textContent=upPlanText();
  const w=upKind&&upInfo&&upInfo.targets[upKind==='port'?'homebrew':upKind];$('up-note').replaceChildren();
  if(w&&!w.writable){const nt=el('div',null,'note warn');
    nt.append(el('div',w.exists===false?'이 종류를 받을 폴더가 서버에 없습니다':'이 폴더는 지금 쓸 수 없습니다','t'),
      el('div',w.exists===false?'compose 에서 이 폴더를 마운트하고 컨테이너를 다시 띄웁니다. 폴더 위치는 README 의 폴더 설명을 봅니다.'
        :'compose 에서 이 폴더 마운트의 read_only 를 false 로 바꾸고 컨테이너를 다시 띄웁니다.','d'));$('up-note').append(nt);}
  const failed=upUnits.filter((u)=>u.state==='fail').length;
  $('up-go').textContent=failed&&!upBusy?upT('goRetry',{n:failed}):upT('go');
  $('up-go').disabled=upBusy||!(w&&w.writable)||(upKind==='retro'&&!sys);$('up-clear').disabled=upBusy;$('up-clear').textContent=upT('reset');
  // The result of the batch on screen.
  // The batch on screen, or the one that just finished: its summary stays through a language switch.
  const shown=upUnits.length?upUnits:upDone;const t=tally(shown);const sum=$('up-sum');sum.hidden=!shown.length;
  if(shown.length)sum.textContent=upSumText(shown)+(upUnits.length&&t.fail&&t.ok&&!upBusy?'. '+upT('rKeep'):'');
  // While files are going up nothing that decides where they go can be changed.
  for(const b of document.querySelectorAll('#up-kinds button,#up-change,#up-file-btn,#up-dir-btn'))b.disabled=upBusy;
  for(const id of ['up-target','up-game','up-name','up-desc','up-desc-ko','up-savetype','up-required'])$(id).disabled=upBusy;
  $('up-drop').setAttribute('aria-disabled',String(upBusy));
  for(const u of upHistory)upPaint(u);}
// Counts in files when a request carries several (a folder, a disc set), else in requests; never invented per file.
const upFilesT=(n)=>n===1?upT('f1',{n}):upT('fN',{n});
const upBatchesT=(n,f)=>upT('bf',{b:n===1?upT('b1',{n}):upT('bN',{n}),f:upFilesT(f)});
function upSumText(units){const t=tally(units);
  if(!hasBatches(units))return upT('rSum',t)+(t.wait?upT('rSumWait',t):'');
  const f=tallyFiles(units);
  return upT('sumB',{ok:upBatchesT(t.ok,f.ok),fail:upBatchesT(t.fail,f.fail)})+(t.wait?upT('sumBWait',{wait:upBatchesT(t.wait,f.wait)}):'');}
function upTrim(){for(const u of trimHistory(upHistory,upUnits.length?upUnits:upDone,50)){u.row?.remove();upHistory.splice(upHistory.indexOf(u),1);}}
// One result row per request, updated in place as it goes from waiting to sent or failed.
function upPaint(u){
  if(!u.row){u.row=el('div',null,'note');u.row.setAttribute('role','listitem');$('up-log').prepend(u.row);}
  const ok=u.state==='ok',fail=u.state==='fail';
  u.row.className='note'+(fail?' warn':'');
  const head=ok?upT('rOk'):fail?upT('rFail'):upT(u.state==='busy'?'rBusy':'rWait');
  const kids=[el('div',head+' · '+u.label,'t')];
  if(u.files.length>1){const det=el('details',null,'d');det.append(el('summary',upT('rList',{n:u.files.length})));
    for(const [i,f] of u.files.entries())det.append(el('div',u.paths?u.paths[i]:f.name));
    kids.push(det,el('div',upT('rUnit'),'d'));}
  if(ok){const d=u.d||{};
    kids.push(el('div',upT('rWhere',{where:d.where,files:upFilesT(d.files)})+(d.kind==='port'?' · '+upT('rPort'):''),'d'));
    if(d.install){for(const x of d.install.excluded||[])kids.push(el('div',upT('rExcl',{rule:topText('hb.ex.'+x.rule)||x.rule,paths:x.paths.join(', ')}),'d'));
      if(d.install.rules?.length)kids.push(el('div',upT('rBasis',{rules:d.install.rules.join(' · ')}),'d'));}}
  if(fail){const why=failureKind(u.status,u.code);
    kids.push(el('div',why==='net'?upT('rNet'):(u.msg||('HTTP '+u.status)),'d'));
    if(why==='dup')kids.push(el('div',upT('rDup'),'d'));
    if(upUnits.includes(u)&&!upBusy){const row=el('div',null,'row-actions');const b=el('button',upT('rRetry'));b.type='button';
      b.addEventListener('click',()=>upSubmit([u]));row.append(b);kids.push(row);}}
  u.row.replaceChildren(...kids);}
function upSetKind(kind,fromUser){
  if(fromUser)upDropBatch();
  upKind=kind;upRender();}
// A batch that was partly sent is over once the kind changes: what went up stays up, the rest is picked again.
function upDropBatch(){
  if(upBusy||!upUnits.length)return;
  const rest=unitsToSend(upUnits);
  if(rest.length<upUnits.length){upFiles=rest.flatMap((u)=>u.files);if(!rest.some((u)=>u.paths))upPaths=null;}
  upUnits=[];}
// Initial page load and a quick file pick share the same target lookup.
let upInfoFlight=null;
async function loadUploadInfo(){
  if(upInfo)return true;
  if(!upInfoFlight)upInfoFlight=fetchUploadInfo().finally(()=>{upInfoFlight=null;});
  return upInfoFlight;}
async function fetchUploadInfo(){
  try{upInfo=await api('/admin/api/upload/targets');
  $('up-system').replaceChildren(...upInfo.systems.map((s)=>{const o=el('option',s.name+' ('+s.extensions.join(' ')+')');o.value=s.id;return o;}));
  // Every retro console is its own tile, so a ROM goes where it was meant to and not where its extension guesses.
  $('up-systems').replaceChildren(...upInfo.systems.map((s)=>{const b=el('button');b.type='button';b.dataset.kind='retro';b.dataset.system=s.id;
    const im=el('img');im.alt='';im.loading='lazy';im.src='/api/retro/systems/'+encodeURIComponent(s.id)+'/icon';im.onerror=()=>im.style.visibility='hidden';
    b.append(im,el('b',s.name));b.title=s.name+' · '+s.extensions.join(' ');b.setAttribute('aria-label','레트로 · '+s.name);return b;}));
  const more=el('button',null,'up-more-sys');more.type='button';more.hidden=true;
  more.addEventListener('click',()=>{upAllSys=true;upRender();});$('up-systems').append(more);
  if(!upInfo.systems.length)$('up-systems').append(el('div','서버에 레트로 기종이 없습니다.','empty'));
  // A homebrew app's patch or save goes into its own switch/<app>/ folder.
  for(const h of upInfo.homebrew||[]){const o=el('option',(h.kind==='port'?'포트 · ':'홈브류 · ')+h.name+' (switch/'+h.app+'/)');o.value=h.app;$('up-target').append(o);}
  return true;}catch(e){upInfo=null;toast(errText(e));return false;}}
async function loadUpload(){
  if(!await loadUploadInfo())return;
  // Sent here from an app card: the app and what to add to it are already chosen.
  // An entry that arrives while files are going up waits: it is applied when the batch ends.
  if(upPending&&!upBusy){
    // A new entry starts clean: nothing picked or failed before may be sent to the kind chosen here.
    if(!upBusy){upFiles=[];upPaths=null;upUnits=[];upGuess=null;upSystems=[];upOpen=false;upAllSys=false;}
    $('up-target').value=upPending.app;upKind=upPending.kind;upPreset=true;upPending=null;}
  upRender();}
// New files: read what they are from the names, fill in what the names tell, and leave the rest to the admin.
async function upTake(files,paths){
  if(upBusy||!files.length||!await loadUploadInfo())return;
  upFiles=files;upPaths=paths;upUnits=[];upDone=[];upAllSys=false;upOpen=false;
  const zip=!paths&&files.length===1&&/[.]zip$/i.test(files[0].name)?await zipNames(files[0]):null;
  const g=guessUpload({names:files.map((f)=>f.name),paths,zipNames:zip,systems:upInfo.systems});
  upGuess=g;upSystems=g.systems||[];
  if(g.name)$('up-name').value=g.name;
  if(!upPreset){
    // Several consoles fit one extension: none is picked until the admin does.
    upKind=g.kind??null;$('up-system').value=upSystems.length===1?upSystems[0]:'';
    if(g.titleId){$('up-target').value='';const game=upInfo.games.find((x)=>x.titleId===g.titleId);
      $('up-game').value=game?game.name+' ['+game.titleId+']':g.titleId;}}
  upRender();}
function upReset(){if(upBusy)return;upFiles=[];upPaths=null;upSystems=[];upGuess=null;upUnits=[];upDone=[];upOpen=false;upAllSys=false;upPreset=false;upKind=null;
  for(const id of ['up-name','up-desc','up-desc-ko','up-savetype'])$(id).value='';
  $('up-required').checked=false;$('up-target').value='';$('up-game').value='';
  upRender();}
$('up-target').addEventListener('change',()=>{upDropBatch();upRender();});
$('up-game').addEventListener('input',()=>{upDropBatch();upRender();});
gamePicker($('up-game'),{fill:true,pick:()=>{upDropBatch();upRender();}});
$('up-kinds').addEventListener('click',(e)=>{const b=e.target.closest('[data-kind]');if(!b||upBusy)return;
  const kind=b.dataset.kind;
  if(b.dataset.system){$('up-system').value=b.dataset.system;upOpen=false;}
  else if(kind==='retro'){if(upKind!=='retro')$('up-system').value='';}
  else upOpen=false;
  upSetKind(kind,true);});
$('up-change').addEventListener('click',()=>{if(upBusy)return;upOpen=!upOpen;upRender();});
$('up-file-btn').addEventListener('click',()=>{if(!upBusy)$('up-file').click();});
$('up-dir-btn').addEventListener('click',()=>{if(!upBusy)$('up-dir').click();});
$('up-drop').addEventListener('click',(e)=>{if(!upBusy&&!e.target.closest('button'))$('up-file').click();});
$('up-drop').addEventListener('keydown',(e)=>{if(e.target===$('up-drop')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(!upBusy)$('up-file').click();}});
$('up-clear').addEventListener('click',upReset);
$('up-file').addEventListener('change',()=>{const f=[...$('up-file').files];$('up-file').value='';upTake(f,null);});
$('up-dir').addEventListener('change',()=>{const f=[...$('up-dir').files];$('up-dir').value='';upTake(f,f.map((x)=>x.webkitRelativePath||x.name));});
// Files dragged anywhere on the page open the upload tab and land there.
const hasFiles=(e)=>Boolean(e.dataTransfer)&&[...e.dataTransfer.types].includes('Files');
let dragDepth=0;
document.addEventListener('dragenter',(e)=>{if(!hasFiles(e))return;e.preventDefault();
  if(dragDepth++===0){document.body.classList.add('dragging');if(location.hash!=='#upload')location.hash='upload';}});
document.addEventListener('dragleave',(e)=>{if(!hasFiles(e))return;if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('dragging');}});
document.addEventListener('dragover',(e)=>{if(hasFiles(e)){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
document.addEventListener('drop',async(e)=>{if(!hasFiles(e))return;e.preventDefault();dragDepth=0;document.body.classList.remove('dragging');
  const got=await droppedFiles(e.dataTransfer);upTake(got.files,got.paths);});
function upTitleId(){const v=$('up-game').value.trim();const m=v.match(/[0-9A-Fa-f]{16}/);return m?m[0].toUpperCase():'';}
// One unit goes up in pieces and is placed by one request; it ends with the unit marked sent or failed and its row repainted.
async function upSend(u,label){
  // Where it goes was frozen into the unit when the batch was made; the name and descriptions are read now.
  const k=u.f.kind;const fields={};
  if(k==='retro')fields.system=u.f.system;
  if(k==='patch'||k==='save'){const app=u.f.app;
    if(app)fields.homebrew=app;else fields.titleId=u.f.titleId;fields.name=$('up-name').value.trim();
    fields.description=$('up-desc').value.trim();fields.descriptionKo=$('up-desc-ko').value.trim();
    if(k==='save'&&!app&&$('up-savetype').value)fields.saveType=$('up-savetype').value;
    if(k==='patch'&&!app&&$('up-required').checked)fields.required='true';}
  if(k==='port')fields.port='true';
  const bar=$('up-bar');bar.hidden=false;bar.firstElementChild.style.width='0';$('up-progress').textContent=label;
  const r=await chunkedKind(k==='port'?'homebrew':k,u.files,{fields,paths:u.paths,onProgress:(x)=>{bar.firstElementChild.style.width=(x*100).toFixed(1)+'%';}});
  const d=r.d||{};
  u.status=r.status;u.d=d;u.msg=d.error||'';u.code=d.code||null;u.state=r.status===201?'ok':'fail';
  upPaint(u);}
// Send the given units (default: every one that has not gone in). Units that went up are never sent again.
async function upSubmit(only){
  if(upBusy)return;
  if(!upFiles.length){toast(upT('tFiles'));return;}
  if(!upKind){toast(upT('tKind'));return;}
  if(upKind==='retro'&&!$('up-system').value){toast(upT('tSys'));return;}
  if(upKind==='patch'||upKind==='save'){
    if(!$('up-target').value&&!upTitleId()){toast(upT('tTarget'));return;}
    if(!$('up-name').value.trim()){toast(upT('tName'));return;}}
  if(!upUnits.length){
    upUnits=splitUnits({kind:upKind,names:upFiles.map((f)=>f.name),paths:upPaths}).map((s)=>({label:s.label,files:s.from.map((i)=>upFiles[i]),paths:upPaths&&upKind!=='game'?s.from.map((i)=>upPaths[i]):null,state:'wait',f:{kind:upKind,system:$('up-system').value,app:$('up-target').value,titleId:upTitleId()}}));
    upDone=[];
    for(const u of upUnits)upHistory.push(u);
    // Rows go in newest first, so the batch reads top to bottom in the order it was picked.
    for(const u of [...upUnits].reverse())upPaint(u);
    upTrim();}
  const todo=(only||unitsToSend(upUnits)).filter((u)=>u.state!=='ok');
  upBusy=true;for(const u of todo)u.state='wait';upRender();
  for(const [i,u] of todo.entries()){u.state='busy';upPaint(u);
    await upSend(u,todo.length>1?(i+1)+' / '+todo.length+' · '+u.label:'');}
  upBusy=false;$('up-bar').hidden=true;$('up-progress').textContent='';
  if(!upUnits.some((u)=>u.state!=='ok')){
    // Everything went up: the picked files are done with, the results stay on screen.
    upFiles=[];upPaths=null;upSystems=[];upGuess=null;upOpen=false;upAllSys=false;upPreset=false;upKind=null;
    for(const id of ['up-name','up-desc','up-desc-ko','up-savetype'])$(id).value='';
    $('up-required').checked=false;$('up-target').value='';$('up-game').value='';
    const done=upUnits;upUnits=[];upRender();
    // The summary of a finished batch stays until the next pick.
    upDone=done;upRender();upTrim();
    toast(upT('tDone'));}
  else{upRender();toast(upT('tSome'));}
  if(upPending)await loadUpload();}
$('up-form').addEventListener('submit',(e)=>{e.preventDefault();upSubmit();});

addEventListener('beforeunload',(e)=>{if(upBusy)e.preventDefault();});
`;
