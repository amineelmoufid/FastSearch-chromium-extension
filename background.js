// Default search engines
const DEFAULT_ENGINES = [
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
  { id: "brave", name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  { id: "ddg", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  { id: "youtube", name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
  { id: "wikipedia", name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Special:Search?search=%s" },
  { id: "github", name: "GitHub", url: "https://github.com/search?q=%s" }
];

// Helper to extract base domain (e.g. google.com from www.google.com or search.brave.com)
function getDomain(urlStr) {
  try {
    const url = new URL(urlStr);
    let hostname = url.hostname;
    // We want to extract the registered domain or at least the host.
    // For safety with rules, we can remove the 'www.' prefix and use that as the filter.
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    return hostname;
  } catch (e) {
    console.error("Invalid URL:", urlStr, e);
    return null;
  }
}

let updateQueue = Promise.resolve();

// Function to update declarativeNetRequest session rules (sequenced via promise queue to avoid race conditions)
function updateRules() {
  updateQueue = updateQueue.then(async () => {
    await updateRulesInternal();
  }).catch(err => {
    console.error("Queue execution error:", err);
  });
  return updateQueue;
}

async function updateRulesInternal() {
  try {
    // Get current engines from storage, default to DEFAULT_ENGINES if none exist
    const result = await chrome.storage.sync.get(["searchEngines"]);
    const engines = result.searchEngines || DEFAULT_ENGINES;

    // Extract unique domains
    const domains = new Set();
    engines.forEach(engine => {
      const domain = getDomain(engine.url);
      if (domain) {
        domains.add(domain);
        // Also add base/parent domains just in case
        const parts = domain.split('.');
        if (parts.length > 2) {
          domains.add(parts.slice(-2).join('.'));
        }
      }
    });

    // Create rules to strip frame protection headers
    const newRules = Array.from(domains).map((domain, index) => {
      const ruleId = index + 1; // rule IDs must be >= 1
      return {
        id: ruleId,
        priority: 1,
        action: {
          type: "modifyHeaders",
          responseHeaders: [
            { header: "X-Frame-Options", operation: "remove" },
            { header: "Frame-Options", operation: "remove" },
            { header: "Content-Security-Policy", operation: "remove" }
          ]
        },
        condition: {
          requestDomains: [domain],
          resourceTypes: ["sub_frame"]
        }
      };
    });

    // Get current rules to remove them
    const existingRules = await chrome.declarativeNetRequest.getSessionRules();
    const existingRuleIds = existingRules.map(r => r.id);

    console.log(`Replacing ${existingRuleIds.length} existing rules with ${newRules.length} new rules for domains:`, Array.from(domains));

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existingRuleIds,
      addRules: newRules
    });
  } catch (err) {
    console.error("Failed to update declarativeNetRequest rules:", err);
  }
}


// Initialize rules on startup/install
chrome.runtime.onInstalled.addListener(async () => {
  // Save default engines if not already present
  const result = await chrome.storage.sync.get(["searchEngines"]);
  if (!result.searchEngines) {
    await chrome.storage.sync.set({ searchEngines: DEFAULT_ENGINES });
  }
  await updateRules();

  // Create right-click context menu item for selected text
  chrome.contextMenus.create({
    id: "fastsearch-selection",
    title: "Search '%s' with FastSearch",
    contexts: ["selection"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.log("Context menu registration notice:", chrome.runtime.lastError.message);
    }
  });

  // Create right-click context menu item for links
  chrome.contextMenus.create({
    id: "fastsearch-link",
    title: "Open link with FastSearch",
    contexts: ["link"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.log("Context menu registration notice:", chrome.runtime.lastError.message);
    }
  });
});

chrome.runtime.onStartup.addListener(async () => {
  await updateRules();
});

// Update rules when storage changes
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === "sync" && changes.searchEngines) {
    await updateRules();
  }
});

// Handler to toggle overlay on active tab
async function toggleOverlayOnActiveTab() {
  console.log("FastSearch Background: toggleOverlayOnActiveTab called");
  try {
    const [activeTab] = await chrome.tabs.query({ activeTab: true, currentWindow: true });
    if (!activeTab) {
      console.log("FastSearch Background: No active tab found.");
      return;
    }
    
    console.log("FastSearch Background: Active tab URL is", activeTab.url);

    // Ignore restricted pages (like chrome:// or vivaldi://)
    if (activeTab.url && (
      activeTab.url.startsWith("chrome://") || 
      activeTab.url.startsWith("chrome-extension://") || 
      activeTab.url.startsWith("edge://") || 
      activeTab.url.startsWith("vivaldi://") ||
      activeTab.url.startsWith("about:")
    )) {
      console.warn("Cannot toggle FastSearch on browser system pages:", activeTab.url);
      return;
    }

    console.log("FastSearch Background: Sending message to content script in tab", activeTab.id);
    chrome.tabs.sendMessage(activeTab.id, { action: "toggle-fast-search-overlay" }).catch((err) => {
      console.log("Could not communicate with tab. Content script might not be injected yet.", err);
    });
  } catch (err) {
    console.error("Failed to toggle overlay:", err);
  }
}

// Listen for keyboard command
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-fast-search") {
    await toggleOverlayOnActiveTab();
  }
});

// Listen for action click (extension icon)
chrome.action.onClicked.addListener(async () => {
  await toggleOverlayOnActiveTab();
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "open-new-tab") {
    if (message.url) {
      chrome.tabs.create({ url: message.url });
    }
  }
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab) {
    if (info.menuItemId === "fastsearch-selection" && info.selectionText) {
      chrome.tabs.sendMessage(tab.id, {
        action: "open-with-query",
        query: info.selectionText
      }).catch((err) => {
        console.log("Could not send context menu query. Tab might not be ready or active.", err);
      });
    } else if (info.menuItemId === "fastsearch-link" && info.linkUrl) {
      chrome.tabs.sendMessage(tab.id, {
        action: "open-link-url",
        url: info.linkUrl
      }).catch((err) => {
        console.log("Could not send context menu link. Tab might not be ready or active.", err);
      });
    }
  }
});
