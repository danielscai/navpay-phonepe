import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const base = host ? `${proto}://${host}` : "";

  const html = `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>NavPay Merchant API Docs</title>
      <style>
        :root{--bg:#07121d;--card:#0c1a28;--text:#e6f0ff;--muted:#9db2c8;--line:rgba(255,255,255,.10);--accent:#5ad7ff;}
        body{margin:0;min-height:100vh;font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;background:
          radial-gradient(1000px 600px at 10% 0%, rgba(90,215,255,.16), transparent 55%),
          radial-gradient(900px 500px at 80% 20%, rgba(69,240,179,.12), transparent 50%),
          var(--bg);
          color:var(--text);
        }
        .wrap{max-width:900px;margin:0 auto;padding:34px 18px;}
        .title{font-size:26px;font-weight:800;letter-spacing:-.02em;}
        .sub{margin-top:10px;color:var(--muted);font-size:12px;line-height:1.6;}
        .grid{margin-top:18px;display:grid;gap:12px;grid-template-columns:1fr;}
        @media(min-width:860px){.grid{grid-template-columns:1fr 1fr;}}
        .card{border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.03);padding:16px;}
        a{color:inherit;text-decoration:none;}
        .card:hover{background:rgba(255,255,255,.06);}
        .k{font-size:12px;color:var(--muted);}
        .h{margin-top:8px;font-size:14px;font-weight:800;}
        .btns{margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;}
        .btn{display:inline-flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.18);font-size:12px;color:var(--muted);}
        .btn strong{color:var(--accent);font-weight:800;}
        code{color:var(--text);}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="title">NavPay Merchant API 文档 (V1)</div>
        <div class="sub">无需登录即可访问。PDF 下载为服务端实时生成，建议用于对外交付与归档。</div>
        ${base ? `<div class="sub">当前访问域：<code>${base}</code></div>` : ""}
        <div class="grid">
          <a class="card" href="/docs/merchant-api/collect">
            <div class="k">代收</div>
            <div class="h">下单 API</div>
            <div class="btns">
              <span class="btn"><strong>HTML</strong> /docs/merchant-api/collect</span>
              <span class="btn"><strong>PDF</strong> /docs/merchant-api/collect.pdf</span>
            </div>
          </a>
          <a class="card" href="/docs/merchant-api/payout">
            <div class="k">代付</div>
            <div class="h">下单 API</div>
            <div class="btns">
              <span class="btn"><strong>HTML</strong> /docs/merchant-api/payout</span>
              <span class="btn"><strong>PDF</strong> /docs/merchant-api/payout.pdf</span>
            </div>
          </a>
        </div>
      </div>
    </body>
  </html>`;

  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

