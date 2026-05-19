FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends libgl1-mesa-glx libglib2.0-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN python -c "import insightface; from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_s', providers=['CPUExecutionProvider']).prepare(ctx_id=0, det_size=(320, 320))"

COPY main.py .

EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
