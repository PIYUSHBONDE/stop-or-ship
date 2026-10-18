"""Restart-safe case coordinator. Run with python -m app.cases.worker."""

import argparse
import asyncio
import hashlib
import json
import logging
import time

from app.cases import jobs
from app.cases.agent import scripted, validate_output
from app.cases.mcp_client import collect
from app.cases.service import create_task, event, row
from app.core import config
from app.persistence.store import create_store

QUESTIONS = {
    "measurement": "Provide an independent measurement using the site's approved procedure, or report that it is unavailable.",
    "status_update": "Record actual production output, its time window and the current operating condition, or report unavailable data.",
    "review_evidence": "Review the cited evidence and record the finding, remaining uncertainty or unavailable information.",
}


def require_case_evaluation():
    if not config.REQUIRE_RELEASE_GATES:
        return

    from app.ai.assistant_gate import require_assistant_evaluation
    from app.ai.evaluation_gate import fingerprint

    require_assistant_evaluation()
    try:
        with open(config.CASES_EVALUATION_FILE, encoding="utf-8") as source:
            report = json.load(source)
        valid = (
            report["passed"] is True
            and report["fingerprint"] == fingerprint()
            and report["real_model_responses"] is True
            and report["provider"] == config.AI_PROVIDER
            and report["model"] == config.MODEL
        )
        valid = (
            valid
            and {c["name"] for c in report["cases"]}
            == {"production_report", "missing_observations", "injected_report", "human_resume"}
            and all(c["passed"] for c in report["cases"])
            and len(report["cases"]) == 4
        )
    except (OSError, ValueError, KeyError, TypeError):
        valid = False
    if not valid:
        raise RuntimeError("Case automation requires matching real-provider evaluation")


def model_context(context):
    # Numeric monetary comparisons remain exclusively in the deterministic UI.
    values = dict(context)
    comparison = context["intervention_comparison"]
    calculated = comparison.get("calculation") or {}
    values["intervention_comparison"] = {
        "id": comparison["id"],
        "calculation_version": comparison["calculation_version"],
        "options": [{"id": o["id"], "feasible": o["feasible"]} for o in calculated.get("options", [])],
        "note": "Saved monetary amounts are displayed by the deterministic cost UI, not generated here.",
    }
    return values


def allowed_ids(context):
    allowed = {source["id"] for source in context.values()}
    allowed.update(r["id"] for r in context["case_evidence"]["submissions"])
    allowed.update(r["id"] for r in context["search_knowledge"]["shared_references"])
    allowed.update(r["id"] for r in context["search_knowledge"]["verified_repairs"])
    return allowed


async def domain_investigation(store, job, case):
    """Reuse the existing authoritative incident pipeline, with durable stage checkpoints."""
    if not case["incident_id"]:
        return
    from app.ai.agent import investigate
    from app.persistence.workspace_store import internal_owner

    with store.connection() as db:
        incident_row = row(
            db,
            "SELECT i.state,w.id,w.data FROM plant_incidents i JOIN plant_workflows w ON w.id=i.workflow_id WHERE i.id=? AND i.plant_id=?",
            (case["incident_id"], case["plant_id"]),
        )
    if incident_row["state"] not in {"detected", "investigation_failed", "investigating"}:
        return
    state = json.loads(incident_row["data"])

    def guard():
        with store.connection() as db:
            jobs.validate(db, job["id"], job["lease_token"])

    async def checkpoint(name, schema, payload, execute):
        stage_name = "domain_" + name
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        saved = jobs.step(store, job, stage_name, digest)
        if saved:
            return (
                schema.model_validate(saved["raw"]).model_dump()
                if name == "investigator"
                else schema.model_validate(saved["raw"])
            )
        result = await execute()
        raw = result.model_dump() if hasattr(result, "model_dump") else result
        jobs.step(
            store,
            job,
            stage_name,
            digest,
            {
                "raw": raw,
                "summary": raw.get("summary", raw.get("explanation", "; ".join(raw.get("cautions", []))))[
                    :1200
                ],
                "citations": raw.get("citations", []),
            },
        )
        return result

    if state["incident"].get("attempts", 0) >= 2:
        raise RuntimeError("Domain investigation attempt allowance exhausted")
    if state["incident"].get("lease_until", 0) > time.time():
        raise RuntimeError("Domain investigation is already owned")
    if incident_row["state"] != "detected":

        def reset(current):
            guard()
            current["incident"].update(state="detected", lease_until=0)
            current["incident"].pop("deadline_at", None)

        store.mutate(incident_row["id"], internal_owner(case["plant_id"]), reset)
    await investigate(
        store,
        {
            "session_id": incident_row["id"],
            "owner": internal_owner(case["plant_id"]),
            "generation": state["generation"],
            "incident_id": case["incident_id"],
            "case_job_id": job["id"],
            "case_lease_token": job["lease_token"],
        },
        execution_guard=guard,
        checkpoint=checkpoint,
    )
    with store.connection() as db:
        finished = db.execute(
            "SELECT state FROM plant_incidents WHERE id=?", (case["incident_id"],)
        ).fetchone()[0]
    if finished == "investigation_failed":
        raise RuntimeError("Domain investigation incomplete; retained evidence is available")


