// Isolated-world helper. fix-proton-mail.js runs in the main world and cannot read
// chrome.storage, so this script marks <html> with the options instead.
const apply = ({ newestFirst = true }) =>
  document.documentElement.toggleAttribute('data-fix-proton-mail-oldest-first', !newestFirst);
chrome.storage.sync.get('newestFirst', apply);
chrome.storage.onChanged.addListener((c) => {
  if (c.newestFirst) apply({ newestFirst: c.newestFirst.newValue });
});
