import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAtlasTitle,atlasTitleCode,fixAtlasTitle,atlasTitleSchema,atlasTitleInstruction} from '../workflows/titulo-atlas.mjs';
import {buildModular} from '../workflows/build-modular.mjs';
import {validateZettelTree,zettelFilename} from '../zettelkasten.mjs';
const title='Um simulador de vendas com IA que treina vendedores a persuadir leads com gatilhos, urgência e benefícios concretos para aumentar agendamentos presenciais';

test('título de produção com 154 caracteres cabe no Atlas e conserva o original',()=>{
  assert.equal(title.length,154);
  const result=prepareAtlasTitle(title);
  assert.equal(result.title,title);
  const category={id:'c',parentId:null,address:'A',name:'Vendas',description:'Vendas',noteIds:['n']};
  assert.doesNotThrow(()=>validateZettelTree([category],[{id:'n',categoryId:'c',parentNoteId:null,address:'A.1',title:result.title}]));
  assert.equal(atlasTitleSchema.properties.title.maxLength,undefined);
});
test('normalização respeita títulos curtos e Unicode e rejeita valores vazios',()=>{
  assert.deepEqual(prepareAtlasTitle('  Meu\n título  '),{title:'Meu título'});
  assert.deepEqual(prepareAtlasTitle('a'.repeat(150)),{title:'a'.repeat(150)});
  assert.deepEqual(prepareAtlasTitle('a'.repeat(170)),{title:'a'.repeat(170)});
  assert.deepEqual(prepareAtlasTitle('a'.repeat(186)),{title:'a'.repeat(186)});
  assert.deepEqual(prepareAtlasTitle('😀'.repeat(85)),{title:'😀'.repeat(85)});
  assert.deepEqual(prepareAtlasTitle('😀'.repeat(1000)),{title:'😀'.repeat(1000)});
  for(const value of [undefined,null,1,'',' \n '])assert.throws(()=>prepareAtlasTitle(value),/ausente ou vazio/);
});
test('árvore armazenada aceita títulos longos nas execuções seguintes',()=>{
  const categories=[{id:'c',parentId:null,address:'A',name:'Vendas',description:'Vendas',noteIds:['n']}];
  const note={id:'n',categoryId:'c',parentNoteId:null,address:'A.1',title:'a'.repeat(170)};
  assert.doesNotThrow(()=>validateZettelTree(categories,[note]));
  for(const length of [179,186,1000])assert.doesNotThrow(()=>validateZettelTree(categories,[{...note,title:'a'.repeat(length)}]));
});
test('Code conserva contexto e aceita JSON serializado; respostas inválidas continuam pendentes',()=>{
  const context={block:{id:'b',text:'Original'},tree:[],knowledgeThreshold:.8};
  const run=output=>new Function('$input','$',atlasTitleCode)({first:()=>({json:{output}})},name=>{
    assert.equal(name,'Validar decisão de conhecimento');return {item:{json:context}};
  })[0].json;
  for(const output of [{title},JSON.stringify({title})]){
    const result=run(output);assert.equal(result.ok,true);assert.equal(result.block.text,'Original');
    assert.equal(result.block.title,title);assert.equal(result.knowledgeThreshold,.8);
  }
  const tooLong=run({title:'a'.repeat(171)});
  assert.equal(tooLong.ok,true);assert.equal(tooLong.block.title,'a'.repeat(171));
  for(const output of [undefined,{},'{invalid'])assert.equal(run(output).ok,false);
  assert.deepEqual(context.block,{id:'b',text:'Original'});
});
test('correção acrescenta somente orientação de comprimento e alinha validação',async()=>{
  const before=(await buildModular()).atlas;
  assert.deepEqual(fixAtlasTitle(before),before);
  const raw=structuredClone(before);
  raw.nodes.find(n=>n.name==='Schema — Título da nota').parameters.inputSchema='antigo';
  raw.nodes.find(n=>n.name==='Montar nota preparada').parameters.jsCode='antigo';
  const fixed=fixAtlasTitle(raw);
  for(const node of fixed.nodes)if(!['Schema — Título da nota','Montar nota preparada'].includes(node.name))
    assert.deepEqual(node,raw.nodes.find(n=>n.name===node.name));
  assert.deepEqual(fixed.connections,raw.connections);
  const old=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../workflows/modular-originais.json',import.meta.url)));
  const expected=structuredClone(old.atlas.nodes.find(n=>n.name==='Agent: Preparador de Notas'));
  const actual=fixed.nodes.find(n=>n.name===expected.name);
  expected.parameters.options.systemMessage+='\n\n'+atlasTitleInstruction;
  assert.deepEqual(actual.parameters,expected.parameters);
  assert.ok(!fixed.nodes.find(n=>n.name==='Validar pedido do Atlas').parameters.jsCode.includes('n.title.length > 170'));
  assert.ok(!fixed.nodes.find(n=>n.name==='Validar pedido do Atlas').parameters.jsCode.includes('n.title.length > 150'));
});

// Nomes de arquivos têm orçamento próprio; não modificam o título do Atlas.
test('título longo com Unicode é preservado enquanto o nome do arquivo respeita 240 bytes',()=>{
  const original='Conhecimento e experiências de vendas com inteligência artificial 😀 '.repeat(20);
  const note={address:'A.1',wordCount:100,title:prepareAtlasTitle(original).title};
  const before=structuredClone(note),filename=zettelFilename(note);
  assert.ok(Buffer.byteLength(filename,'utf8')<=240);
  assert.ok(filename.endsWith('.md'));assert.deepEqual(note,before);
  assert.equal(note.title,original.trim());
});
