from pathlib import Path
import json,subprocess,hashlib,datetime
r=Path(__file__).resolve().parents[1];app=r/'megi-revision'
read=lambda p:json.loads((r/p).read_text())
checks=read('evidencia/resultados/verificacion.json')
assert all(x['codigo']==0 for x in checks['resultados'])
ui={n:read(f'evidencia/resultados/{n}.json') for n in ['recorrido','advertencias','agente','demo-final','sugerencias']}
assert all(all(x['pasa'] for x in v['resultados']) and v.get('fallos',0)==0 for v in ui.values())
assert all(x['passed'] for x in read('pruebas-hackathon/revision-trazable-resultados.json')['resultados'])
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=app,text=True).strip()
assert subprocess.check_output(['git','status','--porcelain'],cwd=app,text=True).strip()==''
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
lat=read('evidencia/resultados/latencia.json')
visible=lat['visibleMs']/1000; total=lat['resultados'][0]['ms']/1000
n={k:len(v['resultados']) for k,v in ui.items()}
paths=subprocess.check_output(['git','ls-files','-z'],cwd=app).decode().split('\0')
files={f'megi-revision/{p}':hashlib.sha256((app/p).read_bytes()).hexdigest() for p in paths if p and (app/p).is_file()}
for p in sorted((r/'evidencia').glob('*.mjs')) + sorted((r/'evidencia').glob('*.py')) + [r/'evidencia/auditoria-hackathon.mts',r/'pruebas-hackathon/bateria.mts',r/'pruebas-hackathon/revision-trazable.mts']:
 files[str(p.relative_to(r))]=hashlib.sha256(p.read_bytes()).hexdigest()
auditoria=read('evidencia/resultados/auditoria-para-el-100.json');assert auditoria['pendientes']==[]
comparacion=read('evidencia/resultados/comparacion-modelos.json')['mediciones']
medida=next(x for x in comparacion if x['archivo']=='latencia.json')
modelo=read('evidencia/resultados/configuracion-latencia.json')['modeloFinal']
assert medida['comparacionValida'] and medida['modeloEfectivo']==modelo
assert read('evidencia/resultados/modelos.json')['catalogo']['actual']['model']==modelo
assert read('evidencia/resultados/modelo-app.json')['configuracion']['model']==modelo
assert max(lat['visibleMs'],lat['resultados'][0]['ms']) < 35000
assert not subprocess.check_output(['git','diff','--cached','--name-only'],cwd=r,text=True).strip()
regresiones={}
for name,p,key in [('auditoria_http','evidencia/auditoria-hackathon-resultados.json','results'),('bateria_http','pruebas-hackathon/bateria-resultados.json','resultados'),('revision_trazable','pruebas-hackathon/revision-trazable-resultados.json','resultados')]:
 rows=read(p)[key];tests=[x for x in rows if 'passed' in x];assert all(x['passed'] for x in tests);regresiones[name]=len(tests)
proof={'fecha':now,'app_commit':head,'app_arbol_limpio':True,'codigo_sha256':files,'checks':checks,'regresiones':regresiones,'navegador':{k:{'comprobaciones':n[k],'fallos':v.get('fallos',0),'archivo':f'resultados/{k}.json'} for k,v in ui.items()},'latencia':{'plan_visible_ms':lat['visibleMs'],'turno_completo_ms':lat['resultados'][0]['ms'],'exploratorio':True,'n':1,'objetivo_turno_completo_35s':max(visible,total)<35},'limites':['Plan visible y turno completo son medidas distintas; la serie completa conserva la variabilidad y no acredita una garantía de latencia.','API del modelo medida con spans llm_call, incluyendo red y reintentos; no equivale al cómputo puro del modelo. Las versiones miden operaciones del servidor.','Build local completo; configuración de producción pendiente (secreto de autenticación y Postgres persistente).','Los recorridos conservan avisos conocidos del framework y distinguen la sonda 401 inicial sin sesión.','Datos sintéticos, sin validación clínica, despliegue, GitHub ni Clips.']}
proof['pendientes']=[]
proof['modelo']={'efectivo':modelo,'runId':medida['runId'],'apiMs':medida['apiMs'],'herramientasMs':medida['herramientasMs'],'configuracion':'resultados/configuracion-latencia.json','comparacion':'resultados/comparacion-modelos.json'}
proof['root_index_sin_cambios']=True
proof['auditoria']='resultados/auditoria-para-el-100.json'
proof['limites'].append('El intento solicitado como Qwen ejecutó Grok 4.7; está marcado como comparación inválida y no acredita rendimiento de Qwen.')
proof['evidencia_sha256']={}
for p in [r/'evidencia/resultados/verificacion.json',r/'evidencia/resultados/auditoria-para-el-100.json',r/'evidencia/resultados/latencia.json',r/'evidencia/resultados/comparacion-modelos.json',r/'evidencia/resultados/diagnostico-latencia.json',r/'evidencia/revision-trazable-mcp.json']+[r/f'evidencia/resultados/{name}.json' for name in ui]:
 proof['evidencia_sha256'][str(p.relative_to(r))]=hashlib.sha256(p.read_bytes()).hexdigest()
(r/'evidencia/revision-trazable-validacion.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
nav=read('evidencia/revision-trazable-navegador.json');nav['fecha']=now;nav['app_commit']=head;nav['comprobaciones_correctas']={k:n[k] for k in ui};nav['limites']=proof['limites'];nav['modelo_efectivo']=modelo;nav['objetivo_35s_verificado']=True;(r/'evidencia/revision-trazable-navegador.json').write_text(json.dumps(nav,ensure_ascii=False,indent=2)+'\n')

print(json.dumps({'app_commit':head,'navegador':n,'visible_s':visible,'turno_s':total,'hashes':len(files)},ensure_ascii=False))
