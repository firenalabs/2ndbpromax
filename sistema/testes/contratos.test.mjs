import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentText, validateDigest } from '../contratos.mjs';

function fixture(text = '  O Dr. Paulo chegou. Ele trouxe café ☕.\n\nA segunda ideia começa aqui!  ') {
  const segmentation = segmentText(text);
  const source = { id: 'origem', digestId: 'digest', text };
  return { source, digest: {
    id: source.digestId, sourceId: source.id, schemaVersion: 1,
    createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    originalText: text, segmentation,
    segmentedText: segmentation.segments.map(s => `[${s.id}] ${text.slice(s.start, s.end).trim()}`).join('\n'),
    keytopics: [{ id: 'SEG_00001', title: 'Primeira ideia', bulletpoints: ['Um ponto.'] }],
  } };
}

test('mapa preserva acentos, espaços, abreviações e emojis e permite cortes exatos', () => {
  const { source, digest } = fixture();
  assert.deepEqual(segmentText(source.text), digest.segmentation);
  validateDigest(digest, source);
  const boundaries = [0, ...digest.segmentation.segments.slice(1).map(s => s.start), source.text.length];
  const cuts = boundaries.slice(0, -1).map((start, i) => source.text.slice(start, boundaries[i + 1]));
  assert.equal(cuts.join(''), source.text);
  assert.ok(digest.segmentation.segments.some(s => source.text.slice(s.start, s.end).includes('☕')));
});

test('aceita um único tópico para texto curto', () => {
  const { source, digest } = fixture('Uma ideia sem pontuação');
  assert.equal(digest.segmentation.segments.length, 1);
  assert.equal(validateDigest(digest, source), digest);
});

test('rejeita SEG inventado, repetido, fora de ordem ou primeiro tópico incompleto', () => {
  const { source, digest } = fixture('Primeira frase. Segunda frase. Terceira frase.');
  const base = digest.keytopics[0];
  for (const ids of [['SEG_99999'], ['SEG_00002'], ['SEG_00001', 'SEG_00001'], ['SEG_00001', 'SEG_00003', 'SEG_00002']]) {
    assert.throws(() => validateDigest({ ...digest, keytopics: ids.map(id => ({ ...base, id })) }, source));
  }
});

test('rejeita alteração do original e inconsistência do mapa ou texto segmentado', () => {
  const { source, digest } = fixture();
  assert.throws(() => validateDigest({ ...digest, originalText: source.text.trim() }, source));
  assert.throws(() => validateDigest({ ...digest, segmentedText: 'outro texto' }, source));
  const changed = structuredClone(digest);
  changed.segmentation.segments[0].end = source.text.length + 1;
  assert.throws(() => validateDigest(changed, source));
});


test('transcrição longa sem pontuação oferece âncoras de até 50 palavras sem perder texto',()=>{
 const text='  '+Array.from({length:7500},(_,i)=>i%17===0?'ação😀':'palavra'+i).join(' \t ')+ '  ';
 const {source,digest}=fixture(text),segments=digest.segmentation.segments;
 assert.equal(segments.length,150);assert.deepEqual(segmentText(text),digest.segmentation);
 assert.equal(segments.map(s=>text.slice(s.start,s.end)).join(''),text);
 assert.ok(segments.every(s=>text.slice(s.start,s.end).match(/\S+/g).length<=50));
 validateDigest(digest,source);
 const prior=fixture('Texto antigo. Outro assunto.');prior.digest.segmentation.version='sentence-pt-BR-v1';
 validateDigest(prior.digest,prior.source);
});

test('frases curtas conservam limites naturais e frase longa ganha fallback',()=>{
 const text='Primeira frase. '+Array(101).fill('Palavra').join(' ') + '. Fim.';
 const {source,digest}=fixture(text);assert.equal(digest.segmentation.segments.length,5);
 assert.equal(text.slice(0,digest.segmentation.segments[0].end),'Primeira frase. ');
 assert.equal(digest.segmentation.segments.map(s=>text.slice(s.start,s.end)).join(''),text);
 validateDigest(digest,source);
});


test('versões são metadados; mapa e conteúdo continuam sendo validados',()=>{
 const {source,digest}=fixture();
 for(const schemaVersion of [undefined,1,2,'3']) for(const version of [undefined,'sentence-pt-BR-v1','sentence-pt-BR-v2','custom-v99']) {
  const value={...digest,schemaVersion,segmentation:{...digest.segmentation,version}};
  assert.equal(validateDigest(value,source),value);
 }
 assert.throws(()=>validateDigest({...digest,segmentation:{...digest.segmentation,offsetUnit:'utf8'}},source),/UTF-16/);
 assert.throws(()=>validateDigest({...digest,schemaVersion:999,segmentation:{...digest.segmentation,version:'custom',segments:[]}},source),/mapa de segmentos está vazio/);
});
