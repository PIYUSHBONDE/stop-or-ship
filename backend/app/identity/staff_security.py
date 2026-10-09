"""Local named staff identity. Tokens are opaque, expiring and stored only as hashes."""

import hashlib
import hmac
import secrets
import threading

from fastapi import HTTPException

COOKIE = "plantsense_staff"
SESSION_SECONDS = 8 * 60 * 60
INVITATION_SECONDS = 48 * 60 * 60
_hash_slots = threading.BoundedSemaphore(2)
_salt = b"PlantSense timing equalization salt"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _derive(password: str, salt: bytes) -> bytes:
    if not _hash_slots.acquire(timeout=2):
        raise HTTPException(429, "Sign-in is busy; please retry shortly")
    try:
        # OWASP scrypt minimum, bounded concurrency and no new dependency.
        return hashlib.scrypt(password.encode(), salt=salt, n=2**17, r=8, p=1, maxmem=256 * 1024 * 1024)
    finally:
        _hash_slots.release()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return "scrypt-v1$" + salt.hex() + "$" + _derive(password, salt).hex()


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        _derive(password, _salt)
        return False
    version, salt, expected = stored.split("$")
    if version != "scrypt-v1":
        return False
    return hmac.compare_digest(_derive(password, bytes.fromhex(salt)), bytes.fromhex(expected))


PERMISSIONS = {
    "admin": {
        "plant.read",
        "plant.manage",
        "plant.configure",
        "incident.review",
        "incident.approve",
        "repair.write",
        "staff.manage",
    },
    "manager": {"plant.read", "plant.manage", "incident.review", "incident.approve", "repair.write"},
    "reliability": {"plant.read", "incident.review"},
    "technician": {"plant.read", "repair.write"},
    "viewer": {"plant.read"},
}
