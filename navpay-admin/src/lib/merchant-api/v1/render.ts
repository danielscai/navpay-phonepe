import type { MerchantApiEndpoint } from "@/lib/merchant-api/v1/contract";
import { z } from "zod";

type DocNode =
  | { kind: "string"; optional?: boolean; rules?: string[] }
  | { kind: "number"; optional?: boolean; rules?: string[] }
  | { kind: "boolean"; optional?: boolean }
  | { kind: "enum"; optional?: boolean; values: string[] }
  | { kind: "object"; optional?: boolean; props: Record<string, DocNode> }
  | { kind: "unknown"; optional?: boolean };

function unwrapOptional(schema: z.ZodTypeAny): { schema: z.ZodTypeAny; optional: boolean } {
  let s: any = schema;
  let optional = false;
  // ZodOptional / ZodDefault / ZodNullable wrappers
  while (s?._def?.typeName === "ZodOptional" || s?._def?.typeName === "ZodDefault" || s?._def?.typeName === "ZodNullable") {
    optional = true;
    s = s._def.innerType ?? s._def.schema ?? s._def.innerType;
  }
  return { schema: s, optional };
}

function rulesForString(s: any): string[] {
  const checks = (s?._def?.checks ?? []) as any[];
  const rules: string[] = [];
  for (const c of checks) {
    if (c.kind === "min") rules.push(`min=${c.value}`);
    if (c.kind === "max") rules.push(`max=${c.value}`);
    if (c.kind === "email") rules.push("email");
    if (c.kind === "url") rules.push("url");
    if (c.kind === "regex") rules.push("regex");
  }
  return rules;
}

function rulesForNumber(s: any): string[] {
  const checks = (s?._def?.checks ?? []) as any[];
  const rules: string[] = [];
  for (const c of checks) {
    if (c.kind === "min") rules.push(`min=${c.value}${c.inclusive ? "" : " (exclusive)"}`);
    if (c.kind === "max") rules.push(`max=${c.value}${c.inclusive ? "" : " (exclusive)"}`);
    if (c.kind === "int") rules.push("int");
  }
  return rules;
}

