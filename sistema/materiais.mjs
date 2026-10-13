import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJson, digestMarkdown } from './arquivos.mjs';
import { buildBlocks, validateBlock } from './contratos-atlas.mjs';

export async function saveMaterials(root, digest, name) {
  const keyFolder = join(root, 'KeyTopics Processados');
  const cutsFolder = join(root, 'Recortes por Assunto', digest.sourceId);
  await mkdir(keyFolder, { recursive: true });
  await mkdir(cutsFolder, { recursive: true });
  const blocks = buildBlocks(digest);
  if (digest.blocks) {
    if (digest.blocks.length !== blocks.length) throw new Error('Quantidade de recortes diverge dos KeyTopics.');
    digest.blocks.forEach((block, i) => validateBlock(block, blocks[i]));
  }
  const record = { ...digest, blocks };
  await writeJson(join(keyFolder, name + '.json'), record);
  await writeFile(join(keyFolder, name + '.md'), digestMarkdown(record, name), 'utf8');
  for (const block of blocks) {
    const path = join(cutsFolder, block.id + '.json');
    const previous = await readJson(path, null);
    if (previous) validateBlock(previous, block);
    else await writeJson(path, block);
    await writeFile(join(cutsFolder, block.id + '.md'), '# ' + block.keytopic + '\n\nOrigem: ' + block.sourceId + '\nKeyTopic: ' + block.segmentId + '\n\n' + block.text, 'utf8');
  }
  return record;
}

export async function listMaterials(root) {
  const directory = join(root, 'KeyTopics Processados');
  const files = await readdir(directory).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const records = [];
  for (const name of files.filter(n => n.endsWith('.json')).sort()) records.push(await readJson(join(directory, name), null));
  return records;
}

export async function migrateMaterials(root, jobs) {
  for (const job of jobs.filter(j => j.status === 'completed')) {
    const digest = await readJson(join(root, job.digestFile), null);
    if (!digest) continue;
    const record = await saveMaterials(root, { ...digest, sourceFile: job.originalFile, inputName: job.inputName, sequence: job.sequence }, job.baseName);
    job.digestFile = join('KeyTopics Processados', job.baseName + '.json');
    job.preparationVersion = 1;
  }
}
