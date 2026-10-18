"""Only explicitly observed HTTPS service origins enter the CSRF allowlist."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pilot import web_origins


def description(aliases):
    return {
        "status": {"url": "https://plantsense-web-hash-el.a.run.app"},
        "metadata": {"annotations": {"run.googleapis.com/urls": json.dumps(aliases)}},
    }


def test_both_observed_cloud_run_urls_are_preserved():
    aliases = [
        "https://plantsense-web-hash-el.a.run.app",
        "https://plantsense-web-123.asia-south1.run.app",
    ]
    assert set(web_origins(description(aliases)).split(",")) == set(aliases)


@pytest.mark.parametrize(
    "origin",
    [
        "https://*.run.app",
        "http://plantsense-web.run.app",
        "https://plantsense-web.run.app/path",
        "https://external.invalid",
    ],
)
def test_unexpected_origins_fail_closed(origin):
    with pytest.raises(ValueError):
        web_origins(description([origin]))
