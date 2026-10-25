/** OAuth settings belong to the login page, independently of account approval. */
export const GOOGLE_SETTINGS_SCRIPT = /* js */ `
if($('google-form'))$('google-form').addEventListener('submit',async(e)=>{e.preventDefault();
  try{await api('/admin/api/google',{method:'POST',body:{enabled:$('g-enabled').checked,clientId:$('g-id').value,clientSecret:$('g-secret').value}});
    toast(topText('pp.saved'));loadGoogleSettings();}catch(err){toast(err.message);}});
if($('g-clear'))$('g-clear').addEventListener('click',async()=>{if(!await ask(topText('pp.googleClearAsk'),{danger:true}))return;
  try{await api('/admin/api/google/clear',{method:'POST',body:{}});toast(topText('pp.deleted'));loadGoogleSettings();}catch(err){toast(err.message);}});
if($('g-copy'))$('g-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('g-redirect').textContent);toast(topText('pp.copied'));}catch{toast(topText('pp.copyFail'));}});
async function loadGoogleSettings(){
  if(!$('g-enabled'))return;
  try{const g=await api('/admin/api/google');$('g-enabled').checked=g.enabled;$('g-id').value=g.clientId||'';
    $('g-secret').value='';$('g-secret').placeholder=g.hasSecret?topText('pp.storedSecretPh'):topText('pp.clientSecret');
    $('g-redirect').textContent=g.redirectUri;
    $('g-status').textContent=g.active?topText('pp.googleOn'):g.enabled?topText('pp.googleNeedBoth'):topText('pp.googleOffStatus');
  }catch(err){toast(errText(err));}}
`;
