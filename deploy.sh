#!/bin/bash
set -e

echo "=== NCR Aloha Deployment ==="
cd /var/www/ncr-aloha

echo "1. Pulling latest code..."
git pull origin main

echo "2. Rebuilding containers..."
docker compose build

echo "3. Restarting services..."
docker compose up -d

echo "4. Cleaning up old images..."
docker image prune -f

echo "5. Checking service health..."
sleep 10
curl -s http://localhost:3000/health && echo " - Backend OK"
curl -s http://localhost:8765/health && echo " - Pipecat OK"

echo "=== Deployment Complete ==="
