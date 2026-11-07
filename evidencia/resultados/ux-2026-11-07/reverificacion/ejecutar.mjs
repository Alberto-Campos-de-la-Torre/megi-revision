import { chromium } from '../../../node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import { mkdirSync,writeFileSync } from 'node:fs';
const out=fileURLToPath(new URL('./',import.meta.url));mkdirSync(out,{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1400,height:950},locale:'es-MX'});const checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(id,passed,detail)=>{checks.push({id,passed:!!passed,...(detail===undefined?{}:{detail})});console.log((passed?'PASS ':'FAIL ')+id);};
const photo=n=>page.screenshot({path:out+'/'+n+'.png',fullPage:true});
const ratio=(a,b)=>{const lum=s=>{const n=(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number).map(v=>v/255);return n.reduce((s,v,i)=>s+[.2126,.7152,.0722][i]*(v<=.04045?v/12.92:((v+.055)/1.055)**2.4),0)};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
try{
 await page.goto('http://localhost:8082/chat',{waitUntil:'domcontentloaded'});
 const dev=page.getByRole('button',{name:/local dev|desarrollador local/i});
 await Promise.race([dev.first().waitFor({timeout:20000}),page.getByRole('heading',{name:'Soy el agente de MEGI Revisión'}).waitFor({timeout:20000})]).catch(()=>{});
 if(await dev.count()){await dev.first().click();await page.waitForURL(/revision|home|chat/);await page.goto('http://localhost:8082/chat',{waitUntil:'domcontentloaded'});}
 await page.getByRole('heading',{name:'Soy el agente de MEGI Revisión'}).waitFor({timeout:30000});
 for(const [w,h] of [[390,844],[360,640]]){
  await page.setViewportSize({width:w,height:h});
  for(const [i,text]of ['¿Qué consultas tengo pendientes de revisión?','Prepara el plan de la primera consulta pendiente','Explícame cómo trabajas y qué decisiones quedan en mis manos'].entries()){
   const chip=page.getByRole('button',{name:text,exact:true});let ok=true,msg;
   try{await chip.click({trial:true,timeout:5000});}catch(e){ok=false;msg=e.message.slice(0,600);}
   const libre=await chip.evaluate(e=>{const r=e.getBoundingClientRect(),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!p&&(e===p||e.contains(p));});
   check('UX1-'+w+'-sugerencia-'+(i+1),ok&&libre,msg??{hitTest:libre});
  }
  check('chat-'+w+'-sin-overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await photo('chat-'+w);
 }
 await page.setViewportSize({width:1400,height:950});await page.evaluate(()=>document.documentElement.classList.add('dark'));
 const sec=await page.locator('.bienvenida-agente__seccion').evaluate(e=>({text:getComputedStyle(e).color,bg:getComputedStyle(document.body).backgroundColor}));
 check('UX3-para-empezar-oscuro',ratio(sec.text,sec.bg)>=4.5,{...sec,ratio:ratio(sec.text,sec.bg)});await photo('chat-oscuro');
 await page.evaluate(()=>document.documentElement.classList.remove('dark'));
 await page.goto('http://localhost:8082/revision/demo-c4',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Luis Modelo Simulado',exact:true}).waitFor({timeout:30000});
 const abrir=page.locator('header[data-mobile-app-bar] button[aria-pressed="false"]');if(await abrir.count())await abrir.first().click();
 const button=page.getByRole('button',{name:'Ayúdame con esta revisión',exact:true});await button.waitFor({state:'visible',timeout:20000});
 for(const dark of [false,true]){
  await page.evaluate(v=>document.documentElement.classList.toggle('dark',v),dark);
  await page.waitForTimeout(400);
  const info=await button.evaluate(e=>{let n=e;while(n&&getComputedStyle(n).backgroundColor==='rgba(0, 0, 0, 0)')n=n.parentElement;return{text:getComputedStyle(e).color,bg:getComputedStyle(n??document.body).backgroundColor}});
  check('UX2-inspector-'+(dark?'oscuro':'claro'),ratio(info.text,info.bg)>=4.5,{...info,ratio:ratio(info.text,info.bg)});await photo('inspector-'+(dark?'oscuro':'claro'));
 }
 check('sin-excepciones-javascript',errors.length===0,errors);
}catch(e){check('excepcion',false,e.message);await photo('error').catch(()=>{});}
await browser.close();const result={fecha:new Date().toISOString(),url:'http://localhost:8082',alcance:'Lectura de interfaz en contexto de navegador nuevo, sin enviar mensajes ni modificar planes. Contraste calculado con colores computados, sin afirmar certificación de accesibilidad.',checks};writeFileSync(out+'/resultados.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({pasan:checks.filter(x=>x.passed).length,fallan:checks.filter(x=>!x.passed).length},null,2));process.exitCode=checks.some(x=>!x.passed)?1:0;
