import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

from app.core import config


class Store:
    """Atomic session mutations. No session state is authoritative in process memory."""

    def __init__(self, db_path=None, cloud=None):
        self.cloud = config.MODE == "cloud" if cloud is None else cloud
        if self.cloud:
            from google.cloud import firestore

            self.client = firestore.Client(project=config.PROJECT)
        else:
            self.path = db_path or config.DB
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            with self.connection() as db:
                db.execute("PRAGMA journal_mode=WAL")
                db.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner TEXT, data TEXT)")
                db.execute("CREATE TABLE IF NOT EXISTS budgets (day TEXT PRIMARY KEY, calls INTEGER)")
                from app.core.events import now
                from app.persistence.workspace_schema import migrate

                migrate(db, now())

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def create(self, session):
        if self.cloud:
            self.client.collection("sessions").document(session["id"]).create(session)
        else:
            with self.connection() as db:
                db.execute(
                    "INSERT INTO sessions VALUES (?, ?, ?)",
                    (session["id"], session["owner"], json.dumps(session)),
                )

    def read(self, id, owner):
        if not self.cloud:
            from app.persistence.workspace_store import read_runtime

            runtime = read_runtime(self, id, owner)
            if runtime is not None:
                return runtime
        if self.cloud:
            s = self.client.collection("sessions").document(id).get(timeout=8, retry=None).to_dict()
        else:
            with self.connection() as db:
                row = db.execute("SELECT data FROM sessions WHERE id=?", (id,)).fetchone()
                s = json.loads(row[0]) if row else None
        self.check(s, owner)
        return s

    @staticmethod
    def check(session, owner):
        if not session or session["owner"] != owner:
            raise HTTPException(404, "Session not found")

    def mutate(self, id, owner, fn, *, token=None, permission="plant.read", action="investigation.update"):
        if not self.cloud:
            from app.persistence.workspace_store import mutate_runtime

            found, result = mutate_runtime(self, id, owner, fn, token, permission, action)
            if found:
                return result
        if self.cloud:
            from google.cloud import firestore

            ref = self.client.collection("sessions").document(id)

            @firestore.transactional
            def apply(transaction):
                s = ref.get(transaction=transaction, timeout=8, retry=None).to_dict()
                self.check(s, owner)
                result = fn(s)
                transaction.set(ref, s)
                return result

            return apply(self.client.transaction())
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT data FROM sessions WHERE id=?", (id,)).fetchone()
            s = json.loads(row[0]) if row else None
            self.check(s, owner)
            result = fn(s)
            db.execute("UPDATE sessions SET data=? WHERE id=?", (json.dumps(s), id))
            return result

    def reserve_ai(self, reservation=None):
        from app.persistence.ai_usage import reserve

        return reserve(self, reservation)

    def settle_ai(self, request_id, owner, outcome):
        from app.persistence.ai_usage import settle

        return settle(self, request_id, owner, outcome)
