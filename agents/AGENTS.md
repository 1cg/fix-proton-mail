# Notes for agents and developers

This file records the design decisions for this extension, and how to develop and test it in a live browser.

## Goal

Keyboard-driven triage for the Proton Mail web app (`mail.proton.me`), as a Chrome MV3 extension. Develop it by testing live in a browser on the user's Proton account.

All keys are inactive in text fields and in the composer. The extension must not break typing in the composer or in search.

## Files

| File | Purpose |
|---|---|
| `../extension/fix-proton-mail.js` | All logic. The header comment lists the keys and the DOM assumptions. |
| `../extension/manifest.json` | MV3 manifest. Two content scripts at `document_start`: the main script in the main world, and `settings.js` in the isolated world. |
| `../extension/settings.js` | Isolated-world bridge: reads the options and marks `<html>`. |
| `../extension/options.html`, `options.js` | The options page. |
| `cdp.mjs` | Drives a browser through the Chrome DevTools Protocol (CDP). |
| `guard.js` | Prints where focus is. Run it before each test key. |

## Design decisions

### Packaging

- The code is a Chrome MV3 extension. It works in Chrome, Brave, and other Chromium browsers. It started as a Brave custom scriptlet; that form is not supported.
- The content script runs in the page's main world (`"world": "MAIN"`, Chromium 111 or later). This gives direct access to the page DOM and to the router.
- The script runs at `document_start`. It makes no one-time queries at load. All lookups are lazy.
- An idempotent guard (`window.__fixProtonMail`) stops a second copy.
- Each release changes the version in three places: `window.__fixProtonMail`, the console line and toast, and `manifest.json`. The toast tells the user which version is active.

### Key handling

- One capture-phase `keydown` listener on `window` runs before Proton's handlers. It calls `stopImmediatePropagation` for keys it uses.
- The script blocks every unmodified single letter and `*`, also letters it does not use. Proton's own shortcuts act on Proton's own selection, which can differ from our cursor. The extension replaces all of Proton's single-letter shortcuts.
- Keys with Cmd, Ctrl or Alt go to Proton. Exception: Cmd+Up and Cmd+Down in the list.
- `C`, `E` and `o` in the reader go to Proton (`READER_NATIVE`). They act only on the open message.
- The script ignores keys in text fields, during IME composition, and while a dropdown or dialog is open. Esc in a text field blurs it.
- While a composer is open and not minimized (`section.composer` without `.composer--is-minimized`), Proton gets every key. Focus can be on a composer button or an address chip, which is not a text field. Before this rule, letters and Backspace (archive) acted there.
- A closing dropdown has `.is-dropdown-out` and can keep focus in a hidden input. The script does not count it as open.
- The message body is a same-origin iframe. Keys in it do not reach the top window. On window `blur`, the script adds a listener to the iframe document once.

### Modes

The mode comes from where focus is.

- **List:** focus on a row, or nowhere. The cursor is the focused row. The script adds a focus ring, because Proton's rows have `outline-none--at-all`.
- **Reader:** focus in an `article` or the body iframe. Proton swallows arrows, so the script moves itself.
  - The current message is the focused `article`. Proton's `data-hasfocus` does not follow focus, so it is only a fallback.
  - Down and Up scroll 80 px while the current message runs past the pane edge. At its edge, they focus the next or previous message in screen order, and show at least 120 px of it.
  - Page Down and Page Up scroll 90% of the pane, then focus the message at the pane top.
  - Enter and Right expand a collapsed message (click `message-header-collapsed:<n>`) or collapse an expanded one (click `.message-header-from-container`). The class selector is fragile.
  - Enter or Right on the row that is already open moves focus into the reader.
