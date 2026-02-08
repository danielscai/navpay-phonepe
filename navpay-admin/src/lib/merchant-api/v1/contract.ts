import { z } from "zod";

// Merchant-facing API (API key auth). This contract is the single source of truth:
// - route handlers validate requests with these schemas
// - docs pages render from the same definitions (avoids drift)

export const moneyStr = z.string().regex(/^[0-9]+(\.[0-9]{1,6})?$/, "money_string");

export const collectCreateReq = z.object({
  merchantOrderNo: z.string().min(1).max(64),
  amount: moneyStr,
  notifyUrl: z.string().url(),
  remark: z.string().max(256).optional(),
});

export const payoutCreateReq = z.object({
  merchantOrderNo: z.string().min(1).max(64),
  amount: moneyStr,
  notifyUrl: z.string().url(),
  remark: z.string().max(256).optional(),

  beneficiaryName: z.string().min(1).max(64),
  accountNo: z.string().min(6).max(32),
  ifsc: z.string().min(6).max(16),
  bankName: z.string().max(64).optional(),
});

export const orderStatusCollect = z.enum(["CREATED", "PENDING_PAY", "PAID", "SUCCESS", "FAILED", "EXPIRED"]);
export const orderStatusPayout = z.enum(["REVIEW_PENDING", "APPROVED", "BANK_CONFIRMING", "SUCCESS", "FAILED", "REJECTED", "EXPIRED"]);

export const collectCreateResp = z.object({
  ok: z.literal(true),
  data: z.object({
    orderId: z.string(),
    status: orderStatusCollect,
    fee: moneyStr,
    createdAtMs: z.number().int(),
  }),
});

export const payoutCreateResp = z.object({
  ok: z.literal(true),
  data: z.object({
    orderId: z.string(),
    status: orderStatusPayout,
    fee: moneyStr,
    createdAtMs: z.number().int(),
  }),
});

export type MerchantApiEndpoint = {
  id: string;
  method: "POST" | "GET";
  path: string;
  title: string;
  auth: "api_key";
  headers: { name: string; required: boolean; desc: string }[];
  requestSchema?: z.ZodTypeAny;
  responseSchema?: z.ZodTypeAny;
  exampleRequest?: any;
  exampleResponse?: any;
};

export const merchantApiV1Endpoints: MerchantApiEndpoint[] = [
  {
    id: "collect_create",
    method: "POST",
    path: "/api/v1/collect/orders",
    title: "创建代收订单",
    auth: "api_key",
    headers: [
      { name: "x-navpay-key-id", required: true, desc: "API Key ID（开户后提供）" },
      { name: "x-navpay-secret", required: true, desc: "API Secret（开户后提供）" },
      { name: "content-type", required: true, desc: "application/json" },
    ],
    requestSchema: collectCreateReq,
    responseSchema: collectCreateResp,
    exampleRequest: {
      merchantOrderNo: "C202602080001",
      amount: "100.00",
      notifyUrl: "https://merchant.example.com/navpay/notify",
      remark: "test collect",
    },
    exampleResponse: { ok: true, data: { orderId: "co_xxx", status: "CREATED", fee: "3.00", createdAtMs: 1707350000000 } },
  },
  {
    id: "payout_create",
    method: "POST",
    path: "/api/v1/payout/orders",
    title: "创建代付订单",
    auth: "api_key",
    headers: [
      { name: "x-navpay-key-id", required: true, desc: "API Key ID（开户后提供）" },
      { name: "x-navpay-secret", required: true, desc: "API Secret（开户后提供）" },
      { name: "content-type", required: true, desc: "application/json" },
    ],
    requestSchema: payoutCreateReq,
    responseSchema: payoutCreateResp,
    exampleRequest: {
      merchantOrderNo: "P202602080001",
      amount: "100.00",
      notifyUrl: "https://merchant.example.com/navpay/notify",
      beneficiaryName: "Test User",
      accountNo: "1234567890",
      ifsc: "HDFC0000123",
      bankName: "HDFC",
      remark: "test payout",
    },
    exampleResponse: { ok: true, data: { orderId: "po_xxx", status: "REVIEW_PENDING", fee: "4.50", createdAtMs: 1707350000000 } },
  },
];

