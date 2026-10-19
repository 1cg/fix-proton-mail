# Proton Mail Keyboard

A Chrome extension that adds keyboard triage to the Proton Mail web app (`mail.proton.me`). It works in Chrome, Brave, and other Chromium browsers (version 111 or later).

This repository is a public resource. Issues and pull requests are off.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` (Brave: `brave://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the `extension` folder.
5. Reload Proton Mail. A "proton-kbd v5 active" toast shows.

## Keys

Press `?` in Proton Mail for the full list. The keys do not work in text fields or in the composer.

| Key | Action |
|---|---|
| `Up` `Down` `j` `k` | Move the cursor (list); scroll (reader) |
| `Shift+Up` `Shift+Down` `J` `K` | Select a range (list); next or previous conversation (reader) |
| `x` `Space` | Check the cursor row |
| `Enter` `Right` | Open the cursor row |
| `Left` | Go to the folder sidebar (list); go back to the list (reader) |
| `Up` `Down` then `Enter` or `Right` | In the sidebar: move between folders, then open one |
| `Esc` | Clear the selection, leave search, or go back to the list |
| `Delete` `Backspace` | Archive |
| `r` / `a` `R` / `F` | Reply / reply all / forward |
| `u` `*` `l` `m` | Read or unread, star, label, move |
| `i` `s` `t` | Move to Inbox, Spam, Trash |
| `g` then a letter | Go to a folder (`i` `a` `e` `*` `d` `t` `s` `m`) |
| `n` `/` `v` | New message, search, filter menu |
| `U` `A` | Show unread, show all |
| `f` | Link hints |

## When Proton changes its page

All selectors are in `SEL` at the top of `extension/proton-kbd.js`. If a selector finds nothing, a toast names it. Update that entry.

## License

0BSD. See `LICENSE`.
