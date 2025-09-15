import { chromium, Browser, BrowserContext, Page } from "playwright";

export class TradingViewScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map(); // Track one page per ticker
  // Track which symbols are subscribed to (prevents double-subscribe)
  private subscriptions = new Set<string>();

  // Initialize browser + context if not already done
  async initialize() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: false, // Running in headed mode per task requirements
      });
      this.context = await this.browser.newContext();
    }
  }

  // Check if valid ticker and display error message if invalid
  async validateTicker(symbol: string): Promise<boolean> {
    await this.initialize();
    const page = await this.context!.newPage();
    const url = `https://www.tradingview.com/symbols/${symbol}/?exchange=BINANCE`;
    console.log(`Validating ticker at URL: ${url}`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
      // Check for a selector to validate (price in this case)
      const exists = await page.$('[class*="price"]');
      await page.close();
      return !!exists;
    } catch (err) {
      console.error(`Error validating ${symbol}:`, err);
      await page.close();
      return false;
    }
  }

  // Open (or reuse) a page for a given ticker
  private async getPageForTicker(symbol: string): Promise<Page> {
    if (!this.context) await this.initialize();

    if (this.pages.has(symbol)) {
      return this.pages.get(symbol)!; // Reuse existing page
    }

    const page = await this.context!.newPage(); // Opens new tab
    const url = `https://www.tradingview.com/symbols/${symbol}/?exchange=BINANCE`; // Builds URL
    console.log(`Opening page for ${url}`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    this.pages.set(symbol, page);
    return page;
  }

  // Subscribe to live updates for a ticker
  async subscribeToTicker(
    symbol: string,
    onPrice: (price: number) => void,
    onError?: (failedSymbol: string, reason: string) => void
  ): Promise<void> {
    if (this.subscriptions.has(symbol)) {
      console.log(`Already subscribed to ${symbol}`);
      await this.unsubscribeFromTicker(symbol); // ensures clean slate
      return;
    }

    const page = await this.getPageForTicker(symbol);

    try {
      // Try multiple possible selectors (TradingView DOM changes often)
      const possibleSelectors = [
        '[data-field="last_price"]',
        ".js-symbol-last",
        ".tv-symbol-price-quote__value",
        '[class*="last-JWoJqCpY"]',
        '[class*="price"]',
      ];

      let targetSelector: string | null = null;

      for (const sel of possibleSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 5000 });
          targetSelector = sel;
          break;
        } catch {
          continue;
        }
      }

      if (!targetSelector) {
        // Fallback: scan page text for a price-like string
        const fallback = await page.evaluate(() => {
          const elements = document.querySelectorAll("*");
          const priceRegex = /^\$?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/;
          for (const el of Array.from(elements)) {
            const text = el.textContent?.trim();
            if (
              text &&
              priceRegex.test(text) &&
              parseFloat(text.replace(/[\$,]/g, "")) > 0.00001
            ) {
              return { sel: null, initial: text };
            }
          }
          return null;
        });

        if (fallback) {
          const price = this.cleanPriceText(fallback.initial);
          if (price !== null) {
            console.log(`[STREAM-FALLBACK] ${symbol} → ${price}`);
            onPrice(price);
          }
        } else {
          throw new Error(`No valid price element found for ${symbol}`);
        }
      }

      const exposedName = `onPriceUpdate_${symbol}`;

      // Expose Node-side function
      await page.exposeFunction(exposedName, (raw: string) => {
        const price = this.cleanPriceText(raw);
        if (price !== null) {
          console.log(`[STREAM] ${symbol} → ${price}`);
          onPrice(price);
        }
      });

      // Inject MutationObserver
      await page.evaluate(
        (args: { sel: string | null; fnName: string }) => {
          let target: Element | null = null;
          if (args.sel) {
            target = document.querySelector(args.sel);
          }
          if (!target) return;

          const observer = new MutationObserver(() => {
            try {
              (window as any)[args.fnName](target!.textContent || "");
            } catch {
              // ignore
            }
          });

          observer.observe(target, {
            childList: true,
            subtree: true,
            characterData: true,
          });

          // send the initial value once
          try {
            (window as any)[args.fnName](target!.textContent || "");
          } catch {
            // ignore
          }
        },
        { sel: targetSelector, fnName: exposedName }
      );

      this.subscriptions.add(symbol);
      console.log(`Subscribed to live updates for ${symbol}`);
    } catch (err: any) {
      console.error(`Failed to subscribe to ${symbol}:`, err);
      this.subscriptions.delete(symbol);

      if (onError) {
        onError(symbol, err.message || "Unknown error");
      }
    }
  }

  // Unsubscribe and clean up for a ticker
  async unsubscribeFromTicker(symbol: string): Promise<void> {
    this.subscriptions.delete(symbol);

    const page = this.pages.get(symbol);
    if (page) {
      try {
        await page.close();
        console.log(`Closed page for ${symbol}`);
      } catch (err) {
        console.warn(`Error closing page for ${symbol}:`, err);
      }
      this.pages.delete(symbol);
    } else {
      console.log(`No page to close for ${symbol}`);
    }
  }

  // Helper to simplify raw price text into a number
  private cleanPriceText(text: string | null | undefined): number | null {
    if (!text) return null;
    const cleaned = text.replace(/[\$,\s]/g, "");
    const number = parseFloat(cleaned);
    return isNaN(number) ? null : number;
  }

  // Close all tabs, context, and browser
  async close(): Promise<void> {
    for (const page of this.pages.values()) {
      await page.close();
    }
    this.pages.clear();

    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
