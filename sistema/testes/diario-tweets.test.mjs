import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitDiaryAngles, structureDiaryTweets } from '../diario-tweets.mjs';
import { saveAutomaticContents } from '../conteudos-automaticos.mjs';

const context = { text: 'Texto original', referenceId: 'grupo', contentSourceIds: ['origem'], sourceWordCount: 2 };

test('separa os ângulos atuais sem alterar o texto original e conserva a ordem', () => {
  const items = splitDiaryAngles({ output: 'Primeiro ângulo\n\n---\n\nSegundo ângulo' }, context);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => i.tweetIndex), [1, 2]);
  assert.equal(items[0].text, context.text);
  assert.equal(items[1].texto, 'Texto original\n\nÂngulo deste item: Segundo ângulo');
  assert.equal(splitDiaryAngles({ error: 'API indisponível' }, context)[0].error.message, 'API indisponível');
  assert.ok(splitDiaryAngles({ output: '' }, context)[0].error);
});

test('aceita tweet único, arrays e JSON, preservando quebras de linha e separando erros', () => {
  assert.equal(structureDiaryTweets({ output: 'primeira linha\n\nsegunda linha' }, context).generatedContents[0].body, 'primeira linha\n\nsegunda linha');
  const result = structureDiaryTweets({ output: '```json\n{"tweets":["tweet 1",{"text":"tweet 2"},""]}\n```' }, context);
  assert.deepEqual(result.generatedContents.map(c => c.contentKey), ['tweet-1', 'tweet-2']);
  assert.equal(result.generatedContentErrors.length, 1);
  assert.equal(structureDiaryTweets({ error: { message: 'falha' } }, context).generatedContentErrors[0].message, 'falha');
  assert.equal(structureDiaryTweets({}, context).generatedContents.length, 0);
});

test('quatro tweets do mesmo grupo geram quatro arquivos Markdown distintos e retries não duplicam', async t => {
  const root = await mkdtemp(join(tmpdir(), 'diario-tweets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const items = splitDiaryAngles({ output: 'ângulo 1\n---\nângulo 2\n---\nângulo 3\n---\nângulo 4' }, context);
  const generatedContents = items.flatMap((item, i) => structureDiaryTweets({ output: `tweet ${i + 1}\n\ntexto próprio` }, item).generatedContents);
  const result = { generatedContents, generatedContentErrors: [] };
  const sources = [{ id: 'grupo', text: context.text, sourceIds: ['origem'], createdAt: '2026-10-07T00:00:00Z' }];
  const logs = [];
  for (let i = 0; i < 2; i++) await saveAutomaticContents(root, result, 'diario', sources, message => logs.push(message));
  assert.ok(logs.every(message => !message.startsWith('Não foi possível')));
  const files = await readdir(join(root, 'Conteúdos Gerados'));
  assert.equal(files.filter(file => file.endsWith('.md')).length, 4);
  assert.equal(files.filter(file => file.endsWith('.json')).length, 4);
  const bodies = await Promise.all(files.filter(file => file.endsWith('.md')).map(file => readFile(join(root, 'Conteúdos Gerados', file), 'utf8')));
  assert.deepEqual(bodies.sort(), generatedContents.map(c => c.body + '\n').sort());
  const records = await Promise.all(files.filter(file => file.endsWith('.json')).map(async file => JSON.parse(await readFile(join(root, 'Conteúdos Gerados', file), 'utf8'))));
  assert.equal(new Set(records.map(r => r.id)).size, 4);
  assert.deepEqual(records.map(r => r.tweetIndex).sort(), [1, 2, 3, 4]);
});
