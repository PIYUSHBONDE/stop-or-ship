import json
from pathlib import Path

from app.main import app

destination = Path(__file__).resolve().parents[2] / "web" / "openapi.json"
destination.write_text(json.dumps(app.openapi(), indent=2), encoding="utf-8")
print("Exported " + str(destination))
