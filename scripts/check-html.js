'use strict';

/**
 * Basit HTML denge kontrolu (gelistirme yardimcisi).
 * Etiketlerin dogru kapanip kapanmadigini ve bozuk etiket olup olmadigini kontrol eder.
 */

const fs = require('fs');
const path = require('path');

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const dir = path.join(__dirname, '..', 'public');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
let errors = 0;

for (const file of files) {
  const html = fs.readFileSync(path.join(dir, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const problems = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let match;

  while ((match = tagRe.exec(html))) {
    const raw = match[0];
    const name = match[1].toLowerCase();
    const selfClosing = /\/>$/.test(raw);
    if (name === '!doctype' || VOID.has(name) || selfClosing) continue;

    if (raw.startsWith('</')) {
      const open = stack.pop();
      if (!open || open.name !== name) {
        problems.push(`beklenmeyen kapanis </${name}> (acik: ${open ? open.name : 'yok'})`);
      }
    } else {
      stack.push({ name, index: match.index });
    }
  }

  if (stack.length) {
    problems.push('kapanmayan etiketler: ' + stack.map((t) => `<${t.name}>`).join(', '));
  }

  // Bozuk etiket ipuclari: metin icinde acilmis ama hic kapanmamis '<' isareti
  const suspicious = html.match(/<[a-zA-Z][^<>]*$/);
  if (suspicious && suspicious.length) {
    problems.push(`bozuk etiket: ${suspicious[0].slice(0, 60)}`);
  }

  if (problems.length) {
    errors += 1;
    console.log(`\n${file}:`);
    problems.forEach((p) => console.log('  - ' + p));
  } else {
    console.log(`${file}: OK`);
  }
}

process.exit(errors ? 1 : 0);
