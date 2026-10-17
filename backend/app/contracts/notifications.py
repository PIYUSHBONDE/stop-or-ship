"""Plant-scoped actionable notifications and actor-owned read acknowledgements."""

from typing import Literal

from pydantic import Field

from app.contracts.models import RequestModel


class NotificationRead(RequestModel):
    notification_id: str = Field(min_length=8, max_length=82, pattern=r"^[a-z0-9:-]+$")


class Notification(RequestModel):
    id: str
    kind: Literal["human_request", "analysis_ready", "blocked", "recurring_issue"]
    case_id: str
    task_id: str | None = None
    asset_id: str | None = None
    title: str
    message: str
    ai_summary: str | None = None
    created_at: str
    read: bool


class NotificationPage(RequestModel):
    items: list[Notification]
    unread_count: int
    next_cursor: int | None


class NotificationAcknowledgement(RequestModel):
    notification_id: str
    read: bool = True
