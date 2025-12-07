FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y \
    gcc \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir 'pipecat-ai[daily,openai,deepgram,cartesia,silero]' daily-python

# Copy application code
COPY *.py ./

EXPOSE 8765

CMD ["python", "server.py"]
