"""Strict CSV parsing and read-only import previews."""

import csv
import io

from fastapi import HTTPException
from pydantic import ValidationError

from .source_models import ObservationWindow
from .sources import checksum, normalized_frame, source_record
from .staff_access import authorize, available

COLUMNS = ["asset_id", "record_id", "window_start", "observed_at", "signal_id", "value", "unit", "std", "p95"]


def parse(source, text):
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    if reader.fieldnames != COLUMNS:
        raise HTTPException(422, "CSV columns must match the supplied telemetry template")
    grouped = {}
    try:
        for number, row in enumerate(reader, 2):
            if number > 321 or None in row or any(value is None for value in row.values()):
                raise ValueError("Batch exceeds 320 signal rows or has malformed columns")
            if row["asset_id"] != source["configuration"]["asset_id"]:
                raise ValueError("CSV equipment does not match this source")
            key = row["record_id"]
            window = grouped.setdefault(
                key,
                dict(
                    record_id=key,
                    window_start=row["window_start"] or None,
                    observed_at=row["observed_at"] or None,
                    values=[],
                ),
            )
            if (window["window_start"], window["observed_at"]) != (
                row["window_start"] or None,
                row["observed_at"] or None,
            ):
                raise ValueError("Signals in a record must have identical window timestamps")
            window["values"].append(
                dict(
                    signal_id=row["signal_id"],
                    value=row["value"],
                    unit=row["unit"],
                    std=row["std"] or None,
                    p95=row["p95"] or None,
                )
            )
        if not 1 <= len(grouped) <= 10:
            raise ValueError("Use between one and ten windows per batch")
        windows = [ObservationWindow.model_validate(value) for value in grouped.values()]
        for index, window in enumerate(windows):
            normalized_frame(source, window, index)
        return windows
    except (ValueError, ValidationError, csv.Error) as error:
        raise HTTPException(422, "Invalid telemetry CSV: " + str(error).splitlines()[0]) from error


def preview(store, token, plant_id, source_id, request):
    available(store)
    with store.connection() as db:
        db.execute("BEGIN")
        authorize(db, token, plant_id, "plant.manage")
        source = source_record(db, plant_id, source_id)
        if source["version"] != request.expected_version:
            raise HTTPException(409, "Source changed; reload before previewing the import")
        windows = parse(source, request.csv)
        digest = checksum(
            dict(
                source_id=source_id,
                version=source["version"],
                windows=[w.model_dump(mode="json") for w in windows],
            )
        )
        return dict(
            checksum=digest,
            source_version=source["version"],
            window_count=len(windows),
            signal_count=sum(len(w.values) for w in windows),
            missing_timestamp_count=sum(w.observed_at is None for w in windows),
            windows=windows,
        )
