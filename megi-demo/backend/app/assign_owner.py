"""Asigna dueño a los pacientes sin `doctor_id` (migración a multi-tenencia).

Los pacientes creados antes de la separación por médico no tienen dueño, y sin
dueño **no los ve nadie** en la app: es deliberado. Hay que decir explícitamente
de quién son.

No se reparte por heurística: hoy no existe ningún dato fiable de quién atendió a
quién (`consultations.doctor_id` iba siempre NULL y `approved_by` solo está en
las consultas aprobadas). Inventarlo sería peor que dejarlo sin asignar.

Uso:
    cd backend && .venv/bin/python -m app.assign_owner --listar
    cd backend && .venv/bin/python -m app.assign_owner <usuario>          # simula
    cd backend && .venv/bin/python -m app.assign_owner <usuario> --aplicar

Opcional: `--copiar-perfil-seed` traslada el perfil profesional de `seed.json`
al usuario. Solo si sabes que esos datos (incluida la CÉDULA) son suyos.
"""
import sys

from .db import db, init_db


def _huerfanos(conn) -> int:
    return conn.execute(
        "SELECT COUNT(*) AS n FROM patients WHERE doctor_id IS NULL OR doctor_id = ''"
    ).fetchone()["n"]


def main() -> None:
    init_db()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    aplicar = "--aplicar" in sys.argv

    with db() as conn:
        if "--listar" in sys.argv or not args:
            n = _huerfanos(conn)
            print(f"Pacientes sin dueño: {n}")
            for r in conn.execute(
                "SELECT doctor_id, COUNT(*) AS n FROM patients GROUP BY doctor_id"
            ):
                print(f"  {r['doctor_id'] or '(sin asignar)'}: {r['n']}")
            if not args:
                print("\nUso: python -m app.assign_owner <usuario> [--aplicar]")
            return

        usuario = args[0].strip().lower()
        if not conn.execute("SELECT 1 FROM users WHERE username = ?", (usuario,)).fetchone():
            print(f"ERROR: el usuario '{usuario}' no existe. Créalo antes.")
            raise SystemExit(1)

        n = _huerfanos(conn)
        if not aplicar:
            print(f"SIMULACRO: se asignarían {n} pacientes a '{usuario}'.")
            print("Repite con --aplicar para hacerlo (haz antes ./scripts/megi backup).")
            return

        conn.execute(
            "UPDATE patients SET doctor_id = ? WHERE doctor_id IS NULL OR doctor_id = ''",
            (usuario,),
        )
        # En el expediente importado, `consultations.doctor_id` traía el código
        # de consultorio del IMSS, no un usuario. Se PRESERVA antes de reasignar:
        # es dato clínico-administrativo real, solo estaba en la columna
        # equivocada.
        preservadas = conn.execute(
            "UPDATE consultations SET imss_consultorio = doctor_id "
            "WHERE doctor_id IS NOT NULL AND doctor_id != '' "
            "  AND imss_consultorio IS NULL "
            "  AND doctor_id NOT IN (SELECT username FROM users)"
        ).rowcount
        # Y ahora sí: la consulta hereda el dueño de su paciente.
        conn.execute(
            "UPDATE consultations SET doctor_id = ("
            "  SELECT p.doctor_id FROM patients p WHERE p.id = consultations.patient_id"
            ") WHERE doctor_id IS NULL OR doctor_id = '' "
            "   OR doctor_id NOT IN (SELECT username FROM users)"
        )
        # La identidad profesional también se traslada: hasta ahora se imprimía
        # desde seed.json (única para toda la instalación). Si el médico no tiene
        # perfil propio, hereda el que ya se venía usando en sus documentos.
        # OPT-IN a propósito. El perfil del seed puede ser dato de plantilla, y
        # la cédula acaba impresa en recetas: escribir una de la que no estás
        # seguro es peor que dejar el perfil vacío (la app avisa con
        # `complete: false` y el médico lo rellena en «Mi perfil»).
        from .config import load_seed
        doc = (load_seed() or {}).get("DOCTOR") or {} if "--copiar-perfil-seed" in sys.argv else {}
        actual = conn.execute("SELECT cedula FROM users WHERE username = ?", (usuario,)).fetchone()
        if doc and not (actual and actual["cedula"]):
            conn.execute(
                "UPDATE users SET name = COALESCE(NULLIF(name,''), ?), specialty = ?, "
                "cedula = ?, cedula_esp = ?, institution = ?, address = ?, phone = ? "
                "WHERE username = ?",
                (doc.get("name"), doc.get("specialty"), doc.get("cedula"),
                 doc.get("cedula_esp"), doc.get("institution"), doc.get("address"),
                 doc.get("phone"), usuario),
            )
            print(f"  (perfil profesional del seed asignado a '{usuario}': céd. {doc.get('cedula')})")
        if preservadas:
            print(f"  ({preservadas} códigos de consultorio IMSS preservados en imss_consultorio)")
        print(f"Asignados {n} pacientes (y sus consultas) a '{usuario}'.")


if __name__ == "__main__":
    main()