- **List paging:** Page Down and Page Up move the cursor by the rows that fit in the pane, less one. With Shift they select.
- **Sidebar:** focus on a folder link. Arrows move between links. Left in the list goes here, and Right or Enter opens the folder.
  - The links are `a[data-testid^="navigation-link:"]`. This includes custom folders, labels and views. The script skips links to other hosts, for example the folders and labels settings page.
  - The current folder is the link whose path starts the URL. Views have two path segments (`views/newsletters`).
  - After a folder opens, the script waits until the first row id changes. Proton can reuse the row elements, so compare ids, not elements.
  - Proton puts focus back on the link after it renders, so the script waits 300 ms before it focuses the first row.
  - Archive, Trash, Spam and All mail are under "More" and are not in the DOM. Use `g` for them.

### Actions

- Proton is a React app. `checkbox.click()` reaches React state. Do not set `checkbox.checked`.
- Toolbar buttons act on the checked rows. If no rows are checked, they act on the open conversation.
- If no rows are checked, a list action checks the cursor row, clicks the toolbar button, then unchecks the row.
- After an action that moves rows (archive, inbox, spam, trash), the cursor goes to the row at the first moved row's index.
- Delete and Backspace archive. They never trash.
- In the list, `r`, `a`/`R` and `F` act on one conversation: the one checked row, else the cursor row, else the open one. If that conversation is not open, the script opens it first. Proton then marks it as read.

### Navigation

- Folder routes are `/u/<n>/<slug>`. A row's `data-element-id` is the last URL segment.
- If a folder link is not in the DOM, the script calls `history.pushState` and dispatches a `PopStateEvent`. Proton's router follows that.
- A search is the folder path plus `#keyword=...`. Proton's clear button only empties the text, so Esc routes back to the last folder.

### Message order

- An open conversation shows the newest message first. A CSS rule sets `flex-direction: column-reverse` on the div that holds the `article` elements.
- The options page (`options.html`) has one checkbox for this. It saves `newestFirst` in `chrome.storage.sync`.
- `fix-proton-mail.js` runs in the main world and cannot read `chrome.storage`. `settings.js` runs in the isolated world, reads the option, and sets `data-fix-proton-mail-oldest-first` on `<html>`. The CSS rule does not apply when that attribute is present.
- Proton scrolls the pane after it opens a conversation or expands a message. It uses an animation that writes `scrollTop` each frame, plus native scrolls from its focus moves. It measures in DOM order, so in the reversed order it scrolls to the wrong place.
- `holdScroll` fixes this for 1.5 s. It drops Proton's `scrollTop` writes, and it undoes other scrolls. On a conversation open with the top message expanded, it keeps the pane at the top. On expand or collapse, it keeps the message header where it was on the screen.
- A key, wheel or click ends the hold. Keys in the body iframe end it too.
- A short thread does not scroll yet, so the hold finds the pane by its overflow style, not by its content height.
- Only the visual order changes. The DOM order, Tab order and Proton's choice of which message to expand do not change.

### Proton DOM

Captured from the user's inbox in October 2026, column layout. The current selectors are in `SEL`.

```
section[aria-label="Message list"]
  div[data-testid="message-list-loaded"]
    div.item-container[data-shortcut-target="item-container"]     <- the row
        [tabindex="0"] [data-element-id="<id>"]
        [data-shortcut-target-selected]                          <- Proton's own selection flag
        class includes "outline-none--at-all"                    <- kills focus outlines
      label.checkbox-container
        input[type=checkbox][data-testid="item-checkbox"]
      div.item-hover-action-buttons.hidden                       <- per-row hover actions; text only in span.sr-only
```

- The top toolbar buttons are `[data-testid="toolbar:<name>"]`. They show only when a row is checked or a conversation is open.
- Proton has its own shortcut system (`data-shortcut-target`). This extension replaces its single-letter keys. See "Key handling".

### Errors, not fallbacks

- Each selector is in `SEL`. There are no fallback selectors.
- If a selector finds nothing, the key is still consumed and a toast names the selector. The fix is to update `SEL`.
- Fallback selectors hide breakage and can click the wrong element. A clear error is safer.

## Workflow

