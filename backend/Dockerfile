FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_PROJECT_ENVIRONMENT=/opt/venv
RUN pip install --no-cache-dir uv==0.12.23
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
COPY data/knowledge.json ./data/knowledge.json
COPY data/artifacts ./data/artifacts
RUN useradd --uid 10001 --create-home appuser && chown -R appuser:appuser /app
USER appuser
ENV PATH="/opt/venv/bin:$PATH"
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
