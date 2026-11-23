// Translation tooling (development only).
//   node scripts/i18n-extract.mjs wrap    → wraps the French text of the interface in tr() (codemod)
//   node scripts/i18n-extract.mjs check   → lists tr()/trn() keys with no English translation
//   node scripts/i18n-extract.mjs report  → French text not wrapped (to handle by hand)
// Text is found with a real parser (Babel): JSX text, display attributes (title, placeholder,
// aria-label…), label/title/text properties, messages (errors, confirmations, toasts).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SRC = join(root, 'src/renderer/src');
const SKIP_DIRS = ['i18n', 'gfx', 'storage'];
const mode = process.argv[2] ?? 'report';

function files(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.includes(f)) out.push(...files(p));
    } else if (/\.(tsx?|mts)$/.test(f) && !f.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label', 'hint', 'caption', 'sub', 'text', 'tip']);
const PROPS = new Set(['label', 'title', 'text', 'hint', 'desc', 'description', 'caption', 'sub', 'message', 'tip', 'help']);
const CALLS = new Set(['setError', 'confirm', 'alert', 'prompt', 'toastError', 'setNote', 'setMsg', 'setStatus', 'setHint', 'setWarn', 'setInfo', 'setMessage', 'setAttribute', 'fail']);
const ASSIGN = new Set(['textContent', 'title', 'innerText', 'placeholder']);

export function frenchish(s) {
  const x = s.trim();
  if (!/[A-Za-zÀ-ÿ]/.test(x)) return false;
  if (/^(https?:|ct-|#|var\(|\.|\/|data:|blob:)/.test(x)) return false;
  if (/^[a-z0-9_\-.:/#%]+$/.test(x)) return false;
  return /\s/.test(x) || /[À-ÖØ-öø-ÿ’]/.test(x) || /^[A-ZÀ-ÖØ-Ý]/.test(x);
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

/** Climbs through ternaries, ||/&&, parentheses and `as` to the context that uses the string. */
function context(path) {
  let p = path;
  for (;;) {
    const par = p.parentPath;
    if (!par) return null;
    if (par.isConditionalExpression() && p.key !== 'test') p = par;
    else if (par.isLogicalExpression()) p = par;
    else if (par.isTSAsExpression() || par.isParenthesizedExpression() || par.isTSNonNullExpression()) p = par;
    else return { path: p, parent: par };
  }
}

function inTr(path) {
  return !!path.findParent((p) => p.isCallExpression() && p.get('callee').isIdentifier() && ['tr', 'trn', 'trMaybe'].includes(p.node.callee.name));
}

function wanted(path) {
  const c = context(path);
  if (!c) return false;
  const { path: p, parent } = c;
  if (parent.isJSXExpressionContainer()) {
    const gp = parent.parentPath;
    if (gp.isJSXAttribute()) return ATTRS.has(gp.node.name.name);
    return gp.isJSXElement() || gp.isJSXFragment();
  }
  if (parent.isJSXAttribute()) return ATTRS.has(parent.node.name.name);
  if (parent.isObjectProperty() && p.key === 'value') {
    const k = parent.node.key;
    return PROPS.has(k.name ?? k.value);
  }
  if ((parent.isCallExpression() || parent.isNewExpression()) && p.listKey === 'arguments') {
    const cal = parent.node.callee;
    const name = cal.type === 'Identifier' ? cal.name : cal.type === 'MemberExpression' ? cal.property.name : null;
    if (parent.isNewExpression() && name === 'Error') return true;
    if (name === 'setAttribute') return p.key === 1;
    return CALLS.has(name);
  }
  if (parent.isAssignmentExpression() && p.key === 'right') {
    const l = parent.node.left;
    return l.type === 'MemberExpression' && ASSIGN.has(l.property.name);
  }
  return false;
}

/** The dictionary's keys and values, read with the parser (en.ts is TypeScript). */
export function readDict(file) {
  const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript'] });
  const out = {};
  traverse(ast, {
    ObjectProperty(p) {
      const k = p.node.key;
      const key = k.type === 'StringLiteral' ? k.value : k.name;
      if (p.node.value.type === 'StringLiteral') out[key] = p.node.value.value;
    },
  });
  return out;
}

// Run as a command (the tests import readDict without running it).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

function main() {
  const keys = new Map();
  const report = [];
  let changed = 0;

  for (const file of files(SRC)) {
    const code = readFileSync(file, 'utf8');
    let ast;
    try {
      ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: false });
    } catch (e) {
      console.error('parse error', file, e.message);
      continue;
    }
    const edits = [];
    const rel = relative(root, file).split(sep).join('/');
    const line = (n) => code.slice(0, n.start).split('\n').length;
    traverse(ast, {
      CallExpression(path) {
        const c = path.node.callee;
        if (c.type === 'Identifier' && ['tr', 'trn', 'trMaybe'].includes(c.name)) {
          for (const a of path.node.arguments) if (a.type === 'StringLiteral') keys.set(a.value, `${rel}:${line(a)}`);
        }
      },
      JSXText(path) {
        const raw = code.slice(path.node.start, path.node.end);
        if (!frenchish(raw)) return;
        const lead = raw.match(/^\s*/)[0];
        const trail = raw.match(/\s*$/)[0];
        const core = raw.slice(lead.length, raw.length - trail.length);
        const key = core.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
        const sib = path.parentPath.node.children ?? [];
        const fragment = sib.some((s) => s.type === 'JSXExpressionContainer' && s.expression.type !== 'JSXEmptyExpression' && !(s.expression.type === 'CallExpression' && s.expression.callee.name === 'tr'));
        if (raw.includes('&')) return report.push(`${rel}:${line(path.node)}  [entity] ${key}`);
        if (fragment) report.push(`${rel}:${line(path.node)}  [fragment] ${key}`);
        edits.push({ start: path.node.start + lead.length, end: path.node.end - trail.length, text: `{tr(${quote(key)})}` });
        keys.set(key, `${rel}:${line(path.node)}`);
      },
      StringLiteral(path) {
        if (!frenchish(path.node.value) || inTr(path)) return;
        if (path.parentPath.isImportDeclaration() || path.parentPath.isExportNamedDeclaration() || path.parentPath.isTSLiteralType()) return;
        if (wanted(path)) {
          const inAttr = path.parentPath.isJSXAttribute();
          const text = `tr(${quote(path.node.value)})`;
          edits.push({ start: path.node.start, end: path.node.end, text: inAttr ? `{${text}}` : text });
          keys.set(path.node.value, `${rel}:${line(path.node)}`);
        } else if (!path.parentPath.isObjectProperty() || path.key === 'value') {
          const p = path.parentPath;
          if (p.isBinaryExpression() || p.isSwitchCase() || p.isJSXAttribute()) return;
          report.push(`${rel}:${line(path.node)}  [string] ${path.node.value}`);
        }
      },
      TemplateLiteral(path) {
        const txt = path.node.quasis.map((q) => q.value.cooked).join('{}');
        if (frenchish(txt.replace(/\{\}/g, '')) && /[a-zà-ÿ]{3,}\s+[a-zà-ÿ]{2,}|[À-ÿ’]/i.test(txt) && !inTr(path)) report.push(`${rel}:${line(path.node)}  [template] ${txt}`);
      },
    });
    if (mode === 'wrap' && edits.length) {
      edits.sort((a, b) => b.start - a.start);
      let out = code;
      for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
      if (!/import \{[^}]*\btr\b[^}]*\} from '[^']*i18n'/.test(out)) {
        let r = relative(dirname(file), join(SRC, 'i18n')).split(sep).join('/');
        if (!r.startsWith('.')) r = `./${r}`;
        const imports = [...out.matchAll(/^import [\s\S]*?from '[^']+';\n/gm)];
        const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
        out = out.slice(0, at) + `import { tr } from '${r}';\n` + out.slice(at);
      }
      writeFileSync(file, out);
      changed++;
    }
  }

  if (mode === 'wrap') console.log(`wrapped text in ${changed} files, ${keys.size} keys`);
  if (mode === 'report' || mode === 'wrap') {
    writeFileSync(join(root, 'scripts/.i18n-report.txt'), report.join('\n') + '\n');
    console.log(`${report.length} items to check by hand → scripts/.i18n-report.txt`);
  }
  if (mode === 'check' || mode === 'keys') {
    const EN = readDict(join(SRC, 'i18n/en.ts'));
    const miss = [...keys].filter(([k]) => !(k in EN));
    if (mode === 'keys') writeFileSync(join(root, 'scripts/.i18n-missing.json'), JSON.stringify(Object.fromEntries(miss.map(([k, w]) => [k, w])), null, 1));
    console.log(`${keys.size} keys, ${miss.length} without English`);
    for (const [k, w] of miss.slice(0, mode === 'check' ? 400 : 0)) console.log(`  ${w}  ${k}`);
    if (mode === 'check' && miss.length) process.exitCode = 1;
  }
}
