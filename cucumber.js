// `npm test` runs everything except the real-browser scenarios (tagged @browser), which need
// Chromium: `npm run test:browser` runs those. CI runs both. `npm run test:lighthouse` runs the Lighthouse
// measurements of the live site (tagged @lighthouse), kept out of both: they take minutes and depend on the network.
export default {
  tags: 'not @browser and not @lighthouse',
};

export const browser = {
  tags: '@browser',
};

export const lighthouse = {
  tags: '@lighthouse',
};
