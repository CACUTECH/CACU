// Pull the real lucide-react icon nodes the app uses and emit them as inline SVG strings.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.argv[2], 'node_modules/lucide-react/dist/esm/icons');
const names = ['package', 'briefcase', 'sparkles', 'shopping-cart', 'trending-up', 'wrench', 'activity',
  'receipt', 'plus', 'circle-check', 'search', 'monitor-speaker', 'arrow-left-right', 'users', 'store',
  'banknote', 'calendar-clock', 'calculator', 'mouse-pointer-2', 'notebook-pen', 'sheet', 'message-circle',
  'user-plus', 'file-text'];

const out = {};
for (const name of names) {
  const src = readFileSync(join(dir, `${name}.js`), 'utf8');
  const body = src.match(/const __iconNode = (\[[\s\S]*?\]);\nconst/)[1];
  const nodes = Function(`return ${body}`)();
  out[name] = nodes.map(([tag, attrs]) =>
    `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
}
writeFileSync(process.argv[3], `window.ICONS = ${JSON.stringify(out, null, 1)};\n`);
console.log(`wrote ${Object.keys(out).length} icons`);
