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
RUN pip install --no-cache-dir 'pipecat-ai[daily,openai,deepgram,cartesia,silero]' daily-python pipecat-flows

# Copy application code
COPY *.py ./

EXPOSE 8765

# USE_FLOWS=true to use structured conversation flow, false for free-form
ENV USE_FLOWS=false

CMD ["sh", "-c", "if [ \"$USE_FLOWS\" = 'true' ]; then python server_telnyx_flows.py; else python server_telnyx.py; fi"]
