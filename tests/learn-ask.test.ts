import { describe, expect, it } from 'vitest';
import { answerParts, buildAskRequest, COACH_PROMPT, type AskInput } from '@/lib/learn/ask';
import { MAX_CHUNK_CHARS } from '@/lib/learn/generate';

const input = (overrides: Partial<AskInput> = {}): AskInput => ({
  title: 'How vaccines work',
  channelName: 'Science Channel',
  durationSec: 600,
  segments: [
    { startMs: 0, durationMs: 5000, text: 'Vaccines train the immune system.' },
    { startMs: 65_000, durationMs: 5000, text: 'Antibodies bind to antigens.' },
  ],
  turns: [{ role: 'user', text: 'What do antibodies do?', atSec: 70 }],
  ...overrides,
});

describe('buildAskRequest', () => {
  it('puts the coach instructions, video details, and transcript in the system prompt', () => {
    const { system } = buildAskRequest(input());
    expect(system.startsWith(COACH_PROMPT)).toBe(true);
    expect(system).toContain(
      'Video title: How vaccines work\nChannel: Science Channel\nLength: 10:00',
    );
    expect(system).toContain(
      '<transcript>\n[0:00] Vaccines train the immune system.\n[1:05] Antibodies bind to antigens.\n</transcript>',
    );
    expect(system).not.toContain('only the part of the transcript');
  });

  it('prefixes questions with the playback position and keeps answers as they are', () => {
    const { messages } = buildAskRequest(
      input({
        turns: [
          { role: 'user', text: 'What do antibodies do?', atSec: 70 },
          { role: 'assistant', text: 'They bind to antigens [1:05].' },
          { role: 'user', text: 'And then?', atSec: 3725 },
          { role: 'user', text: 'No position' },
        ],
      }),
    );
    expect(messages).toEqual([
      { role: 'user', content: '[At 1:10] What do antibodies do?' },
      { role: 'assistant', content: 'They bind to antigens [1:05].' },
      { role: 'user', content: '[At 1:02:05] And then?' },
      { role: 'user', content: 'No position' },
    ]);
  });

  it('sends the part of a very long transcript around the latest question', () => {
    const line = 'word '.repeat(400);
    const segments = Array.from({ length: 1000 }, (_, i) => ({
      startMs: i * 30_000,
      durationMs: 30_000,
      text: `${i === 900 ? 'LATE ' : ''}${line}`,
    }));
    const late = buildAskRequest(
      input({ segments, turns: [{ role: 'user', text: 'Q', atSec: 900 * 30 }] }),
    );
    expect(late.system).toContain('LATE');
    expect(late.system).toContain('only the part of the transcript');
    expect(late.system.length).toBeLessThan(MAX_CHUNK_CHARS + COACH_PROMPT.length + 1000);

    const early = buildAskRequest(
      input({ segments, turns: [{ role: 'user', text: 'Q', atSec: 0 }] }),
    );
    expect(early.system).toContain('[0:00] word');
    expect(early.system).not.toContain('LATE');
  });
});

describe('answerParts', () => {
  it('turns [m:ss] and [h:mm:ss] markers into timestamps', () => {
    expect(answerParts('See [1:05] and [1:02:03].')).toEqual([
      { text: 'See ' },
      { label: '1:05', seconds: 65 },
      { text: ' and ' },
      { label: '1:02:03', seconds: 3723 },
      { text: '.' },
    ]);
  });

  it('removes bold markers and headings', () => {
    expect(answerParts('## Short answer\nIt is **energy**.')).toEqual([
      { text: 'Short answer\nIt is energy.' },
    ]);
  });

  it('leaves text without markers unchanged', () => {
    expect(answerParts('No markers [here].')).toEqual([{ text: 'No markers [here].' }]);
  });
});
