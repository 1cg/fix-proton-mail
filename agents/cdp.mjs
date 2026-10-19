// usage: node cdp.mjs eval '<js expr>' | node cdp.mjs evalfile <file> | node cdp.mjs shot <out.png>
//        node cdp.mjs key <Key> [shift|meta] | node cdp.mjs front | node cdp.mjs reload
// Talks to the first mail.proton.me tab on port 9333. Node 22 or later (global WebSocket).
const [cmd, arg, arg2] = process.argv.slice(2);
const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
const tab = tabs.find((t) => t.type === 'page' && t.url.includes('mail.proton.me'));
if (!tab) { console.error('No mail.proton.me tab found. Open Proton in the debug browser.'); process.exit(1); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const send = (method, params = {}) => new Promise((res, rej) => {
  const my = ++id;
  const on = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== my) return;
    ws.removeEventListener('message', on);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  };
  ws.addEventListener('message', on);
  ws.send(JSON.stringify({ id: my, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const KEYS = {
  ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, Delete: 46, Backspace: 8,
};
try {
  if (cmd === 'eval') console.log(JSON.stringify(await evaluate(arg), null, 2));
  else if (cmd === 'evalfile') {
    const { readFileSync } = await import('node:fs');
    console.log(JSON.stringify(await evaluate(readFileSync(arg, 'utf8')), null, 2));
  } else if (cmd === 'shot') {
    const { writeFileSync } = await import('node:fs');
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(arg, Buffer.from(r.data, 'base64'));
    console.log(arg);
  } else if (cmd === 'key') {
    // real trusted key events, same path as a physical keypress
    const shift = arg2 === 'shift'; const meta = arg2 === 'meta';
    const code = KEYS[arg] ?? arg.toUpperCase().charCodeAt(0);
    const text = arg === 'Enter' ? '\r' : arg.length === 1 ? (shift ? arg.toUpperCase() : arg) : undefined;
    const base = { key: shift && text ? text : arg, windowsVirtualKeyCode: code, modifiers: (shift ? 8 : 0) | (meta ? 4 : 0) };
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    console.log('sent', arg, shift ? '+shift' : '');
  } else if (cmd === 'front') { await send('Page.bringToFront'); console.log('front'); }
  else if (cmd === 'reload') { await send('Page.reload'); console.log('reloaded'); }
  else console.error('Unknown command. Use eval, evalfile, shot, key or reload.');
} finally { ws.close(); }
