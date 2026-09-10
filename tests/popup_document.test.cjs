const path = require('path');

function createDocument(width, height) {
  let nextId = 0;
  const frames = new Map(), timers = new Map(), listeners = new Map();
  const doc = {
    defaultView: {
      innerWidth: width, innerHeight: height,
      requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; },
      cancelAnimationFrame(id) { frames.delete(id); },
      setTimeout(fn) { const id = ++nextId; timers.set(id, fn); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    frames, timers, listeners,
    flush() {
      for (const queue of [frames, timers]) {
        const callbacks = [...queue.values()]; queue.clear();
        for (const fn of callbacks) fn();
      }
    },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, props = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ preventDefault() {}, stopPropagation() {}, ...props });
    },
    querySelectorAll() { return this.body.children.filter(el => el.className === 'nc-popup'); },
    createElement(tag) {
      const attrs = new Map();
      const element = {
        ownerDocument: doc, children: [], style: {}, className: '',
        rect: { left: 0, top: 0, bottom: 0, width: 180, height: 120 },
        classList: { add() {}, remove() {} },
        setAttribute(name, value) { attrs.set(name, value); },
        getAttribute(name) { return attrs.get(name); },
        setCssStyles(styles) { Object.assign(this.style, styles); },
        addEventListener() {}, scrollIntoView() {},
        createEl(tag) { return this.appendChild(doc.createElement(tag)); },
        getBoundingClientRect() { return this.rect; },
        appendChild(child) { this.children.push(child); child.parent = this; return child; },
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; },
        get firstChild() { return this.children[0]; },
        remove() { this.parent?.removeChild(this); },
        contains(other) { return this === other || this.children.some(child => child.contains(other)); },
      };
      return element;
    },
  };
  doc.body = doc.createElement('body');
  return doc;
}

exports.run = async (t, loadModule) => {
  const { Popup } = await loadModule(path.resolve(__dirname, '../src/ui/popup.ts'));
  const main = createDocument(1400, 1000), popout = createDocument(400, 300);
  const oldDocument = globalThis.activeDocument, oldWindow = globalThis.activeWindow;
  globalThis.activeDocument = main;
  globalThis.activeWindow = { createEl() { throw new Error('Must create in anchor document'); } };
  const popup = new Popup();
  try {
    t.eq(main.body.children.length, 0, 'constructor does not mount into active document');
    const anchor = popout.createElement('button');
    anchor.rect = { left: 370, top: 50, bottom: 80, width: 20, height: 30 };
    let selected = '';
    const items = ['First', 'Second'].map(label => ({ label, onSelect() { selected = label; } }));
    popup.show(anchor, items);
    popout.flush();
    const menu = popout.body.children[0];
    t.ok(menu.ownerDocument === popout, 'menu belongs to trigger document');
    t.eq(main.body.children.length, 0, 'main window remains empty');
    t.eq(menu.style.left, '214px', 'clamps to popout width, not main width');
    t.eq(menu.style.top, '86px', 'positions below trigger in popout');
    t.eq(popout.listeners.get('keydown').size, 1, 'keyboard listener belongs to popout');
    main.fire('keydown', { key: 'Escape' });
    t.ok(popup.isOpen(), 'main window keyboard does not consume popout menu');
    popout.fire('keydown', { key: 'ArrowDown' });
    popout.fire('keydown', { key: 'ArrowDown' });
    popout.fire('keydown', { key: 'Enter' });
    t.eq(selected, 'Second', 'owner document keyboard selects correct option');
    t.eq(anchor.getAttribute('aria-expanded'), 'false', 'selection closes trigger ARIA state');
    t.eq(popout.listeners.get('keydown').size, 0, 'keyboard listener removed from original document');
    t.eq(popout.listeners.get('mousedown').size, 0, 'outside listener removed from original document');

    popup.show(anchor, items);
    popup.hide();
    t.eq(popout.timers.size, 0, 'hide cancels deferred outside listener');
    t.eq(popout.frames.size, 0, 'hide cancels stale positioning frame');
    popout.flush();
    t.eq(popout.listeners.get('mousedown').size, 0, 'no listener leaks after immediate close');

    popup.show(anchor, items);
    popout.flush();
    const mainAnchor = main.createElement('button');
    mainAnchor.rect = { left: 30, top: 300, bottom: 330, width: 20, height: 30 };
    popup.show(mainAnchor, items);
    main.flush();
    t.eq(anchor.getAttribute('aria-expanded'), 'false', 'moving menu clears previous anchor state');
    t.eq(popout.body.children.length, 0, 'moving between documents removes old menu');
    t.eq(popout.listeners.get('mousedown').size, 0, 'moving between documents removes old listeners');
    t.eq(main.body.children[0].style.top, '174px', 'reopened menu uses new anchor coordinates');
    popout.fire('mousedown', { target: popout.body });
    t.ok(popup.isOpen(), 'old document cannot dismiss moved menu');
    main.fire('mousedown', { target: main.body });
    t.ok(!popup.isOpen(), 'outside click in owner document dismisses menu');
    popup.show(anchor, items);
    popup.destroy();
    t.eq(popout.frames.size + popout.timers.size, 0, 'destroy cancels pending callbacks');
    t.eq(popout.body.children.length, 0, 'destroy removes menu');
  } finally {
    popup.destroy();
    globalThis.activeDocument = oldDocument;
    globalThis.activeWindow = oldWindow;
  }
};
