"""Bounded, read-only assistant and voice contracts."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field

from app.contracts.models import RequestModel

Text = Annotated[str, Field(min_length=1, max_length=160)]
Finite = Annotated[float, Field(allow_inf_nan=False)]
MachineMode = Literal["idle", "running", "degraded", "stopped", "under_repair", "recovering"]


class SimulationReading(RequestModel):
    signal_id: Text
    value: Finite
    unit: Text
    low: Finite
    high: Finite
    ooc: bool


class SimulationEquipment(RequestModel):
    asset_id: Text
    readings: list[SimulationReading] = Field(max_length=8)
    mode: MachineMode | None = None


class SimulationCase(RequestModel):
    id: Text
    asset_id: Text
    operator_id: Text
    status: Text
    note: str = Field(max_length=600)


class SimulationAssignment(SimulationCase):
    operator_name: Text | None = None
    craft: Text | None = None
    experience_years: Annotated[int, Field(ge=0, le=80)] | None = None


class SimulationProductionLine(RequestModel):
    id: Text
    capacity_per_hour: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    output_per_hour: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    mode: MachineMode


class SimulationProcessContext(RequestModel):
    simulated_at: datetime
    paused: bool
    speed: Literal[1, 10]
    phase: Text
    fault_asset_id: Text | None = None
    affected_asset_ids: list[Text] = Field(max_length=36)
    lines: list[SimulationProductionLine] = Field(max_length=8)


class SimulationImpactLine(RequestModel):
    id: Text
    name: Text
    capacity_per_hour: Annotated[float, Field(ge=0, allow_inf_nan=False)]


class SimulationCaseEvidence(RequestModel):
    case_id: Text
    asset_id: Text
    occurred_at: datetime
    attended_at: datetime | None = None
    fixed_at: datetime | None = None
    recovered_at: datetime | None = None
    interrupted: bool = False
    detection: SimulationReading
    topology_captured: bool
    affected_asset_ids: list[Text] = Field(max_length=36)
    lines: list[SimulationImpactLine] = Field(max_length=8)
    recovery_basis: Literal["scenario_timer"] = "scenario_timer"


class SimulationContext(RequestModel):
    captured_at: datetime
    selected_case_id: Text | None = None
    selected_assignment_id: Text | None = None
    equipment: list[SimulationEquipment] = Field(max_length=36)
    assignments: list[SimulationAssignment] = Field(max_length=5)
    cases: list[SimulationCase] = Field(max_length=10)
    case_evidence: SimulationCaseEvidence | None = None
    process: SimulationProcessContext | None = None


class Exchange(RequestModel):
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=3000)


class AssistantContext(RequestModel):
    incident_id: str | None = Field(default=None, pattern=r"^[a-f0-9-]{36}$")
    asset_id: str | None = Field(default=None, min_length=1, max_length=80)
    case_id: str | None = Field(default=None, pattern=r"^[a-f0-9-]{36}$")


class AssistantQuestion(AssistantContext):
    question: str = Field(min_length=1, max_length=1000)
    screen: Literal[
        "plant", "monitoring", "operators", "operations", "incidents", "maintenance", "memory", "plant-setup"
    ]
    history: list[Exchange] = Field(default_factory=list, max_length=6)
    simulation_context: SimulationContext | None = None


class AssistantSource(RequestModel):
    id: str
    title: str
    text: str


class AssistantCost(RequestModel):
    option_id: str
    name: str
    total_paise: int
    feasible: bool


class AssistantUsage(RequestModel):
    request_id: str
    status: str
    charged_micro_usd: int
    audio_seconds: int | None = None
    synthesis_characters: int | None = None


class AssistantAnswer(AssistantContext):
    case_revision: int | None = None
    captured_at: datetime | None = None
    answer: str
    citations: list[AssistantSource]
    navigation: list[str]
    calculation_version: str | None
    configuration_version: int
    costs: list[AssistantCost]
    provider: str
    answer_reference: str
    usage: AssistantUsage | None = None


class TranscriptionRequest(AssistantContext):
    audio_base64: str = Field(min_length=60, max_length=700000)


class TranscriptionResponse(RequestModel):
    transcript: str
    usage: AssistantUsage


class SpeechRequest(AssistantContext):
    answer_reference: str = Field(pattern=r"^[a-f0-9]{32}$")


class SpeechResponse(RequestModel):
    audio_base64: str
    mime_type: Literal["audio/mpeg"] = "audio/mpeg"
    usage: AssistantUsage
