import { activityFields } from '@/lib/learn/describe';
import { ACTIVITY_LABELS, type Activity } from '@/lib/learn/schema';
import { formatTimestamp } from '@/lib/transcript/format';

/** Read-only list of generated activities with their answers, for debug and evaluation views. */
export function ActivityList({
  activities,
  videoId,
}: {
  activities: readonly Activity[];
  videoId?: string;
}) {
  return (
    <ol className="cards">
      {activities.map((activity, index) => {
        const time = formatTimestamp(activity.sourceStartSec * 1000);
        return (
          <li key={index}>
            <p>
              <span className="muted">{ACTIVITY_LABELS[activity.type]}: </span>
              <strong>{activity.prompt}</strong>{' '}
              {videoId ? (
                <a
                  href={`https://youtu.be/${videoId}?t=${activity.sourceStartSec}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {time}
                </a>
              ) : (
                <time className="muted">{time}</time>
              )}
            </p>
            {activityFields(activity).map((field) => (
              <p key={field.label} className={field.label === 'Answer' ? undefined : 'muted'}>
                {field.label}: {field.value}
              </p>
            ))}
          </li>
        );
      })}
    </ol>
  );
}
