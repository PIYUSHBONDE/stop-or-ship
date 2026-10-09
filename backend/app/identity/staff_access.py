"""Local staff enrollment and plant authorization, separate from demo identities."""

import secrets
import time
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.events import now
from app.identity.staff_security import (
    INVITATION_SECONDS,
    PERMISSIONS,
    SESSION_SECONDS,
    hash_password,
    token_hash,
    verify_password,
)
from app.plant.catalog import seed_catalog


def available(store):
    # A cloud adapter and managed named identity must pass a separate deployment gate.
    if store.cloud:
        raise HTTPException(503, "Shared staff access is currently available in local development only")


def authenticate(db, token):
    if not token or not 32 <= len(token) <= 100:
        raise HTTPException(401, "Staff sign-in required")
    row = db.execute(
        "SELECT u.id,u.email,u.display_name FROM staff_sessions s JOIN staff_users u ON u.id=s.user_id "
        "WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1",
        (token_hash(token), time.time()),
    ).fetchone()
    if not row:
        raise HTTPException(401, "Staff session expired; please sign in")
    return dict(zip(("id", "email", "display_name"), row))


def authorize(db, token, plant_id, permission="plant.read"):
    user = authenticate(db, token)
    row = db.execute(
        "SELECT p.organization_id,o.name,p.name,m.role FROM memberships m "
        "JOIN plants p ON p.id=m.plant_id JOIN organizations o ON o.id=p.organization_id "
        "WHERE m.plant_id=? AND m.user_id=? AND m.active=1",
        (plant_id, user["id"]),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Plant not found")
    permissions = PERMISSIONS[row[3]]
    if permission not in permissions:
        raise HTTPException(403, "Your plant role does not permit this action")
    return {
        "id": plant_id,
        "organization_id": row[0],
        "organization_name": row[1],
        "name": row[2],
        "role": row[3],
        "permissions": sorted(permissions),
        "user": user,
    }


def audit(db, plant_id, actor, action, message, incident=None, event_id=None, at=None):
    db.execute(
        "INSERT OR IGNORE INTO plant_audit "
        "(id,plant_id,at,actor_id,actor_name,action,incident_id,calculation_version,message) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (
            event_id or str(uuid.uuid4()),
            plant_id,
            at or now(),
            actor["id"] if actor else None,
            actor["display_name"] if actor else "System",
            action,
            incident["id"] if incident else None,
            incident.get("calculation_version") if incident else None,
            message,
        ),
    )


def rate_limit(store, email):
    available(store)
    current = time.time()
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM auth_limits WHERE started_at<?", (current - 300,))
        for bucket, limit in (("global", 60), ("email:" + token_hash(email), 8)):
            row = db.execute("SELECT attempts FROM auth_limits WHERE bucket=?", (bucket,)).fetchone()
            if row and row[0] >= limit:
                raise HTTPException(429, "Too many sign-in attempts; retry in five minutes")
            db.execute(
                "INSERT INTO auth_limits VALUES (?,?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1",
                (bucket, current),
            )


def access_state(store, token):
    if store.cloud:
        return {"available": False, "setup_required": False, "user": None, "plants": []}
    with store.connection() as db:
        setup = not db.execute("SELECT 1 FROM staff_users LIMIT 1").fetchone()
        try:
            user = authenticate(db, token)
        except HTTPException:
            user = None
        plants = []
        if user:
            for (plant_id,) in db.execute(
                "SELECT plant_id FROM memberships WHERE user_id=? AND active=1", (user["id"],)
            ):
                context = authorize(db, token, plant_id)
                context.pop("user")
                plants.append(context)
        return {"available": True, "setup_required": setup, "user": user, "plants": plants}


def issue_session(db, user_id):
    token = secrets.token_urlsafe(32)
    db.execute("DELETE FROM staff_sessions WHERE expires_at<=?", (time.time(),))
    db.execute(
        "INSERT INTO staff_sessions VALUES (?,?,?)",
        (token_hash(token), user_id, time.time() + SESSION_SECONDS),
    )
    return token


def setup(store, request):
    rate_limit(store, request.email)
    password_hash = hash_password(request.password)
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM staff_users LIMIT 1").fetchone():
            raise HTTPException(409, "Initial setup is complete; sign in or accept a staff invitation")
        organization, plant, user = (str(uuid.uuid4()) for _ in range(3))
        db.execute("INSERT INTO organizations VALUES (?,?)", (organization, request.organization_name))
        db.execute("INSERT INTO plants VALUES (?,?,?)", (plant, organization, request.plant_name))
        seed_catalog(db, plant)
        db.execute(
            "INSERT INTO staff_users VALUES (?,?,?,?,1)",
            (user, request.email, request.display_name, password_hash),
        )
        db.execute("INSERT INTO memberships VALUES (?,?,?,1)", (plant, user, "admin"))
        actor = {"id": user, "display_name": request.display_name}
        audit(db, plant, actor, "plant.created", "Plant created with its initial administrator")
        return issue_session(db, user)


