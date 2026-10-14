import {mkdir,writeFile} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {readJson,writeJson} from './arquivos.mjs';
import {listMaterials} from './materiais.mjs';

export function fileLink(fromDirectory,target) {
  return relative(fromDirectory,target).split(sep).map(encodeURIComponent).join('/');
}
function label(value) {
  const text=String(value??'Input').normalize('NFC').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g,'-').replace(/\.txt$/i,'').trim();
  let result='';for(const c of text){if(Buffer.byteLength(result+c,'utf8')>90)break;result+=c;}
  return result||'Input';
}
export function familyFolder(sourceId,name) {
  const id=/^[a-zA-Z0-9_-]{1,80}$/.test(sourceId)?sourceId:createHash('sha256').update(sourceId).digest('hex').slice(0,24);
  return label(name)+' — '+id;
}

export async function rebuildFamilyIndices(root,state) {
  const base=join(root,'Conteúdos Gerados'),families=new Map();
  await Promise.all(['Famílias','Acervo'].map(name=>mkdir(join(base,name),{recursive:true})));
  const register=(id,name,file)=>{
    if(!families.has(id))families.set(id,{sourceId:id,name:name??id,originalFile:file??null,entries:[],units:[]});
    else {const f=families.get(id);if(name)f.name=name;if(file)f.originalFile=file;}
  };
  for(const m of await listMaterials(root))register(m.sourceId,m.inputName??m.sourceFile?.split(/[\\/]/).at(-1),m.sourceFile);
  for(const unit of Object.values(state.units)) {
    if(!unit.source?.sourceIds)continue;
    const sourceIds=[...new Set(unit.source.sourceIds)];
    for(const[id,index]of sourceIds.map((id,index)=>[id,index]))register(id,families.has(id)?undefined:unit.source.inputName??unit.source.inputFiles?.[index]?.split(/[\\/]/).at(-1),unit.source.inputFiles?.[index]);
    for(const id of sourceIds)families.get(id).units.push(unit);
    for(const entry of unit.publicFiles??[]) {
      const metadata=await readJson(join(base,entry.metadataFile),null);if(!metadata)continue;
      for(const id of sourceIds)families.get(id).entries.push({unit,entry,metadata});
    }
  }
  const overview=['# Conteúdos por família de input','','Cada família reúne os conteúdos dos recortes e dos grupos editoriais que usaram esse input. Conteúdos de grupos com várias origens são acessíveis por todas elas, com um único arquivo no Acervo.','','## Famílias',''];
  for(const family of [...families.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.sourceId.localeCompare(b.sourceId))) {
    const folder=familyFolder(family.sourceId,family.name),directory=join(base,'Famílias',folder);await mkdir(directory,{recursive:true});
    const byType=new Map();for(const item of family.entries){if(!byType.has(item.entry.contentType))byType.set(item.entry.contentType,[]);byType.get(item.entry.contentType).push(item);}
    const lines=['# '+family.name,'','Input: '+family.sourceId,''];
    if(family.originalFile)lines.push('[Texto original]('+fileLink(directory,join(root,family.originalFile))+')','');
    lines.push('## Conteúdos por tipo','');
    const catalog={schemaVersion:1,sourceId:family.sourceId,inputName:family.name,originalFile:family.originalFile,types:{}};
    let count=0;
    for(const[type,entries]of [...byType].sort(([a],[b])=>a.localeCompare(b))) {
      const typeDirectory=join(directory,type);await mkdir(typeDirectory,{recursive:true});
      const typeLines=['# '+type+' — '+family.name,'','[Todos os tipos](../índice.md)',''];
      const references=[];
      for(const{unit,entry,metadata}of entries) {
        const source=unit.source,shared=source.sourceIds.length>1;
        const composition=source.sourceIds.map(id=>families.get(id)?.name??id).join(' + ');
        typeLines.push('## '+unit.code+' — '+source.keytopic,'',source.kind==='grupo'?'Grupo editorial do Diário':'Recorte determinístico','',shared?'Gerado a partir de: **'+composition+'**. Conteúdo compartilhado pelas famílias indicadas.':'Gerado a partir de: '+composition,'','Estado da geração: '+unit.status,'');
        for(const post of metadata.posts) {
          const target=join(base,entry.contentFile),href=fileLink(typeDirectory,target)+'#'+post.id;
          typeLines.push('- ['+post.code+' — abrir conteúdo]('+href+')');
          references.push({publicationId:post.id,contentKey:post.contentKey,sourceIds:source.sourceIds,materialKind:source.kind,materialId:source.id,generationId:unit.id,generationBatchId:unit.batchId,shared,file:href,destinations:post.destinations});count++;
        }
        typeLines.push('');
      }
      await writeFile(join(typeDirectory,'índice.md'),typeLines.join('\n'),'utf8');
      await writeJson(join(typeDirectory,'referencias.json'),{sourceId:family.sourceId,contentType:type,contents:references});
      catalog.types[type]=references;
      lines.push('- ['+type+' — '+references.length+' post(s)]('+type+'/índice.md)');
    }
    if(!byType.size)lines.push('Ainda não há conteúdos gerados para este input.');
    lines.push('','## Materiais utilizados e andamento','');
    for(const unit of family.units)lines.push('- '+(unit.source.kind==='grupo'?'Grupo do Diário':'Recorte')+' — '+unit.source.keytopic+': '+unit.status);
    await writeFile(join(directory,'índice.md'),lines.join('\n')+'\n','utf8');await writeJson(join(directory,'familia.json'),catalog);
    overview.push('- ['+family.name+' — '+count+' post(s)]('+fileLink(base,join(directory,'índice.md'))+')');
  }
  if(!families.size)overview.push('Ainda não há inputs com materiais preparados ou conteúdos salvos.');
  overview.push('','## Rastreabilidade','','Os arquivos em Acervo são os conteúdos únicos. Pedidos conserva seleções, agrupamentos e respostas de execução. A navegação principal está em Famílias.','');
  await writeFile(join(base,'índice.md'),overview.join('\n'),'utf8');
  return {families:families.size};
}
