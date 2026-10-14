// Empacota o jogo num único HTML que roda sem servidor (versão de teste para publicar como artefato).
// Uso: npm run build:artifact  →  dist/simulador-teste.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Remove import/export para juntar os módulos num só escopo.
function flatten(source) {
  return source
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+(?=(async\s+)?(function|const|let|class)\b)/gm, '');
}

// Substitui node:crypto pelo gerador do navegador.
const cryptoShim = `
const crypto = {
  randomInt(max) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] % max;
  },
  randomBytes(n) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(n));
    return { toString: () => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') };
  },
};`;

const serverModules = ['src/engine.js', 'src/bots.js', 'src/game.js', 'src/local-api.js'];
const serverCode = `window.LOCAL_API = (() => {
${cryptoShim}
${serverModules.map((f) => `// ---- ${f} ----\n${flatten(read(f))}`).join('\n')}
return createLocalApi();
})();`;

const appCode = read('public/app.js');
const css = read('public/style.css');
const escapeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

const html = `<title>Simulador de Empresas</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
</style>
<div id="app"><p class="loading">Carregando…</p></div>
<div id="toast" role="status" aria-live="polite"></div>
<script>
${escapeScript(serverCode)}
</script>
<script type="module">
${escapeScript(appCode)}
</script>
`;

const out = path.join(ROOT, 'dist', 'simulador-teste.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Gerado ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(0)} KB)`);
