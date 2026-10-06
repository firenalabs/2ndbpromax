export const keytopicsMarkdownInstructions = `Formato obrigatório da resposta: Markdown, sem JSON, sem blocos de código e sem preâmbulo.
Para cada tópico, use exatamente um heading de nível 2 com ID e título na mesma linha, seguido dos bulletpoints:
## [SEG_00008] Título que expressa a ideia central
- Primeiro ponto.
- Segundo ponto.

Repita esse bloco para os demais tópicos. Use somente IDs existentes, copiados literalmente, únicos e crescentes. Escreva cada bulletpoint em uma linha iniciada por "- ". Não use subtítulos dentro de um tópico. Aspas no conteúdo são permitidas normalmente. Não use numeração de tópicos. Os SEGs acima são exemplos de formato, não IDs obrigatórios.`;

export function parseKeytopicsMarkdown(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('O Agent não retornou Markdown com KeyTopics.');
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  if (/^```(?:markdown|md)?\s*$/i.test(lines[0]) && lines.at(-1).trim() === '```') {
    lines.shift(); lines.pop();
  }
  const keytopics = [];
  let current = null;
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!current && !keytopics.length && /^#\s+KEYTOPICS\s*$/i.test(trimmed)) continue;
    const heading = /^##\s+\[(SEG_\d{5,})\]\s+(.+)$/.exec(trimmed);
    const legacy = heading ? null : /^##\s+(?:\d+\.\s+)?(.+?)\s+\[(SEG_\d{5,})\]$/.exec(trimmed);
    if (heading || legacy) {
      if (current && !current.bulletpoints.length) throw new Error(`KeyTopic ${current.id} não tem bulletpoints.`);
      current = { id: heading ? heading[1] : legacy[2], title: (heading ? heading[2] : legacy[1]).trim(), bulletpoints: [] };
      keytopics.push(current);
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (current && bullet) { current.bulletpoints.push(bullet[1]); continue; }
    if (current?.bulletpoints.length && /^[ \t]{2,}\S/.test(line) && !trimmed.startsWith('#')) {
      current.bulletpoints[current.bulletpoints.length - 1] += '\n' + trimmed;
      continue;
    }
    throw new Error(`Markdown de KeyTopics inválido na linha ${index + 1}: use "## [SEG_00008] Título" e bulletpoints iniciados por "- ".`);
  }
  if (!keytopics.length) throw new Error('Nenhum KeyTopic encontrado no Markdown.');
  if (!current.bulletpoints.length) throw new Error(`KeyTopic ${current.id} não tem bulletpoints.`);
  return { keytopics };
}

export const keytopicsMarkdownCode = `${parseKeytopicsMarkdown.toString()}
try {
  const response = $input.first().json;
  if (response.error) throw new Error(typeof response.error === 'string' ? response.error : response.error.message);
  return [{ json: { output: parseKeytopicsMarkdown(response.output) } }];
} catch (error) {
  return [{ json: { error: { message: error.message, code: 'INVALID_KEYTOPICS_MARKDOWN' } } }];
}`;
