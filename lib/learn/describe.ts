import type { Activity } from './schema';

export interface ActivityField {
  label: string;
  value: string;
}

/** Answer details of an activity as labelled text, for reports and debug views. */
export function activityFields(activity: Activity): ActivityField[] {
  const fields: ActivityField[] = [];
  switch (activity.type) {
    case 'multiple_choice':
      fields.push(
        { label: 'Answer', value: activity.answer },
        { label: 'Wrong options', value: activity.options.join(' | ') },
      );
      break;
    case 'ordering':
      fields.push({
        label: 'Correct order',
        value: activity.options.map((item, i) => `${i + 1}. ${item}`).join('  '),
      });
      break;
    case 'cloze':
      fields.push({ label: 'Answer', value: activity.answer });
      if (activity.options.length > 0) {
        fields.push({ label: 'Also accepted', value: activity.options.join(' | ') });
      }
      break;
    case 'true_false':
      fields.push({ label: 'Answer', value: activity.answer === 'true' ? 'True' : 'False' });
      break;
    default:
      fields.push({ label: 'Answer', value: activity.answer });
  }
  if (activity.explanation) fields.push({ label: 'Why', value: activity.explanation });
  return fields;
}
