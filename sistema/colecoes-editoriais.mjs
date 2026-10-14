import {mkdir,readFile,writeFile,cp,rename,readdir,unlink} from 'node:fs/promises';
import {join,relative,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {readJson,writeJson} from './arquivos.mjs';
import {listMaterials} from './materiais.mjs';
import {fileLink} from './familias-editoriais.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
function label(value,max=75) {
  const text=String(value??'Conteúdo').normalize('NFC').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g,'-').trim();
  let out='';for(const c of text){if(Buffer.byteLength(out+c,'utf8')>max)break;out+=c;}return out||'Conteúdo';
}
function inside(base,path) {
  const target=resolve(base,path);
  if(typeof path!=='string'||target===resolve(base)||!target.startsWith(resolve(base)+sep))throw Error('Referência editorial fora da pasta de conteúdos.');
  return target;
}
async function exists(path){return readFile(path).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;});}
export async function backupCollectionMigration(root,state) {
  if(state.collectionLayoutVersion===3)return;
  const base=join(root,'Conteúdos Gerados');
  const names=await readdir(base).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  if(names.length) {
    const backup='Atualizações/Backups/colecoes-'+new Date().toISOString().replace(/[:.]/g,'-');
    await mkdir(join(root,backup),{recursive:true});
    await cp(base,join(root,backup,'Conteúdos Gerados'),{recursive:true,errorOnExist:true,force:false});
    await writeJson(join(root,backup,'geracoes.json'),state);
    state.collectionBackup=backup;
  }
  state.collectionLayoutVersion=3;
}

