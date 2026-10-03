export interface YouTubeText {
  simpleText?: string;
  runs?: { text?: string }[];
}

export function readText(node: YouTubeText | undefined): string {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  return node.runs?.map((run) => run.text ?? '').join('') ?? '';
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
