# CRDC Assistant – one container: API + chat widget + local embedding model.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Download the embedding model and build the vector index at BUILD time,
# so the server starts fast and never needs internet at runtime.
RUN python scripts/download_model.py && python scripts/build_index.py

# Run as a non-root user.
RUN useradd -m appuser && mkdir -p /app/logs && chown -R appuser /app
USER appuser

EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\",\"8000\")}/api/health')"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
