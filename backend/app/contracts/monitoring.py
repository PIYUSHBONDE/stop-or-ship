"""Contracts for coordinated plant monitoring and versioned source mappings."""

from typing import Literal

from pydantic import BaseModel, Field

from app.contracts.models import RequestModel, Signal


class SourceBinding(RequestModel):
    asset_id: str = Field(min_length=1, max_length=40)
    mode: Literal["healthy", "degradation"] = "healthy"
    quality_mode: Literal["fresh", "missing", "stale", "conflicting"] = "fresh"


class MonitoringUpdate(RequestModel):
    expected_version: int = Field(ge=0)
    plant_configuration_version: int = Field(ge=1)
    enabled: bool
    sources: list[SourceBinding] = Field(min_length=1, max_length=100)


class MonitoringControl(RequestModel):
    expected_version: int = Field(ge=1)
    action: Literal["play", "pause", "step"]
    expected_tick: int = Field(ge=-1)


class SourceHealth(BaseModel):
    asset_id: str
    profile_id: str | None
    source_label: str
    quality: Literal["fresh", "missing", "stale", "conflicting", "not_started"]
    reason: str
    observed_at: str | None = None
    received_at: str | None = None
    signals: list[Signal] = []
    workflow_id: str | None = None
    incident_id: str | None = None


class MonitoringView(BaseModel):
    investigations_remaining_today: int = 3
    version: int
    plant_configuration_version: int
    enabled: bool
    running: bool
    tick: int
    observed_at: str | None
    interval_seconds: int = 5
    simulated_minutes_per_tick: int = 1
    sources: list[SourceBinding]
    health: list[SourceHealth]
    output_basis: str = "Configured production estimate; generated supporting signals"
    quality_issue_count: int = 0
    clock_label: str = "Backend-owned replay clock; accelerated simulation"
