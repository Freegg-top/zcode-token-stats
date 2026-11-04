'use strict';

const acorn = require('acorn');

const MARKER = 'data-usage-used';
const PATCH_TEST_ID = 'token-speed-indicator';
const SNAPSHOT_KEY = 'ztSnapshot';
const COMPONENT_NAME = 'ZTP';
const HELPER_PREFIX = 'function ZTN(value)';

function parse(source) {
  return acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
}

function walk(node, parent, visit) {
  if (!node || typeof node !== 'object') return;
  Object.defineProperty(node, 'parent', { value: parent, enumerable: false, configurable: true });
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) for (const child of value) walk(child, node, visit);
    else walk(value, node, visit);
  }
}

function propertyKey(property) {
  if (property?.type !== 'Property' || property.computed) return null;
  return property.key?.name ?? property.key?.value ?? null;
}

function bindingName(pattern) {
  if (!pattern) return null;
  if (pattern.type === 'Identifier') return pattern.name;
  if (pattern.type === 'AssignmentPattern') return bindingName(pattern.left);
  return null;
}

function objectProperty(object, key) {
  if (!object || object.type !== 'ObjectExpression') return null;
  return object.properties.find(property => propertyKey(property) === key) ?? null;
}

function patternProperty(pattern, key) {
  if (!pattern || pattern.type !== 'ObjectPattern') return null;
  return pattern.properties.find(property => propertyKey(property) === key) ?? null;
}

function enclosingFunction(node) {
  let current = node?.parent;
  while (current && !['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(current.type)) {
    current = current.parent;
  }
  return current ?? null;
}

function declarationStart(fn) {
  if (!fn) return null;
  if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') return fn.start;
  if (fn.parent?.type === 'VariableDeclarator' && fn.parent.parent?.type === 'VariableDeclaration') {
    return fn.parent.parent.start;
  }
  return fn.start;
}

function componentName(fn) {
  if (fn?.id?.name) return fn.id.name;
  if (fn?.parent?.type === 'VariableDeclarator' && fn.parent.id?.type === 'Identifier') return fn.parent.id.name;
  return null;
}

function findMarker(ast) {
  const markers = [];
  walk(ast, null, node => {
    if (node.type === 'Literal' && node.value === MARKER) markers.push(node);
    else if (node.type === 'StringLiteral' && node.value === MARKER) markers.push(node);
  });
  return markers;
}

function findAliases(ast, name) {
  const aliases = new Set([name]);
  let changed = true;
  while (changed) {
    changed = false;
    walk(ast, null, node => {
      if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier' || node.init?.type !== 'CallExpression') return;
      if (!(node.init.arguments ?? []).some(argument => argument?.type === 'Identifier' && aliases.has(argument.name))) return;
      if (!aliases.has(node.id.name)) {
        aliases.add(node.id.name);
        changed = true;
      }
    });
  }
  return aliases;
}

function findCallSites(ast, aliases) {
  const calls = [];
  walk(ast, null, node => {
    if (node.type !== 'CallExpression' || node.arguments?.length < 2) return;
    const first = node.arguments[0];
    const props = node.arguments[1];
    if (first?.type !== 'Identifier' || !aliases.has(first.name) || props?.type !== 'ObjectExpression') return;
    if (!objectProperty(props, 'workspacePath') || !objectProperty(props, 'sessionId')) return;
    calls.push(node);
  });
  return calls;
}

function snapshotBinding(call) {
  let current = call.parent;
  while (current) {
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(current.type)) {
      const parameter = current.params?.[0];
      const prop = patternProperty(parameter, 'snapshot');
      const binding = bindingName(prop?.value);
      if (binding) return binding;
    }
    current = current.parent;
  }
  return null;
}

function markerCall(marker) {
  let current = marker;
  while (current) {
    if (current.type === 'CallExpression' && current.arguments?.length >= 2
      && current.arguments[1]?.type === 'ObjectExpression'
      && objectProperty(current.arguments[1], MARKER)) return current;
    current = current.parent;
  }
  return null;
}

function uniqueIdentifier(source, preferred) {
  let name = preferred;
  let index = 2;
  while (new RegExp(`(^|[^\\w$])${name}([^\\w$]|$)`, 'u').test(source)) {
    name = `${preferred}${index++}`;
  }
  return name;
}

function jsxAlias(mount) {
  let callee = mount.callee;
  if (callee?.type === 'SequenceExpression') callee = callee.expressions.at(-1);
  if (callee?.type !== 'MemberExpression' || callee.computed) return null;
  if (!['jsx', 'jsxs', 'jsxDEV'].includes(callee.property?.name)) return null;
  return callee.object?.type === 'Identifier' ? callee.object.name : null;
}

