import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseKeytopicsMarkdown, keytopicsMarkdownCode } from '../keytopics-markdown.mjs';
import { buildBlocks } from '../contratos-atlas.mjs';

test('Markdown preserva aspas, barras, acentos e conteúdo sem serialização dupla', () => {
  const point = 'O objetivo é alavancagem ("economizar duas horas por semana"), com C:\\pasta e ação 🧠.';
  const value = parseKeytopicsMarkdown('## [SEG_00008] Ideia "central"\n- ' + point);
  assert.deepEqual(value, { keytopics: [{ id: 'SEG_00008', title: 'Ideia "central"', bulletpoints: [point] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
});

test('aceita formato anterior numerado com SEG no fim do título', () => {
  const value = parseKeytopicsMarkdown('# KEYTOPICS\r\n\r\n## 1. Ideia inicial [SEG_00008]\r\n\r\n- Um ponto.\r\n\r\n## 2. Outra ideia [SEG_00020]\r\n- Outro ponto.');
  assert.deepEqual(value.keytopics.map(t => [t.id, t.title]), [['SEG_00008', 'Ideia inicial'], ['SEG_00020', 'Outra ideia']]);
});

test('preserva ordem e continuação indentada de bulletpoint e aceita fence completo', () => {
  const value = parseKeytopicsMarkdown('```markdown\n## [SEG_00002] Tema\n- Primeira linha.\n  Continuação.\n- Segundo ponto.\n```');
  assert.deepEqual(value.keytopics[0].bulletpoints, ['Primeira linha.\nContinuação.', 'Segundo ponto.']);
});

test('rejeita estrutura incompleta ou texto estranho em vez de descartar conteúdo', () => {
  for (const text of ['', '{}', '- Ponto sem tópico.', '## [SEG_00001] Sem pontos', '## [SEG_00001] Tema\n- Ponto.\nTexto que seria perdido.', '## Título sem SEG\n- Ponto.', '```markdown\n## [SEG_00001] Tema\n- Ponto.']) {
    assert.throws(() => parseKeytopicsMarkdown(text));
  }
});

test('Code e validador gerados incluem introdução e rejeitam SEG inventado sem corrigir IDs', async () => {
  const specs = JSON.parse(await readFile(new URL('../workflows/01-digestao.nodes.json', import.meta.url), 'utf8'));
  const body = { sourceId: '00000000-0000-4000-8000-000000000001', digestId: '00000000-0000-4000-8000-000000000001-digest-v1', createdAt: '2026-10-06T00:00:00Z', text: 'Introdução. Uma ideia. Outra ideia.' };
  const source = new Function('$input', specs[1].parameters.jsCode)({ first: () => ({ json: { body } }) })[0].json;
  const parse = text => new Function('$input', keytopicsMarkdownCode)({ first: () => ({ json: { output: text } }) })[0].json;
  const validate = value => new Function('$input', '$', specs[5].parameters.jsCode)({ first: () => ({ json: value }) }, () => ({ first: () => ({ json: source }) }))[0].json;
  const digest = validate(parse('## [SEG_00002] Ideia\n- Ponto com "aspas".\n## [SEG_00003] Outra\n- Outro ponto.'));
  assert.equal(digest.ok, true);
  assert.equal(buildBlocks(digest).map(b => b.text).join(''), body.text);
  for (const ids of [['SEG_99999'], ['SEG_00002', 'SEG_00002'], ['SEG_00003', 'SEG_00002']]) {
    assert.equal(validate(parse(ids.map(id => `## [${id}] Ideia\n- Um ponto.`).join('\n'))).ok, false);
  }
  const error = validate(parse('## Título incorreto\n- Ponto.'));
  assert.equal(error.ok, false); assert.match(error.error.message, /Markdown.*linha 1/);
});
