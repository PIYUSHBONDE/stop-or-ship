"""Local shared replay scheduling independent of browser polling.

This is a single-API development adapter. Production durable dispatch remains a
separate gate; existing incident leases and claim fencing protect duplicate runs.
"""

import asyncio
import logging

from . import config
from .agent import investigate
from .monitoring import advance_plants
from .workspace_store import advance_all

log = logging.getLogger("plantsense.local_runtime")


async def run(store):
    pending = set()

    async def execute(job):
        try:
            await investigate(store, job)
        except Exception as error:
            log.warning("shared_investigation_failed error_type=%s", type(error).__name__)

    try:
        while True:
            try:
                jobs = await asyncio.to_thread(advance_plants, store) if config.INTERNAL_TEST_MODE else []
                jobs.extend(await asyncio.to_thread(advance_all, store))
                for job in jobs:
                    task = asyncio.create_task(execute(job))
                    pending.add(task)
                    task.add_done_callback(pending.discard)
            except Exception as error:
                log.error("shared_replay_tick_failed error_type=%s", type(error).__name__)
            await asyncio.sleep(1)
    finally:
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
