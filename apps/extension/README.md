# Cabinet for Chrome

Save the page you are reading to your Cabinet library, with a folder and tags.

## Install (unpacked)

1. Start Cabinet (`pnpm dev` at the repo root) and sign in at http://localhost:3000.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick this
   `apps/extension` folder.
3. Pin **Cabinet** to the toolbar.

The extension uses the Cabinet session already in this browser. There is no separate sign-in: if you
are signed out, the popup offers **Sign in** and opens Cabinet.

## Use

| Action | How |
| --- | --- |
| Save with title, folder and tags | Click the toolbar button, or press `⌘⇧S` (`Ctrl+Shift+S`) |
| Save to the last folder without the popup | Press `⌥⇧S` (`Alt+Shift+S`) |
| Save the page or a link | Right-click → **Save page to Cabinet** / **Save link to Cabinet** |
| Save a highlight | Select text, then right-click → **Save highlight to Cabinet**, or press `⌥⇧H` (`Alt+Shift+H`) |

A highlight becomes a note in your last folder: the selected text as a quote, with a link back to
the page. Quick saves mark the toolbar icon with ✓, or ! when saving failed. The popup remembers the folder you
saved to last, lists only folders you can add to (your own, and folders shared with you as
Contributor or Editor), and tells you when the page is already in your Cabinet.

Shortcuts can be changed at `chrome://extensions/shortcuts`.

The extension sends the page's existing title, description, preview image, and declared article/video type. Cabinet saves these immediately and skips its own website fetch when the title, description, and preview are already complete. A successfully synchronized extension save completes the browser-save step in Cabinet's getting-started guide; opening this guide or leaving a save queued offline does not.

Update the Cabinet API before reloading this extension version: the save payload now includes `source` and optional `contentType` fields.

## Offline and retry

After one successful sign-in, pages and highlights can be saved while the API is unavailable. “Saved locally” means the request is kept in this browser, not yet in your account. The background worker retries about once a minute, even after the popup closes. Open the popup to see pending saves, **Retry sync**, or **Discard** a request. Permission/validation failures stay visible and wait for an explicit retry.

The queue remembers the originating account and API address and only sends when both match. Request UUIDs make retries safe after a lost response without creating duplicate bookmarks or highlights. Folder choices come from a cached account-specific list when offline; changed permissions may block a later save.

Reload the extension after this update to grant its `alarms` permission. Keep unsynced data until the popup confirms it is synced: clearing extension storage or uninstalling removes local queued content.

## Settings

Right-click the toolbar button → **Options** (or the sliders icon in the popup) to set:

- **App address**: where Cabinet runs, opened for Sign in and Open in Cabinet.
- **API address**: where the Cabinet API runs. Chrome asks once for permission to reach a new address.

The defaults (`http://localhost:3000`, `http://localhost:4000`) match local development.

## Permissions

- `activeTab`: read the current tab's address and title when you click the button or use a shortcut.
  The extension cannot see your other tabs or your history.
- `contextMenus`, `storage`: the right-click items, settings, cached account/folder information, and unsynced save requests.
- `alarms`: retry queued saves in the background.
- Host access to the Cabinet API only.

## Develop

```bash
pnpm --filter @cabinet/extension test           # unit tests
pnpm --filter @cabinet/extension test:browser   # loads the extension in Chromium against a fake API
pnpm --filter @cabinet/extension icons          # re-render the icons
```

Plain JavaScript and Manifest V3, no build step. Edit, then press reload on `chrome://extensions`.
