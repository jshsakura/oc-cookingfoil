/**
 * The browser half of a passkey ceremony (security/passkeys.js), as a script string the sign-in
 * pages and the admin page inline. It turns the server's JSON options into what
 * navigator.credentials takes, and the authenticator's answer back into JSON.
 *   pkReady()          why this page cannot use passkeys, as a word key ("pk.insecure", "pk.unsupported"), or ""
 *   pkCreate(options)  add one; pkGet(options) sign in. Both reject with the browser's error.
 *   pkFail(err)        the passkey-words key that says why a ceremony did not finish
 * No backslashes: the admin page puts it inside a template literal.
 */
export const PASSKEY_CLIENT_JS = `
const pkB=(s)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),(c)=>c.charCodeAt(0));
const pkS=(b)=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/[+]/g,'-').replace(/[/]/g,'_').replace(/=+$/,'');
function pkReady(){if(!window.isSecureContext)return 'pk.insecure';return window.PublicKeyCredential&&navigator.credentials?'':'pk.unsupported';}
async function pkCreate(o){o.challenge=pkB(o.challenge);o.user.id=pkB(o.user.id);for(const c of o.excludeCredentials||[])c.id=pkB(c.id);
  const c=await navigator.credentials.create({publicKey:o});const r=c.response;
  return{id:c.id,rawId:pkS(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults(),authenticatorAttachment:c.authenticatorAttachment||undefined,
    response:{clientDataJSON:pkS(r.clientDataJSON),attestationObject:pkS(r.attestationObject),transports:r.getTransports?r.getTransports():[]}};}
async function pkGet(o){o.challenge=pkB(o.challenge);for(const c of o.allowCredentials||[])c.id=pkB(c.id);
  const c=await navigator.credentials.get({publicKey:o});const r=c.response;
  return{id:c.id,rawId:pkS(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults(),authenticatorAttachment:c.authenticatorAttachment||undefined,
    response:{clientDataJSON:pkS(r.clientDataJSON),authenticatorData:pkS(r.authenticatorData),signature:pkS(r.signature),userHandle:r.userHandle?pkS(r.userHandle):undefined}};}
function pkFail(err){const code=err&&(err.code||err.name);
  return{NotAllowedError:'pk.cancelled',AbortError:'pk.cancelled',InvalidStateError:'pk.failed',unknown:'pk.unknown',insecure:'pk.insecure',limit:'pk.limit'}[code]||'pk.failed';}
`;
