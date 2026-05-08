chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    serverUrl: 'http://127.0.0.1:18888'
  });
});
