// Prints where focus is: list, reader, COMPOSER, or a tag name. Run it before each test key.
(() => {
  const ae = document.activeElement;
  const composer = document.querySelectorAll('iframe[data-testid="rooster-iframe"]').length;
  const where = ae.closest?.('[data-shortcut-target="item-container"]') ? 'list'
    : ae.closest?.('article, iframe[data-testid="content-iframe"]') ? 'reader' : ae.tagName;
  return composer ? 'COMPOSER' : where;
})()
