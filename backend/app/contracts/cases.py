"""Public case/task contracts; authority and provenance are server-owned."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import ConfigDict, Field, field_validator

from app.contracts.models import Hypothesis, RequestModel

Text = Annotated[str, Field(min_length=1, max_length=3000)]
Category = Literal["equipment", "production", "maintenance", "quality", "staffing", "materials", "general"]
TaskRole = Literal["reliability", "manager", "technician"]
TaskAssignment = Literal["all", "mine", "available"]
Phase = Literal[
    "triage",
    "investigating",
    "waiting_for_input",
    "awaiting_decision",
    "in_progress",
    "verifying",
    "resolved",
    "blocked",
    "cancelled",
]


class CaseCreate(RequestModel):
    title: str = Field(min_length=2, max_length=160)
    description: Text
    category: Category
    asset_id: str | None = Field(default=None, min_length=1, max_length=80)


class CaseMutation(RequestModel):
    expected_revision: int = Field(ge=1)


class TaskCreate(CaseMutation):
    question: Text
    reason: Text
    completion_requirements: Text
    target_role: TaskRole
    due_at: datetime | None = None

    @field_validator("due_at")
    @classmethod
    def timezone(cls, value):
        if value is not None and value.utcoffset() is None:
            raise ValueError("Due date needs a UTC offset")
        return value


class EvidenceValue(RequestModel):
    signal_id: str = Field(min_length=1, max_length=80)
    value: float = Field(allow_inf_nan=False)
    unit: str = Field(min_length=1, max_length=30)


class TaskResponse(CaseMutation):
    text: Text
    values: list[EvidenceValue] = Field(default_factory=list, max_length=16)


class CaseOutcome(CaseMutation):
    outcome: Text
    evidence_ids: list[str] = Field(min_length=1, max_length=12)


class CaseCancel(CaseMutation):
    reason: Text


class CaseLink(CaseMutation):
    incident_id: str = Field(pattern=r"^[a-f0-9-]{36}$")


class PolicyUpdate(RequestModel):
    expected_version: int = Field(ge=0)
    enabled: bool
    request_information: bool = True
    record_findings: bool = True
    escalate_overdue: bool = True


class AutomationPolicy(RequestModel):
    version: int
    enabled: bool
    request_information: bool
    record_findings: bool
    escalate_overdue: bool


class ViewModel(RequestModel):
    model_config = ConfigDict(extra="ignore")


class CaseView(CaseCreate):
    model_config = ConfigDict(extra="ignore")
    id: str
    organization_id: str
    plant_id: str
    incident_id: str | None
    phase: Phase
    revision: int
    analysis_version: int
    created_at: str
    updated_at: str
    created_by: str | None
    origin: Literal["staff_report", "plant_observation"]
    outcome: str | None = None
    next_action: str | None = None
    next_owner: str | None = None


class HumanTask(ViewModel):
    id: str
    organization_id: str
    plant_id: str
    case_id: str
    target_role: TaskRole
    owner_id: str | None
    owner_name: str | None = None
    state: Literal["open", "claimed", "completed", "cancelled"]
    revision: int
    due_at: str | None
    created_at: str
    question: str
    reason: str
    completion_requirements: str
    escalated: bool = False


class EvidenceSubmission(ViewModel):
    id: str
    actor_id: str | None
    actor_name: str | None = None
    created_at: str
    origin: Literal["staff_report", "technician_statement", "manager_outcome"]
    text: str
    values: list[EvidenceValue] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)


class AgentStepView(ViewModel):
    stage: str
    state: str
    updated_at: str
    summary: str = ""
    citations: list[str] = Field(default_factory=list)
    error: str | None = None
    hypotheses: list[Hypothesis] = Field(default_factory=list)
    unsupported_claims: list[str] = Field(default_factory=list)


class CaseSource(ViewModel):
    id: str
    title: str
    status: Literal["recorded", "missing", "reference"]
    text: str


class AgentRunView(ViewModel):
    id: str
    analysis_version: int
    provider: str
    state: str
    created_at: str
    steps: list[AgentStepView]
    error: str | None = None
    sources: list[CaseSource] = Field(default_factory=list)


class CaseEvent(ViewModel):
    sequence: int
    at: str
    actor_id: str | None
    action: str
    message: str


class CasePage(RequestModel):
    items: list[CaseView]
    next_cursor: int | None


class TaskPage(RequestModel):
    items: list[HumanTask]
    next_cursor: int | None
    actionable_count: int = Field(ge=0)


class CaseDetail(RequestModel):
    case: CaseView
    tasks: list[HumanTask]
    evidence: list[EvidenceSubmission]
    runs: list[AgentRunView]
    events: list[CaseEvent]