1. **Recon, read-only.** Inspect the DOM for the feature. Read console messages for errors.
2. **Prototype in the page.** Inject small snippets, one feature at a time. After each one, check the DOM state and take a screenshot. For example, the toolbar shows the selection count, or the row leaves the list.
3. **Consolidate** into `extension/fix-proton-mail.js`. Keep one IIFE, the idempotent guard, and lazy lookups.
4. **Full test.** Reload the tab, load the final file, and run every affected key again.
5. **Hand off.** Tell the user:
   - what changed
   - which selectors are fragile, because they will break if Proton changes its page
   - how to make sure that it loaded (the toast and the console line)

The agent cannot open `chrome://` pages. The user loads, reloads and configures the extension in `chrome://extensions`.

## Development with Chrome

Use Chrome Canary. It has a separate profile, so a test does not touch your normal browser.

1. Quit any earlier debug instance.
2. Start Canary with a debug port, a new profile, and the extension:

   ```
   "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
     --remote-debugging-port=9333 \
     --user-data-dir="$PWD/tmp/canary-profile" \
     --no-first-run --no-default-browser-check \
     --disable-features=DisableLoadExtensionCommandLineSwitch \
     --load-extension="$PWD/extension" \
     https://mail.proton.me
   ```

3. Log in to Proton by hand. An agent must not type the password.
4. Make sure that the debug port answers: `curl -s http://127.0.0.1:9333/json`.
5. Make sure that the script loaded: `node agents/cdp.mjs eval 'window.__fixProtonMail'`.

Chrome Canary 2026-10 ignored `--load-extension`, also with the `--disable-features` flag. If the script did not load, inject it: `node agents/cdp.mjs evalfile extension/fix-proton-mail.js`. The script does not depend on load timing, so the result is the same.

After you change the script, reload the tab and load the script again. When you finish, quit Canary. Keep `tmp/canary-profile`, so the next session stays logged in. `.gitignore` excludes `tmp/`. A running debug instance can stop your normal browser from starting.

## Driving the browser: cdp.mjs

`cdp.mjs` connects to the first `mail.proton.me` tab on port 9333. It uses the global `WebSocket` in Node 22 or later, so it needs no packages.

| Command | CDP method | Use |
|---|---|---|
| `eval '<expr>'` | `Runtime.evaluate` | Read DOM state. Promises are awaited. |
| `evalfile <file>` | `Runtime.evaluate` | Inject a file, for example the script. |
| `key <Key> [shift\|meta]` | `Input.dispatchKeyEvent` | Send a trusted key press. |
| `front` | `Page.bringToFront` | Show the tab. |
| `shot <out.png>` | `Page.captureScreenshot` | Take a screenshot. |
| `reload` | `Page.reload` | Reload the tab. |

Examples:

```
node agents/cdp.mjs front
node agents/cdp.mjs evalfile agents/guard.js     # must print "list" before list keys
node agents/cdp.mjs key ArrowDown
node agents/cdp.mjs key ArrowDown shift
node agents/cdp.mjs shot /tmp/after.png
```

Lessons:

- A hidden tab gets no key events. Run `front` first.
- `Input.dispatchKeyEvent` makes trusted events. Synthetic `KeyboardEvent`s from `eval` do not act the same way in Proton.
- In zsh, an unquoted variable does not split into words. Use `${=var}`, or a shell function.
- If the user uses the same window during a test, their input mixes with the test keys. Run `guard.js` before each key. If it prints `COMPOSER`, stop.

## Safety rules for live tests

- The account holds real mail. Archive is reversible (move back to Inbox, or Proton's undo toast), but before the first archive test, name the messages and get a yes from the user.
- Test on low-value messages that the user names, or in a test folder or label.
- Never trigger Trash, permanent delete, select all, or empty folder.
- Do not send, reply to, or forward mail. Stub the button clicks to test these keys.
- Do not change Proton settings without asking.
- Read only the list and toolbar structure. Do not read message content.
