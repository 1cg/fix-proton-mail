const box = document.getElementById('newestFirst');
chrome.storage.sync.get({ newestFirst: true }, (o) => { box.checked = o.newestFirst; });
box.addEventListener('change', () => chrome.storage.sync.set({ newestFirst: box.checked }));
