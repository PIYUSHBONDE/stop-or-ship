"""Compatibility entry point for the packaged PostgreSQL migration tool."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.persistence.postgres_migration import (  # noqa: E402,F401
    canonical,
    definitions,
    import_snapshot,
    main,
    manifest,
    postgres_ddl,
    snapshot,
)

if __name__ == "__main__":
    main()
