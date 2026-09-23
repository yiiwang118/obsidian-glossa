const path = require('path');

function makeDocument() {
  const doc = {
    createElementNS(namespaceURI, localName) {
      return {
        nodeType: 1, ownerDocument: doc, localName, namespaceURI, attributes: [], childNodes: [],
        getAttribute(name) { return this.attributes.find(attr => attr.name === name)?.value ?? null; },
        setAttribute(name, value) { this.setAttributeNS(null, name, value); },
        setAttributeNS(ns, name, value) {
          this.attributes = this.attributes.filter(attr => attr.name !== name);
          this.attributes.push({ name, localName: name.split(':').pop(), value, namespaceURI: ns });
        },
        appendChild(node) { this.childNodes.push(node); },
        removeChild(node) { this.childNodes.splice(this.childNodes.indexOf(node), 1); },
        get firstChild() { return this.childNodes[0]; },
        querySelectorAll() {
          return this.childNodes.flatMap(child => child.nodeType === 1
            ? [...(child.getAttribute('id') ? [child] : []), ...child.querySelectorAll()]
            : []);
        },
      };
    },
    createTextNode(textContent) { return { nodeType: 3, textContent, ownerDocument: doc }; },
  };
  return doc;
}

exports.run = async (t, loadModule) => {
  const { setTrustedSvg } = await loadModule(path.resolve(__dirname, '../src/utils/dom.ts'));
  const oldParser = globalThis.DOMParser, oldDocument = globalThis.activeDocument;
  const sourceDoc = makeDocument(), targetDoc = makeDocument(), otherDoc = makeDocument();
  const source = sourceDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const gradient = sourceDoc.createElementNS(source.namespaceURI, 'linearGradient');
  gradient.setAttribute('id', 'glossa-mark-grad');
  source.appendChild(gradient);
  const group = sourceDoc.createElementNS(source.namespaceURI, 'g');
  group.setAttribute('stroke', 'url(#glossa-mark-grad)');
  group.setAttribute('style', 'fill:url("#glossa-mark-grad")');
  group.setAttribute('href', '#glossa-mark-grad');
  group.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#glossa-mark-grad');
  group.appendChild(sourceDoc.createTextNode('preserved text'));
  source.appendChild(group);
  let parses = 0;
  globalThis.DOMParser = class { parseFromString() { parses++; return { documentElement: source }; } };
  globalThis.activeDocument = { createElementNS() { throw new Error('Must clone in target document'); } };
  try {
    const hidden = targetDoc.createElementNS(null, 'span');
    const action = targetDoc.createElementNS(null, 'span');
    const otherWindow = otherDoc.createElementNS(null, 'span');
    for (const target of [hidden, action, otherWindow]) setTrustedSvg(target, 'fixture SVG');
    const getId = target => target.firstChild.childNodes[0].getAttribute('id');
    const hiddenId = getId(hidden), actionId = getId(action), otherId = getId(otherWindow);
    t.eq(parses, 1, 'trusted source is parsed once');
    t.eq(new Set([hiddenId, actionId, otherId]).size, 3, 'every render owns distinct IDs including other documents');
    for (const target of [hidden, action, otherWindow]) {
      const svg = target.firstChild, paint = svg.childNodes[1], id = getId(target);
      t.ok(svg.ownerDocument === target.ownerDocument, 'SVG belongs to its target document');
      t.ok(paint.ownerDocument === target.ownerDocument, 'descendants belong to target document');
      t.eq(paint.getAttribute('stroke'), `url(#${id})`, 'stroke resolves to own gradient');
      t.eq(paint.getAttribute('style'), `fill:url(#${id})`, 'quoted inline URL resolves to own gradient');
      t.eq(paint.getAttribute('href'), `#${id}`, 'href resolves to own element');
      t.eq(paint.getAttribute('xlink:href'), `#${id}`, 'namespaced href resolves to own element');
      t.eq(paint.attributes.find(attr => attr.name === 'xlink:href').namespaceURI, 'http://www.w3.org/1999/xlink', 'attribute namespace preserved');
      t.ok(paint.firstChild.ownerDocument === target.ownerDocument, 'text belongs to target document');
    }
    hidden.removeChild(hidden.firstChild);
    setTrustedSvg(action, 'fixture SVG');
    t.eq(action.childNodes.length, 1, 'rerender replaces rather than accumulates SVG children');
    t.ok(getId(action) !== actionId, 'remounted action receives a new gradient ID');
    t.eq(action.firstChild.childNodes[1].getAttribute('stroke'), `url(#${getId(action)})`, 'remounted action has no references to removed icons');
    t.eq(gradient.getAttribute('id'), 'glossa-mark-grad', 'cached source remains immutable');
    t.eq(group.getAttribute('stroke'), 'url(#glossa-mark-grad)', 'cached references remain immutable');
  } finally {
    globalThis.DOMParser = oldParser;
    globalThis.activeDocument = oldDocument;
  }
};
