import { formatTimestamp } from '@/lib/transcript/format';
import { parseGetTranscriptResponse } from '@/lib/transcript/get-transcript';
import { parseJson3 } from '@/lib/transcript/json3';
import type { TranscriptFixture } from '@/lib/transcript/sanitize';
import { runChecks, type CheckResult } from './checks';
import { activityFields } from './describe';
import { generateActivities } from './generate';
import { targetActivityCount } from './prompt';
import type { QuizProvider } from './providers';
import { ACTIVITY_LABELS, type ActivitySet } from './schema';

export interface Evaluation {
  videoId: string;
  title: string;
  durationSec: number;
  seconds: number;
  set: ActivitySet;
  checks: CheckResult[];
}

export async function evaluateFixture(
  fixture: TranscriptFixture,
  provider: QuizProvider,
): Promise<Evaluation> {
  const body = JSON.stringify(fixture.body);
  const segments =
    fixture.kind === 'timedtext' ? parseJson3(body) : parseGetTranscriptResponse(body);
  const last = segments.at(-1);
  const durationSec =
    fixture.video?.durationSec ?? (last ? Math.ceil((last.startMs + last.durationMs) / 1000) : 0);
  const title = fixture.video?.title ?? fixture.videoId;

  const started = performance.now();
  const set = await generateActivities(
    {
      title,
      channelName: fixture.video?.channelName ?? 'Unknown',
      durationSec,
      segments,
      existingTopics: [],
    },
    provider,
  );

  return {
    videoId: fixture.videoId,
    title,
    durationSec,
    seconds: (performance.now() - started) / 1000,
    set,
    checks: runChecks(set, durationSec, targetActivityCount(durationSec)),
  };
}

export function renderReport(evaluation: Evaluation, providerLabel: string, model: string): string {
  const { videoId, set, checks } = evaluation;
  const link = (sec: number) => `https://youtu.be/${videoId}?t=${sec}`;
  const lines = [
    `# ${evaluation.title}`,
    '',
    `- Video: ${link(0)}`,
    `- Provider: ${providerLabel}, model ${model}`,
    `- Duration: ${formatTimestamp(evaluation.durationSec * 1000)}, generated in ${evaluation.seconds.toFixed(1)} s`,
    `- Topic: ${set.topic}`,
    '',
    '## Automated checks',
    '',
    ...checks.map((c) => `- [${c.passed ? 'x' : ' '}] ${c.name}${c.detail ? `: ${c.detail}` : ''}`),
    '',
    '## Activities',
    '',
    'For each activity, check: accurate to the video, worth remembering, understandable without the video, and a fitting activity type.',
    '',
  ];
  set.activities.forEach((activity, i) => {
    lines.push(`### ${i + 1}. ${ACTIVITY_LABELS[activity.type]}: ${activity.prompt}`, '');
    for (const field of activityFields(activity))
      lines.push(`**${field.label}:** ${field.value}`, '');
    lines.push(
      `**Source:** [${formatTimestamp(activity.sourceStartSec * 1000)}](${link(activity.sourceStartSec)})`,
      '',
    );
  });
  return lines.join('\n');
}
