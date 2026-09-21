// `npm test` runs everything except the real-browser scenarios (tagged @browser), which need
// Chromium: `npm run test:browser` runs those. CI runs both.
export default {
  tags: 'not @browser',
};

export const browser = {
  tags: '@browser',
};
