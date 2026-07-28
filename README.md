# FastSearch Chromium Extension

A fast, keyboard-friendly, overlay search browser extension for Vivaldi, Brave, Chrome, and other Chromium-based browsers. 

Open a command palette modal directly on top of your current tab using a keyboard shortcut, type your search query, choose a search engine (or paste a direct URL), and view the results in an inline iframe overlay without leaving your active tab!

## Key Features

- **Keyboard Shortcut Toggle**: Press `Ctrl + Shift + Space` (or `Alt + Shift + S`) to open/close the overlay.
- **Shortcut Selection Pre-fill**: Highlight any text on a webpage and press the keyboard shortcut (`Ctrl + Shift + Space` or `Alt + Shift + S`) to instantly open the search overlay pre-filled and focused on your selection.
- **0ms Zero-Delay Local Architecture**: The extension always opens instantly using local memory cache. It never blocks or waits for network requests when opening the search UI.
- **Cloudflare Cross-Device Sync**: Synchronize search engines and prompts across all your browsers and devices seamlessly using a free Cloudflare Worker + KV backend.
- **Sleek Glassmorphic Design**: Modern dark mode UI with backdrop blur filters, smooth scale/fade animations, and clean layouts that blend beautifully with any page.
- **Instant Search Selection**: Select search engines using the Arrow keys and `Enter`, clicking the option, or using instant shortcut hotkeys (`Alt + 1` to `Alt + 9`).
- **Direct URL Navigation**: Paste a direct link (e.g. `google.com` or `https://github.com`) and hit Enter to load the webpage directly in the popup, bypassing search engines.
- **Alt + Click Link Interceptor**: Hold `Alt` and click any link on the webpage to open it directly inside the overlay popup instead of navigating away.
- **Selection Search (Right-Click)**: Highlight any text on a page, right-click, and select *"Search '...' with FastSearch"* to trigger the overlay pre-filled with your selection.
- **Context Menu Link Opener**: Right-click any link and select *"Open link with FastSearch"* to load it directly in the popup.
- **Inline Custom Prompts (`%p`)**: Define custom search URL templates (like `https://www.google.com/search?q=%p+%s`) and assign custom prompts (e.g. `correct that expression:`) inside the settings manager.
- **Inline Settings Manager**: Click the gear icon to add, edit, reorder, or delete search engines. Features complete inline verification and confirmation boxes (no browser alerts or prompt popups).
- **One-Click Clipboard Paste**: Click the paste button inside the search bar to paste text from your clipboard instantly.
- **Open in New Tab**: Easily open your current search results permanently in a new browser tab with one click.
- **Keyboard Event Isolation**: Prevents key events typed inside the inputs (like spacebar or navigation arrows) from leaking to the background tab (e.g. pausing a YouTube video in the background).

## Installation

1. Clone or download this repository to your local machine:
   ```bash
   git clone https://github.com/amineelmoufid/FastSearch-chromium-extension.git
   ```
2. Open your Chromium-based browser (Vivaldi, Brave, Chrome, etc.) and navigate to the Extensions page:
   - **Vivaldi**: `vivaldi://extensions/`
   - **Brave / Chrome**: `chrome://extensions/`
3. Toggle on **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the cloned repository folder.
6. The extension is now loaded and active! Open any standard webpage (e.g., [wikipedia.org](https://wikipedia.org)), click on the page to focus it, and press `Ctrl + Shift + Space`.

## How Cloudflare Cross-Device Sync Works (0ms Delay)

To keep all your devices synced without introducing network delays when opening the popup:
1. **Local-First (0ms)**: The popup reads from local storage cache immediately upon keypress. Zero network waiting!
2. **Background Stale-While-Revalidate**: On startup and periodically (every 15 mins), the background service worker checks your Cloudflare Worker URL for updates. If new engines are found, local cache updates quietly in the background.
3. **Instant Auto-Push**: When you add/edit/reorder search engines in Settings, local storage updates instantly (0ms), and a background POST request uploads the changes to your Cloudflare Worker.

### Deploying your Cloudflare Sync Worker

1. Log in to your free [Cloudflare Dashboard](https://dash.cloudflare.com/) and go to **Workers & Pages** -> **Create Worker**.
2. Copy the contents of [`worker.js`](file:///C:/Users/amine/Desktop/tools/FastSearch-chromium-extension/worker.js) into the Cloudflare Worker code editor.
3. Create a **KV Namespace** named `FASTSEARCH_KV`:
   - Go to **Workers & Pages** -> **KV**.
   - Click **Create Namespace** and name it `FASTSEARCH_KV`.
   - Go back to your Worker -> **Settings** -> **Variables** -> **KV Namespace Bindings**.
   - Add a binding with Variable Name `FASTSEARCH_KV` linked to your KV namespace.
4. *(Optional Secret Key)*: Under Worker Settings -> **Variables**, add an Environment Variable `SECRET_KEY` (e.g., `my_secret_token_123`).
5. Click **Deploy**. Copy your deployed Worker URL (e.g., `https://fastsearch-sync.yourname.workers.dev`).
6. In FastSearch Extension Settings (click ⚙️ inside the overlay):
   - Enter your **Cloudflare Worker URL** and **Secret Auth Key** (if configured).
   - Click **Save Sync Config**.
   - Use **Push to Cloud** or **Pull from Cloud** anytime!

## How to Use Prompts

You can use the `%p` placeholder in the Search URL template to define prompts in your search queries:
- **Search URL template**: `https://www.google.com/search?q=%p+%s&udm=14`
- **Prompt (optional)**: `correct that expression:`
- When you type `hello gemi` and press Enter, it will search Google for `correct that expression: hello gemi`.
- If the prompt is left blank, the extension automatically cleans up consecutive plus signs to ensure the search URL remains clean (`https://www.google.com/search?q=hello+gemi`).
