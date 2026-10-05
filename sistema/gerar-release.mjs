import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedUpdatePath, sha256 } from './atualizador.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw new Error('Informe version no package.json, por exemplo 1.0.1.');
if(process.env.GITHUB_REF_TYPE==='tag' && process.env.GITHUB_REF_NAME!=='v'+pkg.version)throw new Error('A tag precisa corresponder à version de package.json.');
const paths=(await readdir(join(root,'sistema'))).filter(n=>n.endsWith('.mjs')).map(n=>'sistema/'+n)
  .concat(['iniciar.bat','iniciar.sh','package.json','README.md','LEIA-ME-ATUALIZACAO.md','sistema/README.md','sistema/configuracao.exemplo.json']).sort();
const files=[];
for(const path of paths){
 if(!allowedUpdatePath(path))throw new Error('Arquivo não permitido: '+path);
 const bytes=await readFile(join(root,path));
 files.push({path,content:bytes.toString('base64'),sha256:sha256(bytes),mode:path.endsWith('.sh')?0o755:0o644});
}
await mkdir(join(root,'dist'),{recursive:true});
await writeFile(join(root,'dist','atualizacao.json'),JSON.stringify({format:1,version:pkg.version,minNodeMajor:22,files}));
console.log('Release '+pkg.version+': '+files.length+' arquivos de programa; configuração e dados não incluídos.');
