import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearSentimentSecretForRoot,
  readSentimentSecretsForRootSync,
  resolveSentimentSecret,
  sentimentSecretsPathForRoot,
  setSentimentSecretForRoot,
} from "../sentiment-secrets.js";
import {
  SENTIMENT_SOURCES,
  sentimentSourcesPayload,
  summarizeMarketSentiment,
  summarizeProjectSentiment,
} from "../sentiment.js";

describe("sentiment sources", () => {
  it("ships no-key baseline sources and optional keyed sources", () => {
    assert.ok(SENTIMENT_SOURCES.some((s) => s.id === "alternative-me" && !s.secretEnv));
    assert.ok(SENTIMENT_SOURCES.some((s) => s.id === "gdelt" && !s.secretEnv));
    assert.ok(SENTIMENT_SOURCES.some((s) => s.id === "coingecko" && s.secretEnv === "COINGECKO_API_KEY"));
    assert.ok(SENTIMENT_SOURCES.some((s) => s.id === "neynar" && s.secretEnv === "NEYNAR_API_KEY"));
    assert.ok(SENTIMENT_SOURCES.some((s) => s.id === "dune" && s.secretEnv === "DUNE_API_KEY"));
  });

  it("stores sentiment secrets locally with 0600 permissions and never exposes raw values", async () => {
    const root = mkdtempSync(join(tmpdir(), "goblin-sentiment-"));
    await setSentimentSecretForRoot(root, "neynar", "ny_test");
    const path = sentimentSecretsPathForRoot(root);
    assert.equal(readSentimentSecretsForRootSync(root).neynar?.apiKey, "ny_test");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.match(readFileSync(path, "utf8"), /"sentiment"/);

    const payload = sentimentSourcesPayload(root, {});
    assert.ok(payload.sources.find((s) => s.id === "neynar")?.configured);
    assert.doesNotMatch(JSON.stringify(payload), /ny_test/);
  });

  it("prefers environment keys over local sentiment secrets", async () => {
    const root = mkdtempSync(join(tmpdir(), "goblin-sentiment-"));
    await setSentimentSecretForRoot(root, "coingecko", "local_key");
    assert.equal(
      resolveSentimentSecret(root, "coingecko", { COINGECKO_API_KEY: "env_key" }),
      "env_key",
    );
    await clearSentimentSecretForRoot(root, "coingecko");
    assert.equal(readSentimentSecretsForRootSync(root).coingecko, undefined);
  });

  it("summarizes no-key market sentiment and CoinGecko attention", async () => {
    const result = await summarizeMarketSentiment({
      fetchImpl: fakeFetch({
        "api.alternative.me/fng": {
          name: "Fear and Greed Index",
          data: [{ value: "27", value_classification: "Fear", timestamp: "1710000000" }],
        },
        "api.coingecko.com/api/v3/search/trending": {
          coins: [
            { item: { id: "solana", name: "Solana", symbol: "SOL", score: 0 } },
            { item: { id: "jito", name: "Jito", symbol: "JTO", score: 1 } },
          ],
        },
      }),
    });

    assert.equal(result.signals.find((s) => s.source === "alternative-me")?.value, 27);
    assert.match(result.signals.find((s) => s.source === "coingecko")?.summary ?? "", /Solana/);
  });

  it("summarizes project news tone with GDELT", async () => {
    const result = await summarizeProjectSentiment("Goblintown", {
      fetchImpl: fakeFetch({
        "api.alternative.me/fng": {
          data: [{ value: "50", value_classification: "Neutral", timestamp: "1710000000" }],
        },
        "api.coingecko.com/api/v3/search/trending": { coins: [] },
        "api.coingecko.com/api/v3/search?": { coins: [] },
        "api.gdeltproject.org/api/v2/doc/doc": {
          articles: [
            { title: "Goblintown ships collaboration backend", url: "https://example.test/a", tone: 1.5, domain: "example.test" },
            { title: "Goblintown thesis engine criticized", url: "https://example.test/b", tone: -0.5, domain: "example.test" },
          ],
        },
      }),
    });

    const gdelt = result.signals.find((s) => s.source === "gdelt");
    assert.equal(gdelt?.kind, "news-tone");
    assert.equal(gdelt?.value, 0.5);
    assert.match(gdelt?.summary ?? "", /2 articles/);
  });

  it("keeps project sentiment signals query-specific and separates market context", async () => {
    const result = await summarizeProjectSentiment("Jito", {
      fetchImpl: fakeFetch({
        "api.alternative.me/fng": {
          data: [{ value: "28", value_classification: "Fear", timestamp: "1710000000" }],
        },
        "api.coingecko.com/api/v3/search/trending": {
          coins: [{ item: { name: "Dolphin", symbol: "POD" } }],
        },
        "api.coingecko.com/api/v3/search?": {
          coins: [
            { id: "jito-governance-token", name: "Jito", symbol: "JTO", market_cap_rank: 112 },
            { id: "jitosol", name: "Jito Staked SOL", symbol: "JITOSOL", market_cap_rank: 121 },
          ],
        },
        "api.gdeltproject.org/api/v2/doc/doc": {
          articles: [
            { title: "Jito governance vote draws attention", url: "https://example.test/j", tone: 2, domain: "example.test" },
          ],
        },
      }),
    });

    assert.deepEqual(
      result.signals.map((signal) => signal.source),
      ["coingecko", "gdelt"],
    );
    const marketContext = (result as { marketContext?: Array<{ source: string }> }).marketContext;
    assert.equal(marketContext?.map((signal) => signal.source).join(","), "alternative-me,coingecko");
    assert.doesNotMatch(result.signals.map((signal) => signal.summary).join("\n"), /Dolphin|Fear/);
    assert.match(result.signals.find((signal) => signal.source === "coingecko")?.summary ?? "", /Jito/);
  });

  it("reports when project sentiment has no query-specific signals", async () => {
    const result = await summarizeProjectSentiment("DJ15QJxVPFGv6kYhT6LvDGqG9b4aBFWQzavA7dGxpump", {
      fetchImpl: fakeFetch({
        "api.alternative.me/fng": {
          data: [{ value: "28", value_classification: "Fear", timestamp: "1710000000" }],
        },
        "api.coingecko.com/api/v3/search/trending": {
          coins: [{ item: { name: "Dolphin", symbol: "POD" } }],
        },
        "api.coingecko.com/api/v3/search?": { coins: [] },
        "api.gdeltproject.org/api/v2/doc/doc": { articles: [] },
      }),
    });

    assert.equal(result.signals.length, 0);
    const metadata = result as { marketContext?: unknown[]; noQuerySignals?: boolean };
    assert.ok((metadata.marketContext?.length ?? 0) > 0);
    assert.equal(metadata.noQuerySignals, true);
  });

  it("explains no-key source network timeouts instead of surfacing raw fetch failed", async () => {
    const result = await summarizeProjectSentiment("Goblintown", {
      fetchImpl: timeoutGdeltFetch(),
    });

    const gdelt = result.sources.find((s) => s.id === "gdelt");
    assert.equal(gdelt?.ok, false);
    assert.equal(gdelt?.error, "network timeout reaching api.gdeltproject.org");
    assert.doesNotMatch(gdelt?.error ?? "", /fetch failed/i);
  });
});

function fakeFetch(payloads: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const text = String(url);
    const key = Object.keys(payloads).find((needle) => text.includes(needle));
    if (!key) throw new Error(`unexpected fetch ${text}`);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      async json() {
        return payloads[key];
      },
      async text() {
        return JSON.stringify(payloads[key]);
      },
    } as Response;
  }) as typeof fetch;
}

function timeoutGdeltFetch(): typeof fetch {
  const base = fakeFetch({
    "api.alternative.me/fng": {
      data: [{ value: "50", value_classification: "Neutral", timestamp: "1710000000" }],
    },
    "api.coingecko.com/api/v3/search/trending": { coins: [] },
    "api.coingecko.com/api/v3/search?": { coins: [] },
  });
  return (async (url: string | URL | Request) => {
    const text = String(url);
    if (text.includes("api.gdeltproject.org/api/v2/doc/doc")) {
      const cause = Object.assign(new Error("Connect Timeout Error"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      });
      throw Object.assign(new TypeError("fetch failed"), { cause });
    }
    return await base(url);
  }) as typeof fetch;
}
