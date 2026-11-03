# API de MEGI para el adaptador · formas reales

Entregable B3 del `REPARTO_TRABAJO.md`. Todas las respuestas de abajo se obtuvieron
el 2 de noviembre de 2026 contra el backend de demo (`megi-demo`, puerto 8020,
modo `local_mock`, sin servicio MLX). Los JSON completos están en `docs/api_samples/`.

**Para el Frente A:** el mock debe imitar estas formas solo donde el adaptador las
consume. La app nunca llama a esta API: pasa siempre por `lib/megi/` (`types.ts`).

## Arranque del backend de demo

```bash
cd megi-demo/backend
./start_demo.sh            # puerto 8020, base propia en backend/data/megi.sqlite
./stop_demo.sh
MEGI_MODE=local_mock .venv/bin/python seed_demo.py   # volver al estado inicial (idempotente)
```

Usuario de servicio: `demo_medico` / `demo-megi-2026` (rol admin, pacientes propios).
Abre `http://127.0.0.1:8020` para ver la interfaz de MEGI con los mismos datos.

## Convenciones

- Prefijo `/api`. Todo lo clínico exige `Authorization: Bearer <token>`.
- Sin token: `401 {"detail":"No autenticado"}`. Token caducado o revocado: `401`.
- Lo que no es de este médico, o no existe: `404` (a propósito, nunca `403`).
- Lo que necesita el servicio MLX (`MEGI_REAL_ASR=true`): `503` con `detail`.
- Los campos JSON de `consultations` (`soap`, `final_soap`, `clinical_facts`,
  `prescription`, `dx_codes`, `vitals`) llegan como **cadenas JSON**, no objetos.
  `GET /soap/{id}` y `GET /patients/{id}/expediente` ya los devuelven parseados.
- Fechas en ISO 8601 UTC.

## Ids de la demo

| Lógico (contrato) | Real en MEGI | Paciente | Consulta de hoy | Conflicto |
|---|---|---|---|---|
| demo-p1 / demo-c1 | P-DEMO1 / C-DEMO1 | Alba Prueba Ficticia, 34 F | Faringoamigdalitis | Alergia a penicilina; el SOAP propone amoxicilina |
| demo-p2 / demo-c2 | P-DEMO2 / C-DEMO2 | Mateo Ejemplo Demo, 61 M | Lumbalgia + HTA | Alergias **vacías**; naproxeno con HTA y losartán activo (advertencias) |
| demo-p3 / demo-c3 | P-DEMO3 / C-DEMO3 | Rosa Ficticia Muestra, 72 F | Gonartrosis | Warfarina activa; el SOAP propone ibuprofeno (interacción grave) |
| demo-p4 / demo-c4 | P-DEMO4 / C-DEMO4 | Luis Modelo Simulado, 28 M | Cefalea tensional | Sin conflictos |

Consultas previas aprobadas (dan la medicación activa): `C-DEMO2-PREV` (losartán),
`C-DEMO3-PREV` (warfarina + metoprolol).

## Endpoints que usa el adaptador

### POST /auth/login

```json
// petición
{"username": "demo_medico", "password": "demo-megi-2026"}
// respuesta 200
{"username": "demo_medico", "name": "Dra. Demo Ficticia", "role": "admin",
 "must_change_password": false, "token": "eyJ1Ijoi…"}
```

`401 {"detail":"Usuario o contraseña incorrectos"}`. Tras varios fallos, `429` con `Retry-After`.
Si `must_change_password` es `true` el token solo sirve para cambiarla: el adaptador lo rechaza.

### GET /patients  → `Paciente[]` (solo los de este médico)

```json
{"id": "P-DEMO1", "name": "Alba Prueba Ficticia", "short": "Alba P. Ficticia",
 "curp": "PUFA920101MDFRBL01", "nss": "12345678901", "age": 34, "sex": "F",
 "time": "", "status": "terminada", "reason": "Dolor de garganta y fiebre de 3 días",
 "last": "Consulta de hoy", "allergies": ["Penicilina"], "chronic": [],
 "scheduled_date": null, "kind": "espontaneo", "created_at": "2026-07-05T10:00:00+00:00",
 "email": "", "phone": "", "source": null, "birthdate": null, "gestacional_semanas": null,
 "doctor_id": "demo_medico", "consulta_abierta_id": null, "motivo_hoy": ""}
```

`allergies` y `chronic` son listas de texto libre. Lista vacía = sin registro.

### GET /patients/{id}  → misma forma, un paciente.

### GET /patients/{id}/consultations  → historial, más reciente primero

```json
[{"id": "C-DEMO3", "status": "in_review", "started_at": "2026-11-02T09:00:00+00:00",
  "finalized_at": "2026-11-02T16:52:21+00:00", "finalized": true,
  "soap": {"S": "…", "O": "…", "A": "…", "P": "…"}},
 {"id": "C-DEMO3-PREV", "status": "approved", "started_at": "2026-09-03T10:00:00+00:00",
  "finalized_at": "2026-09-03T10:00:00+00:00", "finalized": true, "soap": {…}}]
```

