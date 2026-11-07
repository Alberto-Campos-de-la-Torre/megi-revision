// Requiere app mock en :8091 con DATABASE_URL=pglite:/tmp/megi-audit-20261106 y base nueva.
// Crea y exporta únicamente el caso ficticio demo-c4 de esa instancia.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
const out=fileURLToPath(new URL('./resultados/auditoria-independiente-ui', import.meta.url));
mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'es-MX'});
const checks=[];
const check=(id,ok)=>{checks.push({id,passed:!!ok});if(!ok)throw new Error(id);};
try {
 await page.goto('http://localhost:8091/revision',{waitUntil:'networkidle'});
 const dev=page.getByRole('button',{name:/local dev|desarrollador local/i});
 if(await dev.count()){await dev.first().click();await page.waitForURL(/revision|home/);await page.goto('http://localhost:8091/revision',{waitUntil:'networkidle'});}
 await page.getByRole('link',{name:/Luis Modelo Simulado/}).waitFor({timeout:30000});
 check('cuatro-consultas-ficticias',(await page.locator('main ul > li').count())===4);
 await page.screenshot({path:out+'/lista.png',fullPage:true});
 await page.getByRole('link',{name:/Luis Modelo Simulado/}).click();
 await page.getByRole('button',{name:'Plan en blanco',exact:true}).click();
 await page.getByRole('button',{name:/Aprobar y exportar/}).waitFor();
 await page.getByLabel('Fármaco',{exact:true}).fill('Paracetamol');
 await page.getByLabel('Dosis',{exact:true}).fill('500 mg');
 await page.getByLabel('Frecuencia',{exact:true}).fill('cada 8 h');
 await page.getByLabel('Duración',{exact:true}).fill('3 días');
 await page.getByRole('button',{name:'Añadir',exact:true}).click();
 await page.getByText('Sin alertas detectadas',{exact:true}).first().waitFor();
 check('edicion-manual-verificada',true);
 await page.screenshot({path:out+'/plan.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 check('movil-sin-overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:out+'/movil.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:/Aprobar y exportar/}).click();
 await page.getByText('Aprobar y exportar a MEGI',{exact:true}).waitFor();
 await page.getByRole('button',{name:/^Aprobar y exportar$/}).last().click();
 await page.getByText('Aprobado y exportado',{exact:true}).first().waitFor({timeout:30000});
 check('aprobacion-y-cierre',true);
 await page.getByRole('tab',{name:'Exportación',exact:true}).click();
 await page.getByText(/sha256:/).first().waitFor();
 check('fhir-y-sello',await page.getByText(/MedicationRequest/).count()>0);
 await page.screenshot({path:out+'/exportacion.png',fullPage:true});
 await page.goto('http://localhost:8091/revision',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Exportadas',exact:true}).click();
 await page.getByRole('link',{name:/Luis Modelo Simulado/}).waitFor();
 check('archivo-exportadas',true);
} catch(e) {checks.push({id:'error',passed:false,detail:e.message});await page.screenshot({path:out+'/error.png',fullPage:true}).catch(()=>{});}
await browser.close();
const result={fecha:new Date().toISOString(),url:'http://localhost:8091',entorno:'PGlite temporal /tmp/megi-audit-20261106, adaptador mock, pacientes ficticios, sin invocar al modelo',checks};
writeFileSync(out+'/resultados.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
process.exitCode=checks.some(c=>!c.passed)?1:0;
