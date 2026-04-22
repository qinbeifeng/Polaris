#!/bin/bash
set -e

# AI Smart Course System Startup Script

echo "🚀 Initializing AI Smart Course System..."

# Navigate to backend directory
cd "$(dirname "$0")/backend"

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env not found. Creating from .env.example..."
    cp .env.example .env
    echo "✅ .env created. Please update it with your actual configuration."
fi

# Create Virtual Environment if not exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Set a local HOME to ensure all tools write to project directory
export HOME="$(pwd)/backend/.home"
mkdir -p "$HOME"
export PADDLE_HOME="$HOME/.paddle_cache"
export PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK="True"
echo "🏠 Set HOME to $HOME"
echo "📂 Set PADDLE_HOME to $PADDLE_HOME"
echo "🚀 Disabled Paddle Model Source Check"

# Activate Virtual Environment
source venv/bin/activate

# Install Dependencies
echo "⬇️  Installing dependencies..."
pip install -r requirements.txt

# Start Server
echo "🔥 Starting FastAPI Server..."
# Run uvicorn with reload enabled for development
uvicorn app.main:app --reload --reload-dir app --reload-dir ../rag --host 0.0.0.0 --port 8000
