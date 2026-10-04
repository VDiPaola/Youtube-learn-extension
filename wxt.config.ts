import { defineConfig } from 'wxt';

/** Store archives leave out the developer-only quiz evaluation page. */
const includeEvalPage = !process.argv.includes('zip');

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ define: { __EVAL_PAGE__: JSON.stringify(includeEvalPage) } }),
  hooks: {
    'entrypoints:resolved': (_wxt, entrypoints) => {
      if (includeEvalPage) return;
      const index = entrypoints.findIndex((entrypoint) => entrypoint.name === 'eval');
      if (index !== -1) entrypoints.splice(index, 1);
    },
  },
  manifest: ({ browser }) => ({
    name: 'YouTube Learn',
    description: 'Active recall quizzes and spaced repetition for educational YouTube videos.',
    // scripting: updates content scripts in YouTube tabs that were open during an update.
    // alarms: refreshes the due-count badge and checks the daily reminder.
    permissions: ['storage', 'scripting', 'alarms'],
    // Requested when the daily reminder is turned on, so installs and updates show no warning.
    optional_permissions: ['notifications'],
    host_permissions: ['*://*.youtube.com/*'],
    // Requested per provider origin from the settings page, never at install.
    optional_host_permissions: ['*://*/*'],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'youtube-learn@extension',
          // data_collection_permissions requires Firefox 140 (142 on Android).
          strict_min_version: '140.0',
          // Transcripts are sent to the AI provider the user configures.
          data_collection_permissions: { required: ['websiteContent'] },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    }),
  }),
});
