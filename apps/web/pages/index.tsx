import React, { useState, useEffect, useMemo } from 'react';
import { createConnectTransport } from '@connectrpc/connect-web';
import { createCallbackClient } from '@connectrpc/connect';
import { CryptoStreamService } from '../../../packages/tradingview-gen/proto/crypto-stream_connect';
import {
  AddTickerRequest,
  RemoveTickerRequest
} from '../../../packages/tradingview-gen/proto/crypto-stream_pb';

interface TickerData {
  symbol: string;
  price: string;
  lastUpdated: string;
}

// Adds a bolding animation when price updates
function PriceCell({ value }: { value: string }) {
  const [flash, setFlash] = React.useState(false);

  React.useEffect(() => {
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 500);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div
      style={{
        fontSize: '16px',
        fontWeight: flash ? 700 : 600,
        color: '#000',
        transition: 'font-weight 0.3s ease'
      }}
    >
      {value}
    </div>
  );
}

export default function Home() {
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [newTicker, setNewTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Create ConnectRPC client
  const transport = useMemo(() => createConnectTransport({ baseUrl: 'http://localhost:8080' }), []);
  const client = useMemo(() => createCallbackClient(CryptoStreamService, transport), [transport]);

  // Stream real-time price updates
  useEffect(() => {
    let isActive = true;

    client.streamPrices(
      {},
      (response) => {
        if (!isActive) return;

        console.log('Received price update:', response);

        // Check for removal message
        if (response.removed) {
          console.log(`Removing ticker from UI: ${response.ticker}`);
          setTickers(prev => prev.filter(t => t.symbol !== response.ticker));
          return;
        }

        // Otherwise update price
        setTickers(prev => {
          const index = prev.findIndex(t => t.symbol === response.ticker);

          if (index === -1) {
            // New ticker --> add it
            return [...prev, {
              symbol: response.ticker,
              price: response.price,
              lastUpdated: new Date(Number(response.timestamp)).toLocaleTimeString()
            }].sort((a, b) => a.symbol.localeCompare(b.symbol));
          } else {
            // Existing ticker --> update it
            const updated = [...prev];
            updated[index] = {
              symbol: response.ticker,
              price: response.price,
              lastUpdated: new Date(Number(response.timestamp)).toLocaleTimeString()
            };
            return updated;
          }
        });
      },
      (error) => {
        if (isActive) {
          console.error('Stream error:', error);
        }
      }
    );

    return () => {
      isActive = false;
    };
  }, []);

  const [isInvalid, setIsInvalid] = useState(false); // highlights input if invalid

  const handleAddTicker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicker.trim()) return;

    setLoading(true);
    setMessage('');

    const ticker = newTicker.toUpperCase().trim();
    console.log(`Adding ticker: ${ticker}`);

    client.addTicker(new AddTickerRequest({ ticker }), (error, response) => {
      setLoading(false);

      if (error) {
        console.error('Failed to add ticker:', error);
        setMessage('Failed to add ticker. Check console for details.');
        setIsInvalid(true); // mark as invalid if request fails
        return;
      }

      if (response) {
        if (response.success) {
          setMessage(`✅ ${response.message}`);
          setIsInvalid(false); // valid ticker, remove red highlight
          setNewTicker('');
        } else {
          setIsInvalid(true);   // INVALID ticker, highlight input
          setMessage(`❌ ${response.message}`);
        }
      }
    });
  };

  const handleRemoveTicker = (ticker: string) => {
    console.log(`Removing ticker: ${ticker}`);

    // Remove ticker from UI
    setTickers(prev => prev.filter(t => t.symbol !== ticker));

    client.removeTicker(new RemoveTickerRequest({ ticker }), (error, response) => {
      if (error) {
        console.error('Failed to remove ticker:', error);
        setMessage('❌ Failed to remove ticker. Check console for details.');
        return;
      }

      if (response) {
        if (response.success) {
          setMessage(`✅ ${response.message}`);
        } else {
          setMessage(`❌ ${response.message}`);
        }
      }
    });
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      padding: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Add Ticker Form */}
      <div style={{
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '20px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <form onSubmit={handleAddTicker} style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            value={newTicker}
            onChange={(e) => {
              setNewTicker(e.target.value)
              setIsInvalid(false); // reset highlight as user types
            }}
            placeholder="Ticker (e.g., BTCUSD)"
            disabled={loading}
            style={{
              flex: 1,
              padding: '10px 15px',
              border: `1px solid ${isInvalid ? 'red' : '#ddd'}`,  // RED border if invalid
              borderRadius: '4px',
              fontSize: '14px',
              backgroundColor: isInvalid ? '#ffe6e6' : '#f8f9fa', // light red background if invalid
            }}
          />
          <button
            type="submit"
            disabled={loading || !newTicker.trim()}
            style={{
              backgroundColor: '#000',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? 'Adding...' : 'Add'}
          </button>
        </form>
      </div>

      {/* Active Tickers List */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '15px 20px',
          borderBottom: '1px solid #eee',
          fontSize: '16px',
          fontWeight: '600',
          color: '#333'
        }}>
          Active Tickers ({tickers.length})
        </div>

        {tickers.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#666',
            fontSize: '14px'
          }}>
            No tickers added yet. Add a ticker above to get started!
            <br />
          </div>
        ) : (
          <div>
            {tickers.map((ticker) => (
              <div
                key={ticker.symbol}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '15px 20px',
                  borderBottom: '1px solid #eee'
                }}
              >
                <div>
                  <div style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#000'
                  }}>
                    {ticker.symbol}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: '#666',
                    marginTop: '2px'
                  }}>
                    {ticker.lastUpdated}
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '15px'
                }}>
                  <PriceCell value={ticker.price} />

                  <button
                    onClick={() => handleRemoveTicker(ticker.symbol)}
                    style={{
                      backgroundColor: 'transparent',
                      color: '#333',
                      border: 'none',
                      padding: '6px',
                      borderRadius: '0px',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.1s ease',
                      width: '28px',
                      height: '28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#e5e5e5';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.backgroundColor = '#d4d4d8';
                      e.currentTarget.style.transform = 'scale(1.1)';
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.backgroundColor = '#e5e5e5';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    x
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}