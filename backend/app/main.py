"""Application composition, lifecycle and infrastructure error boundary."""

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import config
from .agent import investigate
from .api import router
from .dependencies import Storage
from .middleware import RequestBoundary
from .models import InvestigationJob
from .store import Store
from .telemetry import sample
from .workspace_api import router as workspace_router

log = logging.getLogger("plantsense.api")


def create_app(store: Store | None = None, *, shared_runtime=True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.store = store if store is not None else Store()
        # Validate and warm trusted replay/model artifacts before accepting judge traffic.
        await asyncio.to_thread(sample, 0, None)
        task = None
        if shared_runtime and config.SERVICE_ROLE == "api" and not application.state.store.cloud:
            from .local_runtime import run

            task = asyncio.create_task(run(application.state.store))
        try:
            yield
        finally:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    application = FastAPI(title="PlantSense API", version="1.0.0", lifespan=lifespan)
    application.add_middleware(RequestBoundary)
    application.include_router(router)
    application.include_router(workspace_router)

    @application.exception_handler(RequestValidationError)
    async def invalid_input(request: Request, exc: RequestValidationError):
        # Validation errors must not echo passwords, invitation tokens or other supplied secrets.
        errors = [{key: error[key] for key in ("type", "loc", "msg")} for error in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    @application.get("/health")
    def health():
        return {"status": "ok", "mode": config.MODE, "role": config.SERVICE_ROLE}

    if config.SERVICE_ROLE == "worker" and config.MODE == "cloud":

        @application.post("/internal/investigate", include_in_schema=False)
        async def worker(job: InvestigationJob, store: Storage):
            # Private Cloud Run verifies task OIDC before this handler is reached.
            await investigate(store, job.model_dump())
            return {"status": "processed"}

    @application.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", "unavailable")
        log.error("request_failed request_id=%s error_type=%s", request_id, type(exc).__name__)
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Service temporarily unavailable; your saved session is retained.",
                "request_id": request_id,
            },
            headers={"X-Request-ID": request_id, "Cache-Control": "no-store"},
        )

    return application


app = create_app()
