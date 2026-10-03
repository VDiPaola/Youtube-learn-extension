import { storage } from 'wxt/utils/storage';
import { ACTIVITY_TYPES, type ActivityType } from '@/lib/learn/schema';
import type { VideoInfo } from '@/lib/youtube/player-response';

export interface ChannelRef {
  id: string;
  name: string;
}

export type ChannelRule = 'auto' | 'always' | 'never';

export interface PromptSettings {
  autoPrompt: boolean;
  /** Missing in settings saved before activity types existed. */
  disabledActivityTypes?: ActivityType[];
  allowedChannels: ChannelRef[];
  blockedChannels: ChannelRef[];
}

export const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
  autoPrompt: true,
  disabledActivityTypes: [],
  allowedChannels: [],
  blockedChannels: [],
};

export const promptSettingsItem = storage.defineItem<PromptSettings>('local:promptSettings', {
  fallback: DEFAULT_PROMPT_SETTINGS,
});

export const MIN_DURATION_SEC = 180;
const PREPARE_FRACTION = 0.5;

export function channelRule(settings: PromptSettings, channelId: string): ChannelRule {
  if (settings.blockedChannels.some((c) => c.id === channelId)) return 'never';
  if (settings.allowedChannels.some((c) => c.id === channelId)) return 'always';
  return 'auto';
}

export function withChannelRule(
  settings: PromptSettings,
  channel: ChannelRef,
  rule: ChannelRule,
): PromptSettings {
  const others = (list: ChannelRef[]) => list.filter((c) => c.id !== channel.id);
  return {
    ...settings,
    allowedChannels:
      rule === 'always'
        ? [...others(settings.allowedChannels), channel]
        : others(settings.allowedChannels),
    blockedChannels:
      rule === 'never'
        ? [...others(settings.blockedChannels), channel]
        : others(settings.blockedChannels),
  };
}

export type Eligibility = { eligible: true; reason: string } | { eligible: false; reason: string };

/** Decides whether the Learn button shows and activities are prepared in the background. */
export function checkEligibility(
  video: Pick<VideoInfo, 'channelId' | 'category' | 'durationSec' | 'isLive' | 'captionTracks'>,
  settings: PromptSettings,
): Eligibility {
  const rule = channelRule(settings, video.channelId);
  const decline = (reason: string): Eligibility => ({ eligible: false, reason });
  if (!settings.autoPrompt) return decline('The Learn button is turned off for Education videos.');
  if (rule === 'never') return decline('The Learn button is turned off for this channel.');
  if (video.isLive) return decline('Live streams are not supported.');
  if (video.durationSec < MIN_DURATION_SEC) return decline('The video is shorter than 3 minutes.');
  if (video.captionTracks.length === 0) return decline('The video has no captions.');
  if (rule === 'always') {
    return { eligible: true, reason: 'The Learn button is always on for this channel.' };
  }
  if (video.category === 'Education') {
    return { eligible: true, reason: 'This is an Education video.' };
  }
  return decline('The video is not in the Education category.');
}

/** Background generation starts here so activities are ready by the end of the video. */
export function prepareAtSec(durationSec: number): number {
  return durationSec * PREPARE_FRACTION;
}

/** Enabled activity types. If every type is disabled, all of them are used instead. */
export function enabledActivityTypes(settings: PromptSettings): ActivityType[] {
  const disabled = new Set(settings.disabledActivityTypes ?? []);
  const enabled = ACTIVITY_TYPES.filter((type) => !disabled.has(type));
  return enabled.length > 0 ? enabled : [...ACTIVITY_TYPES];
}
