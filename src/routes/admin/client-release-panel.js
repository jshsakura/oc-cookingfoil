import { top, topPh, topLabel } from "./top-i18n.js";
/**
 * The overview tab's client build block: how the CookingFoil client build
 * reaches this server (uploaded by hand, or also followed on GitHub), the
 * release followed, what consoles are offered and from where, and a button to
 * look right away. Talks to /admin/api/client-release (client-release-api.js)
 * and saves the mode and the release as server settings.
 */

export const CLIENT_RELEASE_HTML = `<p class="muted">${top("cr.lede")}</p>
<form class="add" id="cr-form" autocomplete="off">
  <select id="cr-mode" ${topLabel("cr.modeLabel")}><option value="manual">${top("cr.manual")}</option><option value="github">${top("cr.github")}</option></select>
  <input id="cr-repo" ${topPh("cr.repoPh")} ${topLabel("cr.repoLabel")} maxlength="140" spellcheck="false">
  <input id="cr-tag" ${topPh("cr.tagPh")} ${topLabel("cr.tagLabel")} maxlength="100" spellcheck="false">
  <input id="cr-asset" ${topPh("cr.assetPh")} ${topLabel("cr.assetLabel")} maxlength="104" spellcheck="false">
  <button type="submit" data-top="fp.save">${top("fp.save")}</button>
  <button class="primary" type="button" id="cr-check">${top("cr.checkBtn")}</button>
</form>
<p class="muted" id="cr-token-hint" hidden>${top("cr.tokenHint")}</p>
<div class="scroll" id="cr-status" data-skel></div>`;

export const CLIENT_RELEASE_SCRIPT = /* js */ `
const CR_SOURCE={manual:'cr.manualShort',github:'GitHub'};
function crShowFields(){const gh=$('cr-mode').value==='github';for(const id of ['cr-repo','cr-tag','cr-asset','cr-check','cr-token-hint'])$(id).hidden=!gh;}
function crRender(d){
  $('cr-mode').value=d.mode||'manual';$('cr-repo').value=d.repo||'';$('cr-tag').value=d.tag||'';$('cr-asset').value=d.asset||'';crShowFields();
  const v=(x)=>x?x.version:topText('hb.noneVal');
  const rows=[[topText('cr.rowOffered'),d.offered?topFill('cr.offeredVal',{v:d.offered.version,src:d.offered.source==='github'?'GitHub':topText(CR_SOURCE[d.offered.source]||'cr.manualShort'),at:fmt(d.offered.at)}):topText('hb.noneVal')],[topText('cr.rowManual'),v(d.manual)]];
  if(d.mode==='github'){
    rows.push([topText('cr.rowFollowing'),topFill('cr.followingVal',{repo:d.repo||'',tag:d.tag||topText('cr.latest')})]);
    rows.push([topText('cr.rowFetched'),d.fetched?topFill('cr.fetchedVal',{v:d.fetched.version,at:fmt(d.fetched.at)}):v(d.github)]);
    rows.push([topText('hb.checkedAt'),d.checked_at?fmt(d.checked_at)+(d.error?topText('cr.checkFailed'):topText('cr.checkOk')):topText('cr.notChecked')]);
    if(d.error)rows.push([topText('cr.rowResult'),d.error.message]);
  }
  if(d.rejected)rows.push([topText('cr.rowRejected'),d.rejected.message]);
  table('cr-status',[topText('cr.colItem'),topText('cr.colValue')],rows.map(([k,x])=>{const tr=el('tr');tr.append(td(k),td(x));return tr;}),'');
}
async function loadClientRelease(){try{crRender(await api('/admin/api/client-release'));}catch(err){toast(err.message);}}
async function crCheck(quiet){const b=$('cr-check');b.disabled=true;
  try{const d=await api('/admin/api/client-release/check',{method:'POST',body:{}});crRender(d);
    if(!quiet)toast(d.error?topFill('cr.fetchFail',{msg:d.error.message}):topFill('cr.checkedToast',{v:d.offered?.version||topText('hb.noneVal')}));}
  catch(err){toast(err.message);}finally{b.disabled=false;}}
$('cr-mode').addEventListener('change',crShowFields);
$('cr-form').addEventListener('submit',async(e)=>{e.preventDefault();
  const body={clientSource:$('cr-mode').value};
  if(body.clientSource==='github')Object.assign(body,{clientReleaseRepo:$('cr-repo').value.trim(),clientReleaseTag:$('cr-tag').value.trim(),clientReleaseAsset:$('cr-asset').value.trim()});
  try{await api('/admin/api/server-settings',{method:'POST',body});toast(topText('pp.saved'));crCheck(true);}
  catch(err){toast(/clientReleaseRepo/.test(err.message)?topText('cr.errRepo'):/clientReleaseTag/.test(err.message)?topText('cr.errTag'):/clientReleaseAsset/.test(err.message)?topText('cr.errAsset'):err.message);}});
$('cr-check').addEventListener('click',()=>crCheck(false));
`;
