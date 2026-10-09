"""Export prepared dataset features to bounded CSV import batches without replay.

Dataset record order and values remain intact. UCI cycle IDs do not provide
acquisition timestamps, so those fields remain empty rather than invented.
"""

import argparse
import csv
import hashlib
import json
from pathlib import Path

from app.telemetry.datasets import UNITS
from app.telemetry.imports import COLUMNS


def convert(path, output, asset_id, profile):
    data = json.loads(path.read_text(encoding="utf-8"))
    if profile not in {"pump", "bearing"}:
        data = data["profiles"][profile]
    records = [*data["healthy"], *data["fault"]]
    # Remove overlap between prepared selections. Preserve original record IDs.
    records = list({str(row.get("record_id", row.get("cycle_id"))): row for row in records}.values())
    output.mkdir(parents=True, exist_ok=True)
    count = 0
    for offset in range(0, len(records), 10):
        destination = output / f"{profile}-{offset // 10 + 1:04d}.csv"
        with destination.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(COLUMNS)
            for row in records[offset : offset + 10]:
                features = row.get("features", {})
                record_id = row.get("record_id", row.get("cycle_id"))
                for key, value in row["values"].items():
                    writer.writerow(
                        [
                            asset_id,
                            record_id,
                            "",
                            "",
                            key,
                            value,
                            data.get("units", UNITS)[key],
                            features.get(key + "_std", ""),
                            features.get(key + "_p95", ""),
                        ]
                    )
        if destination.stat().st_size > 50000:
            raise ValueError("Converted batch exceeds the import byte limit")
        count += 1
    manifest = dict(
        source=str(path.name),
        source_checksum=hashlib.sha256(path.read_bytes()).hexdigest(),
        dataset="ims-bearings" if profile == "bearing" else "uci-hydraulics",
        profile=profile,
        asset_id=asset_id,
        records=len(records),
        batches=count,
        transformation="Prepared cycle/snapshot features; selected healthy then fault records, deduplicated by original record ID; order is an analysis selection, not a plant chronology. Acquisition timestamps unavailable in prepared artifacts and retained as missing.",
    )
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--profile", choices=["pump", "cooler", "valve", "bearing"], required=True)
    args = parser.parse_args()
    print(json.dumps(convert(args.input, args.output, args.asset_id, args.profile)))
