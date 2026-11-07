// Comprobaciones adicionales a las del auditor: inspector en modo oscuro y
// sugerencias de bienvenida en un móvil más pequeño (360×640).
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const out = fileURLToPath(new URL('./', import.meta.url));
const lum = (c) => { const [r,g,b] = c.match(/\d+/g).map(Number).map(v => { v/=255; return v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; }); return 0.2126*r+0.7152*g+0.0722*b; };
const ratio = (a,b) => { const la = lum(a), lb = lum(b); return +(((Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05)).toFixed(2)); };
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: 'es-MX' });
const checks = [];
const check = (id, ok, detail) => { checks.push({ id, passed: !!ok, ...(detail === undefined ? {} : { detail }) }); console.log((ok ? 'PASS ' : 'FAIL ') + id, detail ?? ''); };
await page.goto('http://127.0.0.1:8091/revision', { waitUntil: 'networkidle' });
const dev = page.getByRole('button', { name: /local dev|desarrollador local/i }); if (await dev.count()) { await dev.first().click(); await page.waitForURL(/revision/); }
// Inspector, claro y oscuro
await page.goto('http://127.0.0.1:8091/revision/demo-c3', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Plan en blanco', exact: true }).waitFor({ timeout: 30000 });
const abrir = page.locator('header[data-mobile-app-bar] button[aria-pressed="false"], button[aria-label="Toggle agent"][aria-pressed="false"]'); if (await abrir.count()) await abrir.first().click();
const sug = page.getByRole('button', { name: 'Ayúdame con esta revisión', exact: true }); await sug.waitFor({ state: 'visible', timeout: 15000 });
const medir = () => sug.evaluate((e) => { let n = e; let bg = getComputedStyle(n).backgroundColor; while (n && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) { n = n.parentElement; bg = n ? getComputedStyle(n).backgroundColor : 'rgb(255, 255, 255)'; } const vacio = document.querySelector('.agent-sidebar-panel .agent-empty-state, .agent-sidebar-panel [data-agentkit-empty-state]'); return { text: getComputedStyle(e).color, bg, vacio: vacio ? getComputedStyle(vacio).color : null }; });
const claro = await medir(); const rc = ratio(claro.text, claro.bg); check('inspector-claro-contraste>=4.5', rc >= 4.5, { ...claro, ratio: rc });
await page.screenshot({ path: out + '/16-inspector-claro.png' });
await page.evaluate(() => document.documentElement.classList.add('dark')); await page.waitForTimeout(300);
const oscuro = await medir(); const ro = ratio(oscuro.text, oscuro.bg); check('inspector-oscuro-contraste>=4.5', ro >= 4.5, { ...oscuro, ratio: ro });
await page.screenshot({ path: out + '/17-inspector-oscuro.png' });
await page.evaluate(() => document.documentElement.classList.remove('dark'));
// Bienvenida en 360×640: las tres sugerencias clicables (hit-test real)
await page.setViewportSize({ width: 360, height: 640 });
await page.goto('http://127.0.0.1:8091/chat', { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Soy el agente de MEGI Revisión' }).waitFor();
for (const [i, text] of ['¿Qué consultas tengo pendientes de revisión?', 'Prepara el plan de la primera consulta pendiente', 'Explícame cómo trabajas y qué decisiones quedan en mis manos'].entries()) {
  const chip = page.getByRole('button', { name: text, exact: true }); await chip.scrollIntoViewIfNeeded();
  const hit = await chip.evaluate((e) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); return { libre: !!t && (e === t || e.contains(t)), target: (t?.className || '').toString().slice(0, 60), y: Math.round(r.y) }; });
  let clicable = false; try { await chip.click({ trial: true, timeout: 5000 }); clicable = true; } catch {}
  check('sugerencia-' + (i+1) + '-clicable-360x640', hit.libre && clicable, hit);
}
check('chat-360-sin-overflow-horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.screenshot({ path: out + '/18-chat-360.png' });
await browser.close();
writeFileSync(out + '/extra.json', JSON.stringify({ fecha: new Date().toISOString(), checks }, null, 2) + '\n');
process.exitCode = checks.some(c => !c.passed) ? 1 : 0;
