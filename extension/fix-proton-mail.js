// fix-proton-mail v8.3: Proton Mail keyboard enhancements (Chrome MV3 extension, main-world content script)
//
// Replaces Proton's single-key shortcuts. Every unmodified letter (and *) is
// consumed outside text fields, so Proton's own shortcuts never act on its
// own selection, which can differ from this cursor. Modified keys (cmd/ctrl/alt)
// still go to Proton. While a dropdown or dialog is open, Proton gets every key.
// Text fields get every key (Esc blurs them). While a composer is open and not
// minimized, Proton gets every key. The composer body is an iframe this
// script never hooks.
//
// List (focus in the list, or nowhere):
//   ↓ ↑ j k               move cursor            cmd+↓ / cmd+↑   last / first row
//   PgDn PgUp             move a page (shift: select)
//   shift+↓ ↑  J K        range-select from the anchor row
//   x  space              toggle the cursor row's checkbox
//   Enter  →              open cursor row        Esc   clear selection, then leave search
//   ←                     go to the folder sidebar
//   Del / ⌫               archive
//   r / a R / F           reply / reply all / forward the one selected conversation
//                         (the one checked row, else the cursor row, else the open one)
// Reader (focus in an open message or its body iframe):
//   ↓ ↑ j k               scroll the message; at its edge, go to the next / previous message
//   PgDn PgUp             scroll a page          Enter →  expand / collapse the message
//   J / K                 open next / previous conversation
//   r                     reply                  a  R    reply all
//   F                     forward                Esc ←   back to the list
//   Del / ⌫               archive the open conversation
//   C  E  o               Proton native: remote content, embedded images, original
// Folder sidebar (focus on a folder link):
//   ↓ ↑ j k               move between folders   Enter →  open the folder, focus its list
//   Esc                   back to the list
// Actions (checked rows, else the open conversation (reader) or cursor row (list)):
//   u    toggle read / unread     *  star        l  label as      m  move to
//   i    move to Inbox            s  spam        t  trash
// Anywhere:
//   g then i a e * d t s m   go to Inbox, Archive, Sent, Starred, Drafts, Trash, Spam, All mail
//   n   new message      /   search       U / A   show unread / all     v   filter menu
//   f   link hints       ?   help         Esc in a text field: blur it
//
// Proton DOM assumptions (verified Oct 2026, column layout). All selectors are in
// SEL. There are no fallbacks: if a selector finds nothing, the key is still
// consumed and a toast names the selector. If Proton ships a redesign, update SEL.
//   - checkbox.click() reaches React; the toolbar then acts on the checked rows
//   - toolbar buttons act on checked rows, else on the open conversation
//   - a row's data-element-id equals the conversation id at the end of the URL
//   - the message body is a same-origin iframe
//   - a conversation's articles share one parent div (CSS shows them newest first)
//   - an article has data-expanded="true" when it is open; its collapsed header
//     expands on click, and .message-header-from-container collapses it
//   - Proton's data-hasfocus does not follow focus
//   - folder routes are /u/<n>/<slug>, and the router follows history.pushState + popstate
(() => {
  if (window.top !== window || window.__fixProtonMail) return;
  window.__fixProtonMail = 'v8.3';

  const SEL = {
    row: '[data-shortcut-target="item-container"]',
    checkbox: 'input[data-testid="item-checkbox"]',
    star: '[data-testid^="item-star-"]',
    article: 'article[data-shortcut-target="message-container"]',
    expandHeader: '[data-testid^="message-header-collapsed:"]',   // click to expand
    collapseHeader: '.message-header-from-container',             // click to collapse
    bodyFrame: 'iframe[data-testid="content-iframe"]',
    reply: '[data-testid="message-view:reply"]',
    replyAll: '[data-testid="message-view:reply-all"]',
    forward: '[data-testid="message-view:forward"]',
    search: 'input[data-testid="search-keyword"]',
    composer: 'section.composer',   // minimized: .composer--is-minimized
    compose: '[data-testid="sidebar:compose"]',
    unreadFilter: '[data-testid="filter-dropdown:show-unread"]',
    filters: '[data-testid="filter-dropdown:show-filters"]',
    popup: '[role="dialog"], .dropdown',
    // toolbar buttons: movetoarchive, movetoinbox, movetospam, movetotrash,
    // unread, read, labelas, moveto
    toolbar: (name) => `[data-testid="toolbar:${name}"]`,
    navLink: (slug) => `a[data-testid="navigation-link:${slug}"]`,
    navAny: 'a[data-testid^="navigation-link:"]',
  };
  const FOLDERS = { i: 'inbox', a: 'archive', e: 'sent', '*': 'starred', d: 'drafts',
    t: 'trash', s: 'spam', m: 'all-mail' };
  const READER_NATIVE = new Set(['C', 'E', 'o']);   // act on the open message only

  // ---- load indicator: console line + 3s toast --------------------------
  console.info('[fix-proton-mail] loaded v8.3');
  const toast = (msg, ms = 3000) => {
    const show = () => {
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText =
        'position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:6px 10px;' +
        'background:#6d4aff;color:#fff;font:12px/1.4 ui-monospace,Menlo,monospace;border-radius:6px;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none;white-space:pre';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), ms);
    };
    document.body ? show() : addEventListener('DOMContentLoaded', show, { once: true });
  };
  toast('fix-proton-mail v8.3 active (? for help)');

  // report a missing element; returns true so the caller still consumes the key
  const fail = (name, sel) => {
    console.warn(`[fix-proton-mail] ${name} not found: ${sel}`);
    toast(`fix-proton-mail: ${name} not found\n${sel}\nNot available here, or Proton changed its page (update SEL).`, 6000);
    return true;
  };
  // click one element, or report it missing
  const press = (name, sel, root = document) => {
    const el = root.querySelector(sel);
    if (!el) return fail(name, sel);
    el.click();
    return true;
  };

  // ---- focus ring -------------------------------------------------------
  const ring = document.createElement('style');
  // rows carry .outline-none--at-all, so out-specify it for the cursor row.
  // Show a conversation newest first: reverse its message container. The
  // options page turns this off through an attribute that settings.js sets.
  ring.textContent = `
    html ${SEL.row}:focus, html ${SEL.navAny}:focus, html ${SEL.article}:focus-within{outline:2px solid #6d4aff!important;outline-offset:-2px!important}
    html:not([data-fix-proton-mail-oldest-first]) div:has(> ${SEL.article}){display:flex;flex-direction:column-reverse}`;
  document.documentElement.appendChild(ring);

  // ---- generic helpers --------------------------------------------------
  const isEditable = (el) =>
    !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) &&
    !(el.tagName === 'INPUT' && el.type === 'checkbox');
  const shown = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (test, ms = 2000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (test()) return true;
    return false;
  };
  const inReader = (el) => !!el?.closest?.(`${SEL.article}, ${SEL.bodyFrame}`);
  // any visible dialog or dropdown, even if focus is outside it. A closing one
  // (.is-dropdown-out) stays in the DOM, sometimes with focus in it; ignore it.
  const isOpenPopup = (p) => !!p && !p.classList.contains('is-dropdown-out') && shown(p);
  const popupOpen = (el) =>
    isOpenPopup(el?.closest?.(SEL.popup)) || [...document.querySelectorAll(SEL.popup)].some(isOpenPopup);
  const composerOpen = () => [...document.querySelectorAll(SEL.composer)]
    .some((c) => !c.classList.contains('composer--is-minimized') && shown(c));
  const inClosedPopup = (el) => !!el?.closest?.(SEL.popup) && !isOpenPopup(el.closest(SEL.popup));

  // ---- message list -----------------------------------------------------
  const rows = () => [...document.querySelectorAll(SEL.row)].filter(shown);
  const cb = (r) => r.querySelector(SEL.checkbox);
  const isChecked = (r) => !!cb(r)?.checked;
  const setChecked = (r, v) => { const c = cb(r); if (c && c.checked !== v) c.click(); };
  const openId = () => location.pathname.split('/').pop();
  const openRow = (list) => list.find((r) => r.dataset.elementId === openId());

  let cursor = null;          // last row we focused
  let anchor = null;          // start of a shift-selection
  let shiftSet = new Set();   // rows checked by the current shift-selection

  const resetSelectionState = () => { anchor = null; shiftSet = new Set(); };

  const currentIndex = (list) => {
    const a = document.activeElement?.closest?.(SEL.row);
    let i = a ? list.indexOf(a) : -1;
    if (i < 0 && cursor) i = list.indexOf(cursor);
    return i;
  };

  const focusRow = (r) => {
    r.focus({ preventScroll: true });
    r.scrollIntoView({ block: 'nearest' });
    cursor = r;
  };

  const move = (dir, extend) => {
    const list = rows();
    if (!list.length) return false;
    const i = currentIndex(list);
    const next = i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + dir));

    if (extend) {
      if (!anchor || !list.includes(anchor)) anchor = list[i < 0 ? next : i];
      const a = list.indexOf(anchor);
      const want = new Set(list.slice(Math.min(a, next), Math.max(a, next) + 1));
      for (const r of shiftSet) if (!want.has(r)) setChecked(r, false);
      for (const r of want) setChecked(r, true);
      shiftSet = want;
    } else {
      resetSelectionState();
    }
    focusRow(list[next]);
    return true;
  };

  // rows that fit in the list pane, less one so the old cursor stays in view
  const pageRows = () => {
    const r = rows()[0];
    const sc = r && scroller(r);
    if (!sc) return 10;
    return Math.max(1, Math.floor(sc.clientHeight / r.getBoundingClientRect().height) - 1);
  };

  const jump = (last) => {
    const list = rows();
    if (!list.length) return false;
    resetSelectionState();
    focusRow(last ? list[list.length - 1] : list[0]);
    return true;
  };

  const toggleCursor = () => {
    const list = rows();
    const i = currentIndex(list);
    if (i < 0) return false;
    setChecked(list[i], !isChecked(list[i]));
    return true;
  };

  // Proton's native Esc also clears, but it jumps focus to the first row
  const clearChecks = () => {
    const checked = rows().filter(isChecked);
    if (!checked.length) return false;
    for (const r of checked) setChecked(r, false);
    resetSelectionState();
    return true;
  };

  // open the cursor row; if it is already open, move focus into the reader
  const openCursor = () => {
    const list = rows();
    const i = currentIndex(list);
    if (i < 0) return false;
    const art = list[i] === openRow(list) && currentArticle();
    if (art) art.focus();
    else list[i].click();
    return true;
  };

  // reader J / K: open the next / previous conversation in the list
  const openSibling = (dir) => {
    const list = rows();
    const i = list.indexOf(openRow(list));
    const r = i >= 0 && list[i + dir];
    if (!r) return true;   // at either end: nothing to open
    cursor = r;
    r.click();
    return true;
  };

  // Esc from the reader: put focus back on the open row (or the cursor)
  const backToList = () => {
    const list = rows();
    const r = openRow(list) || (cursor && list.includes(cursor) && cursor) || list[0];
    if (r) focusRow(r);
    return true;
  };

  // ---- actions on the target rows ---------------------------------------
  // Targets: checked rows; else, from the reader, the open conversation;
  // else the cursor row, which gets checked so the toolbar acts on it.
  const targets = (fromReader) => {
    const list = rows();
    const checked = list.filter(isChecked);
    if (checked.length) return { list, rows: checked, auto: false };
    const r = fromReader ? openRow(list) : list[currentIndex(list)];
    return r ? { list, rows: [r], auto: !fromReader } : null;
  };

  const toolbarButton = (names) => {
    for (const n of names) {
      const b = document.querySelector(SEL.toolbar(n));
      if (b && !b.disabled && shown(b)) return b;
    }
    return null;
  };

  // names: toolbar buttons to try in order (read/unread swap with state)
  // moves: the rows leave the list, so put the cursor on the row below them
  const toolbarAction = async (names, fromReader, { moves = false, keepChecked = false } = {}) => {
    const t = targets(fromReader);
    if (!t) return toast('fix-proton-mail: no row to act on');
    if (t.auto) setChecked(t.rows[0], true);
    let b = null;
    await waitFor(() => (b = toolbarButton(names)), 1000);   // toolbar re-renders after a check
    if (!b) return fail(names.join(' / '), names.map(SEL.toolbar).join(', '));
    b.click();
    resetSelectionState();
    if (moves) {
      // the cursor goes to the first row below the last moved row, else to
      // the first moved row's index. Match by id: Proton can reuse row elements.
      const moved = new Set(t.rows.map((r) => r.dataset.elementId));
      const last = Math.max(...t.rows.map((r) => t.list.indexOf(r)));
      const nextId = t.list.slice(last + 1).find((r) => !moved.has(r.dataset.elementId))?.dataset.elementId;
      await waitFor(() => !rows().some((r) => moved.has(r.dataset.elementId)));
      const l = rows();
      const first = Math.min(...t.rows.map((r) => t.list.indexOf(r)));
      const next = l.find((r) => r.dataset.elementId === nextId) || l[Math.min(first, l.length - 1)];
      if (next) focusRow(next);
    } else if (t.auto && !keepChecked) {
      await sleep(300);
      setChecked(t.rows[0], false);
    }
  };

  const star = (fromReader) => {
    const t = targets(fromReader);
    if (!t) return toast('fix-proton-mail: no row to act on');
    for (const r of t.rows) {
      const b = r.querySelector(SEL.star);
      if (!b) return fail('star', SEL.star);
      b.click();
    }
  };

  // ---- reader -----------------------------------------------------------
  // the message the user is on: the one holding focus, else Proton's focus
  // flag (it does not follow focus), else the last expanded one, else the last one
  const currentArticle = () => {
    const arts = [...document.querySelectorAll(SEL.article)];
    const ae = document.activeElement;
    return arts.find((a) => a.contains(ae)) ||
      arts.find((a) => a.dataset.hasfocus === 'true') ||
      arts.filter((a) => a.dataset.expanded === 'true').pop() || arts.pop();
  };

  const messageButton = (name) => {
    const art = currentArticle();
    if (!art) return fail('article', SEL.article);
    return press(name, SEL[name], art);
  };

  // list r / a / R / F: act on one conversation (the one checked row, else the
  // cursor row, else the one open in the reader); open it first if needed
  const listMessage = async (name) => {
    const list = rows();
    const checked = list.filter(isChecked);
    if (checked.length > 1) return toast('fix-proton-mail: select one message');
    const r = checked[0] || list[currentIndex(list)] || openRow(list);
    if (!r) return toast('fix-proton-mail: select or open a message first');
    const id = r.dataset.elementId;
    if (openId() !== id) {
      r.click();
      if (!await waitFor(() => openId() === id && currentArticle()?.querySelector(SEL[name])))
        return fail(name, SEL[name]);
    }
    messageButton(name);
  };

  // the nearest ancestor that can scroll; with now, only one that has
  // content to scroll at the moment
  const scroller = (el, now = true) => {
    while (el && !((!now || el.scrollHeight > el.clientHeight) && /auto|scroll/.test(getComputedStyle(el).overflowY)))
      el = el.parentElement;
    return el;
  };

  // Proton swallows arrows in the message view, so move ourselves.
  // ↓ / ↑ scroll while the current message runs past the pane edge; at its
  // edge they move focus to the next / previous message in screen order.
  const STEP = 80, PEEK = 120;   // px per key; px of a new message to show
  const articlesOnScreen = () => [...document.querySelectorAll(SEL.article)]
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const stepReader = (dir) => {
    const art = currentArticle();
    const sc = scroller(art);
    if (!art) return true;
    const pane = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const r = art.getBoundingClientRect();
    const past = dir > 0 ? r.bottom - pane.bottom : pane.top - r.top;
    if (sc && past > 1) { sc.scrollBy({ top: dir * Math.min(STEP, past) }); return true; }
    const arts = articlesOnScreen();
    const next = arts[arts.indexOf(art) + dir];
    // no message beyond: scroll on to the pane edge (the subject is above the top one)
    if (!next) { sc?.scrollBy({ top: dir * STEP }); return true; }
    next.focus({ preventScroll: true });
    const n = next.getBoundingClientRect();
    const show = Math.min(n.height, PEEK);
    const need = dir > 0 ? n.top + show - pane.bottom : pane.top - (n.bottom - show);
    if (sc && need > 0) sc.scrollBy({ top: dir * need });
    return true;
  };

  // Page Up / Page Down: scroll the pane by most of its height, then focus
  // the message at the top of the pane so ↓ / ↑ go on from there
  const pageReader = (dir) => {
    const sc = scroller(currentArticle());
    if (!sc) return true;
    sc.scrollBy({ top: dir * sc.clientHeight * 0.9, behavior: 'instant' });
    const top = sc.getBoundingClientRect().top + 1;
    const art = articlesOnScreen().find((a) => a.getBoundingClientRect().bottom > top);
    art?.focus({ preventScroll: true });
    return true;
  };

  // Enter / →: expand or collapse the current message
  const toggleMessage = () => {
    const art = currentArticle();
    if (!art) return fail('article', SEL.article);
    const expanded = art.dataset.expanded === 'true';
    const sc = scroller(art, false);   // a short thread does not scroll yet
    // keep the header where it is on screen, but not above the pane top
    if (sc) holdScroll(sc, art, Math.max(0, art.getBoundingClientRect().top - sc.getBoundingClientRect().top));
    press(expanded ? 'collapse' : 'expand', expanded ? SEL.collapseHeader : SEL.expandHeader, art);
    art.focus({ preventScroll: true });
    return true;
  };

  // Proton scrolls the pane after it opens a conversation or expands a
  // message: an animation that writes scrollTop each frame, plus native
  // scrolls from its focus moves. It measures in DOM order, so in the
  // reversed order it scrolls to the wrong place. holdScroll keeps el's top
  // at a fixed offset from the pane top (el null: keep the pane at the top)
  // for 1.5 s. It drops Proton's writes and undoes other scrolls. A key,
  // wheel or click ends the hold, so the user can scroll at once.
  let userAt = 0;
  for (const ev of ['keydown', 'wheel', 'pointerdown']) addEventListener(ev, () => { userAt = Date.now(); }, true);
  const realScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  let holdId = 0;
  const holdScroll = async (sc, el = null, offset = 0) => {
    const id = ++holdId, start = Date.now(), path = location.pathname;
    const active = () => id === holdId && Date.now() - start < 1500 &&
      location.pathname === path && userAt <= start;
    const get = () => realScrollTop.get.call(sc);
    const want = () => Math.max(0, el
      ? get() + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - offset : 0);
    Object.defineProperty(sc, 'scrollTop', {
      configurable: true,
      get,
      set(v) { if (!active()) realScrollTop.set.call(this, v); },
    });
    for (; active(); await sleep(30)) {
      const w = want();
      if (Math.abs(get() - w) > 1) realScrollTop.set.call(sc, w);
    }
    if (id === holdId) delete sc.scrollTop;
  };

  // a conversation opened with its top message expanded: show the subject
  const keepTop = async (path) => {
    const start = Date.now();
    while (Date.now() - start < 1500 && location.pathname === path) {
      const arts = [...document.querySelectorAll(SEL.article)];
      const open = arts.find((a) => a.dataset.expanded === 'true');
      if (arts.length > 1 && open) {
        const top = arts.reduce((a, b) => (b.getBoundingClientRect().top < a.getBoundingClientRect().top ? b : a));
        if (top !== open) return;   // Proton expanded a lower message: keep its scroll
        const sc = scroller(top);
        if (sc) return holdScroll(sc);
      }
      await sleep(20);
    }
  };
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    keepTop(lastPath);
  }, 50);

  // ---- global -----------------------------------------------------------
  const focusSearch = () => {
    const s = document.querySelector(SEL.search);
    if (!s) return fail('search', SEL.search);
    s.focus();
    return true;
  };

  // Search is the folder URL plus #keyword=...; Proton's clear button only
  // empties the text, so leave search by routing back to the last folder.
  const inSearch = () => /keyword=/.test(location.hash);
  let lastFolder = null;
  const noteFolder = () => { if (!inSearch()) lastFolder = location.pathname; };
  noteFolder();
  for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, noteFolder, true);

  // list Esc: first clear the selection, then leave the search view
  const listEscape = () => {
    if (clearChecks()) return true;
    if (!inSearch()) return false;
    resetSelectionState();
    cursor = null;
    const base = location.pathname.match(/^\/u\/\d+/)?.[0] ?? '';
    history.pushState({}, '', lastFolder || `${base}/inbox`);
    dispatchEvent(new PopStateEvent('popstate'));
    document.activeElement?.blur?.();
    return true;
  };

  const showUnread = (on) => {
    const b = document.querySelector(SEL.unreadFilter);
    if (!b) return fail('unreadFilter', SEL.unreadFilter);
    if ((b.getAttribute('aria-pressed') === 'true') !== on) b.click();
    return true;
  };

  const goFolder = (slug) => {
    resetSelectionState();
    cursor = null;
    const link = document.querySelector(SEL.navLink(slug));
    if (link) return link.click();
    // folders under "More" are not in the DOM; use the router directly
    const base = location.pathname.match(/^\/u\/\d+/)?.[0] ?? '';
    history.pushState({}, '', `${base}/${slug}`);
    dispatchEvent(new PopStateEvent('popstate'));
  };
  let gAt = 0;   // time of a pending "g" prefix

  // ---- folder sidebar ---------------------------------------------------
  // skip links to other hosts (the folders and labels settings page)
  const navLinks = () => [...document.querySelectorAll(SEL.navAny)]
    .filter((a) => a.host === location.host && shown(a));
  // the link is the current folder; paths can have two segments (views/newsletters)
  const isCurrent = (a) => location.pathname === a.pathname || location.pathname.startsWith(a.pathname + '/');

  const focusSidebar = () => {
    const links = navLinks();
    if (!links.length) return fail('folder links', SEL.navAny);
    (links.find(isCurrent) || links[0]).focus();
    return true;
  };

  const moveSidebar = (ae, dir) => {
    const links = navLinks();
    const i = links.indexOf(ae.closest(SEL.navAny));
    links[Math.min(links.length - 1, Math.max(0, i + dir))]?.focus();
    return true;
  };

  // open the focused folder, then put the cursor on its first row
  const openSidebar = async (ae) => {
    const link = ae.closest(SEL.navAny);
    const first = rows()[0]?.dataset.elementId;   // Proton can reuse the row elements
    resetSelectionState();
    cursor = null;
    if (!isCurrent(link)) {
      link.click();
      await waitFor(() => isCurrent(link) && rows()[0] && rows()[0].dataset.elementId !== first);
      await sleep(300);   // Proton puts focus back on the link after it renders
    }
    const l = rows();
    if (l.length) focusRow(l[0]);
  };

  const HELP = `fix-proton-mail v8.3
list:    ↑↓ j k  move   PgUp/Dn  page   ⌘↑↓  first/last   shift+↑↓ J K  select range
         x space  toggle   Enter →  open   ←  folders   Esc  clear / leave search
         Del/⌫  archive
         r  reply   a R  reply all   F  forward   (checked row, else cursor row)
reader:  ↑↓ j k  scroll, then next/prev message   PgUp/Dn  page   Enter →  expand/collapse
         J K  next/prev conversation   r  reply   a R  reply all
         F  forward   Esc ←  back to list   Del/⌫  archive   C E o  native
folders: ↑↓ j k  move   Enter →  open   Esc  back to list
actions: u  read/unread   *  star   l  label   m  move   i  inbox
         s  spam   t  trash
go:      g + i a e * d t s m   (inbox archive sent starred drafts trash spam all)
any:     n  new   /  search   U A  unread/all   v  filter   f  hints   ?  help`;

  // ---- link hints -------------------------------------------------------
  const ALPHABET = 'asdfghjklqwertyuiopzxcvbnm';
  const CLICKABLE = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=menuitem]', '[role=tab]', '[role=checkbox]',
    '[role=option]', '[role=treeitem]', '[tabindex]:not([tabindex="-1"])', SEL.row,
  ].join(',');

  const hintable = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      return false;
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    return !!top && (top === el || el.contains(top) || top.contains(el));
  };

  const makeLabels = (count) => {
    const n = ALPHABET.length;
    const len = Math.max(1, Math.ceil(Math.log(count) / Math.log(n)));
    return Array.from({ length: count }, (_, i) => {
      let s = '', v = i;
      for (let d = 0; d < len; d++) { s = ALPHABET[v % n] + s; v = Math.floor(v / n); }
      return s;
    });
  };

  let hint = null;

  const endHints = () => {
    if (!hint) return;
    hint.host.remove();
    for (const ev of ['scroll', 'resize', 'mousedown']) window.removeEventListener(ev, endHints, true);
    hint = null;
  };

  const startHints = () => {
    const els = [...document.querySelectorAll(CLICKABLE)].filter(hintable);
    if (!els.length) return;
    const labels = makeLabels(els.length);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    const css = document.createElement('style');
    css.textContent = `
      .h{position:fixed;font:bold 11px/1.4 ui-monospace,Menlo,monospace;text-transform:uppercase;
         background:#ffd94a;color:#000;border:1px solid #b08d00;border-radius:3px;padding:0 3px;
         box-shadow:0 1px 3px rgba(0,0,0,.35)}
      .t{opacity:.35}`;
    root.appendChild(css);
    const hints = els.map((el, i) => {
      const r = el.getBoundingClientRect();
      const node = document.createElement('span');
      node.className = 'h';
      node.style.left = Math.max(0, r.left) + 'px';
      node.style.top = Math.max(0, r.top) + 'px';
      node.textContent = labels[i];
      root.appendChild(node);
      return { el, label: labels[i], node };
    });
    document.documentElement.appendChild(host);
    hint = { host, hints, typed: '' };
    for (const ev of ['scroll', 'resize', 'mousedown']) window.addEventListener(ev, endHints, true);
  };

  const handleHintKey = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') return endHints();
    if (e.key === 'Backspace') hint.typed = hint.typed.slice(0, -1);
    else if (k.length === 1 && ALPHABET.includes(k)) hint.typed += k;
    else return;
    const { typed } = hint;
    let any = false;
    for (const h of hint.hints) {
      const m = h.label.startsWith(typed);
      h.node.style.display = m ? '' : 'none';
      if (m) {
        any = true;
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = typed;
        h.node.replaceChildren(t, h.label.slice(typed.length));
      }
    }
    if (!any) return endHints();
    const exact = hint.hints.find((h) => h.label === typed);
    if (exact) {
      endHints();
      if (isEditable(exact.el)) exact.el.focus();
      else { exact.el.focus({ preventScroll: true }); exact.el.click(); }
    }
  };

  // ---- key dispatch -----------------------------------------------------
  const isSingleKey = (e) => e.key.length === 1 && /[a-z*]/i.test(e.key);

  // ae: the focused element in whichever document got the key
  // returns true if the key is ours, 'pass' to give it to Proton
  const dispatch = (e, ae, reader) => {
    const k = e.key;

    if (e.metaKey && !reader && (k === 'ArrowDown' || k === 'ArrowUp')) return jump(k === 'ArrowDown');
    if (e.ctrlKey || e.metaKey || e.altKey) return false;

    if (gAt && Date.now() - gAt < 1500) {
      gAt = 0;
      const slug = FOLDERS[k === '*' ? k : k.toLowerCase()];
      if (slug) goFolder(slug);
      return true;
    }
    gAt = 0;

    if (ae?.closest?.(SEL.navAny)) {
      switch (k) {
        case 'ArrowDown': case 'j': return moveSidebar(ae, +1);
        case 'ArrowUp':   case 'k': return moveSidebar(ae, -1);
        case 'ArrowRight': case 'Enter': openSidebar(ae); return true;
        case 'Escape': return backToList();
      }
    }

    if (reader) {
      switch (k) {
        case 'ArrowDown': case 'j': return stepReader(+1);
        case 'ArrowUp':   case 'k': return stepReader(-1);
        case 'PageDown': return pageReader(+1);
        case 'PageUp':   return pageReader(-1);
        case 'Enter': case 'ArrowRight': return toggleMessage();
        case 'J': return openSibling(+1);
        case 'K': return openSibling(-1);
        case 'r': return messageButton('reply');
        case 'a': case 'R': return messageButton('replyAll');
        case 'F': return messageButton('forward');
        case 'Escape': case 'ArrowLeft': return backToList();
        case 'Delete': case 'Backspace':
          toolbarAction(['movetoarchive'], true, { moves: true }); return true;
      }
      if (READER_NATIVE.has(k)) return 'pass';
    } else {
      switch (k) {
        case 'ArrowDown': case 'j': return move(+1, e.shiftKey);
        case 'ArrowUp':   case 'k': return move(-1, e.shiftKey);
        case 'PageDown': return move(+pageRows(), e.shiftKey);
        case 'PageUp':   return move(-pageRows(), e.shiftKey);
        case 'J': return move(+1, true);
        case 'K': return move(-1, true);
        case 'x': case ' ': return toggleCursor();
        case 'Escape': return listEscape();
        case 'Enter': case 'ArrowRight': return openCursor();
        case 'ArrowLeft': return focusSidebar();
        case 'F': listMessage('forward'); return true;
        case 'r': listMessage('reply'); return true;
        case 'a': case 'R': listMessage('replyAll'); return true;
        case 'Delete': case 'Backspace':
          toolbarAction(['movetoarchive'], false, { moves: true }); return true;
      }
    }

    // actions: in the reader they target the open conversation
    switch (k) {
      case 'u': toolbarAction(['unread', 'read'], reader); return true;
      case '*': star(reader); return true;
      case 'l': toolbarAction(['labelas'], reader, { keepChecked: true }); return true;
      case 'm': toolbarAction(['moveto'], reader, { keepChecked: true }); return true;
      case 'i': toolbarAction(['movetoinbox'], reader, { moves: true }); return true;
      case 's': toolbarAction(['movetospam'], reader, { moves: true }); return true;
      case 't': toolbarAction(['movetotrash'], reader, { moves: true }); return true;
      case 'g': gAt = Date.now(); return true;
      case 'n': return press('compose', SEL.compose);
      case '/': return focusSearch();
      case 'v': return press('filters', SEL.filters);
      case 'U': return showUnread(true);
      case 'A': return showUnread(false);
      case '?': toast(HELP, 10000); return true;
      case 'f': startHints(); return true;
    }
    return false;
  };

  const onKey = (e, ae, reader) => {
    userAt = Date.now();   // also for keys in the body iframe, which skip window
    if (hint) return handleHintKey(e);
    // while a composer is open, Proton gets every key: focus can be on a
    // composer button or chip, not in a text field
    if (e.isComposing || popupOpen(ae) || composerOpen()) return;

    if (isEditable(ae)) {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
      // after a search, focus stays in the hidden search input: one Esc leaves search
      if (inClosedPopup(ae) && inSearch()) {
        listEscape();
        e.preventDefault(); e.stopImmediatePropagation();
        return;
      }
      setTimeout(() => { if (ae.ownerDocument.activeElement === ae) ae.blur(); }, 0);
      return;
    }
    const r = dispatch(e, ae, reader);
    if (r === 'pass') return;
    // also block every unmodified single letter we did not use (or that found
    // nothing to act on), so no Proton shortcut runs on its own selection
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (r || (plain && isSingleKey(e))) { e.preventDefault(); e.stopImmediatePropagation(); }
  };

  // main listener (capture phase, ahead of Proton's handlers)
  window.addEventListener('keydown', (e) => {
    const ae = document.activeElement;
    onKey(e, ae, inReader(ae));
  }, true);

  // The message body is a same-origin iframe; keys typed there never reach
  // the top window. When focus moves into it, hook its document once.
  const hookBodyFrame = () => {
    const f = document.activeElement;
    if (!f?.matches?.(SEL.bodyFrame)) return;
    let doc;
    try { doc = f.contentDocument; } catch { return; }
    if (!doc || doc.__fixProtonMail) return;
    doc.__fixProtonMail = true;
    doc.addEventListener('keydown', (e) => onKey(e, doc.activeElement, true), true);
  };
  window.addEventListener('blur', () => setTimeout(hookBodyFrame, 0));
})();
