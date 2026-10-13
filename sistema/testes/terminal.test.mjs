import test from 'node:test';
import assert from 'node:assert/strict';
import {formatTerminal} from '../terminal.mjs';
import {Executor} from '../executor.mjs';

test('terminal distingue sucesso, aviso e erro e restaura a cor ao final',()=>{
  for(const[level,code]of [['success',32],['warning',33],['error',31]])assert.equal(formatTerminal('Mensagem',level,{isTTY:true,env:{}}),`\u001b[${code}mMensagem\u001b[0m`);
  assert.equal(formatTerminal('Aguardando arquivos','info',{isTTY:true,env:{}}),'Aguardando arquivos');
});
test('logs redirecionados ficam sem ANSI; respeita NO_COLOR e preferência do terminal',()=>{
  for(const options of [{isTTY:false,env:{}},{isTTY:true,env:{NO_COLOR:''}},{isTTY:true,env:{FORCE_COLOR:'0'}},{isTTY:true,env:{TERM:'dumb'}}])assert.equal(formatTerminal('Erro','error',options),'Erro');
  assert.match(formatTerminal('Erro','error',{isTTY:false,env:{FORCE_COLOR:'1'}}),/^\u001b\[31m/);
  assert.equal(formatTerminal('Erro','error',{isTTY:true,env:{NO_COLOR:'',FORCE_COLOR:'1'}}),'Erro');
});
test('preparação completa não oculta Diário parcial e sua pendência',()=>{
  const logs=[];
  const ex=new Executor('/tmp/nao-usado',{modularPipelineVersion:1},{log:(message,level)=>logs.push({message,level})});
  ex.state={jobs:[{status:'completed',atlasStatus:'completed',diaryStatus:'completed'}]};
  ex.atlas={atlas:{noteIds:['nota']}};
  ex.diary={state:{records:[{inputName:'texto.txt',status:'partial',errors:{brag:'Trecho não literal.'}}]}};
  ex.showStatus();
  assert.ok(logs.some(l=>l.message.startsWith('Preparação — Concluídos: 1')&&l.level==='success'));
  assert.ok(logs.some(l=>l.message.startsWith('Atlas:')&&l.level==='success'));
  assert.ok(logs.some(l=>l.message.startsWith('Diário:')&&l.message.includes('1 elaboração')&&l.level==='warning'));
  assert.ok(logs.some(l=>l.message.includes('texto.txt (brag): Trecho não literal.')&&l.level==='error'));
  logs.length=0;ex.diary.state.records[0]={status:'completed',errors:{}};ex.showStatus();
  assert.ok(logs.some(l=>l.message.startsWith('Diário:')&&l.level==='success'));
  assert.ok(logs.every(l=>l.level!=='error'));
});
