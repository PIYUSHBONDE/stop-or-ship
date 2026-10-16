"""Explicit injected-store browser fixture; never packaged in runtime images."""

from app.core import config
from app.main import create_app
from app.persistence.store import Store

if (
    not config.INTERNAL_TEST_MODE
    or config.AI_PROVIDER != "scripted"
    or config.MODE != "local"
):
    raise RuntimeError(
        "This entry point requires an explicitly isolated scripted test environment"
    )

# Use production observation projection while injecting the test store, as operational tests do.
config.INTERNAL_TEST_MODE = False
app = create_app(store=Store(config.DB, cloud=False))
