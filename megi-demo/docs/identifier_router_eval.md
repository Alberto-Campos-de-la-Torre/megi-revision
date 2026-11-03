# Evaluación del router de identificadores

Estado y evaluación de la ruta de identificadores (`v1.6A-ckpt750` + `resolver_v1.1`).
Mantener fuera del README de la app.

## Contrato de estados

El resolver devuelve exactamente uno de:

| Estado            | Significado                                 | Acción de UI                       |
|-------------------|---------------------------------------------|------------------------------------|
| `VALUE`           | interpretación única y confiable            | aceptar                            |
| `MULTI_CANDIDATE` | ambiguo (p. ej. B/V pelona, 0/O, 1/I/l)     | confirmar / elegir candidato       |
| `ABSTAIN`         | sin señal suficiente                        | dictar de nuevo / captura manual   |
| `INVALID`         | falla validación estructural (CURP/NSS)     | corregir y revalidar               |

## Política (resolver_v1.1)

```text
RAW y RESOLVED salen del mismo candidate_base (no inventa caracteres).
B/V clarificada    → resolver aprovecha disambiguador.
B/V pelona ambigua → MULTI_CANDIDATE / requires_confirmation.
No se fuerza B/V por acústica cuando no hay evidencia.
Falsos disparos controlados → preferir ABSTAIN/INVALID antes que un VALUE dudoso.
```

## BLIND

- BLIND de identificadores: **sellado, no abierto**. No publicar resultados aquí aún.

## Métricas DEV

> Pendiente. Registrar precisión por estado, tasa de `MULTI_CANDIDATE`, tasa de
> falsos disparos B/V y exactitud canónica (CURP/NSS) cuando se corran las evals.

| Métrica                          | Valor | Fecha | Notas |
|----------------------------------|-------|-------|-------|
| Exactitud canónica CURP          | _—_   | _—_   |       |
| Exactitud canónica NSS           | _—_   | _—_   |       |
| Tasa MULTI_CANDIDATE (B/V pelona)| _—_   | _—_   |       |
| Falsos disparos B/V              | _—_   | _—_   |       |

## Implementación actual (Sprint 1, mock)

- Backend: `backend/app/services/mock_resolver.py` (reglas deterministas).
- Frontend demo: `frontend/src/api/client.js::localResolveIdentifier` (paridad con el backend).
- UI: tarjeta "Identificadores capturados" en `frontend/src/components/revision.jsx`.
