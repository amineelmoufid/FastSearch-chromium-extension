(function () {
  // Prevent duplicate injection
  if (window.fastSearchOverlayInjected) {
    console.log("FastSearch Content Script: Already injected on this page.");
    return;
  }
  window.fastSearchOverlayInjected = true;
  console.log("FastSearch Content Script: Injecting on", window.location.href);

  // Default engines list
  const DEFAULT_ENGINES = [
    { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
    { id: "brave", name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
    { id: "ddg", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
    { id: "youtube", name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
    { id: "wikipedia", name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Special:Search?search=%s" },
    { id: "github", name: "GitHub", url: "https://github.com/search?q=%s" }
  ];

  let engines = [...DEFAULT_ENGINES];
  let selectedEngineIndex = 0;
  let activeView = "search"; // "search" or "settings"
  let currentSearchEngine = null; // Stored engine when iframe search is active

  // Create overlay container and mount Shadow DOM
  const root = document.createElement("div");
  root.id = "fast-search-root";
  const parent = document.body || document.documentElement;
  if (parent) {
    parent.appendChild(root);
    console.log("FastSearch Content Script: Shadow DOM host appended successfully.");
  } else {
    console.error("FastSearch Content Script: Could not find document body or documentElement to append Shadow DOM host.");
  }

  const shadow = root.attachShadow({ mode: "open" });

  // Load stylesheet inside Shadow DOM
  const styleLink = document.createElement("link");
  styleLink.rel = "stylesheet";
  styleLink.href = chrome.runtime.getURL("styles.css");
  shadow.appendChild(styleLink);

  // Injected HTML template
  const uiContainer = document.createElement("div");
  uiContainer.innerHTML = `
    <div class="backdrop" id="fs-backdrop" style="display: none;">
      <!-- Command Palette / Box -->
      <div class="container" id="fs-container">
        <!-- Search View -->
        <div id="fs-search-view">
          <div class="search-header">
            <div class="search-icon-wrapper">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </div>
            <input type="text" class="search-input" id="fs-search-input" placeholder="Type query to search..." autocomplete="off">
            <div class="header-actions">
              <button class="action-btn" id="fs-paste-btn" title="Paste from clipboard">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
              </button>
              <button class="action-btn" id="fs-clear-btn" title="Clear input" style="display: none;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
              <button class="action-btn" id="fs-settings-btn" title="Search settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </button>
            </div>
          </div>
          <ul class="engines-list" id="fs-engines-list"></ul>
          <div class="footer">
            <div class="shortcut-guide">
              <span><span class="shortcut-key">↑↓</span> navigate</span>
              <span><span class="shortcut-key">Enter</span> search</span>
              <span><span class="shortcut-key">Alt + 1-9</span> quick search</span>
            </div>
            <div>
              <span>Press <span class="shortcut-key">Esc</span> to close</span>
            </div>
          </div>
        </div>

        <!-- Settings View -->
        <div id="fs-settings-view" style="display: none;"></div>
      </div>

      <!-- Results Modal (Initially hidden/pointer-disabled) -->
      <div class="results-modal" id="fs-results-modal">
        <div class="results-bar">
          <div class="results-left">
            <button class="action-btn" id="fs-results-back-btn" title="Back to Search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            </button>
            <div class="results-title-info" id="fs-results-engine-info"></div>
          </div>
          <div class="results-query-bar">
            <div class="search-icon-wrapper">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </div>
            <input type="text" class="results-query-input" id="fs-results-query-input" placeholder="Search again...">
          </div>
          <div class="results-right">
            <button class="action-btn" id="fs-results-open-tab-btn" title="Open in New Tab">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </button>
            <button class="action-btn" id="fs-results-close-btn" title="Close Overlay">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>
        <iframe class="results-iframe" id="fs-results-iframe" name="fs-results-iframe" referrerPolicy="no-referrer"></iframe>
      </div>
    </div>
  `;
  shadow.appendChild(uiContainer);

  // Core DOM Elements
  const backdrop = shadow.getElementById("fs-backdrop");
  const container = shadow.getElementById("fs-container");
  const searchInput = shadow.getElementById("fs-search-input");
  const clearBtn = shadow.getElementById("fs-clear-btn");
  const settingsBtn = shadow.getElementById("fs-settings-btn");
  const enginesList = shadow.getElementById("fs-engines-list");
  
  const searchView = shadow.getElementById("fs-search-view");
  const settingsView = shadow.getElementById("fs-settings-view");

  const resultsModal = shadow.getElementById("fs-results-modal");
  const resultsIframe = shadow.getElementById("fs-results-iframe");
  const resultsEngineInfo = shadow.getElementById("fs-results-engine-info");
  const resultsQueryInput = shadow.getElementById("fs-results-query-input");
  const resultsBackBtn = shadow.getElementById("fs-results-back-btn");
  const resultsOpenTabBtn = shadow.getElementById("fs-results-open-tab-btn");
  const resultsCloseBtn = shadow.getElementById("fs-results-close-btn");
  const pasteBtn = shadow.getElementById("fs-paste-btn");

  // Load Engines from Storage
  async function loadEngines() {
    const result = await chrome.storage.sync.get(["searchEngines"]);
    if (result.searchEngines && Array.isArray(result.searchEngines) && result.searchEngines.length > 0) {
      engines = result.searchEngines;
    } else {
      engines = [...DEFAULT_ENGINES];
    }
    // Safeguard index bounds
    if (selectedEngineIndex >= engines.length) {
      selectedEngineIndex = 0;
    }
  }

  // Extract base domain for favicon
  function getDomain(urlStr) {
    try {
      const url = new URL(urlStr);
      return url.hostname;
    } catch (e) {
      return "search";
    }
  }

  // Check if string looks like a URL
  function isURL(str) {
    str = str.trim();
    try {
      const url = new URL(str);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {}
    
    // Check for typical domain patterns (e.g. domain.com or sub.domain.co.uk)
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}(\/.*)?$/;
    return domainRegex.test(str);
  }

  // Render search engines inside list
  function renderEngines() {
    enginesList.innerHTML = "";
    engines.forEach((engine, index) => {
      const li = document.createElement("li");
      li.className = `engine-item ${index === selectedEngineIndex ? "selected" : ""}`;
      
      const domain = getDomain(engine.url);
      const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

      li.innerHTML = `
        <div class="engine-icon">
          <img src="${faviconUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
          <span style="display:none;">${engine.name[0].toUpperCase()}</span>
        </div>
        <div class="engine-info">
          <div class="engine-name">${engine.name}</div>
        </div>
        ${index < 9 ? `<div class="engine-shortcut">Alt+${index + 1}</div>` : ""}
      `;

      li.addEventListener("click", () => {
        selectedEngineIndex = index;
        renderEngines();
        triggerSearch(engines[index]);
      });

      enginesList.appendChild(li);
    });

    // Ensure selected item is scrolled into view
    const selectedItem = enginesList.querySelector(".engine-item.selected");
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest" });
    }
  }

  // Render settings interface
  function renderSettings() {
    let deleteIndex = -1;

    let addEditFormHtml = `
      <div class="settings-form" id="fs-settings-form">
        <div class="settings-title-row">
          <h3 class="settings-title" id="fs-form-title">Add Search Engine</h3>
        </div>
        <input type="hidden" id="fs-edit-index" value="-1">
        <div class="form-group">
          <label class="form-label">Engine Name</label>
          <input type="text" class="form-input" id="fs-input-name" placeholder="e.g. StackOverflow">
        </div>
        <div class="form-group">
          <label class="form-label">Search URL template (use %s for query, %p for prompt)</label>
          <input type="text" class="form-input" id="fs-input-url" placeholder="e.g. https://www.google.com/search?q=%p+%s">
        </div>
        <div class="form-group">
          <label class="form-label">Prompt (optional, replaces %p)</label>
          <input type="text" class="form-input" id="fs-input-prompt" placeholder="e.g. correct that expression:">
        </div>
        <div class="form-error" id="fs-form-error" style="display: none;"></div>
        <div class="form-buttons">
          <button class="btn btn-secondary" id="fs-cancel-form-btn">Cancel</button>
          <button class="btn btn-primary" id="fs-save-form-btn">Save</button>
        </div>
      </div>
    `;

    settingsView.innerHTML = `
      <div class="settings-title-row">
        <h3 class="settings-title">Manage Search Engines</h3>
        <button class="btn btn-secondary" id="fs-back-to-search-btn">Back to Search</button>
      </div>
      <div class="settings-list">
        ${engines.map((engine, index) => {
          const domain = getDomain(engine.url);
          const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
          return `
            <div class="settings-item">
              <div class="engine-icon" style="width: 18px; height: 18px;">
                <img src="${faviconUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                <span style="display:none; font-size:9px;">${engine.name[0].toUpperCase()}</span>
              </div>
              <div class="settings-item-info">
                <span class="settings-item-name">${engine.name}</span>
                <span class="settings-item-url">${engine.url}</span>
                ${engine.prompt ? `<span class="settings-item-url" style="color: var(--color-accent); font-weight: 500;">Prompt: ${engine.prompt}</span>` : ""}
              </div>
              <div class="settings-actions">
                <button class="btn-icon fs-move-up-btn" data-index="${index}" title="Move Up" ${index === 0 ? "disabled" : ""}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </button>
                <button class="btn-icon fs-move-down-btn" data-index="${index}" title="Move Down" ${index === engines.length - 1 ? "disabled" : ""}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <button class="btn-icon fs-edit-engine-btn" data-index="${index}" title="Edit">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="btn-icon btn-icon-danger fs-delete-engine-btn" data-index="${index}" title="Delete">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
      ${addEditFormHtml}

      <!-- Inline Confirmation Overlay -->
      <div class="settings-confirm-overlay" id="fs-settings-confirm">
        <div class="settings-confirm-card">
          <div style="font-size: 14px; font-weight: 500; margin-bottom: 16px; text-align: center; line-height: 1.4;">
            Are you sure you want to delete "<span id="fs-delete-target-name"></span>"?
          </div>
          <div class="form-buttons" style="justify-content: center; gap: 12px; margin-top: 0;">
            <button class="btn btn-secondary" id="fs-delete-cancel-btn" style="flex: 1;">Cancel</button>
            <button class="btn btn-danger" id="fs-delete-confirm-btn" style="flex: 1;">Delete</button>
          </div>
        </div>
      </div>
    `;

    // Hook settings action events
    settingsView.querySelector("#fs-back-to-search-btn").addEventListener("click", () => {
      showSearchView();
    });

    // Confirmation dialog selectors
    const confirmOverlay = settingsView.querySelector("#fs-settings-confirm");
    const deleteTargetName = settingsView.querySelector("#fs-delete-target-name");
    const deleteCancelBtn = settingsView.querySelector("#fs-delete-cancel-btn");
    const deleteConfirmBtn = settingsView.querySelector("#fs-delete-confirm-btn");

    // Save/Cancel Form events
    const cancelFormBtn = settingsView.querySelector("#fs-cancel-form-btn");
    const saveFormBtn = settingsView.querySelector("#fs-save-form-btn");
    const inputName = settingsView.querySelector("#fs-input-name");
    const inputUrl = settingsView.querySelector("#fs-input-url");
    const inputPrompt = settingsView.querySelector("#fs-input-prompt");
    const editIndexEl = settingsView.querySelector("#fs-edit-index");
    const formTitle = settingsView.querySelector("#fs-form-title");
    const formError = settingsView.querySelector("#fs-form-error");

    function showError(msg) {
      if (msg) {
        formError.textContent = msg;
        formError.style.display = "block";
      } else {
        formError.style.display = "none";
        formError.textContent = "";
      }
    }

    function resetForm() {
      inputName.value = "";
      inputUrl.value = "";
      inputPrompt.value = "";
      editIndexEl.value = "-1";
      showError("");
      formTitle.textContent = "Add Search Engine";
      saveFormBtn.textContent = "Save";
    }

    cancelFormBtn.addEventListener("click", () => {
      resetForm();
    });

    // Clear error on typing
    inputName.addEventListener("input", () => showError(""));
    inputUrl.addEventListener("input", () => showError(""));

    saveFormBtn.addEventListener("click", async () => {
      const name = inputName.value.trim();
      const url = inputUrl.value.trim();
      const prompt = inputPrompt.value.trim();
      const editIdx = parseInt(editIndexEl.value);

      if (!name || !url) {
        showError("Please fill out both Name and URL template.");
        return;
      }

      if (!url.includes("%s")) {
        showError("The URL template must include %s for the search query placeholder.");
        return;
      }

      if (editIdx >= 0) {
        // Edit existing engine
        engines[editIdx] = { ...engines[editIdx], name, url, prompt };
      } else {
        // Add new engine
        const id = "custom_" + Date.now();
        engines.push({ id, name, url, prompt });
      }

      await chrome.storage.sync.set({ searchEngines: engines });
      resetForm();
      renderSettings();
    });

    // Item actions: Edit, Delete, Order
    settingsView.querySelectorAll(".fs-edit-engine-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(btn.dataset.index);
        const engine = engines[idx];
        inputName.value = engine.name;
        inputUrl.value = engine.url;
        inputPrompt.value = engine.prompt || "";
        editIndexEl.value = idx.toString();
        showError("");
        formTitle.textContent = `Edit "${engine.name}"`;
        saveFormBtn.textContent = "Update";
        inputName.focus();
      });
    });

    settingsView.querySelectorAll(".fs-delete-engine-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        deleteIndex = parseInt(btn.dataset.index);
        const engine = engines[deleteIndex];
        deleteTargetName.textContent = engine.name;
        confirmOverlay.classList.add("active");
      });
    });

    deleteCancelBtn.addEventListener("click", () => {
      confirmOverlay.classList.remove("active");
      deleteIndex = -1;
    });

    deleteConfirmBtn.addEventListener("click", async () => {
      if (deleteIndex >= 0) {
        engines.splice(deleteIndex, 1);
        await chrome.storage.sync.set({ searchEngines: engines });
        confirmOverlay.classList.remove("active");
        deleteIndex = -1;
        renderSettings();
      }
    });

    settingsView.querySelectorAll(".fs-move-up-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.index);
        if (idx > 0) {
          const temp = engines[idx];
          engines[idx] = engines[idx - 1];
          engines[idx - 1] = temp;
          await chrome.storage.sync.set({ searchEngines: engines });
          renderSettings();
        }
      });
    });

    settingsView.querySelectorAll(".fs-move-down-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.index);
        if (idx < engines.length - 1) {
          const temp = engines[idx];
          engines[idx] = engines[idx + 1];
          engines[idx + 1] = temp;
          await chrome.storage.sync.set({ searchEngines: engines });
          renderSettings();
        }
      });
    });
  }

  // Toggle View Controllers
  function showSearchView() {
    activeView = "search";
    settingsView.style.display = "none";
    searchView.style.display = "block";
    renderEngines();
    searchInput.focus();
  }

  function showSettingsView() {
    activeView = "settings";
    searchView.style.display = "none";
    settingsView.style.display = "block";
    renderSettings();
  }

  // Search trigger logic
  function triggerSearch(engine, queryOverride = null) {
    const query = queryOverride !== null ? queryOverride : searchInput.value.trim();
    if (!query) return;

    currentSearchEngine = engine;
    let searchUrl;
    let displayName = engine.name;
    
    if (isURL(query)) {
      searchUrl = query;
      if (!searchUrl.startsWith("http://") && !searchUrl.startsWith("https://")) {
        searchUrl = "https://" + searchUrl;
      }
      displayName = "Direct Link";
      currentSearchEngine = { name: "Direct Link", url: "%s" };
    } else {
      // Build the query URL using search engine template
      const promptText = engine.prompt || "";
      searchUrl = engine.url;
      
      if (searchUrl.includes("%p")) {
        searchUrl = searchUrl.replace("%p", encodeURIComponent(promptText));
        if (!promptText) {
          // Clean up formatting: e.g. "%p+%s" -> "+%s" -> "%s"
          searchUrl = searchUrl.replace(/\+%s/g, '%s').replace(/%s\+/g, '%s');
        }
      }
      
      searchUrl = searchUrl.replace("%s", encodeURIComponent(query));
    }
    
    // Configure iframe results modal
    resultsIframe.src = searchUrl;

    const domain = getDomain(searchUrl);
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    resultsEngineInfo.innerHTML = `
      <div class="engine-icon" style="width: 16px; height: 16px; margin: 0;">
        <img src="${faviconUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
        <span style="display:none; font-size:8px;">${displayName[0].toUpperCase()}</span>
      </div>
      <span>${displayName === "Direct Link" ? `Direct Link: ${domain}` : displayName}</span>
    `;

    resultsQueryInput.value = query;

    // Show iframe overlay, hide command container
    container.style.display = "none";
    resultsModal.classList.add("active");
  }

  // Go back from results iframe to search box
  function goBackToSearch() {
    resultsIframe.src = "about:blank"; // unload iframe
    resultsModal.classList.remove("active");
    container.style.display = "flex";
    showSearchView();
    // Maintain typed query in search input
    searchInput.value = resultsQueryInput.value;
    handleSearchInputChanged();
    searchInput.focus();
    searchInput.select();
  }

  // Open overlay completely
  async function openOverlay(initialQuery = "") {
    console.log("FastSearch Content Script: Opening overlay...");
    await loadEngines();
    backdrop.style.display = "flex";
    backdrop.offsetHeight; // force reflow
    backdrop.classList.add("active");
    container.style.display = "flex";
    showSearchView();
    searchInput.value = initialQuery;
    handleSearchInputChanged();
    searchInput.focus();
    if (initialQuery) {
      searchInput.select();
    }
  }

  // Close overlay completely
  function closeOverlay() {
    backdrop.classList.remove("active");
    resultsModal.classList.remove("active");
    resultsIframe.src = "about:blank";
    searchInput.value = "";
    // Wait for transition to complete before setting display: none
    setTimeout(() => {
      if (!backdrop.classList.contains("active")) {
        backdrop.style.display = "none";
      }
    }, 250);
  }

  // Clear query button visibility handler
  function handleSearchInputChanged() {
    if (searchInput.value.length > 0) {
      clearBtn.style.display = "flex";
    } else {
      clearBtn.style.display = "none";
    }
  }

  // Event Listeners

  // Toggle overlay messaging
  chrome.runtime.onMessage.addListener((message) => {
    console.log("FastSearch Content Script: Received message from background:", message);
    if (message.action === "toggle-fast-search-overlay") {
      if (backdrop.classList.contains("active")) {
        closeOverlay();
      } else {
        openOverlay();
      }
    } else if (message.action === "open-with-query") {
      openOverlay(message.query);
    } else if (message.action === "open-link-url") {
      openOverlayWithDirectURL(message.url);
    }
  });

  // Settings Cog click
  settingsBtn.addEventListener("click", () => {
    if (activeView === "search") {
      showSettingsView();
    } else {
      showSearchView();
    }
  });

  // Paste button click
  pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        searchInput.value = text;
        handleSearchInputChanged();
        searchInput.focus();
      }
    } catch (err) {
      console.error("Failed to read clipboard:", err);
    }
  });

  // Clear query button click
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    handleSearchInputChanged();
    searchInput.focus();
  });

  // Back and Close buttons inside results bar
  resultsBackBtn.addEventListener("click", () => {
    goBackToSearch();
  });

  resultsOpenTabBtn.addEventListener("click", () => {
    const url = resultsIframe.src;
    if (url && url !== "about:blank") {
      chrome.runtime.sendMessage({ action: "open-new-tab", url: url });
    }
  });

  resultsCloseBtn.addEventListener("click", () => {
    closeOverlay();
  });

  // Input listeners for input change
  searchInput.addEventListener("input", () => {
    handleSearchInputChanged();
  });

  // Search typing box keyboard handler
  searchInput.addEventListener("keydown", (e) => {
    // Prevent host tab scrolling when using arrow keys inside overlay
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
    }
  });

  searchInput.addEventListener("keyup", (e) => {
    if (activeView !== "search") return;

    if (e.key === "ArrowDown") {
      selectedEngineIndex = (selectedEngineIndex + 1) % engines.length;
      renderEngines();
    } else if (e.key === "ArrowUp") {
      selectedEngineIndex = (selectedEngineIndex - 1 + engines.length) % engines.length;
      renderEngines();
    } else if (e.key === "Enter") {
      if (engines[selectedEngineIndex]) {
        triggerSearch(engines[selectedEngineIndex]);
      }
    }
  });

  // Global overlay keys (Esc, Alt + 1-9 shortcuts)
  backdrop.addEventListener("keydown", (e) => {
    // Stop propagation so host site shortcuts don't intercept typing or Esc keys
    e.stopPropagation();

    // Escape handling
    if (e.key === "Escape") {
      if (resultsModal.classList.contains("active")) {
        goBackToSearch();
      } else {
        closeOverlay();
      }
      return;
    }

    // Quick engine shortcuts Alt + 1/2/3...9
    if (e.altKey && e.key >= "1" && e.key <= "9") {
      const idx = parseInt(e.key) - 1;
      if (idx < engines.length) {
        e.preventDefault();
        
        // Use query from active element (either main search input or results bar search input)
        let query = "";
        if (resultsModal.classList.contains("active")) {
          query = resultsQueryInput.value.trim();
        } else {
          query = searchInput.value.trim();
        }

        if (query) {
          triggerSearch(engines[idx], query);
        }
      }
    }
  });

  backdrop.addEventListener("keyup", (e) => {
    e.stopPropagation();
  });

  backdrop.addEventListener("keypress", (e) => {
    e.stopPropagation();
  });

  // Results bar input enter to search again
  resultsQueryInput.addEventListener("keyup", (e) => {
    if (e.key === "Enter") {
      if (currentSearchEngine) {
        triggerSearch(currentSearchEngine, resultsQueryInput.value.trim());
      }
    }
  });

  // Click outside to close (backdrop clicks)
  backdrop.addEventListener("click", (e) => {
    const path = e.composedPath();
    // Close overlay if user clicks outside the containers
    if (!path.includes(container) && !path.includes(resultsModal)) {
      closeOverlay();
    }
  });

  // Prevent event propagation inside container
  container.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  
  resultsModal.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Local page shortcut fallback (Alt+Shift+S or Ctrl+Shift+Space)
  window.addEventListener("keydown", (e) => {
    const isAltShiftS = e.altKey && e.shiftKey && (e.key === "S" || e.key === "s");
    const isCtrlShiftSpace = e.ctrlKey && e.shiftKey && (e.key === " " || e.code === "Space");
    
    if (isAltShiftS || isCtrlShiftSpace) {
      console.log("FastSearch Content Script: Direct shortcut keydown detected in window:", isAltShiftS ? "Alt+Shift+S" : "Ctrl+Shift+Space");
      e.preventDefault();
      e.stopPropagation();
      if (backdrop.classList.contains("active")) {
        closeOverlay();
      } else {
        openOverlay();
      }
    }
  }, true);

  // Directly open any URL inside the results iframe modal
  async function openOverlayWithDirectURL(url) {
    await loadEngines();
    backdrop.style.display = "flex";
    backdrop.offsetHeight; // force reflow
    backdrop.classList.add("active");
    
    // Hide the command container
    container.style.display = "none";
    
    // Set results iframe source
    resultsIframe.src = url;
    
    currentSearchEngine = { name: "Direct Link", url: "%s" };
    
    const domain = getDomain(url);
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    resultsEngineInfo.innerHTML = `
      <div class="engine-icon" style="width: 16px; height: 16px; margin: 0;">
        <img src="${faviconUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
        <span style="display:none; font-size:8px;">D</span>
      </div>
      <span>Direct Link: ${domain}</span>
    `;
    
    resultsQueryInput.value = url;
    resultsModal.classList.add("active");
  }

  // Intercept Alt+Click on webpage links
  window.addEventListener("click", (e) => {
    if (e.altKey) {
      const link = e.target.closest("a");
      if (link && link.href) {
        // Ignore hash anchors on current page
        const currentUrl = new URL(window.location.href);
        const targetUrl = new URL(link.href);
        if (currentUrl.origin === targetUrl.origin && currentUrl.pathname === targetUrl.pathname && targetUrl.hash) {
          return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        
        console.log("FastSearch Link Interceptor: Alt+Clicked link:", link.href);
        openOverlayWithDirectURL(link.href);
      }
    }
  }, true); // Intercept in capture phase

})();
