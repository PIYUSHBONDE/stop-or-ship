"""Produce an honest proposal PDF from the implemented prototype and measured local evidence."""

import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "artifacts"
OUT.mkdir(parents=True, exist_ok=True)
styles = getSampleStyleSheet()
styles["Title"].textColor = colors.HexColor("#17483d")
styles["Heading2"].textColor = colors.HexColor("#17483d")
styles["BodyText"].leading = 16
story = []


def text(value, style="BodyText"):
    story.append(Paragraph(value, styles[style]))
    story.append(Spacer(1, 10))


text("PlantSense", "Title")
text("Evidence-backed plant reliability decisions", "Heading2")
text("Manufacturing: Intelligent Operations &amp; Industrial Efficiency | AI Builder Cup 2026")
text(
    "Prototype proposal and local validation draft. Cloud deployment and live Gemini validation remain pending authentication."
)
text("The problem", "Heading2")
text(
    "Plants can detect an abnormal signal without quickly knowing its cause, downstream consequences, or whether maintenance should interrupt production. Technical knowledge, production commitments and repair history are usually reviewed separately."
)
text("The solution", "Heading2")
text(
    "PlantSense links a spatial plant view to one complete reliability workflow: persistent detection, evidence gathering, uncertain diagnosis, deterministic intervention economics, human approval, repair verification and reusable confirmed knowledge."
)
preview = OUT / "plant-3d.png"
if preview.exists():
    from PIL import Image as PILImage

    with PILImage.open(preview) as img:
        w, h = img.size
    story.append(Image(str(preview), width=480, height=480 * h / w))
story.append(PageBreak())
text("What the working prototype demonstrates", "Heading2")
for value in [
    "Twelve selectable assets, two production lines, shared utilities and downstream impact paths.",
    "Public hydraulic measurements replayed through a fitted normal baseline and Isolation Forest.",
    "Inspectable telemetry and cited demo procedures; conflicting-sensor uncertainty is explicit.",
    "Four actions compared over the same eight-hour horizon using integer-paise costs and labelled assumptions.",
    "Versioned human approval, technician correction and three-window recovery verification.",
    "A later incident retrieves the verified repair while retaining the original diagnosis.",
]:
    text("&#8226; " + value)
text("Google AI and Cloud implementation", "Heading2")
text(
    "The cloud integration uses ADK/Gemini for tool-based investigation; Cloud Run for web/API/private worker; Cloud Tasks for authenticated asynchronous execution; Firestore for transactional workflow state and vector retrieval; Firebase anonymous identity; and Cloud Storage for source artifacts. Deployment scripts and locked container builds are supplied. The local investigator is explicitly scripted and does not substitute for live-model validation."
)
text("Trust and differentiation", "Heading2")
text(
    "The differentiator is the coherent decision loop: shared operational evidence, competing maintenance and production objectives, transparent arithmetic, human control, and proof of repair. The scene communicates where consequences occur. No automatic real-plant control, certified safety behaviour, online retraining or zero-configuration factory integration is claimed."
)
story.append(PageBreak())
text("Evidence and limits", "Heading2")
report_path = ROOT / "backend" / "data" / "artifacts" / "detection-evaluation.json"
if report_path.exists():
    r = json.loads(report_path.read_text(encoding="utf-8"))
    text(
        f"The public dataset has {r['cycles']} cycles and only {r['healthy_cycles']} fully healthy stable cycles. The detector fits {r['healthy_fit_cycles']} healthy cycles. The held-out subset has {r['test_cycles']} cycles, including only {r['test_healthy_cycles']} healthy cycle. Reported precision/recall on that subset are {r['precision']:.2f}/{r['recall']:.2f}; this small, constrained evaluation does not establish industrial generalization or robust false-alarm performance."
    )
text(
    "Software verification covers ownership, stale approvals, idempotency, deterministic costs, failed recovery and memory. Browser tests exercise five complete workflows. Actual live-model diagnosis, grounding, abstention and tool performance still require evaluation on the deployed project."
)
text("Business value", "Heading2")
text(
    "PlantSense makes the cost and operational consequence of intervention alternatives inspectable. Configured contribution margin, downtime, penalties and failure probabilities demonstrate decision mechanics; they are not customer savings or calibrated risk estimates. An industrial pilot would measure decision time, confirmed diagnostic accuracy, verified repair rate, avoided output loss and operator acceptance."
)
text("Delivery and expansion", "Heading2")
text(
    "The submission focuses on the full incident-to-resolution loop. Future work adds qualified site-specific manuals, more healthy operating regimes, actual plant adapters, broader asset models, and CMMS integration. The canonical model separates plant configuration from reusable reasoning and workflow logic."
)
text("Source attribution", "Heading2")
text(
    "Helwig, Pignanelli and Schuetze (2015), Condition monitoring of hydraulic systems, UCI Machine Learning Repository, DOI 10.24432/C5CW21, CC BY 4.0. Cycle means, filtered/split evaluation and reordered replay are derived transformations. Factory geometry and demo SOPs are original synthetic material."
)
SimpleDocTemplate(
    str(OUT / "PlantSense_Proposal_Draft.pdf"),
    pagesize=A4,
    rightMargin=48,
    leftMargin=48,
    topMargin=45,
    bottomMargin=45,
    title="PlantSense prototype proposal",
    author="PlantSense",
).build(story)
print("Built " + str(OUT / "PlantSense_Proposal_Draft.pdf"))