export async function rebuildCollections(root,state) {
  const base=join(root,'Conteúdos Gerados'),statePath=join(root,'sistema/geracoes.json');
  await backupCollectionMigration(root,state);
  const inputs=new Map();
  const register=(id,name,file,date)=>{if(!inputs.has(id))inputs.set(id,{id,name:name??id,file:file??null,date:date??''});};
  for(const m of await listMaterials(root))register(m.sourceId,m.inputName,m.sourceFile,m.createdAt);
  const units=Object.values(state.units);
  for(const u of units)for(const [i,id]of(u.source?.sourceIds??[]).entries())register(id,u.source.sourceIds.length===1?u.source.inputName:u.source.inputFiles?.[i]?.split(/[\\/]/).at(-1),u.source.inputFiles?.[i],u.source.createdAt);
  for(const b of state.batches)for(const s of b.sources??[])for(const[i,id]of(s.sourceIds??[]).entries())register(id,s.inputName??s.inputFiles?.[i]?.split(/[\\/]/).at(-1),s.inputFiles?.[i],s.createdAt);
  state.collections??={};state.collectionAliases??={};
  for(const input of inputs.values()) {
    const id='col-'+hash(input.id);
    state.collections[id]??={id,sourceIds:[input.id],createdAt:input.date,title:input.name??input.id,folder:null};
  }
  const parent=new Map([...inputs.keys()].map(id=>[id,id]));
  const find=id=>{let x=id;while(parent.get(x)!==x)x=parent.get(x);return x;};
  const union=ids=>{const valid=ids.filter(id=>parent.has(id));if(!valid.length)return;const first=find(valid[0]);for(const id of valid)parent.set(find(id),first);};
  // Consolidação persistida e agrupamentos explícitos; não há inferência por assunto/dia.
  for(const c of Object.values(state.collections))union(c.sourceIds);
  for(const b of state.batches)for(const s of b.sources??[])if(s.kind==='grupo')union(s.sourceIds??[]);
  for(const u of units)if(u.source?.kind==='grupo')union(u.source.sourceIds??[]);
  const groups=new Map();for(const id of inputs.keys()){const key=find(id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(id);}
  const active=[],byInput=new Map();
  for(const ids of groups.values()) {
    const candidates=Object.values(state.collections).filter(c=>c.sourceIds.some(id=>ids.includes(id))&&!state.collectionAliases[c.id]);
    candidates.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    const c=candidates[0];c.sourceIds=[...ids].sort();
    const related=units.filter(u=>u.source?.sourceIds?.some(id=>ids.includes(id)));
    const representative=related.find(u=>u.source.kind==='grupo')??related[0]??{source:state.batches.flatMap(b=>b.sources??[]).find(s=>s.sourceIds?.some(id=>ids.includes(id)))};
    if(!c.folder){c.title=representative?.source?.keytopic??c.title;c.folder='Coleções/'+label(c.title)+' — '+c.id;}
    for(const other of candidates.slice(1))state.collectionAliases[other.id]=c.id;
    // Resolver aliases transitivos sem manter cadeias.
    for(const [alias,target]of Object.entries(state.collectionAliases))if(candidates.some(x=>x.id===target))state.collectionAliases[alias]=c.id;
    active.push(c);for(const id of ids)byInput.set(id,c);
  }
  await writeJson(statePath,state);
  for(const unit of units) {
    const c=byInput.get(unit.source?.sourceIds?.[0]);if(!c)continue;
    if(!unit.id&&!(unit.publicFiles?.length))continue; // Material antigo em revisão, ainda sem geração.
    if(!/^[a-zA-Z0-9_-]+$/.test(unit.id))throw Error('Identidade de geração inválida na migração.');
    if(!/^Coleções\/[^\/\\]+$/.test(c.folder))throw Error('Pasta de coleção inválida.');
    const oldEntries=unit.publicFiles??[],entries=[];
    const directory=join(base,c.folder),origins=join(directory,'Origens');await mkdir(origins,{recursive:true});
    const batch=state.batches.find(b=>b.id===unit.batchId);
    const stem=label((unit.source.kind==='grupo'?'Grupo':'Recorte')+' '+(unit.code??'')+' — '+unit.source.keytopic)+' — gen-'+label(unit.id,80);
    for(const entry of oldEntries) {
      if(!/^[a-z][a-z0-9-]*$/.test(entry.contentType))throw Error('Tipo de conteúdo inválido na migração.');
      const oldFile=inside(base,entry.contentFile),oldMetadata=inside(base,entry.metadataFile);
      const typeFolder=join(directory,entry.contentType);await mkdir(typeFolder,{recursive:true});
      const newContent=c.folder+'/'+entry.contentType+'/'+stem+'.md',newMetadata=c.folder+'/'+entry.contentType+'/'+stem+'.json';
      const target=inside(base,newContent),metaTarget=inside(base,newMetadata);
      let metadata=await readJson(oldMetadata,null);
      // Uma interrupção após a cópia pode deixar somente a cópia de destino.
      metadata??=await readJson(metaTarget,null);
      if(!metadata||metadata.generationId!==unit.id)throw Error('Não foi possível comprovar a origem do documento '+entry.contentFile);
      if(await exists(target)&&target!==oldFile) {
        const owned=await readJson(metaTarget,null);
        if(!owned||owned.generationId!==unit.id)throw Error('Destino já existe e não pertence à geração: '+newContent);
      }
      const text=await readFile(oldFile,'utf8').catch(async e=>{if(e.code!=='ENOENT')throw e;return readFile(target,'utf8');});
      const originHref=fileLink(typeFolder,join(origins,unit.id+'.md'));
      // Atualiza somente o link técnico inicial; o corpo do conteúdo permanece intacto.
      const rendered=text.replace(/^(Fonte: \[[^\n]*?\]\()[^\n]*?(\))$/m,'$1'+originHref+'$2');
      await writeFile(target+'.tmp',rendered,'utf8');await rename(target+'.tmp',target);
      metadata.generationBatchId=unit.batchId;metadata.originalGenerationBatchId=unit.originalGenerationBatchId??unit.batchId;
      metadata.collectionId=c.id;metadata.originFile=fileLink(typeFolder,join(origins,unit.id+'.json'));
      metadata.posts=metadata.posts.map(p=>({...p,contentFile:stem+'.md#'+p.id}));
      await writeJson(metaTarget,metadata);
      entries.push({...entry,contentFile:newContent,metadataFile:newMetadata});
    }
    const {text,keytopics,bulletpoints,...origin}=unit.source;
    await writeJson(join(origins,unit.id+'.json'),{...origin,collectionId:c.id,generationId:unit.id,generationBatchId:unit.batchId,materialFile:batch?fileLink(origins,join(base,batch.folder,'Fontes',unit.code+'.json')):null});
    await writeFile(join(origins,unit.id+'.md'),['# '+unit.source.keytopic,'','Tipo: '+unit.source.kind,'Geração: '+unit.id,'','Inputs utilizados: '+unit.source.sourceIds.join(', '),'',...(batch?['[Texto utilizado e composição]('+fileLink(origins,join(base,batch.folder,'Fontes',unit.code+'.md'))+')','']:[]),...entries.map(e=>'- ['+e.contentType+']('+fileLink(origins,join(base,e.contentFile))+')')].join('\n'),'utf8');
    unit.collectionId=c.id;
    if(oldEntries.length){unit.contentFolder=c.folder;unit.contentLayoutVersion=3;unit.publicFiles=entries;}
    if(batch&&oldEntries.length)unit.files=entries.map(e=>relative(join(base,batch.folder),join(base,e.contentFile)).split(sep).join('/'));
    // Persistir referências novas antes de remover arquivos antigos torna a retomada segura.
    await writeJson(statePath,state);
    for(const [i,old]of oldEntries.entries()) {
      if(old.contentFile===entries[i].contentFile)continue;
      for(const path of [old.contentFile,old.metadataFile])await unlink(inside(base,path)).catch(e=>{if(e.code!=='ENOENT')throw e;});
    }
  }
  const overview=['# Coleções editoriais','','Abra uma coleção para visualizar seus conteúdos por tipo. Recortes e grupos do Diário alimentam a mesma coleção quando suas origens estão relacionadas.',''];
  for(const c of active) {
    const directory=join(base,c.folder),related=units.filter(u=>u.collectionId===c.id),types=new Map();let count=0;
    for(const u of related)for(const e of u.publicFiles??[]){const m=await readJson(join(base,e.metadataFile),null);if(!m)continue;if(!types.has(e.contentType))types.set(e.contentType,[]);types.get(e.contentType).push({u,e,m});count+=m.posts.length;}
    await mkdir(directory,{recursive:true});
    const names=c.sourceIds.map(id=>inputs.get(id)?.name??id);
    const consolidated=state.batches.some(b=>(b.sources??[]).some(s=>s.kind==='grupo'&&s.sourceIds?.some(id=>c.sourceIds.includes(id))));
    const lines=['# '+c.title,'','Coleção: '+c.id,'','Inputs: '+names.join(' + '),'','Diário: '+(consolidated?'agrupamento disponível':'aguardando agrupamento editorial'),'',count+' post(s) · '+types.size+' tipo(s) · '+related.length+' geração(ões)','','## Conteúdos por tipo',''];
    const catalog={schemaVersion:1,id:c.id,title:c.title,sourceIds:c.sourceIds,aliases:Object.keys(state.collectionAliases).filter(id=>state.collectionAliases[id]===c.id),types:{}};
    for(const[type,items]of [...types].sort(([a],[b])=>a.localeCompare(b))) {
      const typeDirectory=join(directory,type),typeLines=['# '+type+' — '+c.title,'','[Coleção](../índice.md)',''];const refs=[];
      for(const {u,e,m}of items) {
        typeLines.push('## '+u.source.keytopic,'','Origem: '+u.source.kind+' · '+u.source.sourceIds.map(id=>inputs.get(id)?.name??id).join(' + '),'Geração: '+u.id+' · Estado: '+u.status,'','[Abrir documento completo]('+fileLink(typeDirectory,join(base,e.contentFile))+')','');
        for(const p of m.posts)refs.push({publicationId:p.id,contentKey:p.contentKey,sourceIds:u.source.sourceIds,materialKind:u.source.kind,materialId:u.source.id,generationId:u.id,generationBatchId:u.batchId,file:fileLink(typeDirectory,join(base,e.contentFile))+'#'+p.id,destinations:p.destinations});
      }
      await writeFile(join(typeDirectory,'índice.md'),typeLines.join('\n'),'utf8');await writeJson(join(typeDirectory,'referencias.json'),{collectionId:c.id,contentType:type,contents:refs});catalog.types[type]=refs;
      lines.push('- ['+type+' — '+refs.length+' post(s)]('+type+'/índice.md)');
    }
    lines.push('','## Inputs originais','');for(const id of c.sourceIds){const input=inputs.get(id);lines.push('- '+(input.file?'['+input.name+']('+fileLink(directory,join(root,input.file))+')':input.name));}
    lines.push('','## Andamento das gerações','');for(const u of related)lines.push('- '+u.source.kind+' — '+u.source.keytopic+': '+u.status);
    await writeFile(join(directory,'índice.md'),lines.join('\n')+'\n','utf8');await writeJson(join(directory,'colecao.json'),catalog);
    overview.push('- ['+c.title+' — '+count+' post(s)]('+fileLink(base,join(directory,'índice.md'))+')','  Inputs: '+names.join(' + '));
  }
  await mkdir(join(base,'Coleções'),{recursive:true});
  await writeJson(join(base,'Coleções/aliases.json'),state.collectionAliases);
  // Guardar a navegação obsoleta fora da apresentação principal, incluindo arquivos manuais.
  const history=join(root,state.collectionBackup??'Atualizações/Backups/colecoes-historico','Navegação anterior');
  for(const name of ['Famílias','Acervo']) {
    const old=join(base,name);const list=await readdir(old).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(list===null)continue;
    await mkdir(history,{recursive:true});await rename(old,join(history,name+'-'+Date.now()));
  }
  for(const c of Object.values(state.collections))if(state.collectionAliases[c.id]&&c.folder) {
    const old=join(base,c.folder);const list=await readdir(old).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(list===null)continue;
    await mkdir(history,{recursive:true});await rename(old,join(history,c.id+'-'+Date.now()));
  }
  overview.push('','Pedidos e respostas técnicas permanecem em Pedidos. Cada documento preserva a origem e a geração; nenhuma IA é chamada para atualizar esta organização.','');
  await writeFile(join(base,'índice.md'),overview.join('\n'),'utf8');await writeJson(statePath,state);
  return {collections:active.length};
}