function runtimeAliases(ast) {
  const react = new Set();
  const portal = new Set();
  const services = new Set();
  walk(ast, null, node => {
    if (node.type === 'CallExpression') {
      let callee = node.callee;
      if (callee?.type === 'SequenceExpression') callee = callee.expressions.at(-1);
      if (callee?.type === 'MemberExpression' && !callee.computed
        && ['useState', 'useRef', 'useEffect'].includes(callee.property?.name)
        && callee.object?.type === 'Identifier') react.add(callee.object.name);
      if (callee?.type === 'Identifier' && node.parent?.type === 'VariableDeclarator'
        && node.parent.id?.type === 'ObjectPattern'
        && node.parent.id.properties.some(property => propertyKey(property) === 'zcodeAgentService')) {
        services.add(callee.name);
      }
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property?.name === 'createPortal'
      && node.object?.type === 'Identifier') portal.add(node.object.name);
  });
  const one = (set, label) => {
    if (set.size !== 1) throw new Error(`Expected one ${label} alias, found ${set.size}`);
    return [...set][0];
  };
  return {
    react: one(react, 'React'),
    portal: one(portal, 'ReactDOM portal'),
    services: one(services, 'zcodeAgentService accessor'),
  };
}

/**
 * Locate the composer toolbar component, its insertion sibling array, wrapper
 * aliases, and call sites using stable string/property markers rather than
 * minified identifiers. Throws when the structure is not safely recognized.
 */
function analyze(source) {
  const ast = parse(source);
  const markers = findMarker(ast);
  if (markers.length !== 1) throw new Error(`Expected one ${MARKER} anchor, found ${markers.length}`);
  const marker = markers[0];
  const fn = enclosingFunction(marker);
  if (!fn) throw new Error('Could not find the composer component around the usage marker');
  const param = fn.params?.[0];
  if (param?.type !== 'ObjectPattern') throw new Error('Composer component does not destructure a props object');
  const params = new Map(param.properties.map(property => [propertyKey(property), property]));
  for (const required of ['workspacePath', 'workspaceIdentity', 'sessionId']) {
    if (!params.has(required)) throw new Error(`Composer component is missing the ${required} prop`);
  }
  const mount = markerCall(marker);
  if (!mount) throw new Error('Could not find the JSX call that renders the usage marker');
  const children = mount.parent;
  if (children?.type !== 'ArrayExpression') throw new Error('Usage marker is not a direct child of a JSX children array');
  const name = componentName(fn);
  if (!name) throw new Error('Could not determine the composer component name');
  const jsx = jsxAlias(mount);
  if (!jsx) throw new Error('Could not determine the JSX runtime alias');
  const aliases = { ...runtimeAliases(ast), jsx };
  const aliasesForComponent = findAliases(ast, name);
  const calls = findCallSites(ast, aliasesForComponent);
  if (calls.length === 0) throw new Error('Could not find any composer component call site');
  const callAnchors = calls.map(call => {
    const props = call.arguments[1];
    const snapshot = snapshotBinding(call);
    if (!snapshot) throw new Error('Could not find the snapshot expression passed by the composer call site');
    return { call, props, snapshot };
  });
  return {
    ast,
    fn,
    fnStart: declarationStart(fn),
    componentName: name,
    aliases,
    param,
    params,
    mount,
    children,
    callAnchors,
    markerStart: marker.start,
  };
}

function insertComma(source, objectStart, objectEnd) {
  const beforeClose = source.slice(objectStart, objectEnd - 1).trimEnd();
  return beforeClose.endsWith(',') ? '' : ',';
}

function renderHelper(template, aliases) {
  return template
    .replaceAll('__ZTP_REACT__', () => aliases.react)
    .replaceAll('__ZTP_JSX__', () => aliases.jsx)
    .replaceAll('__ZTP_PORTAL__', () => aliases.portal)
    .replaceAll('__ZTP_SERVICES__', () => aliases.services);
}

