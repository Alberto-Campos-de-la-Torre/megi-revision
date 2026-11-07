import { chromium } from '../../../node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import {writeFileSync}from'node:fs';
const out=fileURLToPath(new URL('./',import.meta.url));
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844},locale:'es-MX'});
await page.goto('http://127.0.0.1:8091/chat',{waitUntil:'networkidle'});
const dev=page.getByRole('button',{name:/local dev|desarrollador local/i});if(await dev.count()){await dev.first().click();await page.waitForURL(/revision|home|chat/);await page.goto('http://127.0.0.1:8091/chat',{waitUntil:'domcontentloaded'});}
await page.getByRole('heading',{name:'Soy el agente de MEGI Revisión'}).waitFor();
const chip=page.getByRole('button',{name:'¿Qué consultas tengo pendientes de revisión?',exact:true});await chip.scrollIntoViewIfNeeded();
const hit=()=>chip.evaluate(e=>{const r=e.getBoundingClientRect();const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{rect:{y:r.y,height:r.height},target:target?.className,libre:!!target&&(e===target||e.contains(target))};});
const antes=await hit();await page.screenshot({path:out+'/14-movil-interceptado.png'});
const scrollers=await chip.evaluate(e=>{let a=e.parentElement;const rows=[];while(a){if(a.scrollHeight>a.clientHeight&&getComputedStyle(a).overflowY!=='visible'){rows.push({class:a.className,top:a.scrollTop,scroll:a.scrollHeight,client:a.clientHeight});a.scrollTop+=180;}a=a.parentElement;}return rows;});
const despues=await hit();let clicable=false;try{await chip.click({trial:true,timeout:5000});clicable=true;}catch{}
await page.screenshot({path:out+'/15-movil-desplazado.png'});
const result={fecha:new Date().toISOString(),antes,despues,scrollers,clicableConDesplazamientoAdicional:clicable};writeFileSync(out+'/movil.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));await browser.close();