def sign_in(store, request):
    rate_limit(store, request.email)
    with store.connection() as db:
        row = db.execute(
            "SELECT id,password_hash FROM staff_users WHERE email=? AND enabled=1", (request.email,)
        ).fetchone()
    if not verify_password(request.password, row[1] if row else None):
        raise HTTPException(401, "Email or password is incorrect")
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        if not db.execute("SELECT 1 FROM staff_users WHERE id=? AND enabled=1", (row[0],)).fetchone():
            raise HTTPException(401, "Email or password is incorrect")
        return issue_session(db, row[0])


def sign_out(store, token):
    available(store)
    with store.connection() as db:
        db.execute("DELETE FROM staff_sessions WHERE token_hash=?", (token_hash(token or ""),))


def invite(store, token, plant_id, request):
    available(store)
    raw_token = secrets.token_urlsafe(32)
    expires = time.time() + INVITATION_SECONDS
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        context = authorize(db, token, plant_id, "staff.manage")
        db.execute(
            "INSERT INTO invitations VALUES (?,?,?,?,?,NULL,?)",
            (token_hash(raw_token), plant_id, request.email, request.role, expires, context["user"]["id"]),
        )
        audit(
            db,
            plant_id,
            context["user"],
            "staff.invited",
            "Staff invitation created for role " + request.role,
        )
    return {
        "token": raw_token,
        "email": request.email,
        "role": request.role,
        "expires_at": datetime.fromtimestamp(expires, timezone.utc).isoformat(),
    }


def accept_invitation(store, current_token, request):
    rate_limit(store, request.email)
    password_hash = hash_password(request.password)
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        invitation = db.execute(
            "SELECT i.plant_id,i.role FROM invitations i JOIN memberships m ON m.plant_id=i.plant_id AND m.user_id=i.created_by "
            "WHERE i.token_hash=? AND i.email=? AND i.expires_at>? AND i.accepted_at IS NULL AND m.active=1 AND m.role='admin'",
            (token_hash(request.token), request.email, time.time()),
        ).fetchone()
        if not invitation:
            raise HTTPException(409, "Invitation is invalid, expired or already accepted")
        existing = db.execute("SELECT id FROM staff_users WHERE email=?", (request.email,)).fetchone()
        if existing:
            # An invitation must never reset an existing user's password or impersonate them.
            actor = authenticate(db, current_token)
            if actor["id"] != existing[0]:
                raise HTTPException(
                    403, "Sign in to the existing staff account before accepting this invitation"
                )
            user_id = existing[0]
        else:
            user_id = str(uuid.uuid4())
            db.execute(
                "INSERT INTO staff_users VALUES (?,?,?,?,1)",
                (user_id, request.email, request.display_name, password_hash),
            )
            actor = {"id": user_id, "display_name": request.display_name}
        if db.execute(
            "SELECT 1 FROM memberships WHERE plant_id=? AND user_id=?", (invitation[0], user_id)
        ).fetchone():
            raise HTTPException(409, "Membership already exists; an administrator must update it")
        db.execute("INSERT INTO memberships VALUES (?,?,?,1)", (invitation[0], user_id, invitation[1]))
        db.execute(
            "UPDATE invitations SET accepted_at=? WHERE token_hash=?", (now(), token_hash(request.token))
        )
        audit(db, invitation[0], actor, "staff.joined", "Staff invitation accepted for role " + invitation[1])
        return issue_session(db, user_id)


def members(store, token, plant_id):
    available(store)
    with store.connection() as db:
        authorize(db, token, plant_id, "staff.manage")
        rows = db.execute(
            "SELECT u.id,u.email,u.display_name,m.role,m.active FROM memberships m "
            "JOIN staff_users u ON u.id=m.user_id WHERE m.plant_id=? ORDER BY u.display_name",
            (plant_id,),
        ).fetchall()
        return [dict(zip(("id", "email", "display_name", "role", "active"), row)) for row in rows]


def update_member(store, token, plant_id, user_id, request):
    available(store)
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        context = authorize(db, token, plant_id, "staff.manage")
        target = db.execute(
            "SELECT role,active FROM memberships WHERE plant_id=? AND user_id=?", (plant_id, user_id)
        ).fetchone()
        if not target:
            raise HTTPException(404, "Member not found")
        if target == ("admin", 1) and (request.role != "admin" or not request.active):
            admins = db.execute(
                "SELECT COUNT(*) FROM memberships WHERE plant_id=? AND role='admin' AND active=1", (plant_id,)
            ).fetchone()[0]
            if admins <= 1:
                raise HTTPException(409, "The plant must retain an active administrator")
        db.execute(
            "UPDATE memberships SET role=?,active=? WHERE plant_id=? AND user_id=?",
            (request.role, int(request.active), plant_id, user_id),
        )
        audit(
            db,
            plant_id,
            context["user"],
            "staff.access_changed",
            f"Membership {user_id} changed from {target[0]}/{bool(target[1])} to {request.role}/{request.active}",
        )
