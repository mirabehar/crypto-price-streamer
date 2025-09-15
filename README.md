# Cryptocurrency Streaming Web App

## Directory Structure
- `apps/`
  - `server/`      - Node.js backend with ConnectRPC & Playwright
    - `index.ts`
    - `scraper.ts` - Handles Playwright browser automation for live crypto prices
  - `web/`         - Next.js frontend
    - `index.tsx`
- `packages/`
  - `tradingview-gen/`  - Generated TypeScript code from proto files
- `proto/`        - ConnectRPC service definitions
- `run.sh`        - Convenience script to install dependencies, generate code, install browsers, and start both frontend & backend

## Tech Stack
*   TypeScript
*   Next.js
*   Node.js
    *   `tsx` for TypeScript execution
*   `pnpm` for package management 
*   ConnectRPC for communication between the frontend and backend
*   Playwright to stream price data from TradingView via the Node.js server


## Implementation Features and Performance Optimizations
- **UI:** The list of tickers displayed on the user interface are sorted alphabetically.
- **Live Updates:** The prices update in real time, providing the current price for each ticker without any delay. 
- **Visible Timestamps:** Each ticker displays the last updated time, giving users real-time context for price changes.  
- **Parallel Streaming for Multiple Clients:** Backend efficiently manages multiple clients and multiple tickers in parallel, ensuring low-latency updates without opening redundant browser tabs.  
- **Efficient Resource Management:** The scraper ensures that only one browser tab is created per active ticker. Subsequent subscriptions reuse the same tab until the ticker is unsubscribed. This reduces overhead and allows the system to scale to more tickers efficiently.

## How to Run (Unix/Linux)
1. Install dependencies: 
```bash
pnpm install --recursive 
```
2. Launch the application:
```bash
./run.sh
```
3. Open http://localhost:3000 in a browser. Add/remove tickers to see live updates. 

## How to Run Manually (Windows)
1. Install dependencies: 
```bash
pnpm install --recursive 
```
2. Generate protobuf code:
```bash
pnpm run generate 
```
3. Install Playwright browsers (server):
```bash
pnpm -F server exec playwright install
```
4. Start backend and frontend:
```bash
pnpm run dev
```
5. Open http://localhost:3000 in a browser. Add/remove tickers to see live updates. 

## Notes
- Playwright runs in headed mode to show live browser automation.