#!/bin/bash

echo "Starting Cryptocurrency Price Streamer"

# Install dependencies
echo "Installing dependencies"
pnpm install --recursive

# Generate protobuf code
echo "Generating protobuf code"
pnpm run generate

# Install playwright browsers (for server)
echo "Installing playwright browsers"
pnpm -F server exec playwright install

# Start development servers
echo "Starting development servers"
echo "Frontend: http://localhost:3000"
echo "Backend: http://localhost:8080"
exec pnpm run dev