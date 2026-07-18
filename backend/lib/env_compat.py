"""Environment-variable helpers used by feedBack Studio.

Flat-importable, with no import-time I/O or mutable global state.
"""

import os

_TRUE_VALUES = {"1", "true", "yes", "on"}


def getenv_compat(name, default=None):
    """Return a feedBack Studio environment variable or ``default``."""
    return os.environ.get(name, default)


def env_flag_compat(name):
    """Parse a conventional boolean environment flag."""
    return (getenv_compat(name, "") or "").strip().lower() in _TRUE_VALUES
