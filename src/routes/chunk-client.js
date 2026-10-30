/**
 * The browser side of the public site's resumable uploads (routes/web-chunks.js), inlined into views/landing.html.
 * A file goes up in pieces small enough for a tunnel, and picks up where it stopped after a dropped connection.
 * The admin pages have their own copy in admin/common-script.js, wired to the admin chunk routes.
 *
 *   chunkUploadTo(chunksUrl, file, { onBytes, headers }) → { status: 200, id } or the { status, d } that stopped it
 *   chunkedPost(chunksUrl, url, file, { headers, uploadHeaders, onBytes })   the file in pieces, then one fetch to
 *       `url` naming it in X-Chunk-Id; resolves that Response, throws when a piece could not be sent
 *   chunkCall(method, url, body, type, onLoaded, headers) → { status, d }   one request; status 0 when no answer came
 *   chunkRetry(call)    tried again with a growing wait on no answer or a 5xx; a refusal (and 507) is final
 */
export const CHUNK_CLIENT = /* js */ `
// The piece size can be set from the page (window.UP_CHUNK_BYTES) for tests.
const chunkSize=()=>Number(window.UP_CHUNK_BYTES)||16*1048576;
const CHUNK_TRIES=6;
function chunkCall(method,url,body,type,onLoaded,headers){return new Promise((resolve)=>{
  const x=new XMLHttpRequest();
  if(onLoaded)x.upload.addEventListener('progress',(e)=>{if(e.lengthComputable)onLoaded(e.loaded);});
  x.addEventListener('loadend',()=>{let d={};try{d=JSON.parse(x.responseText);}catch{}resolve({status:x.status,d});});
  x.open(method,url);x.setRequestHeader('Accept','application/json');
  for(const k in headers||{})x.setRequestHeader(k,headers[k]);
  if(type)x.setRequestHeader('Content-Type',type);
  x.send(body);});}
async function chunkRetry(call){let r;
  for(let i=0;i<CHUNK_TRIES;i++){r=await call();
    if(r.status!==0&&(r.status<500||r.status===507))return r;
    if(i<CHUNK_TRIES-1)await new Promise((ok)=>setTimeout(ok,Math.min(15000,(Number(window.UP_RETRY_MS)||1000)*2**i)));}
  return r;}
async function chunkUploadTo(chunksUrl,file,opts={}){
  const body=JSON.stringify({name:file.name,size:file.size,lastModified:file.lastModified});
  let r=await chunkRetry(()=>chunkCall('POST',chunksUrl,body,'application/json',null,opts.headers));
  if(r.status!==200)return r;
  const id=r.d.id;let off=r.d.offset,stall=0;
  if(opts.onBytes)opts.onBytes(off);
  while(off<file.size){
    const from=off;
    r=await chunkRetry(()=>chunkCall('PUT',chunksUrl+'/'+id+'?offset='+from,file.slice(from,Math.min(from+chunkSize(),file.size)),'application/octet-stream',(n)=>{if(opts.onBytes)opts.onBytes(from+n);},opts.headers));
    // A wrong offset answers the real one: carry on from there.
    if(r.status===200)off=r.d.offset;
    else if(r.status===409&&typeof r.d.offset==='number')off=r.d.offset;
    else return r;
    stall=off>from?0:stall+1;
    if(stall>=CHUNK_TRIES)return r;
    if(opts.onBytes)opts.onBytes(off);}
  return {status:200,id};}
async function chunkedPost(chunksUrl,url,file,opts={}){
  const r=await chunkUploadTo(chunksUrl,file,{headers:opts.uploadHeaders,onBytes:opts.onBytes});
  if(r.status===0)throw new Error('network');
  if(r.status!==200)return new Response(JSON.stringify(r.d||{}),{status:r.status,headers:{'Content-Type':'application/json'}});
  const headers=new Headers(opts.headers);headers.set('X-Chunk-Id',r.id);
  return fetch(url,{method:'POST',headers});}
`;
