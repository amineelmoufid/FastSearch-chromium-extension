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


// Cloudflare Synchronization Logic (Background Stale-While-Revalidate)

async function syncFromCloudflare() {
  try {
    const { cfSyncUrl, cfSecretKey, searchEngines, cfLastUpdated } = await chrome.storage.sync.get([
      "cfSyncUrl", "cfSecretKey", "searchEngines", "cfLastUpdated"
    ]);
    if (!cfSyncUrl) return { success: false, reason: "No Cloudflare URL configured" };

    const headers = {};
    if (cfSecretKey) {
      headers["Authorization"] = `Bearer ${cfSecretKey}`;
    }

    const res = await fetch(cfSyncUrl, { method: "GET", headers });
    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${errText}` };
    }

    const data = await res.json();
    if (data && Array.isArray(data.engines)) {
      const remoteUpdated = data.updatedAt || 0;
      const localUpdated = cfLastUpdated || 0;

      // Update local cache quietly if remote has data and is newer or different
      if (remoteUpdated > localUpdated || (data.engines.length > 0 && JSON.stringify(data.engines) !== JSON.stringify(searchEngines))) {
        await chrome.storage.sync.set({
          searchEngines: data.engines,
          cfLastUpdated: remoteUpdated || Date.now(),
          cfLastSynced: Date.now()
        });
        console.log("FastSearch Background: Cloudflare pull updated local storage successfully.");
        return { success: true, updated: true, enginesCount: data.engines.length, updatedAt: remoteUpdated };
      }
      return { success: true, updated: false, enginesCount: (searchEngines || []).length };
    }
    return { success: false, error: "Invalid data format received from Cloudflare Worker" };
  } catch (err) {
    console.error("FastSearch Background: Cloudflare pull error:", err);
    return { success: false, error: err.message };
  }
}

async function pushToCloudflare(enginesOverride = null) {
  try {
    const { cfSyncUrl, cfSecretKey, searchEngines } = await chrome.storage.sync.get([
      "cfSyncUrl", "cfSecretKey", "searchEngines"
    ]);
    if (!cfSyncUrl) return { success: false, error: "Cloudflare Sync URL not configured" };

    const engines = enginesOverride || searchEngines || DEFAULT_ENGINES;
    const headers = { "Content-Type": "application/json" };
    if (cfSecretKey) {
      headers["Authorization"] = `Bearer ${cfSecretKey}`;
    }

    const updatedAt = Date.now();
    const payload = {
      engines,
      updatedAt
    };

    const res = await fetch(cfSyncUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      await chrome.storage.sync.set({ cfLastUpdated: updatedAt, cfLastSynced: Date.now() });
      console.log("FastSearch Background: Cloudflare push successful.");
      return { success: true, updatedAt };
    } else {
      const errText = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${errText}` };
    }
  } catch (err) {
    console.error("FastSearch Background: Cloudflare push error:", err);
    return { success: false, error: err.message };
  }
}

// Setup periodic alarm for background sync (every 15 minutes)
try {
  chrome.alarms.create("fastsearch-cf-sync-alarm", { periodInMinutes: 15 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "fastsearch-cf-sync-alarm") {
      syncFromCloudflare();
    }
  });
} catch (e) {
  console.log("Alarms registration notice:", e);
}

// Initialize rules and Cloudflare sync on startup/install
chrome.runtime.onInstalled.addListener(async () => {
  // Save default engines if not already present
  const result = await chrome.storage.sync.get(["searchEngines"]);
  if (!result.searchEngines) {
    await chrome.storage.sync.set({ searchEngines: DEFAULT_ENGINES });
  }
  await updateRules();
  syncFromCloudflare();

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
  syncFromCloudflare();
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
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
  } else if (message.action === "cf-pull") {
    syncFromCloudflare().then(sendResponse);
    return true; // keep async channel open
  } else if (message.action === "cf-push") {
    pushToCloudflare().then(sendResponse);
    return true; // keep async channel open
  } else if (message.action === "cf-auto-push") {
    pushToCloudflare(message.engines).then(sendResponse);
    return true;
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

