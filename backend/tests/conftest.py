"""Existing replay regression tests explicitly opt into the internal adapter."""

import pytest

from app.core import config


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "operational: exercise production defaults with legacy adapters disabled"
    )


@pytest.fixture(autouse=True)
def internal_test_adapter(monkeypatch, request):
    monkeypatch.setattr(config, "AI_PROVIDER", "scripted")
    monkeypatch.setattr(config, "INTERNAL_TEST_MODE", request.node.get_closest_marker("operational") is None)


pytest_plugins = ["tests.support.workspace", "tests.support.telemetry"]