function schemaToDocNode(schema: z.ZodTypeAny): DocNode {
  const { schema: s, optional } = unwrapOptional(schema);
  const tn = (s as any)?._def?.typeName as string | undefined;

  if (tn === "ZodObject") {
    const shape = (s as any)._def.shape();
    const props: Record<string, DocNode> = {};
    for (const [k, v] of Object.entries(shape)) props[k] = schemaToDocNode(v as any);
    return { kind: "object", optional, props };
  }
  if (tn === "ZodString") return { kind: "string", optional, rules: rulesForString(s) };
  if (tn === "ZodNumber") return { kind: "number", optional, rules: rulesForNumber(s) };
  if (tn === "ZodBoolean") return { kind: "boolean", optional };
  if (tn === "ZodEnum") return { kind: "enum", optional, values: Array.from((s as any)._def.values ?? []) };

  return { kind: "unknown", optional };
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

function prettyJson(x: any): string {
  return JSON.stringify(x, null, 2);
}

function renderSchema(node: DocNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (node.kind === "object") {
    const lines: string[] = [];
    lines.push(`${pad}{`);
    for (const [k, v] of Object.entries(node.props)) {
      const opt = v.optional ? " (optional)" : "";
      if (v.kind === "object") {
        lines.push(`${pad}  ${k}${opt}:`);
        lines.push(renderSchema(v, indent + 2));
      } else if (v.kind === "enum") {
        lines.push(`${pad}  ${k}${opt}: enum(${v.values.join(" | ")})`);
      } else if (v.kind === "string") {
        const r = v.rules?.length ? ` [${v.rules.join(", ")}]` : "";
        lines.push(`${pad}  ${k}${opt}: string${r}`);
      } else if (v.kind === "number") {
        const r = v.rules?.length ? ` [${v.rules.join(", ")}]` : "";
        lines.push(`${pad}  ${k}${opt}: number${r}`);
      } else if (v.kind === "boolean") {
        lines.push(`${pad}  ${k}${opt}: boolean`);
      } else {
        lines.push(`${pad}  ${k}${opt}: unknown`);
      }
    }
    lines.push(`${pad}}`);
    return lines.join("\n");
  }
  if (node.kind === "enum") return `${pad}enum(${node.values.join(" | ")})`;
  if (node.kind === "string") return `${pad}string`;
  if (node.kind === "number") return `${pad}number`;
  if (node.kind === "boolean") return `${pad}boolean`;
  return `${pad}unknown`;
}

export function renderMerchantApiHtml(opts: {
  title: string;
  subtitle?: string;
  endpoints: MerchantApiEndpoint[];
  baseUrlHint?: string;
}): string {
  const { title, subtitle, endpoints, baseUrlHint } = opts;

  const sections = endpoints
    .map((ep) => {
      const reqDoc = ep.requestSchema ? renderSchema(schemaToDocNode(ep.requestSchema)) : null;
      const respDoc = ep.responseSchema ? renderSchema(schemaToDocNode(ep.responseSchema)) : null;

      const curl = ep.exampleRequest
        ? [
            `curl -X ${ep.method} '${ep.path}' \\`,
            `  -H 'x-navpay-key-id: <YOUR_KEY_ID>' \\`,
            `  -H 'x-navpay-secret: <YOUR_SECRET>' \\`,
            `  -H 'content-type: application/json' \\`,
            `  -d '${JSON.stringify(ep.exampleRequest)}'`,
          ].join("\n")
        : null;

      return `
        <section class="card" id="${escapeHtml(ep.id)}">
          <div class="ep-title">
            <div class="ep-method">${escapeHtml(ep.method)}</div>
            <div class="ep-path">${escapeHtml(ep.path)}</div>
          </div>
          <div class="ep-name">${escapeHtml(ep.title)}</div>

          <div class="h">Headers</div>
          <table class="tbl">
            <thead><tr><th>Name</th><th>Required</th><th>Description</th></tr></thead>
            <tbody>
              ${ep.headers
                .map(
                  (h) =>
                    `<tr><td><code>${escapeHtml(h.name)}</code></td><td>${h.required ? "Y" : "N"}</td><td>${escapeHtml(h.desc)}</td></tr>`,
                )
                .join("")}
            </tbody>
          </table>

          ${reqDoc ? `<div class="h">Request Schema</div><pre class="code">${escapeHtml(reqDoc)}</pre>` : ""}
          ${ep.exampleRequest ? `<div class="h">Request Example</div><pre class="code">${escapeHtml(prettyJson(ep.exampleRequest))}</pre>` : ""}

          ${respDoc ? `<div class="h">Response Schema</div><pre class="code">${escapeHtml(respDoc)}</pre>` : ""}
          ${ep.exampleResponse ? `<div class="h">Response Example</div><pre class="code">${escapeHtml(prettyJson(ep.exampleResponse))}</pre>` : ""}

          ${curl ? `<div class="h">cURL</div><pre class="code">${escapeHtml(curl)}</pre>` : ""}
        </section>
      `;
    })
    .join("\n");

  const toc = endpoints.map((ep) => `<a class="toc-item" href="#${escapeHtml(ep.id)}">${escapeHtml(ep.title)}</a>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root{
        --bg:#07121d;
        --card:#0c1a28;
        --muted:#9db2c8;
        --text:#e6f0ff;
        --faint:#6f88a1;
        --line: rgba(255,255,255,.10);
        --accent:#5ad7ff;
        --ok:#45f0b3;
      }
      html,body{height:100%;}
      body{margin:0;font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;background:
        radial-gradient(1000px 600px at 10% 0%, rgba(90,215,255,.16), transparent 55%),
        radial-gradient(900px 500px at 80% 20%, rgba(69,240,179,.12), transparent 50%),
        var(--bg);
        color:var(--text);
      }
      a{color:inherit;}
      .wrap{max-width:1100px;margin:0 auto;padding:28px 18px 60px;}
      .top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding-bottom:18px;}
      .title{font-weight:800;letter-spacing:-.02em;font-size:24px;}
      .sub{margin-top:8px;color:var(--muted);font-size:12px;line-height:1.5;}
      .badge{display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.04);font-size:12px;color:var(--muted);}
      .dot{width:8px;height:8px;border-radius:999px;background:var(--ok);box-shadow:0 0 0 3px rgba(69,240,179,.12);}
      .toc{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0;}
      .toc-item{display:inline-block;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.03);text-decoration:none;font-size:12px;color:var(--muted);}
      .toc-item:hover{background:rgba(255,255,255,.06);}
      .card{margin-top:18px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));padding:16px;}
      .ep-title{display:flex;flex-wrap:wrap;align-items:center;gap:10px;}
      .ep-method{display:inline-flex;align-items:center;justify-content:center;padding:6px 10px;border-radius:999px;border:1px solid rgba(90,215,255,.35);color:var(--accent);font-weight:700;font-size:12px;}
      .ep-path{font-size:13px;color:var(--muted);word-break:break-all;}
      .ep-name{margin-top:10px;font-size:14px;font-weight:700;letter-spacing:-.01em;}
      .h{margin-top:14px;font-size:12px;color:var(--faint);text-transform:uppercase;letter-spacing:.08em;}
      .tbl{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;}
      .tbl th,.tbl td{padding:10px 10px;border-top:1px solid var(--line);vertical-align:top;}
      .tbl thead th{color:var(--faint);font-weight:700;font-size:11px;}
      code{color:var(--text);}
      .code{margin-top:8px;border:1px solid var(--line);background:rgba(0,0,0,.18);border-radius:14px;padding:12px;overflow:auto;font-size:12px;line-height:1.45;}
      .foot{margin-top:26px;color:var(--faint);font-size:12px;}
      @media print {
        body{background:#fff;color:#000;}
        .card{break-inside:avoid;}
        .code{background:#f6f8fa;}
        .badge,.toc{display:none;}
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <div>
          <div class="title">${escapeHtml(title)}</div>
          <div class="sub">${escapeHtml(subtitle ?? "本文档由服务端实时渲染（与接口契约同源），用于避免接口变更导致文档过期。")}</div>
          ${baseUrlHint ? `<div class="sub">Base URL: <code>${escapeHtml(baseUrlHint)}</code></div>` : ""}
          <div class="toc">${toc}</div>
        </div>
        <div class="badge"><span class="dot"></span>Generated at ${escapeHtml(new Date().toISOString())}</div>
      </div>
      ${sections}
      <div class="foot">Headers <code>x-navpay-key-id</code> / <code>x-navpay-secret</code> 为敏感信息，请仅在 HTTPS 环境使用，并配合商户 IP 白名单。</div>
    </div>
  </body>
</html>`;
}

