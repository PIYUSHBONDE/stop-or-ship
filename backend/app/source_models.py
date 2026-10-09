"""Plant-scoped observation and historical import contracts."""

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .models import RequestModel, Signal
from .plant_configuration import Identifier


class SignalRule(RequestModel):
    requires_stop: bool = False
    signal_id: Identifier
    unit: str = Field(min_length=1, max_length=30)
    lower: float | None = None
    upper: float | None = None

    @model_validator(mode="after")
    def ordered(self):
        if self.lower is not None and self.upper is not None and self.lower >= self.upper:
            raise ValueError("Lower limit must be below upper limit")
        return self


class SourceConfiguration(RequestModel):
    expected_version: int = Field(ge=0)
    plant_configuration_version: int = Field(ge=1)
    name: str = Field(min_length=2, max_length=100)
    asset_id: Identifier
    kind: Literal["operational", "historical"]
    rules: list[SignalRule] = Field(default_factory=list, max_length=32)
    procedure: str = Field(default="", max_length=3000)
    dataset: str = Field(default="", max_length=200)
    attribution: str = Field(default="", max_length=1000)
    transformation: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def unique_signals(self):
        if len({r.signal_id for r in self.rules}) != len(self.rules):
            raise ValueError("Signal rules must be unique")
        if self.kind == "historical" and (not self.dataset.strip() or not self.attribution.strip()):
            raise ValueError("Historical sources require dataset identity and attribution")
        return self


class ObservationValue(RequestModel):
    signal_id: Identifier
    value: float
    unit: str = Field(min_length=1, max_length=30)
    std: float | None = Field(default=None, ge=0)
    p95: float | None = None


class ObservationWindow(RequestModel):
    record_id: str = Field(min_length=1, max_length=100)
    window_start: datetime | None = None
    observed_at: datetime | None = None
    values: list[ObservationValue] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def timestamps(self):
        for stamp in (self.window_start, self.observed_at):
            if stamp is not None and stamp.utcoffset() is None:
                raise ValueError("Timestamps must include a UTC offset")
        if len({v.signal_id for v in self.values}) != len(self.values):
            raise ValueError("A window cannot contain duplicate signal IDs")
        return self


class ObservationBatch(RequestModel):
    expected_version: int = Field(ge=1)
    windows: list[ObservationWindow] = Field(min_length=1, max_length=10)


class ImportRequest(RequestModel):
    expected_version: int = Field(ge=1)
    csv: str = Field(min_length=1, max_length=50000)
    preview_checksum: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class ImportPreview(RequestModel):
    checksum: str
    source_version: int
    window_count: int
    signal_count: int
    missing_timestamp_count: int
    windows: list[ObservationWindow]


class SourceView(RequestModel):
    condition: Literal["within_envelope", "outside_envelope", "unknown"] = "unknown"
    id: str
    version: int
    configuration: SourceConfiguration
    reviewed_by: str
    reviewed_at: str
    quality: Literal["fresh", "stale", "missing", "not_connected", "historical", "incomplete"]
    reason: str
    diagnostic_ready: bool
    observed_at: str | None = None
    received_at: str | None = None
    signals: list[Signal] = Field(default_factory=list)
    incident_id: str | None = None


class IngestionResult(RequestModel):
    accepted: int
    duplicates: int
    incident_ids: list[str]


class OperationalRepair(RequestModel):
    observed_cause: str = Field(min_length=3, max_length=500)
    fix: str = Field(min_length=3, max_length=1000)
    parts: str = Field(max_length=500)
    outcome: str = Field(min_length=3, max_length=500)
