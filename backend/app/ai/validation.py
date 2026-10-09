"""Narratives cannot replace deterministic currency calculations or attest safety."""

import re


def validate_narrative(text):
    if re.search(r"₹|\$|\b(?:INR|rupees?|paise|paisa|USD|dollars?|Rs\.)", text, re.IGNORECASE):
        raise ValueError("Currency claims must come from the deterministic cost engine")
    if re.search(
        r"\b(?:safe to (?:operate|continue)|guaranteed safe|ensur\w*\s+(?:\w+\s+){0,6}safety)\b",
        text,
        re.IGNORECASE,
    ):
        raise ValueError("Generated safety assurance rejected")
