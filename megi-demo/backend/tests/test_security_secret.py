"""P0: en modo real el backend exige un secreto de firma propio.

`resolve_secret` es la función pura que decide; probamos su contrato sin tener
que levantar el proceso (el fallo real ocurre al importar `security` en real).
"""
import pytest

from app.security import _DEV_DEFAULT, resolve_secret


def test_real_mode_rejects_missing_secret():
    with pytest.raises(RuntimeError):
        resolve_secret(None, None, "real")


def test_real_mode_rejects_dev_default():
    # El default de desarrollo NO cuenta como secreto válido en real.
    with pytest.raises(RuntimeError):
        resolve_secret(_DEV_DEFAULT, None, "real")
    with pytest.raises(RuntimeError):
        resolve_secret(None, _DEV_DEFAULT, "real")


def test_real_mode_accepts_custom_secret_from_env_or_file():
    assert resolve_secret("un-secreto-propio", None, "real") == "un-secreto-propio"
    assert resolve_secret(None, "secreto-de-archivo", "real") == "secreto-de-archivo"
    # env tiene prioridad sobre archivo
    assert resolve_secret("env-gana", "archivo", "real") == "env-gana"


def test_local_mode_allows_default():
    # En desarrollo/local_mock no estorbamos: el default es aceptable.
    assert resolve_secret(None, None, "local_mock") == _DEV_DEFAULT
