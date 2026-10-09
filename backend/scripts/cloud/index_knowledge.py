"""Cloud-only seed: embed permitted demo documents, store citation metadata and vectors."""

from google import genai
from google.cloud import firestore
from google.cloud.firestore_v1.vector import Vector

from app.ai.knowledge import documents
from app.core import config

if not config.PROJECT:
    raise SystemExit("Set GOOGLE_CLOUD_PROJECT; authenticate with application-default credentials")
client = genai.Client(vertexai=True, project=config.PROJECT, location=config.EMBEDDING_LOCATION)
db = firestore.Client(project=config.PROJECT)
for doc in documents():
    result = client.models.embed_content(
        model="gemini-embedding-001",
        contents=doc["text"],
        config={"output_dimensionality": 768, "task_type": "RETRIEVAL_DOCUMENT"},
    )
    for family in doc.get("equipment_families", ["pump", "cooler", "valve", "bearing"]):
        db.collection("knowledge").document(doc["id"] + "-" + family).set(
            {**doc, "equipment_family": family, "embedding": Vector(result.embeddings[0].values)}
        )
    print("Indexed " + doc["id"])