No trae receta: para la medicación activa el adaptador abre la última `approved`/`exported`
con `GET /consultations/{id}` y lee `prescription`.

Estados de consulta: `draft` → `in_review` → `approved` → `exported` (también `radiologia`, que se ignora).
**Pendiente de revisión** = `finalized: true` y estado distinto de `approved`/`exported`.

### GET /consultations/{id}  → fila completa (campos JSON como cadenas)

```json
{"id": "C-DEMO3", "patient_id": "P-DEMO3", "status": "in_review",
 "started_at": "2026-11-02T09:00:00+00:00", "updated_at": "…", "doctor_id": "demo_medico",
 "motivo": "Dolor de rodilla derecha",
 "transcript": "Me duele la rodilla derecha desde hace dos semanas…",
 "soap": "{\"S\": \"…\", \"O\": \"…\", \"A\": \"…\", \"P\": \"…\"}",
 "final_soap": "{\"S\": \"…\", …}",
 "clinical_facts": "{\"diagnosticos\": [{\"code\": \"M17.1\", \"label\": \"Gonartrosis primaria, unilateral\"}], \"medicamentos_propuestos\": [\"Ibuprofeno 400 mg cada 8 h 7 días\", \"Paracetamol 1 g cada 8 h\"], \"alergias_mencionadas\": [], \"pendientes\": [\"Radiografía de rodilla derecha AP y lateral\", \"INR en 2 semanas\", \"Fisioterapia\"], \"signos_vitales\": {\"ta\": \"130/82\", \"fc\": \"70\"}}",
 "validation_flags": "{\"status\": \"requires_review\", \"official_note\": false, \"flags\": [], \"warnings\": []}",
 "finalized_at": "2026-11-02T16:52:21+00:00",
 "approved_soap": null, "prescription": null, "dx_codes": null,
 "approved_by": null, "approved_at": null,
 "vitals": "{\"ta\": \"130/82\", \"fc\": \"70\"}",
 "doc_suggestions": null, "imss_consultorio": null, "estudios_estado": null}
```

Tras aprobar: `status: "approved"`, `approved_soap`, `prescription`
(`[{"drug","dose","freq","duration"}]`), `dx_codes` (`[{"code","label"}]`), `approved_by`, `approved_at`.

El adaptador mapea: `final_soap`/`approved_soap` → `soap`; `clinical_facts.diagnosticos` o `dx_codes`
→ `diagnosticos`; `clinical_facts.medicamentos_propuestos` → `medicamentosPropuestos`;
`clinical_facts.pendientes` → `pendientes`.

### GET /soap/{id}  → lo mismo pero parseado

```json
{"transcript": "…", "soap": {"S":"…","O":"…","A":"…","P":"…"}, "final_soap": {…},
 "clinical_facts": {…}, "validation": {"status": "requires_review", "official_note": false, "flags": [], "warnings": []}}
```

### GET /patients/{id}/expediente  → vista estructurada (parseada)

```json
{"paciente": {"id": "P-DEMO3", "name": "…", "age": 72, "sex": "F", "reason": "…",
              "allergies": ["Sulfas"], "chronic": ["Fibrilación auricular", "Hipertensión arterial"],
              "created_at": "2026-07-05"},
 "consultas": [{"id": "C-DEMO3", "fecha": "2026-11-02", "status": "in_review", "finalizada": true,
                "motivo": "…", "soap": {…}, "dx": [], "receta": [], "vitals": {…}, "aprobada_por": null},
               {"id": "C-DEMO3-PREV", "fecha": "2026-09-03", "status": "approved", "finalizada": true,
                "motivo": "…", "soap": {…},
                "dx": ["I48.9 Fibrilación y aleteo auricular, no especificado", "I10 Hipertensión esencial (primaria)"],
                "receta": ["Warfarina 5 mg cada 24 h", "Metoprolol 50 mg cada 12 h"], "vitals": {…},
                "aprobada_por": "Dra. Demo Ficticia"}],
 "documentos": [], "estudios": [], "aportados": [], "citas": [], "sellos": [],
 "conteos": {"consultas": 2, "estudios": 0, "aportados": 0, "envios": 0, "documentos": 0, "citas": 0, "sellos": 0}}
```

Útil para que el agente resuma; `receta` aquí viene como texto, por eso la medicación
activa estructurada se toma de `/consultations/{id}`.

### POST /safety/rx-check  → verificación determinista (sin LLM, siempre disponible)

