from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RequestModel(BaseModel):
    """Reject unknown fields and whitespace-only input at the API boundary."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class Status(StrEnum):
    HEALTHY = "healthy"
    DEGRADING = "degrading"
    INVESTIGATING = "investigating"
    CRITICAL = "critical"
    AFFECTED = "affected"
    STOPPED = "stopped"
    VERIFYING = "verifying"


class Plant(BaseModel):
    id: str
    name: str
    simulation: bool = True
    currency: str = "INR"


class Area(BaseModel):
    id: str
    name: str
    purpose: str
    nominal_units_per_hour: int = 0


class Asset(BaseModel):
    id: str
    name: str
    type: str
    area_id: str
    purpose: str
    position: list[float] = Field(min_length=3, max_length=3)
    status: Status = Status.HEALTHY
    diagnostic_profile: Literal["pump", "bearing", "valve", "cooler"] | None = None


class Signal(BaseModel):
    asset_id: str
    signal_id: str
    timestamp: str
    value: float
    unit: str
    provenance: Literal["measured_replay", "synthetic"]
    source_cycle_id: int | None = None
    source_dataset_id: str | None = None
    source_record_id: str | None = None


class Dependency(BaseModel):
    source: str
    target: str
    relationship: str
    capacity_fraction: float = Field(ge=0, le=1)


class Evidence(BaseModel):
    id: str
    source: str
    section: str
    version: str
    provenance: str
    text: str


class Hypothesis(BaseModel):
    cause: str
    confidence: Literal["low", "medium", "high"]
    supporting_evidence: list[str] = Field(min_length=1)
    conflicting_evidence: list[str] = []


class RolePosition(BaseModel):
    role: Literal["Reliability", "Production"]
    preferred_option: str
    explanation: str


class InvestigationResult(BaseModel):
    summary: str
    hypotheses: list[Hypothesis] = Field(min_length=1, max_length=3)
    missing_information: list[str]
    citations: list[str]
    roles: list[RolePosition] = Field(max_length=2)


class DecisionOption(BaseModel):
    id: Literal["stop", "defer", "derate", "continue"]
    name: str
    feasible: bool
    constraint: str | None
    repair_cost_paise: int
    lost_margin_paise: int
    penalty_paise: int
    failure_exposure_paise: int
    total_paise: int
    failure_probability: float
    lost_units: int
    downtime_minutes: int


class Incident(BaseModel):
    id: str
    asset_id: str
    state: str
    severity: str
    created_at: str
    evidence: list[Evidence]
    diagnosis: InvestigationResult | None = None


class Approval(BaseModel):
    option_id: str
    calculation_version: str
    approver: str
    timestamp: str
    actor_id: str | None = None


class WorkOrder(BaseModel):
    id: str
    incident_id: str
    approval: Approval
    procedure: str
    status: str
    option: DecisionOption
    calculation_snapshot: dict
    superseded_at: str | None = None
    superseded_reason: str | None = None


class VerifiedCase(BaseModel):
    id: str
    asset_id: str
    incident_id: str
    observed_cause: str
    fix: str
    parts: str
    outcome: str
    verified_at: str
    original_diagnosis: InvestigationResult | None


class ScenarioRequest(RequestModel):
    scenario: Literal[
        "pump_degradation",
        "cooler_degradation",
        "valve_degradation",
        "bearing_degradation",
        "sensor_uncertainty",
        "memory_recurrence",
    ]


class ReplayRequest(RequestModel):
    action: Literal["play", "pause", "step"]


class CalculationRequest(RequestModel):
    risk_multiplier: float = Field(default=1, ge=0.25, le=3)


class ApprovalRequest(RequestModel):
    option_id: Literal["stop", "defer", "derate", "continue"]
    calculation_version: str = Field(pattern=r"^[a-f0-9]{16}$")
    approver: str = Field(min_length=2, max_length=80)


class RepairRequest(RequestModel):
    observed_cause: str = Field(min_length=3, max_length=500)
    fix: str = Field(min_length=3, max_length=1000)
    parts: str = Field(max_length=500)
    outcome: str = Field(min_length=3, max_length=500)
    recovery: Literal["healthy", "failed"] = "healthy"


class QuestionRequest(RequestModel):
    question: str = Field(min_length=3, max_length=500)


class InvestigationJob(RequestModel):
    session_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    owner: str = Field(min_length=1, max_length=128)
    generation: str = Field(pattern=r"^[a-f0-9-]{36}$")
    incident_id: str = Field(pattern=r"^[a-f0-9-]{36}$")


class MemoryResponse(BaseModel):
    cases: list[VerifiedCase]


class GroundedAnswer(RequestModel):
    answer: str = Field(min_length=1, max_length=4000)
    citations: list[str] = Field(max_length=8)


class QuestionResponse(GroundedAnswer):
    provider: str
    evidence: list[Evidence]


class Calculation(BaseModel):
    options: list[DecisionOption]
    recommended: Literal["stop", "defer", "derate", "continue"]
    assumptions: dict
    risk_multiplier: float
    sensitivity: list["Sensitivity"]


class Sensitivity(BaseModel):
    multiplier: float
    recommended: str


class ProgressRecord(BaseModel):
    at: float
    message: str
    status: Literal["running", "completed", "unavailable"] = "completed"


class IncidentPlantContext(BaseModel):
    name: str
    areas: list[Area]
    assets: list[Asset]
    dependencies: list[Dependency]


class RuntimeIncident(Incident):
    plant_configuration_version: int | None = None
    plant_context: IncidentPlantContext | None = None
    profile_id: str = "pump"
    affected_lines: list[str] = []
    progress: list[ProgressRecord]
    calculation: Calculation
    calculation_version: str
    calculation_revision: int = 1
    safety_stop: bool = False
    safety_evidence: list[Signal] = []
    roles_calculation_version: str | None = None
    decision_changed_reason: str | None = None
    decision_changes: list["DecisionChange"] = []
    work_order: WorkOrder | None
    verification_windows: int
    attempts: int
    provider: str | None = None
    error: str | None = None
    verification_message: str | None = None
    repair: dict | None = None
    repair_attempts: list[dict] = []
    superseded_work_orders: list[WorkOrder] = []
    model_calls: int = 0


class DecisionChange(BaseModel):
    at: str
    reason: str
    previous_version: str
    calculation_version: str


class TelemetryWindow(BaseModel):
    window: int
    signals: list[Signal]
    baseline: dict[str, float]
    deviations: dict[str, float]
    feature_deviations: dict[str, float] = {}
    anomaly: bool
    score: float
    sensor_disagreement: bool
    provenance: str
    source_cycle_id: int | None


class AuditEvent(BaseModel):
    at: str
    message: str


class PlantSnapshot(BaseModel):
    configuration_version: int | None = None
    active_source_count: int = 0
    id: str
    generation: str
    plant: Plant
    areas: list[Area]
    assets: list[Asset]
    dependencies: list[Dependency]
    signals: dict[str, list[Signal]]
    scenario: str | None
    window: int
    running: bool
    incident: RuntimeIncident | None
    incidents: list[RuntimeIncident] = []
    scenarios: list["ScenarioDefinition"] = []
    affected: list[str]
    history: list[TelemetryWindow]
    memory: list[VerifiedCase]
    events: list[AuditEvent]
    quotas: dict[str, int]
    output_per_hour: int
    nominal_output_per_hour: int
    line_output_per_hour: dict[str, int] = {}
    data_mode: str
    simulated_minutes: int


class ScenarioDefinition(BaseModel):
    id: str
    name: str
    asset_id: str
    profile_id: str
    provenance: str
    measured_available: bool
    requires_memory: bool = False


# Resolve forward references before other contract modules subclass these models.
RuntimeIncident.model_rebuild()
PlantSnapshot.model_rebuild()
