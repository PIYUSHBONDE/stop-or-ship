"""Export or verify the canonical API contract without creating a database."""

import argparse
import json
from pathlib import Path

from app.main import app

destination = Path(__file__).resolve().parents[3] / "web" / "contracts" / "openapi.json"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true", help="Fail on contract drift without modifying files")
args = parser.parse_args()
content = json.dumps(app.openapi(), indent=2)
if args.check:
    if not destination.exists() or destination.read_text(encoding="utf-8") != content:
        raise SystemExit("OpenAPI contract drift; run the export and regenerate TypeScript types")
    print("OpenAPI contract is current")
else:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")
    print("Exported " + str(destination))