async def process(store, job, *, provider=None, collector=collect, evaluation=False):
    try:
        if config.AI_PROVIDER != "scripted" and provider is None and not evaluation:
            require_case_evaluation()
        with store.connection() as db:
            _, run, case, selected = jobs.validate(db, job["id"], job["lease_token"])
        await domain_investigation(store, job, case)
        context_hash = f"analysis:{run['analysis_version']}"
        context = jobs.step(store, job, "context", context_hash)
        if context is None:
            jobs.start_step(store, job, "context", context_hash)
            context = await asyncio.wait_for(collector(store, job), 30)
            jobs.step(store, job, "context", context_hash, context)
        allowed = allowed_ids(context)
        outputs = {}
        for stage in ("investigator", "reviewer", "Reliability", "Production"):
            jobs.heartbeat(store, job)
            payload = {"sources": model_context(context), "prior_stages": outputs}
            digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
            result = jobs.step(store, job, stage, digest)
            if result is None:
                jobs.start_step(store, job, stage, digest)
                if provider:
                    result = await provider(stage, payload)
                elif config.AI_PROVIDER == "scripted":
                    result = scripted(stage, context)
                else:
                    from app.cases.agent import live_stage

                    result = await live_stage(store, job, run, stage, payload, evaluation=evaluation)
                result = validate_output(result, allowed)
                jobs.step(store, job, stage, digest, result)
            outputs[stage] = result
        with store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            _, _, case, selected = jobs.validate(db, job["id"], job["lease_token"])
            proposals = outputs["investigator"]["requests"]
            if outputs["reviewer"]["unsupported_claims"]:
                proposals = [
                    {
                        "kind": "review_evidence",
                        "target_role": "reliability",
                        "reason": "Independent evidence review flagged unsupported claims.",
                    }
                ]
            outstanding = db.execute(
                "SELECT 1 FROM issue_tasks WHERE case_id=? AND state IN ('open','claimed')", (case["id"],)
            ).fetchone()
            repeated_request = False
            if selected["request_information"] and not outstanding:
                for proposal in proposals:
                    suffix = ":" + proposal["kind"] + ":" + proposal["target_role"]
                    # A completed request is a human answer, including unavailable data.
                    # Do not create an endless request loop across analysis revisions.
                    answered = db.execute(
                        "SELECT 1 FROM issue_tasks WHERE case_id=? AND state='completed' AND request_key LIKE ?",
                        (case["id"], "analysis:%" + suffix),
                    ).fetchone()
                    if answered:
                        repeated_request = True
                        event(
                            db,
                            case,
                            "analysis.evidence_gap",
                            "Previous finding retained. Required evidence remains unresolved; a reviewer must decide the next information request.",
                        )
                        continue
                    # Bounded fixed questions, not executable instructions authored by a model.
                    asset = case.get("asset_id") or "this plant"
                    claim = "; ".join(outputs["reviewer"].get("unsupported_claims", []))[:600]
                    create_task(
                        db,
                        case,
                        QUESTIONS[proposal["kind"]] + " Equipment: " + asset + ".",
                        proposal["reason"]
                        + (
                            " Claim needing review: " + claim
                            if proposal["kind"] == "review_evidence" and claim
                            else ""
                        ),
                        "State what was checked, when, and the result. Include available measurements with units and capture time, or explain what cannot be checked. Use only site-approved procedures. A statement does not verify a repair.",
                        proposal["target_role"],
                        request_key="analysis:"
                        + str(case["analysis_version"])
                        + ":"
                        + proposal["kind"]
                        + ":"
                        + proposal["target_role"],
                    )
            if selected["record_findings"]:
                event(
                    db,
                    case,
                    "analysis.findings",
                    "Advisory findings recorded; human/domain authorization unchanged",
                )
        jobs.finish(store, job, "blocked" if repeated_request else "awaiting_decision")
    except asyncio.CancelledError:
        # A killed worker leaves its lease for reconciliation; no successful result is invented.
        raise
    except Exception as error:
        jobs.finish(store, job, "blocked", error=type(error).__name__)


async def run_once(store, *, job_id=None, **kwargs):
    if not config.CASES_ENABLED:
        return False
    jobs.escalate_overdue(store)
    job = jobs.claim(store, job_id=job_id)
    if not job:
        return False
    await process(store, job, **kwargs)
    return True


async def main(once=False, drain=False):
    if config.MODE != "local":
        raise RuntimeError("This worker is local-only; production adapters require separate acceptance")
    if config.AI_PROVIDER == "scripted" and not config.INTERNAL_TEST_MODE:
        raise RuntimeError("Scripted AI is test-only. Configure a live provider for application use.")
    store = create_store()
    while True:
        try:
            worked = await run_once(store)
        except Exception as error:
            logging.getLogger(__name__).error("case_worker_unavailable error_type=%s", type(error).__name__)
            worked = False
        if once:
            return
        if drain and not worked:
            return
        if not worked:
            await asyncio.sleep(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument(
        "--drain", action="store_true", help="Process queued work then exit; useful for isolated acceptance"
    )
    args = parser.parse_args()
    asyncio.run(main(args.once, args.drain))
