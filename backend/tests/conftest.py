"""Existing replay regression tests explicitly opt into the internal adapter."""

import pytest

from app import config


@pytest.fixture(autouse=True)
def internal_test_adapter(monkeypatch, request):
    monkeypatch.setattr(config, "INTERNAL_TEST_MODE", not request.node.path.name.startswith("test_sources"))
