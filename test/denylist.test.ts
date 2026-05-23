import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDenylist } from "../src/db/denylist.js";

const FEED_URL = "https://example.test/hostfile";

// A representative URLhaus-style hostfile: bare hostnames, lowercased, with
// '#' comment lines (a banner + a blank line) the parser must skip.
const HOSTFILE = [
  "# abuse.ch URLhaus Host file",
  "# Last updated: whenever",
  "",
  "evil.example",
  "bad-host.test",
].join("\n");

function fetchReturning(body: string, ok = true, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(body, { status: ok ? status : status }),
  ) as unknown as typeof fetch;
}

describe("createDenylist", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns true for a host on the feed", async () => {
    vi.stubGlobal("fetch", fetchReturning(HOSTFILE));
    const isDenied = createDenylist(FEED_URL);
    expect(await isDenied("evil.example")).toBe(true);
    expect(await isDenied("bad-host.test")).toBe(true);
  });

  it("returns false for a host not on the feed", async () => {
    vi.stubGlobal("fetch", fetchReturning(HOSTFILE));
    const isDenied = createDenylist(FEED_URL);
    expect(await isDenied("stripe.com")).toBe(false);
  });

  it("skips '#' comment and blank lines", async () => {
    vi.stubGlobal("fetch", fetchReturning(HOSTFILE));
    const isDenied = createDenylist(FEED_URL);
    // Comment text must never be treated as a denied host.
    expect(await isDenied("# abuse.ch urlhaus host file")).toBe(false);
    expect(await isDenied("")).toBe(false);
  });

  it("fails open (returns false) when the fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );
    const isDenied = createDenylist(FEED_URL);
    expect(await isDenied("evil.example")).toBe(false);
  });

  it("fails open (returns false) on a non-OK response", async () => {
    vi.stubGlobal("fetch", fetchReturning("nope", false, 503));
    const isDenied = createDenylist(FEED_URL);
    expect(await isDenied("evil.example")).toBe(false);
  });

  it("re-fetches after the TTL expires", async () => {
    vi.useFakeTimers();
    // First feed has only evil.example; second adds newly-flagged.example.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("evil.example"))
      .mockResolvedValueOnce(new Response("evil.example\nnewly-flagged.example"));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ttlMs = 1000;
    const isDenied = createDenylist(FEED_URL, ttlMs);

    expect(await isDenied("newly-flagged.example")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance past the TTL to force a re-hydrate on the next lookup.
    vi.setSystemTime(Date.now() + ttlMs + 1);

    expect(await isDenied("newly-flagged.example")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats an undefined feed URL as an empty (deny-nothing) set", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    const isDenied = createDenylist(undefined);
    expect(await isDenied("evil.example")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses hosts-file format ('127.0.0.1<TAB>host') — the real URLhaus shape", async () => {
    const HOSTSFILE = ["# banner", "127.0.0.1\tevil.example", "0.0.0.0 bad-host.test"].join("\n");
    vi.stubGlobal("fetch", fetchReturning(HOSTSFILE));
    const isDenied = createDenylist(FEED_URL);
    expect(await isDenied("evil.example")).toBe(true);
    expect(await isDenied("bad-host.test")).toBe(true);
    // The redirect IP prefix must NOT be treated as a denied host.
    expect(await isDenied("127.0.0.1")).toBe(false);
  });

  it("matches a denylisted host regardless of representation (canonicalization)", async () => {
    // Feed lists an IP-literal form; an IP-encoded / trailing-dot lookup matches.
    vi.stubGlobal("fetch", fetchReturning("127.0.0.1\t0x7f000001\nevil.example"));
    const isDenied = createDenylist(FEED_URL);
    expect(await isDenied("2130706433")).toBe(true); // decimal form of 127.0.0.1
    expect(await isDenied("evil.example.")).toBe(true); // trailing dot
  });
});
