// Self-contained marketing landing page served at GET / for browsers.
// No external assets (inline CSS) so it runs on Workers at $0.

export interface LandingConfig {
  priceUsdc: string;
  network: string;
  baseUrl: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function landingPage(cfg: LandingConfig): string {
  const price = esc(cfg.priceUsdc);
  const net = esc(cfg.network);
  const base = esc(cfg.baseUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vouch — the trust layer for agent payments</title>
<meta name="description" content="Before your AI agent pays, ask Vouch. A per-call counterparty risk score, billed in USDC over x402. No accounts, no API keys.">
<style>
  :root {
    --bg:#0a0b0f; --panel:#12141c; --line:#222533; --ink:#e7e9ee;
    --mut:#8b90a0; --acc:#5eead4; --warn:#fbbf24; --bad:#f87171;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--ink);
    font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  a { color:var(--acc); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .wrap { max-width:880px; margin:0 auto; padding:0 24px; }
  header { padding:80px 0 40px; }
  .tag {
    display:inline-block; font:600 12px/1 var(--mono); letter-spacing:.12em;
    text-transform:uppercase; color:var(--acc); border:1px solid var(--line);
    border-radius:999px; padding:7px 12px; margin-bottom:28px;
  }
  h1 { font-size:clamp(34px,6vw,56px); line-height:1.05; margin:0 0 18px; letter-spacing:-.02em; }
  h1 .dim { color:var(--mut); }
  .lede { font-size:20px; color:var(--mut); max-width:60ch; margin:0 0 32px; }
  .cta { display:flex; gap:12px; flex-wrap:wrap; }
  .btn {
    font:600 15px/1 system-ui; padding:13px 18px; border-radius:10px;
    border:1px solid var(--line); color:var(--ink); background:var(--panel);
  }
  .btn.primary { background:var(--acc); color:#04201c; border-color:var(--acc); }
  pre {
    background:var(--panel); border:1px solid var(--line); border-radius:12px;
    padding:20px; overflow:auto; font:13.5px/1.7 var(--mono); color:#cfd3de;
    margin:36px 0;
  }
  pre .c { color:var(--mut); }
  pre .k { color:var(--acc); }
  pre .s { color:var(--warn); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; margin:8px 0 24px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px; }
  .card h3 { margin:0 0 8px; font-size:16px; }
  .card p { margin:0; color:var(--mut); font-size:14px; }
  section { padding:36px 0; border-top:1px solid var(--line); }
  h2 { font-size:14px; letter-spacing:.08em; text-transform:uppercase; color:var(--mut); margin:0 0 18px; }
  table { width:100%; border-collapse:collapse; font:14px/1.5 var(--mono); }
  td,th { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--mut); font-weight:600; }
  .pill { font:600 11px/1 var(--mono); color:var(--acc); }
  .pill.free { color:var(--mut); }
  footer { padding:48px 0 80px; color:var(--mut); font-size:13px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <span class="tag">AI agents that pay · x402</span>
    <h1>Before your agent pays,<br><span class="dim">ask Vouch.</span></h1>
    <p class="lede">A per-call counterparty risk score for autonomous payments — threat feeds,
      domain signals, and a reputation graph that compounds with every check.
      Billed at <strong>$${price} USDC</strong> per call over x402. No accounts. No API keys.</p>
    <div class="cta">
      <a class="btn primary" href="${base}/.well-known/x402">Discover the API</a>
      <a class="btn" href="${base}/mcp/tools">MCP tool manifest</a>
    </div>
  </header>

  <pre><span class="c">// An agent checks a merchant before paying — x402 handles the payment.</span>
<span class="k">const</span> fetchWithPay = wrapFetchWithPayment(fetch, x402Client);
<span class="k">const</span> res = <span class="k">await</span> fetchWithPay(<span class="s">"${base}/v1/check"</span>, {
  method: <span class="s">"POST"</span>,
  body: JSON.stringify({ target: <span class="s">"https://some-merchant.com"</span> }),
});
<span class="c">// → { score: 87, risk: "low", reasons: [ ... ] }</span></pre>

  <div class="grid">
    <div class="card"><h3>Trust, not vibes</h3><p>Every verdict is explainable — a list of the exact signals behind the score.</p></div>
    <div class="card"><h3>A moat that compounds</h3><p>Each check and community report sharpens the reputation graph. The data is the product.</p></div>
    <div class="card"><h3>x402-native</h3><p>Pay per request in USDC. Discoverable by agents over MCP and the x402 bazaar.</p></div>
  </div>

  <section>
    <h2>Endpoints</h2>
    <table>
      <tr><th>Method &amp; path</th><th>Cost</th><th>Description</th></tr>
      <tr><td>POST /v1/check</td><td><span class="pill">x402 · $${price}</span></td><td>Assess a counterparty → score, risk, reasons</td></tr>
      <tr><td>POST /v1/report</td><td><span class="pill free">free</span></td><td>Flag or vouch for a host (rate-limited)</td></tr>
      <tr><td>GET /.well-known/x402</td><td><span class="pill free">free</span></td><td>Machine-readable resource descriptor</td></tr>
      <tr><td>GET /mcp/tools</td><td><span class="pill free">free</span></td><td>MCP tool manifest</td></tr>
    </table>
  </section>

  <footer>
    Network: <code>${net}</code> · Settles in USDC via <a href="https://x402.org">x402</a>.
    Open source (MIT). Built for the agentic economy.
  </footer>
</div>
</body>
</html>`;
}
