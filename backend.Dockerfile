FROM python:3.11-slim

WORKDIR /app

# Install applypilot + server deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir applypilot && \
    pip install --no-deps python-jobspy && \
    pip install --no-cache-dir pydantic tls-client requests markdownify regex

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
