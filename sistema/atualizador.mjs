import { readFile, writeFile, mkdir, copyFile, rename, unlink, lstat, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const repository = 'firenalabs/2ndbpromax';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function allowedUpdatePath(path) {
  return typeof path === 'string' && (
    /^sistema\/[a-z0-9-]+\.mjs$/.test(path) ||
    ['iniciar.bat','iniciar.sh','package.json','README.md','LEIA-ME-ATUALIZACAO.md','sistema/README.md','sistema/configuracao.exemplo.json'].includes(path)
  );
}
function versionParts(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('A atualização não tem uma versão válida.');
  return value.split('.').map(Number);
}
export function compareVersions(a,b) {
  const left=versionParts(a),right=versionParts(b);
  for(let i=0;i<3;i++) if(left[i]!==right[i]) return Math.sign(left[i]-right[i]);
  return 0;
}
export function validateBundle(bundle, expectedVersion) {
  if (bundle?.format !== 1 || bundle.version !== expectedVersion || bundle.minNodeMajor !== 22 || !Array.isArray(bundle.files) || !bundle.files.length || bundle.files.length > 100) throw new Error('Pacote de atualização inválido.');
  versionParts(bundle.version);
  const paths = new Set(); let size=0;
  for (const file of bundle.files) {
    if (!allowedUpdatePath(file.path) || paths.has(file.path) || typeof file.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content) || ![0o644,0o755].includes(file.mode)) throw new Error('Arquivo não permitido na atualização: '+file.path);
    paths.add(file.path);
    const bytes=Buffer.from(file.content,'base64');size+=bytes.length;
    if (sha256(bytes)!==file.sha256 || size>10_000_000) throw new Error('A integridade do pacote não pôde ser confirmada.');
  }
  if (!paths.has('package.json') || !paths.has('sistema/iniciar.mjs') || !paths.has('sistema/atualizador.mjs')) throw new Error('O pacote de atualização está incompleto.');
  const pkg=JSON.parse(Buffer.from(bundle.files.find(f=>f.path==='package.json').content,'base64').toString('utf8'));
  if(pkg.version!==bundle.version) throw new Error('A versão do programa não corresponde à atualização.');
  return bundle;
}
async function safeDestination(root, path) {
  let current=root;
  for (const part of path.split('/')) {
    current=join(current,part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('A atualização não substitui links: '+path); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
  }
}
async function replaceFile(path,bytes,mode) {
  const temporary=path+'.atualizacao.tmp';
  await writeFile(temporary,bytes,{mode});
  try {await rename(temporary,path);await chmod(path,mode);}
  finally {await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export async function applyBundle(root,bundle,{replace=replaceFile}={}) {
  validateBundle(bundle,bundle.version);
  for(const file of bundle.files) await safeDestination(root,file.path);
  const backupRelative='Atualizações/Backups/'+new Date().toISOString().replace(/[:.]/g,'-');
  await safeDestination(root,backupRelative+'/registro.json');
  const backup=join(root,backupRelative),originals=[];
  await mkdir(backup,{recursive:true});
  for(const file of bundle.files) {
    const path=join(root,file.path);let stat;
    try {stat=await lstat(path);if(!stat.isFile())throw new Error('Destino não é arquivo: '+file.path);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    originals.push({path:file.path,existed:!!stat,mode:stat?.mode & 0o777});
    if(stat){await mkdir(dirname(join(backup,file.path)),{recursive:true});await copyFile(path,join(backup,file.path));}
  }
  await writeFile(join(backup,'registro.json'),JSON.stringify({version:bundle.version,files:originals},null,2));
  const touched=[];
  try {
    for(const file of bundle.files){
      await mkdir(dirname(join(root,file.path)),{recursive:true});touched.push(file.path);
      await replace(join(root,file.path),Buffer.from(file.content,'base64'),file.mode);
    }
  } catch(error) {
    try {
      for(const path of touched.reverse()) {
        const old=originals.find(f=>f.path===path);
        if(old.existed)await replaceFile(join(root,path),await readFile(join(backup,path)),old.mode);
        else await unlink(join(root,path)).catch(e=>{if(e.code!=='ENOENT')throw e;});
      }
    } catch(restoreError) {throw new Error('Falha na atualização e na restauração. Código anterior em '+backupRelative+'. '+restoreError.message);}
    throw new Error('Não foi possível atualizar. O código anterior foi restaurado. '+error.message);
  }
  return backupRelative;
}
async function downloadJson(url,request,maxBytes=1_000_000) {
  const response=await request(url,{headers:{Accept:'application/vnd.github+json','User-Agent':'2ndBrainProMax'},signal:AbortSignal.timeout(60000)});
  if(!response.ok) throw new Error(response.status===404?'Ainda não há uma atualização publicada no GitHub.':'GitHub indisponível: HTTP '+response.status+'. Tente novamente depois.');
  let bytes=0;const chunks=[];
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>maxBytes)throw new Error('Download de atualização acima do limite.');chunks.push(Buffer.from(chunk));}
  return {value:JSON.parse(Buffer.concat(chunks).toString('utf8')),bytes:Buffer.concat(chunks)};
}
export async function updateSystem(root,{request=fetch,log=console.log}={}) {
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const current=pkg.version??'0.0.0';
  log('Procurando atualização no GitHub…');
  const {value:release}=await downloadJson('https://api.github.com/repos/'+repository+'/releases/latest',request);
  if(release.draft || release.prerelease)throw new Error('A release não está pronta para uso.');
  const version=release.tag_name?.replace(/^v/,'');
  if(compareVersions(version,current)<=0){log('Seu sistema já está atualizado ('+current+').');return {updated:false,version:current};}
  const asset=release.assets?.find(a=>a.name==='atualizacao.json');
  if(!asset?.browser_download_url?.startsWith('https://github.com/'+repository+'/releases/download/'))throw new Error('Essa release não contém o pacote de atualização.');
  log('Baixando versão '+version+'…');
  const downloaded=await downloadJson(asset.browser_download_url,request,15_000_000);
  if(asset.digest && asset.digest!=='sha256:'+sha256(downloaded.bytes))throw new Error('O download não corresponde ao arquivo publicado.');
  const bundle=validateBundle(downloaded.value,version);
  const backup=await applyBundle(root,bundle);
  log('Sistema atualizado para '+version+'. Feche e abra o iniciador novamente.');
  log('Código anterior guardado em '+backup+'.');
  log('O n8n não foi modificado. Instruções da versão: '+(release.html_url??'https://github.com/'+repository+'/releases/latest'));
  return {updated:true,version,backup};
}
