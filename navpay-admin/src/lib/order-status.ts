export type OrderType = "collect" | "payout" | "recharge";

export type StatusPill = {
  label: string;
  className: string; // includes np-pill + variant
};

export function notifyStatusPill(status: string | null | undefined): StatusPill {
  const base = "np-pill";
  const ok = "np-pill np-pill-ok";
  const warn = "np-pill np-pill-warn";
  const danger = "np-pill np-pill-danger";
  switch (String(status ?? "")) {
    case "PENDING":
      return { label: "待通知", className: warn };
    case "SUCCESS":
      return { label: "已通知", className: ok };
    case "FAILED":
      return { label: "通知失败", className: danger };
    default:
      return { label: status ? String(status) : "-", className: base };
  }
}

export const collectStatuses = ["CREATED", "PENDING_PAY", "PAID", "SUCCESS", "FAILED", "EXPIRED"] as const;
export const payoutStatuses = [
  "CREATED",
  "REVIEW_PENDING",
  "APPROVED",
  "LOCKED",
  "BANK_CONFIRMING",
  "SUCCESS",
  "FAILED",
  "REJECTED",
  "EXPIRED",
] as const;
export const rechargeStatuses = ["CONFIRMING", "SUCCESS", "FAILED"] as const;
export const rechargeIntentStatuses = ["CREATED", "CONFIRMING", "SUCCESS", "FAILED", "EXPIRED"] as const;

export function knownOrderStatuses(orderType: OrderType): readonly string[] {
  if (orderType === "collect") return collectStatuses;
  if (orderType === "payout") return payoutStatuses;
  return rechargeIntentStatuses;
}

export type OrderStatusEdge = { from: string; to: string; label?: string };

// A "best-practice" visualization (not a strict state machine enforcement).
export function orderStatusFlow(orderType: OrderType): { main: readonly string[]; terminal: readonly string[]; edges: readonly OrderStatusEdge[] } {
  if (orderType === "collect") {
    return {
      main: ["CREATED", "PENDING_PAY", "PAID", "SUCCESS"],
      terminal: ["FAILED", "EXPIRED"],
      edges: [
        { from: "CREATED", to: "PENDING_PAY", label: "用户打开支付页" },
        { from: "PENDING_PAY", to: "PAID", label: "用户完成支付" },
        { from: "PAID", to: "SUCCESS", label: "平台确认入账" },
        { from: "CREATED", to: "EXPIRED", label: "超时" },
        { from: "PENDING_PAY", to: "EXPIRED", label: "超时" },
        { from: "PAID", to: "FAILED", label: "失败" },
        { from: "PENDING_PAY", to: "FAILED", label: "失败" },
      ],
    };
  }

  if (orderType === "payout") {
    return {
    main: ["REVIEW_PENDING", "APPROVED", "LOCKED", "BANK_CONFIRMING", "SUCCESS"],
    terminal: ["FAILED", "REJECTED", "EXPIRED"],
    edges: [
      { from: "REVIEW_PENDING", to: "APPROVED", label: "审核通过" },
      { from: "APPROVED", to: "LOCKED", label: "抢单" },
      { from: "LOCKED", to: "APPROVED", label: "超时释放" },
      { from: "LOCKED", to: "BANK_CONFIRMING", label: "提交银行" },
      { from: "BANK_CONFIRMING", to: "SUCCESS", label: "银行成功" },
      { from: "REVIEW_PENDING", to: "REJECTED", label: "审核拒绝" },
      { from: "BANK_CONFIRMING", to: "FAILED", label: "失败" },
      { from: "REVIEW_PENDING", to: "EXPIRED", label: "过期" },
    ],
    };
  }

  return {
    main: ["CREATED", "CONFIRMING", "SUCCESS"],
    terminal: ["FAILED", "EXPIRED"],
    edges: [
      { from: "CREATED", to: "CONFIRMING", label: "链上交易" },
      { from: "CONFIRMING", to: "SUCCESS", label: "确认 >= N" },
      { from: "CREATED", to: "EXPIRED", label: "超时" },
      { from: "CONFIRMING", to: "FAILED", label: "失败" },
    ],
  };
}

export function orderStatusPill(orderType: OrderType, status: string): StatusPill {
  const base = "np-pill";
  const ok = "np-pill np-pill-ok";
  const warn = "np-pill np-pill-warn";
  const info = "np-pill np-pill-info";
  const danger = "np-pill np-pill-danger";

  if (orderType === "collect") {
    switch (status) {
      case "CREATED":
        return { label: "已创建", className: info };
      case "PENDING_PAY":
        return { label: "支付中", className: warn };
      case "PAID":
        return { label: "已支付", className: info };
      case "SUCCESS":
        return { label: "成功", className: ok };
      case "FAILED":
        return { label: "失败", className: danger };
      case "EXPIRED":
        return { label: "已过期", className: danger };
      default:
        return { label: status, className: base };
    }
  }

  if (orderType === "recharge") {
    switch (status) {
      case "CREATED":
        return { label: "待充值", className: info };
      case "CONFIRMING":
        return { label: "确认中", className: warn };
      case "SUCCESS":
        return { label: "成功", className: ok };
      case "FAILED":
        return { label: "失败", className: danger };
      case "EXPIRED":
        return { label: "已过期", className: danger };
      default:
        return { label: status, className: base };
    }
  }

  switch (status) {
    case "CREATED":
      return { label: "已创建", className: info };
    case "REVIEW_PENDING":
      return { label: "待审核", className: warn };
    case "APPROVED":
      return { label: "待抢单", className: info };
    case "LOCKED":
      return { label: "处理中", className: warn };
    case "BANK_CONFIRMING":
      return { label: "银行处理中", className: info };
    case "SUCCESS":
      return { label: "成功", className: ok };
    case "FAILED":
      return { label: "失败", className: danger };
    case "REJECTED":
      return { label: "已拒绝", className: danger };
    case "EXPIRED":
      return { label: "已过期", className: danger };
    default:
      return { label: status, className: base };
  }
}
