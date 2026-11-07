import { chromium } from '../../node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const out=fileURLToPath(new URL('./',import.meta.url));
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1400,height:950},locale:'es-MX'});const checks=[],observaciones=[];
const check=(id,ok,detail)=>{checks.push({id,passed:!!ok,...(detail===undefined?{}:{detail})});console.log((ok?'PASS ':'FAIL ')+id);};
const photo=n=>page.screenshot({path:out+'/'+n+'.png',fullPage:true});
try{
 await page.goto('http://127.0.0.1:8091/revision',{waitUntil:'networkidle'});
 const dev=page.getByRole('button',{name:/local dev|desarrollador local/i});if(await dev.count()){await dev.first().click();await page.waitForURL(/revision|home/);}
 await page.goto('http://127.0.0.1:8091/chat',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Soy el agente de MEGI Revisión'}).waitFor();
 await page.setViewportSize({width:390,height:844});
 for(const [i,text]of ['¿Qué consultas tengo pendientes de revisión?','Prepara el plan de la primera consulta pendiente','Explícame cómo trabajas y qué decisiones quedan en mis manos'].entries()){
 const chip=page.getByRole('button',{name:text,exact:true});
 try{await chip.click({trial:true,timeout:5000});check('sugerencia-'+(i+1)+'-clicable-en-movil',true);}catch(e){check('sugerencia-'+(i+1)+'-clicable-en-movil',false,e.message.slice(0,1400));}
 }
 await photo('09-chat-movil-final');
 await page.setViewportSize({width:1400,height:950});
 await page.evaluate(()=>document.documentElement.classList.add('dark'));
 const label=page.locator('.bienvenida-agente__seccion');
 observaciones.push({id:'para-empezar-oscuro',...await label.evaluate(e=>({text:getComputedStyle(e).color,background:getComputedStyle(document.body).backgroundColor}))});
 await photo('10-chat-oscuro');
 await page.evaluate(()=>document.documentElement.classList.remove('dark'));
 await page.goto('http://127.0.0.1:8091/revision/demo-c4',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Plan en blanco',exact:true}).waitFor({timeout:30000});
 const abrir=page.locator('header[data-mobile-app-bar] button[aria-pressed="false"]');if(await abrir.count())await abrir.first().click();
 await page.getByRole('button',{name:'Ayúdame con esta revisión',exact:true}).waitFor({state:'visible',timeout:15000});
 const sugerencia=page.getByRole('button',{name:'Ayúdame con esta revisión',exact:true});
 observaciones.push({id:'contraste-sugerencia-inspector',...await sugerencia.evaluate(e=>({text:getComputedStyle(e).color,font:getComputedStyle(e).fontSize,ancestors:[e,...(function*(n){while(n.parentElement){n=n.parentElement;yield n;}})(e)].map(n=>({tag:n.tagName,cls:n.className,bg:getComputedStyle(n).backgroundColor,color:getComputedStyle(n).color})).filter(n=>n.bg!=='rgba(0, 0, 0, 0)')}))});
 await photo('11-inspector-claro');
 await page.getByRole('button',{name:'Plan en blanco',exact:true}).click();
 await page.getByRole('button',{name:/Aprobar y exportar/}).waitFor();
 await page.getByLabel('Fármaco',{exact:true}).fill('Paracetamol');await page.getByLabel('Dosis',{exact:true}).fill('500 mg');await page.getByLabel('Frecuencia',{exact:true}).fill('cada 8 h');await page.getByLabel('Duración',{exact:true}).fill('3 días');await page.getByRole('button',{name:'Añadir',exact:true}).click();
 await page.getByText('Sin alertas detectadas',{exact:true}).first().waitFor();
 const line=page.locator('li[data-linea-id]',{hasText:'Paracetamol'}).first();await line.getByRole('button',{name:'Bloquear',exact:true}).click();await line.getByText('Bloqueada por el médico',{exact:true}).waitFor();check('bloqueo-conservado',await line.getByRole('button',{name:'Editar',exact:true}).count()===0);
 await page.setViewportSize({width:390,height:844});const backdrop=page.locator('.agent-sidebar-backdrop');if(await backdrop.isVisible())await backdrop.click({position:{x:10,y:400}});
 check('tablero-movil-sin-overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await photo('12-tablero-movil');
 await page.setViewportSize({width:1400,height:950});await page.getByRole('button',{name:/Aprobar y exportar/}).click();await page.getByText('Aprobar y exportar a MEGI',{exact:true}).waitFor();await page.getByRole('button',{name:/^Aprobar y exportar$/}).last().click();await page.getByText('Aprobado y exportado',{exact:true}).first().waitFor({timeout:30000});await page.getByRole('tab',{name:'Exportación',exact:true}).click();await page.getByText(/sha256:/).first().waitFor();check('aprobacion-exportacion-conservadas',await page.getByText(/MedicationRequest/).count()>0);await photo('13-exportacion');
}catch(e){check('excepcion',false,e.message);await photo('error-seguimiento').catch(()=>{});}
await browser.close();
writeFileSync(out+'/seguimiento.json',JSON.stringify({fecha:new Date().toISOString(),checks,observaciones,nota:'Sustituye la espera networkidle de la navegación posterior al chat por domcontentloaded y espera del control visible; conserva resultados anteriores.'},null,2)+'\n');console.log(JSON.stringify({checks,observaciones},null,2));process.exitCode=checks.some(c=>!c.passed)?1:0;