function build(source, helperTemplate) {
  if (source.includes(PATCH_TEST_ID)) throw new Error('Token/s patch is already present');
  if (source.includes(HELPER_PREFIX) || source.includes(`function ${COMPONENT_NAME}(`)) {
    throw new Error('Token/s helper names already exist in this bundle');
  }
  const anchor = analyze(source);
  const helper = renderHelper(helperTemplate, anchor.aliases);
  const local = uniqueIdentifier(source, SNAPSHOT_KEY);
  const edits = [];
  const workspace = bindingName(anchor.params.get('workspacePath').value);
  const identity = bindingName(anchor.params.get('workspaceIdentity').value);
  const session = bindingName(anchor.params.get('sessionId').value);
  if (!workspace || !identity || !session) throw new Error('Could not resolve composer prop bindings');
  edits.push({ start: anchor.fnStart, end: anchor.fnStart, text: helper });
  const paramInsert = anchor.param.end - 1;
  edits.push({
    start: paramInsert,
    end: paramInsert,
    text: `${insertComma(source, anchor.param.start, anchor.param.end)}${SNAPSHOT_KEY}:${local}`,
  });
  edits.push({
    start: anchor.mount.end,
    end: anchor.mount.end,
    text: `,(0,$.jsx)(${COMPONENT_NAME},{workspacePath:${workspace},workspaceIdentity:${identity},sessionId:${session},snapshot:${local}})`,
  });
  for (const site of anchor.callAnchors) {
    if (patternProperty(site.props, SNAPSHOT_KEY)) throw new Error('Composer call site already has the snapshot bridge prop');
    edits.push({
      start: site.props.end - 1,
      end: site.props.end - 1,
      text: `${insertComma(source, site.props.start, site.props.end)}${SNAPSHOT_KEY}:${site.snapshot}`,
    });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let text = source;
  let lastStart = Infinity;
  for (const edit of edits) {
    if (edit.end > lastStart) throw new Error('Overlapping automatic patch ranges');
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    lastStart = edit.start;
  }
  const verify = parse(text);
  const markers = findMarker(verify);
  if (markers.length !== 1) throw new Error('Automatic patch verification failed');
  if (!text.includes(PATCH_TEST_ID) || !text.includes(`(0,$.jsx)(${COMPONENT_NAME},`)) {
    throw new Error('Automatic patch markers are missing');
  }
  return { text, anchors: { componentName: anchor.componentName, mount: anchor.mount, calls: anchor.callAnchors.length } };
}

function remove(source) {
  if (!source.includes(PATCH_TEST_ID)) return null;
  const ast = parse(source);
  const markers = findMarker(ast);
  if (markers.length !== 1) return null;
  const fn = enclosingFunction(markers[0]);
  if (!fn) return null;
  const fnStart = declarationStart(fn);
  const helperStart = source.indexOf(HELPER_PREFIX);
  const calls = [];
  walk(ast, null, node => {
    if (node.type === 'CallExpression' && node.arguments?.[0]?.type === 'Identifier'
      && node.arguments[0].name === COMPONENT_NAME) calls.push(node);
  });
  if (helperStart < 0 || helperStart >= fnStart || calls.length !== 1) {
    throw new Error('Cannot safely locate the automatic Token/s patch');
  }
  const edits = [];
  edits.push({ start: helperStart, end: fnStart, text: '' });
  const param = fn.params?.[0];
  const bridge = patternProperty(param, SNAPSHOT_KEY);
  if (bridge) edits.push(removeProperty(source, bridge));
  const ui = calls[0];
  if (ui.parent?.type === 'ArrayExpression') {
    const index = ui.parent.elements.indexOf(ui);
    if (index > 0) {
      edits.push({ start: ui.parent.elements[index - 1].end, end: ui.end, text: '' });
    } else if (source[ui.end] === ',') {
      edits.push({ start: ui.start, end: ui.end + 1, text: '' });
    } else {
      edits.push({ start: ui.start, end: ui.end, text: '' });
    }
  } else {
    edits.push({ start: ui.start, end: ui.end, text: '' });
  }
  walk(ast, null, node => {
    if (node.type !== 'CallExpression' || node.arguments?.length < 2) return;
    const props = node.arguments[1];
    if (props?.type !== 'ObjectExpression') return;
    const bridgeProp = objectProperty(props, SNAPSHOT_KEY);
    if (bridgeProp) edits.push(removeProperty(source, bridgeProp));
  });
  const deduped = [];
  for (const edit of edits) {
    if (!deduped.some(other => other.start === edit.start && other.end === edit.end)) deduped.push(edit);
  }
  deduped.sort((a, b) => b.start - a.start);
  let text = source;
  for (const edit of deduped) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  const verify = parse(text);
  if (text.includes(PATCH_TEST_ID) || findMarker(verify).length !== 1) throw new Error('Automatic patch removal verification failed');
  return text;
}

function removeProperty(source, property) {
  let start = property.start;
  let end = property.end;
  let cursor = start - 1;
  while (cursor >= 0 && /\s/u.test(source[cursor])) cursor--;
  if (source[cursor] === ',') start = cursor;
  else {
    cursor = end;
    while (cursor < source.length && /\s/u.test(source[cursor])) cursor++;
    if (source[cursor] === ',') end = cursor + 1;
  }
  return { start, end, text: '' };
}

module.exports = { analyze, build, remove, parse, MARKER, SNAPSHOT_KEY, COMPONENT_NAME };
