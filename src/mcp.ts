// Minimal stateless MCP server over Streamable HTTP (JSON-RPC 2.0).
//
// Exposes ONLY free tools (vouch_score, vouch_report) so there is no paid
// scoring to leak — the explainable `reasons` stay behind the x402-paid HTTP
// endpoint (/v1/check). This makes Vouch a real, registry-listable MCP server
// (official registry -> PulseMCP/Glama/Smithery) that works in every MCP client.

import { assess } from "./scoring/assess.js";
import { parseTarget } from "./scoring/target.js";
import { D1ReputationRepo } from "./db/repo.js";
import type { DenylistLookup } from "./scoring/signals/threatFeed.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "vouch", version: "0.1.0" };

const TOOLS = [
  {
    name: "vouch_score",
    description:
      "Check whether a counterparty is SAFE TO PAY before sending money. Given a URL " +
      "or host, returns a 0-100 trust score and risk band (low/medium/high/critical), " +
      "detecting scams, phishing, and known-malicious endpoints via threat feeds, " +
      "domain risk heuristics, and a community reputation graph. Call this before " +
      "paying any merchant, API, agent, or x402 resource. Free — for the full " +
      "explainable reasons behind the score, call the paid POST /v1/check endpoint via x402.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", description: "Counterparty URL or hostname." } },
      required: ["target"],
      additionalProperties: false,
    },
  },
  {
    name: "vouch_report",
    description:
      "Report a host as a scam/bad actor ('flag') or as trustworthy ('vouch'), " +
      "improving Vouch's community reputation graph for everyone's future " +
      "payment-trust checks. Free.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        kind: { type: "string", enum: ["flag", "vouch"] },
        reason: { type: "string" },
      },
      required: ["target", "kind"],
      additionalProperties: false,
    },
  },
] as const;

export interface McpDeps {
  db: D1Database;
  isDenied: DenylistLookup;
  waitUntil: (p: Promise<unknown>) => void;
  /** Returns false when the free-tier rate limit is exceeded. */
  rateLimitOk: () => Promise<boolean>;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

function ok(id: string | number, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function toolResult(id: string | number, text: string, structured?: unknown, isError = false) {
  const result: Record<string, unknown> = { content: [{ type: "text", text }], isError };
  if (structured !== undefined) result.structuredContent = structured;
  return ok(id, result);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Handle one JSON-RPC message. Returns the response object, or `null` for
 * notifications (which get no response).
 */
export async function handleMcpMessage(
  msg: JsonRpcMessage,
  deps: McpDeps,
): Promise<object | null> {
  const { id, method } = msg;
  // Notifications have no id -> no response.
  if (id === undefined || id === null) return null;

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call":
      return callTool(id, msg.params, deps);
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function callTool(
  id: string | number,
  params: unknown,
  deps: McpDeps,
): Promise<object> {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
  const name = asString(p.name);
  const args = (p.arguments ?? {}) as Record<string, unknown>;
  const repo = new D1ReputationRepo(deps.db);

  if (name === "vouch_score") {
    if (!(await deps.rateLimitOk())) {
      return toolResult(id, "Rate limit exceeded on the free tier. Try again shortly.", undefined, true);
    }
    const target = asString(args.target).trim();
    if (!target || !parseTarget(target).host) {
      return toolResult(id, "Invalid 'target' — provide a URL or hostname.", undefined, true);
    }
    const result = await assess(target, {
      isDenied: deps.isDenied,
      getReputation: (h) => repo.get(h),
    });
    if (result.host) deps.waitUntil(repo.recordCheck(result.host));
    return toolResult(
      id,
      `${result.host}: trust ${result.score}/100 (${result.risk} risk). ` +
        `Free tier returns score + risk only — call POST /v1/check via x402 for the explainable reasons.`,
      { host: result.host, score: result.score, risk: result.risk },
    );
  }

  if (name === "vouch_report") {
    if (!(await deps.rateLimitOk())) {
      return toolResult(id, "Rate limit exceeded. Try again shortly.", undefined, true);
    }
    const { host } = parseTarget(asString(args.target));
    if (!host) return toolResult(id, "Invalid 'target'.", undefined, true);
    if (args.kind !== "flag" && args.kind !== "vouch") {
      return toolResult(id, "'kind' must be 'flag' or 'vouch'.", undefined, true);
    }
    const reason = typeof args.reason === "string" ? args.reason.slice(0, 500) : undefined;
    deps.waitUntil(repo.recordReport(host, args.kind, reason));
    return toolResult(id, `Recorded ${args.kind} for ${host}.`, { ok: true, host, kind: args.kind });
  }

  return toolResult(id, `Unknown tool: ${name}`, undefined, true);
}

/** Process a parsed POST body (single message or batch). Returns the JSON-RPC
 *  response value, or null when only notifications were received (-> 202). */
export async function handleMcpBody(
  body: unknown,
  deps: McpDeps,
): Promise<object | object[] | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMcpMessage(m as JsonRpcMessage, deps)))).filter(
      (r): r is object => r !== null,
    );
    return out.length ? out : null;
  }
  return handleMcpMessage(body as JsonRpcMessage, deps);
}

export { rpcError };
