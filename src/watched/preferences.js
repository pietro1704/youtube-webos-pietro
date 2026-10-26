export const watchedPageNames = { home: 'Home', subscriptions: 'Subscriptions', search: 'Search', channels: 'Channels', library: 'Library / history', watch: 'Watch recommendations' };
export const watchedThresholdModes = {};
for (let percent = 1; percent <= 100; percent++) watchedThresholdModes[String(percent)] = `${percent}%`;
export const watchedConfigKeys = ['enableWatchedFilter', 'watchedThreshold', ...Object.keys(watchedPageNames).map(page => 'watchedOn_' + page)];
