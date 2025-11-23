import { createServer } from "http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { CryptoStreamService } from "../../../packages/tradingview-gen/proto/crypto-stream_connect";
import { HandlerContext } from "@connectrpc/connect";
import {
    AddTickerRequest,
    AddTickerResponse,
    RemoveTickerRequest,
    RemoveTickerResponse,
    StreamPricesRequest,
    PriceUpdate,
    GetActiveTickersRequest, //TODO: delete
    GetActiveTickersResponse, //TODO: delete
    TickerInfo //TODO: delete
} from "../../../packages/tradingview-gen/proto/crypto-stream_pb";
import { TradingViewScraper } from "./scraper";

// In-memory storage for active tickers with prices
interface TickerData {
    symbol: string;
    currentPrice: number | null;
    lastUpdated: Date | null;
}

const activeTickers = new Map<string, TickerData>();
const scraper = new TradingViewScraper();

// Register streaming clients 
type StreamClient = {
    send: (update: PriceUpdate) => void;
    close: () => void;
};
const streamingClients = new Set<StreamClient>();

const routes = () => (router: any) => {
    router.service(CryptoStreamService, {
        async addTicker(req: AddTickerRequest, context: HandlerContext): Promise<AddTickerResponse> {
            const ticker = req.ticker.toUpperCase();

            if (activeTickers.has(ticker)) {
                return new AddTickerResponse({
                    success: false,
                    message: `Ticker ${ticker} is already being tracked`
                });
            }

            // validate ticker before adding
            const isValid = await scraper.validateTicker(ticker);
            if (!isValid) {
                return new AddTickerResponse({
                    success: false,
                    message: `Ticker ${ticker} is invalid or not found on TradingView`
                });
            }

            // if valid, add ticker to storage
            activeTickers.set(ticker, {
                symbol: ticker,
                currentPrice: null,
                lastUpdated: null
            });

            await scraper.subscribeToTicker(
                ticker,
                // SUCCESS CALLBACK - only receives valid numbers
                (price: number) => {
                    const tickerData = activeTickers.get(ticker);
                    if (tickerData) {
                        tickerData.currentPrice = price;
                        tickerData.lastUpdated = new Date();
                        console.log(`Live update for ${ticker}: $${price.toFixed(2)}`);

                        // Broadcast to streaming clients
                        const update = new PriceUpdate({
                            ticker: ticker,
                            price: price.toFixed(2),
                            timestamp: BigInt(Date.now()),
                            exchange: "BINANCE" // may expand beyond Binance in the future
                        });

                        for (const client of streamingClients) {
                            client.send(update);
                        }
                    }
                },
                // ERROR CALLBACK - handles auto-removal
                (failedSymbol: string, reason: string) => {
                    console.error(`Auto-removing ${failedSymbol}: ${reason}`);
                    activeTickers.delete(failedSymbol);
                }
            );

            console.log(`Added ticker: ${ticker}. Active tickers: ${activeTickers.size}`);

            return new AddTickerResponse({
                success: true,
                message: `Successfully added ${ticker} with live price monitoring`
            });
        },

        async removeTicker(req: RemoveTickerRequest, context: HandlerContext): Promise<RemoveTickerResponse> {
            const ticker = req.ticker.toUpperCase();

            if (!activeTickers.has(ticker)) {
                return new RemoveTickerResponse({
                    success: false,
                    message: `Ticker ${ticker} is not being tracked`
                });
            }

            // unsibscribe from streaming
            await scraper.unsubscribeFromTicker(ticker);

            // remove from storage
            activeTickers.delete(ticker);
            console.log(`Removed ticker: ${ticker}. Active tickers: ${activeTickers.size}`);
            return new RemoveTickerResponse({
                success: true,
                message: `Successfully removed ${ticker}`
            });
        },

        // TODO:delete
        async getActiveTickers(req: GetActiveTickersRequest, context: HandlerContext): Promise<GetActiveTickersResponse> {
            const tickerArray = Array.from(activeTickers.values()) // converts map of ticker objects to array
                .sort((a, b) => a.symbol.localeCompare(b.symbol)); // alphabetical sorting

            console.log(`Returning ${tickerArray.length} active tickers with live prices:`, tickerArray);

            // Create TickerInfo objects with real price data
            const tickerInfos = tickerArray.map(ticker => {
                const priceDisplay = ticker.currentPrice
                    ? `$${ticker.currentPrice.toFixed(2)}`
                    : 'Loading...';
                const timeDisplay = ticker.lastUpdated
                    ? ticker.lastUpdated.toLocaleTimeString()
                    : '';

                console.log(`  ${ticker.symbol}: ${priceDisplay} (updated: ${timeDisplay})`);

                // Return TickerInfo object or loading text if price null or undefined
                return new TickerInfo({
                    symbol: ticker.symbol,
                    currentPrice: ticker.currentPrice?.toFixed(2) || 'Loading...',
                    lastUpdated: timeDisplay
                });
            });

            return new GetActiveTickersResponse({
                tickers: tickerInfos
            });
        },

        async *streamPrices(req: StreamPricesRequest, context: HandlerContext) {
            console.log('New streaming client connected');

            // Create a queue to hold updates for this specific client
            const updateQueue: PriceUpdate[] = [];
            let isActive = true;

            // Create client object that can receive updates
            const client: StreamClient = {
                send: (update: PriceUpdate) => {
                    if (isActive) {
                        updateQueue.push(update);
                    }
                },
                close: () => {
                    isActive = false;
                }
            };

            // Register this client to receive broadcasts
            streamingClients.add(client);

            // Send initial state - all current prices
            const currentTickers = Array.from(activeTickers.values());
            for (const ticker of currentTickers) {
                if (ticker.currentPrice !== null && isActive) {
                    const initialUpdate = new PriceUpdate({
                        ticker: ticker.symbol,
                        price: ticker.currentPrice.toFixed(2),
                        timestamp: BigInt(ticker.lastUpdated?.getTime() || Date.now()),
                        exchange: "BINANCE"
                    });
                    yield initialUpdate;
                }
            }

            // Stream updates as they come in
            try {
                while (isActive && context.signal && !context.signal.aborted) {
                    // Wait for updates in the queue
                    while (updateQueue.length > 0 && isActive) {
                        const update = updateQueue.shift();
                        if (update) {
                            yield update;
                        }
                    }

                    // Small delay to prevent busy waiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } finally {
                // Cleanup when client disconnects
                streamingClients.delete(client);
                client.close();
                console.log('Streaming client disconnected');
            }
        }
    });
};

// Shutdown: close server browser when servers stops
process.on('SIGINT', async () => {
    console.log('\nShutting down...');

    // close scraper browser
    await scraper.close();

    console.log('Cleanup complete! Goodbye');
    process.exit(0);
});

// Create the connectRPC handler
const handler = connectNodeAdapter({
    routes: routes()
});

// Create server with manual CORS handling
const server = createServer((req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Pass to ConnectRPC handler
    handler(req, res);
});

server.listen(8080, () => {
    console.log("ConnectRPC server running on http://localhost:8080");
    console.log("Available RPC endpoints:");
    console.log("- AddTicker");
    console.log("- RemoveTicker");
    console.log("- GetActiveTickers");
    console.log("- StreamPrices (real-time price updates)");
});