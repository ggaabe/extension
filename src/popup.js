// popup.js - handles interaction with the extension's popup, sends requests to the
// service worker (background.js), and updates the popup's UI (popup.html) on completion.
// Function to classify the type of Chrome tabs based on their URL structure

const inputElement = document.getElementById("text");
const outputElement = document.getElementById("output");
const removeDuplicatesBtn = document.getElementById("removeDuplicatesBtn");
const closeOldTabsBtn = document.getElementById("closeOldTabsBtn");

removeDuplicatesBtn.addEventListener("click", async () => {
  try {
    // Retrieve all tabs
    const allTabs = await chrome.tabs.query({});
    const tabMap = {};

    // Group tabs by URL
    allTabs.forEach((tab) => {
      if (!tabMap[tab.url]) {
        tabMap[tab.url] = [];
      }
      tabMap[tab.url].push(tab);
    });

    // Iterate over grouped tabs and close duplicates, keeping the oldest one
    for (const [url, tabs] of Object.entries(tabMap)) {
      if (tabs.length > 1) {
        // Sort tabs by their id to keep the oldest one
        tabs.sort((a, b) => a.id - b.id);
        // Close all tabs except the first one (oldest)
        const tabsToClose = tabs.slice(1).map((tab) => tab.id);
        tabsToClose.forEach(async (tabId) => {
          await chrome.tabs.remove(tabsToClose);
        });
      }
    }

    outputElement.innerText =
      "Duplicate tabs removed, keeping the oldest ones.";
  } catch (error) {
    console.error("Failed to remove duplicate tabs:", error);
    outputElement.innerText = "Error removing duplicate tabs.";
  }
});

closeOldTabsBtn.addEventListener("click", async () => {
  try {
    // Get all tabs
    const allTabs = await chrome.tabs.query({});
    const currentTime = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    const tabsToClose = [];

    // Filter tabs that are older than 24 hours and not in any groups
    allTabs.forEach((tab) => {
      console.log(
        "last acc",
        tab.lastAccessed,
        "current time",
        currentTime,
        "diff",
        currentTime - tab.lastAccessed,
        "more than 24hr",
        currentTime - tab.lastAccessed > twentyFourHours,
        "groupId",
        tab.groupId,
        "all true",
        !tab.groupId &&
          tab.lastAccessed &&
          currentTime - tab.lastAccessed > twentyFourHours
      );

      if (
        tab.groupId === -1 &&
        tab.lastAccessed &&
        currentTime - tab.lastAccessed > twentyFourHours
      ) {
        console.log("Pushing", tab.id);
        tabsToClose.push(tab.id);
      }
    });

    if (tabsToClose.length > 0) {
      await chrome.tabs.remove(tabsToClose);
      outputElement.innerText = `Closed ${tabsToClose.length} old tab(s).`;
    } else {
      outputElement.innerText = "No old tabs to close.";
    }
  } catch (error) {
    console.error("Failed to close old tabs:", error);
    outputElement.innerText = "Error closing old tabs.";
  }
});

// Listen for changes made to the textbox.
inputElement.addEventListener("input", (event) => {
  // Bundle the input data into a message.
  const message = {
    action: "classify",
    text: event.target.value,
  };

  // Send this message to the service worker.
  chrome.runtime.sendMessage(message, (response) => {
    // Handle results returned by the service worker (`background.js`) and update the popup's UI.
    console.log("Final response");
    outputElement.innerText = JSON.stringify(response, null, 2);
  });
});
