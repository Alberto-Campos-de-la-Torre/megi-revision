# adaptador-megi · Frente B

Implementación REAL del contrato `MegiAdapter` (ver `REPARTO_TRABAJO.md`) sobre la
API de MEGI. Se copia tal cual dentro de la app Agent-Native en `lib/megi/`.

```
lib/megi/types.ts       contrato (tipos + interfaz MegiAdapter + MegiError)
lib/megi/megi-http.ts   adaptador http real (login, token, mapeo de ids, rx-check, approve, export)
lib/megi/index.ts       selector por MEGI_MODE (mock | http); el mock lo escribe el Frente A
probar-adaptador.ts     prueba de humo de extremo a extremo contra el backend de demo
```

## Variables de entorno (en `.env` de la app, nunca con prefijo `VITE_`)

```
MEGI_MODE=http
MEGI_URL=http://127.0.0.1:8020
MEGI_USER=demo_medico
MEGI_PASSWORD=demo-megi-2026

# LLM del agente: Grok (xAI) es compatible con OpenAI
OPENAI_BASE_URL=https://api.x.ai/v1
OPENAI_API_KEY=<clave de xAI; se añade el día de la integración>
```

## Probar

```bash
cd megi-demo/backend && ./start_demo.sh &        # backend de demo en :8020
cd adaptador-megi
MEGI_URL=http://127.0.0.1:8020 MEGI_USER=demo_medico MEGI_PASSWORD=demo-megi-2026 node probar-adaptador.ts
cd ../megi-demo/backend && MEGI_MODE=local_mock .venv/bin/python seed_demo.py   # la prueba exporta demo-c4: restaurar
```

Node 22.6+ ejecuta `.ts` directamente (type stripping); por eso las importaciones
llevan extensión `.ts` y no se usan propiedades de parámetro en constructores.
Dentro de la app Agent-Native (bundler propio) funciona igual.

Resultado del 2 de noviembre de 2026: 27 comprobaciones, todas correctas
(ids, listado, medicación activa, 4 verificaciones, 409 sin confirmación, 404,
exportación FHIR con sello, backend apagado).

## Cómo mapea

| Método | Endpoints de MEGI |
|---|---|
| `listarConsultasCerradas` | `GET /patients` → `GET /patients/{id}/consultations` (finalizadas no aprobadas) → `GET /consultations/{id}` |
| `verPaciente` | `GET /patients/{id}` + última consulta aprobada para `medicacionActiva` |
| `verConsulta` | `GET /consultations/{id}` (parsea `final_soap`, `clinical_facts`) |
| `verificarReceta` | `POST /safety/rx-check` con receta propuesta + medicación activa; `blocker`→`bloqueado`, `warn`→`advertencia` |
| `alternativas` | `POST /drugs/alternatives` (503 sin MLX) → tabla local declarada |
| `exportar` | `POST /review/approve` (gate 409 si hay bloqueo sin `confirmaAlertas`) → `GET /export/consultation/{id}` + `GET /consultations/{id}/fhir` |
| `estado` | `GET /health` |

Ids lógicos `demo-pN`/`demo-cN` ↔ reales `P-DEMON`/`C-DEMON`; cualquier otro id pasa intacto.
