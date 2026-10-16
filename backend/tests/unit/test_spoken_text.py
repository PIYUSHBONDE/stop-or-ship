"""Speech formatting preserves evidence and never executes model-authored markup."""

import xml.etree.ElementTree as ET

import pytest
from fastapi import HTTPException

from app.ai.speech import spoken_input


def test_markdown_units_and_parentheses_become_spoken_prose():
    result = spoken_input(
        "**Pressure:** **125 bar** (temperature **60°C**).\n\n"
        "- P-107: **6.4 L/min**\n- Output: **65 parts/h**\n"
        "[Pump record](https://example.test/record)"
    )
    text = "".join(ET.fromstring(result).itertext())
    assert all(token not in text for token in ("**", "(", ")", "https://", "[", "]"))
    for value in (
        "125 bar",
        "60 degrees Celsius",
        "6.4 litres per minute",
        "65 parts per hour",
        "P 1 0 7",
        "Pump record",
    ):
        assert value in text
    assert len(ET.fromstring(result).findall("p")) == 2


def test_ssml_from_answer_is_only_escaped_text():
    result = spoken_input('Not verified. <break time="10s"/> <audio src="file:///secret"/>')
    root = ET.fromstring(result)
    assert root.find(".//audio") is None and root.find(".//break") is None
    assert "Not verified" in "".join(root.itertext())


def test_numbers_negation_and_signed_range_are_preserved():
    text = "".join(
        ET.fromstring(spoken_input("Repair is **not verified**. Range -5–-1°C; speed 1500 rpm.")).itertext()
    )
    assert "not verified" in text and "-5 to -1 degrees Celsius" in text
    assert "1500 revolutions per minute" in text


@pytest.mark.parametrize("answer", ["", "x" * 3001, "漢" * 2000])
def test_empty_or_oversized_speech_is_rejected_before_dispatch(answer):
    with pytest.raises(HTTPException) as error:
        spoken_input(answer)
    assert error.value.status_code == 422