```json
// petición
{"rx_list": [{"drug": "Ibuprofeno 400 mg", "dose": "400 mg", "freq": "cada 8 h"},
             {"drug": "Paracetamol 1 g"}, {"drug": "Warfarina 5 mg"}],
 "allergies": ["Sulfas"], "chronic": ["Fibrilación auricular", "Hipertensión arterial"]}
// respuesta 200
{"alerts": [
   {"severity": "warn", "type": "cronico", "drug": "Ibuprofeno 400 mg", "against": "hipertension arterial",
    "message": "Ibuprofeno 400 mg: AINE puede elevar la presión arterial y reducir el efecto de antihipertensivos."},
   {"severity": "blocker", "type": "interaccion", "drug": "Ibuprofeno 400 mg", "against": "Warfarina 5 mg",
    "severidad": "grave",
    "message": "Ibuprofeno 400 mg + Warfarina 5 mg (grave): Los AINE inhiben la función plaquetaria… → Evitar la combinación; usar paracetamol…"}],
 "blockers": 1, "warnings": 1, "note": "Apoyo determinista, no exhaustivo. El médico valora."}
```

- `severity`: `blocker` (alergia o interacción grave) | `warn` (crónico, interacción moderada/leve).
- `type`: `alergia` | `cronico` | `interaccion`.
- Para que detecte interacciones, el fármaco debe estar en el catálogo aprobado
  (`GET /medications?estado=aprobado`, 13 en la demo) y el par en
  `GET /drug-interactions?estado=aprobado` (6 en la demo). Alergias y crónicos
  usan reglas fijas (penicilina, betalactámicos, sulfas, AINE, etc.).
- El adaptador manda la receta propuesta **más** la medicación activa, para que
  salgan las interacciones propuesto×activo.

Otros ejemplos guardados: `09_rx_check_alba.json` (bloqueo por alergia),
`10_rx_check_mateo.json` (dos advertencias).

### POST /drugs/check y POST /drugs/alternatives  → **503 en la demo**

```json
{"detail": "Verificador FDA no disponible (MEGI_REAL_ASR=false)."}
```

Requieren el servicio MLX (tabla FDA y Gemma). El adaptador los intenta y, ante
`503`/`502`, cae a `/safety/rx-check` y a una tabla local de alternativas,
declarada como tal. Si el día de la grabación se arranca el servicio MLX, se
enriquecen solos.

### POST /review/approve  → cierre con gate de seguridad en el servidor

```json
// petición
{"consultation_id": "C-DEMO4",
 "soap": {"S": "…", "O": "…", "A": "…", "P": "…"},
 "rx_list": [{"drug": "Paracetamol 1 g", "dose": "1 g", "freq": "cada 8 h PRN", "duration": "máx 3 días/semana"}],
 "selected_dx": [{"code": "G44.2", "label": "Cefalea de tipo tensión"}],
 "allergies": ["Ninguna conocida"], "chronic": [],
 "safety_ack": false, "notes": "Plan revisado con el agente"}
// respuesta 200
{"ok": true, "status": "approved", "approved_by": "Dra. Demo Ficticia"}
// con bloqueo y sin safety_ack → 409
{"detail": "Receta con alerta de seguridad sin confirmar: Amoxicilina 500 mg puede relacionarse con la alergia a Penicilina."}
```

Quién firma sale del token, no del cuerpo. `POST /review/save` guarda un borrador
intermedio (`{"ok": true, "saved_at": "…"}`) y pasa la consulta a `in_review`.

### GET /export/consultation/{id}  → sello

```json
{"consultation_id": "C-DEMO4", "content_hash": "sha256:bf5a0e46…", "signature_status": "mock_not_legal_signature", "signed_at": null}
```

Pasa la consulta a `exported`. La firma no es legal (así lo dice el campo).

### GET /consultations/{id}/fhir  → Bundle FHIR R4 (document)

Composition (nota SOAP) + Patient + Encounter + Condition por dx + MedicationRequest por
fármaco + Observation por signo vital. Es lo que el adaptador devuelve como `contenido`.

### GET /consultations/{id}/audit  → auditoría completa

Nota IA vs nota del médico (`note.ai`, `note.doctor`, `edited`, `changed_sections`),
`prescription`, `dx`, `safety` (alertas mostradas al aprobar y `ack`), `timeline`, `signer`.
Sirve para la pestaña «Cambios» si se quiere mostrar lo que registró MEGI.

### GET /health (público)

```json
{"status": "ok", "mode": "local_mock", "build": "unknown"}
```

## Lo que NO existe en MEGI (y resuelve la app Agent-Native)

- No hay tabla de «plan en revisión» con líneas, estados ni bloqueos: eso vive en
  Postgres/PGlite de la app (`planes`, `lineas_plan`, `eventos_revision`).
- No hay «pendientes» como entidad: van dentro del texto del Plan al aprobar.
- No hay endpoint de «reajustar»: lo hace el agente con las acciones de la app y
  vuelve a verificar con `/safety/rx-check`.
