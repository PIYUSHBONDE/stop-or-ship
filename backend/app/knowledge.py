import json
import re

from . import config
from .models import Evidence


def documents():
    return json.loads((config.DATA / "knowledge.json").read_text(encoding="utf-8"))


def local_search(query, memory):
    words = set(re.findall(r"[a-z]+", query.lower()))
    equipment = re.match(r"equipment:(pump|cooler|valve|bearing)\b", query)
    docs = [
        doc
        for doc in documents()
        if not equipment or equipment[1] in doc.get("equipment_families", [equipment[1]])
    ]
    for case in memory:
        docs.append(
            {
                "id": case["id"],
                "source": "Verified repair " + case["incident_id"][:8],
                "section": case["asset_id"] + " / confirmed outcome",
                "version": "1.0",
                "provenance": case["provenance"],
                "text": f"Confirmed cause: {case['observed_cause']}. Fix: {case['fix']}. Outcome: {case['outcome']}",
            }
        )
    docs.sort(
        key=lambda d: (
            d["id"].startswith("case-"),
            (10 if equipment and d["id"] == "sop-" + equipment[1] + "-01" else 0)
            + len(words & set(re.findall(r"[a-z]+", d["text"].lower()))),
        ),
        reverse=True,
    )
    return [Evidence.model_validate(d).model_dump() for d in docs[:5]]


def cloud_search(query, memory):
    from google.cloud import firestore
    from google.cloud.firestore_v1.base_query import FieldFilter
    from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
    from google.cloud.firestore_v1.vector import Vector

    from .ai_client import client as model_client

    client = model_client(embedding=True)
    embedding = (
        client.models.embed_content(
            model="gemini-embedding-001",
            contents=query,
            config={"output_dimensionality": 768, "task_type": "RETRIEVAL_QUERY"},
        )
        .embeddings[0]
        .values
    )
    client.close()
    db = firestore.Client(project=config.PROJECT)
    collection = db.collection("knowledge")
    equipment = re.match(r"equipment:(pump|cooler|valve|bearing)\b", query)
    if equipment:
        collection = collection.where(filter=FieldFilter("equipment_family", "==", equipment[1]))
    query_ref = collection.find_nearest(
        vector_field="embedding",
        query_vector=Vector(embedding),
        distance_measure=DistanceMeasure.COSINE,
        limit=4,
    )
    found = [
        Evidence.model_validate({k: v for k, v in doc.to_dict().items() if k != "embedding"}).model_dump()
        for doc in query_ref.get(timeout=8, retry=None)
    ]
    # Session-scoped verified cases are prioritized without exposing another judge's repair memory.
    verified = [d for d in local_search(query, memory) if d["id"].startswith("case-")]
    return (verified + found)[:6]


def search(query, memory):
    return cloud_search(query, memory) if config.MODE == "cloud" else local_search(query, memory)
