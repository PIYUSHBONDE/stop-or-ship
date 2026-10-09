"""Contracts for shared plant access; identities and permissions are server-owned."""

import re
from typing import Literal

from pydantic import ConfigDict, Field, field_validator

from app.contracts.models import PlantSnapshot, RequestModel, ScenarioRequest
from app.contracts.monitoring import MonitoringView
from app.contracts.sources import SourceView
from app.plant.configuration import Identifier

Role = Literal["admin", "manager", "reliability", "technician", "viewer"]


class Credentials(RequestModel):
    # Passwords are never trimmed, lowercased or silently truncated.
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False, allow_inf_nan=False)
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        value = value.strip().casefold()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("A valid email address is required")
        return value


class SetupRequest(Credentials):
    password: str = Field(min_length=15, max_length=128)
    display_name: str = Field(min_length=2, max_length=80)
    organization_name: str = Field(min_length=2, max_length=80)
    plant_name: str = Field(min_length=2, max_length=80)

    @field_validator("display_name", "organization_name", "plant_name")
    @classmethod
    def nonblank_name(cls, value):
        if len(value.strip()) < 2:
            raise ValueError("At least two non-blank characters are required")
        return value.strip()


class AcceptInvitation(Credentials):
    password: str = Field(min_length=15, max_length=128)
    display_name: str = Field(min_length=2, max_length=80)
    token: str = Field(min_length=32, max_length=100)

    @field_validator("display_name")
    @classmethod
    def nonblank_name(cls, value):
        return SetupRequest.nonblank_name(value)


class InviteRequest(RequestModel):
    email: str = Field(max_length=254)
    role: Role

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return Credentials.normalize_email(value)


class MembershipUpdate(RequestModel):
    role: Role
    active: bool


class StaffUser(RequestModel):
    id: str
    email: str
    display_name: str


class PlantAccess(RequestModel):
    id: str
    organization_id: str
    organization_name: str
    name: str
    role: Role
    permissions: list[str]


class AccessState(RequestModel):
    available: bool
    setup_required: bool
    user: StaffUser | None = None
    plants: list[PlantAccess] = []
    identity_provider: str = "local_staff"


class InvitationReceipt(RequestModel):
    token: str
    email: str
    role: Role
    expires_at: str


class Member(StaffUser):
    role: Role
    active: bool


class WorkspaceContext(PlantAccess):
    user: StaffUser


class SharedPlantSnapshot(PlantSnapshot):
    sources: list[SourceView] = []
    measured_output_per_hour: float | None = None
    estimated_output_per_hour: int | None = None
    monitoring: MonitoringView | None = None
    workspace: WorkspaceContext


class WorkspaceApproval(RequestModel):
    option_id: Literal["stop", "defer", "derate", "continue"]
    calculation_version: str = Field(pattern=r"^[a-f0-9]{16}$")


class WorkspaceSourceRequest(ScenarioRequest):
    asset_id: Identifier | None = None


class DurableAuditEvent(RequestModel):
    sequence: int
    id: str
    at: str
    plant_id: str
    actor_id: str | None
    actor_name: str
    action: str
    incident_id: str | None
    calculation_version: str | None
    message: str


class AuditPage(RequestModel):
    items: list[DurableAuditEvent]
    next_cursor: int | None
