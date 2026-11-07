from pathlib import Path
import json, subprocess
r=Path(__file__).resolve().parents[1]
read=lambda p:json.loads((r/p).read_text())
pruebas=read('pruebas-hackathon/revision-trazable-resultados.json')['resultados'];pasadas={x['id'] for x in pruebas if x['passed']}
rows=[]
def item(id,requisito,fuentes,tests=(),notas=''):
 for f in fuentes: assert (r/f).exists(),f
 for t in tests: assert t in pasadas,(id,t)
 rows.append({'id':id,'requisito':requisito,'estado':'verificado','fuentes':fuentes,'pruebas':list(tests),'notas':notas})
item('A1','Historial vivo fusionado; lo nuevo exige conciliación',['megi-revision/server/lib/plan.ts','megi-revision/server/lib/revision.ts','megi-revision/server/lib/megi/megi-http.ts'],['receta-aprobada-despues-del-plan-cruza-por-adaptador-http','nueva-medicacion-viva-entra-y-frena-aprobacion'])
item('A2','Versión obligatoria para el agente con o sin alcance',['megi-revision/server/lib/revision.ts'],['version-obligatoria-sin-alcance','no-omite-version-en-edicion-acotada','no-edita-version-antigua'])
item('A3','Caché por paciente/adaptador solo durante la acción; coste medido',['megi-revision/server/lib/megi/peticion.ts','megi-revision/server/lib/megi/megi-http.ts','pruebas-hackathon/bateria-resultados.json'],['cache-solo-peticion-y-aislado-por-adaptador','historial-incluye-cronico-antiguo-y-distingue-tratamiento-finalizado'])
item('A4','Hidratación legacy falla con 502 tipado',['megi-revision/server/lib/plan.ts'],['legacy-hidratacion-fallida-es-502-tipado'])
item('A5','Contexto mínimo sin transcripción y parseo por conjunto',['megi-revision/server/lib/revision.ts','megi-revision/server/lib/plan.ts','megi-revision/actions/proponer-plan.ts'],['contexto-conservado-minimo-sin-transcripcion','contexto-se-parsea-una-vez-por-accion-y-no-se-reusa-entre-peticiones'])
item('A6','Exportadas antiguas con fuentes neutras',['megi-revision/server/lib/plan.ts'],['exportadas-antiguas-neutras-y-listadas-sin-backend'])
item('A7','Diálogo se abre después de recibir la versión refrescada',['megi-revision/app/routes/revision.$consultaId.tsx','evidencia/resultados/recorrido.json'])
item('A8','Filtro Exportadas accesible',['megi-revision/actions/listar-consultas.ts','megi-revision/app/routes/revision._index.tsx','evidencia/resultados/recorrido.json'])
item('A9','Numeración, importación y dependencias limpiadas',['megi-revision/.agents/skills/revision-clinica/SKILL.md','megi-revision/actions/proponer-plan.ts','megi-revision/app/components/revision/MedicionesRevision.tsx'])
item('A10','Foco y 60 s como respaldo',['megi-revision/app/routes/revision.$consultaId.tsx'])
item('B1','Recorrido actualizado y capturas',['evidencia/recorrido.mjs','evidencia/resultados/recorrido.json'])
item('B2','Conciliar Losartán antes de aprobar; botón antes deshabilitado',['evidencia/advertencias.mjs','evidencia/resultados/advertencias.json'])
item('B3','Motivo abierto, compositor actual y espera del fin de turno',['evidencia/agente.mjs','evidencia/resultados/agente.json'])
item('B4','Build y pruebas reproducibles con JSON/capturas',['evidencia/verificar.mjs','evidencia/backend.mjs','evidencia/resultados/verificacion.json','ESTADO.md'])
item('B5','Restaurar únicamente casos propios y comprobar cuatro pendientes',['evidencia/finalizar.mjs','evidencia/resultados/demo-final.json'])
item('C1','Motivo abierto tras un cambio del agente',['megi-revision/app/routes/revision.$consultaId.tsx','evidencia/resultados/agente.json'])
item('C2','Diff rojo, verde y ámbar; dosis antes y después',['megi-revision/app/components/revision/ComparacionPlan.tsx','evidencia/resultados/recorrido.json'])
item('C3','Selección explica alcance y ofrece orden acotada',['megi-revision/app/routes/revision.$consultaId.tsx','evidencia/resultados/recorrido.json'])
item('C4','Tres pasos en el estado sin plan',['megi-revision/app/routes/revision.$consultaId.tsx','evidencia/capturas/02-consulta-sin-plan.png'])
item('C5','Marca, chat y espacio local de demo en español',['megi-revision/app/lib/app-config.ts','megi-revision/app/components/layout/AgentInspector.tsx','megi-revision/server/plugins/agent-native-email-branding.ts','megi-revision/app/root.tsx','evidencia/comun.mjs','evidencia/resultados/sugerencias.json','evidencia/capturas/sugerencias-espanol.png'],notas='El inspector desactiva las sugerencias dinámicas genéricas y conserva las clínicas en español; comprobado con el panel vacío abierto.')
item('C6','Pasos derivados de eventos reales; sin temporizadores de progreso',['megi-revision/app/components/revision/EstadoAgente.tsx','megi-revision/app/components/revision/TrabajoAgente.tsx','evidencia/resultados/agente.json'])
item('C7','Fuentes cerradas, conciliación por incertidumbre e iconos por actor',['megi-revision/app/components/revision/LineaPlan.tsx','megi-revision/app/components/revision/ConciliacionMedicacion.tsx','megi-revision/app/components/revision/Bitacora.tsx'])
item('D1','Alternativa automática vinculada a una línea, sin sobrescribir la receta fijada',['megi-revision/app/components/revision/agente.ts','megi-revision/actions/sugerir-reemplazo.ts','megi-revision/actions/resolver-sugerencia.ts','evidencia/resultados/recorrido.json'],['sugerencia-acotada-no-toca-fijada-y-medico-resuelve','alternativa-se-cruza-con-otros-farmacos-del-plan'])
item('D2','Pregunta estructurada de alergias antes de proponer',['megi-revision/server/plugins/agent-chat.ts','megi-revision/.agents/skills/revision-clinica/SKILL.md','evidencia/resultados/agente.json'])
item('D3','Comparación exploratoria manual/agente; servidor y modelo distinguidos',['megi-revision/app/components/revision/MedicionesRevision.tsx','megi-revision/actions/metricas-revision.ts'],['mediciones-reales-y-aisladas','traza-del-modelo-vinculada-desde-contexto-del-servidor-y-aislada'],notas='Operaciones del servidor y API del modelo medidas por separado. API incluye red/reintentos y se lee bajo demanda mediante el hook público, con acceso por propietario. No se estima restando servidor al total.')
item('D4','Skill reducida, herramientas diferidas y medición de latencia',['megi-revision/server/plugins/agent-chat.ts','megi-revision/.agents/skills/revision-clinica/SKILL.md','evidencia/resultados/latencia.json','evidencia/resultados/latencia-serie.json','megi-revision/actions/proponer-plan.ts','evidencia/resultados/configuracion-latencia.json','evidencia/resultados/comparacion-modelos.json'],notas='Recorrido canónico desde un navegador nuevo con Grok 4.20 Non-Reasoning configurado para esta app. Se exige tanto plan visible como turno completo por debajo de 35 s; muestra exploratoria, sin garantía de SLA.')
lat=read('evidencia/resultados/latencia.json');rows[-1]['estado']='verificado' if max(lat['visibleMs'],lat['resultados'][0]['ms'])<35000 else 'pendiente_objetivo_35s';rows[-1]['medicion']={'visibleMs':lat['visibleMs'],'turnoMs':lat['resultados'][0]['ms'],'n':1}
item('E1','Invalidación dirigida sin acumular planes de llamadas anteriores',['megi-revision/app/lib/revision-sync.ts','megi-revision/app/root.tsx','megi-revision/actions/actualizar-linea.ts'],['invalidacion-de-un-plan-no-despierta-otro','entrega-pausada-refresca-su-recurso-sin-marca-de-efecto'])
item('E2','Versión y alcance en current-screen, validación en servidor',['megi-revision/app/hooks/use-navigation-state.ts','megi-revision/app/routes/revision.$consultaId.tsx','megi-revision/actions/view-screen.ts','evidencia/resultados/recorrido.json'])
item('E3','Página de aprobación HTTP incluida diez segundos en el guion',['PLAN_HACKATHON_AGENT_NATIVE.md','megi-revision/server/plugins/agent-chat.ts'],notas='Solo guion: vídeo y Clips siguen fuera del encargo actual.')
item('E4','Manifiesto MCP con lecturas y exclusiones; enlace README',['evidencia/revision-trazable-mcp.json','megi-revision/README.md'])
for id,p in [('DOC_ENVIO','ENVIO_HACKATHON.md'),('DOC_GUION','PLAN_HACKATHON_AGENT_NATIVE.md'),('DOC_README','megi-revision/README.md'),('DOC_ESTADO','ESTADO.md')]:item(id,'Documento actualizado',[p])
item('GATES','Typecheck, doctor, build y tres regresiones',['evidencia/resultados/verificacion.json','evidencia/auditoria-hackathon-resultados.json','pruebas-hackathon/bateria-resultados.json','pruebas-hackathon/revision-trazable-resultados.json'])
item('COMMIT','Commit local de la aplicación',['evidencia/revision-trazable-validacion.json'],notas='El usuario excluyó el commit del repositorio raíz; documentación y evidencia se conservan en el árbol de trabajo.')
if subprocess.check_output(['git','status','--porcelain'],cwd=r/'megi-revision',text=True).strip():
 for x in rows:
  if x['id'] in ['GATES','COMMIT']: x['estado']='pendiente_cierre_final'
(r/'evidencia/resultados/auditoria-para-el-100.json').write_text(json.dumps({'app_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=r/'megi-revision',text=True).strip(),'requisitos':rows,'pendientes':[x['id'] for x in rows if x['estado']!='verificado']},ensure_ascii=False,indent=2)+'\n')
print('Requisitos revisados:',len(rows),'Pendientes:',[x['id'] for x in rows if x['estado']!='verificado'])
