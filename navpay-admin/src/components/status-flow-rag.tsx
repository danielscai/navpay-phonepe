"use client";

import { useMemo } from "react";
import { orderStatusPill, type OrderType } from "@/lib/order-status";

type Rag = "green" | "amber" | "red" | "neutral";

function statusRag(orderType: OrderType, status: string): Rag {
  if (status === "SUCCESS") return "green";
  if (["FAILED", "REJECTED", "EXPIRED"].includes(status)) return "red";
  if (orderType === "collect") {
    if (["PENDING_PAY", "PAID"].includes(status)) return "amber";
    if (status === "CREATED") return "neutral";
  } else {
    if (["REVIEW_PENDING", "APPROVED", "LOCKED", "BANK_CONFIRMING"].includes(status)) return "amber";
    if (status === "CREATED") return "neutral";
  }
  return "neutral";
}

function ragColors(rag: Rag): { fill: string; stroke: string; text: string } {
  // Keep colors consistent with the rest of the UI (no pure neon).
  if (rag === "green") return { fill: "rgba(52, 211, 153, 0.14)", stroke: "rgba(52, 211, 153, 0.40)", text: "rgba(255,255,255,0.92)" };
  if (rag === "amber") return { fill: "rgba(251, 191, 36, 0.14)", stroke: "rgba(251, 191, 36, 0.45)", text: "rgba(255,255,255,0.92)" };
  if (rag === "red") return { fill: "rgba(248, 113, 113, 0.14)", stroke: "rgba(248, 113, 113, 0.45)", text: "rgba(255,255,255,0.92)" };
  return { fill: "rgba(255,255,255,0.06)", stroke: "rgba(255,255,255,0.16)", text: "rgba(255,255,255,0.86)" };
}

type Node = { id: string; x: number; y: number; w: number; h: number };

type Edge = { from: string; to: string };

function layout(orderType: OrderType): { nodes: Node[]; edges: readonly Edge[] } {
  if (orderType === "collect") {
    const nodes: Node[] = [
      { id: "CREATED", x: 40, y: 28, w: 140, h: 44 },
      { id: "PENDING_PAY", x: 210, y: 28, w: 140, h: 44 },
      { id: "PAID", x: 380, y: 28, w: 140, h: 44 },
      { id: "SUCCESS", x: 550, y: 28, w: 140, h: 44 },
      { id: "FAILED", x: 380, y: 108, w: 140, h: 44 },
      { id: "EXPIRED", x: 550, y: 108, w: 140, h: 44 },
    ];
    // Curated edges to avoid line overlap and keep the graph readable.
    const edges: Edge[] = [
      { from: "CREATED", to: "PENDING_PAY" },
      { from: "PENDING_PAY", to: "PAID" },
      { from: "PAID", to: "SUCCESS" },
      { from: "PENDING_PAY", to: "FAILED" },
      { from: "PENDING_PAY", to: "EXPIRED" },
    ];
    return { nodes, edges };
  }

  const nodes: Node[] = [
    { id: "CREATED", x: 40, y: 28, w: 140, h: 44 },
    { id: "REVIEW_PENDING", x: 210, y: 28, w: 140, h: 44 },
    { id: "APPROVED", x: 380, y: 28, w: 140, h: 44 },
    { id: "LOCKED", x: 550, y: 28, w: 140, h: 44 },
    { id: "BANK_CONFIRMING", x: 720, y: 28, w: 160, h: 44 },
    { id: "SUCCESS", x: 910, y: 28, w: 140, h: 44 },
    { id: "FAILED", x: 720, y: 108, w: 140, h: 44 },
    { id: "REJECTED", x: 550, y: 108, w: 140, h: 44 },
    { id: "EXPIRED", x: 40, y: 108, w: 140, h: 44 },
  ];
  const edges: Edge[] = [
    { from: "REVIEW_PENDING", to: "APPROVED" },
    { from: "APPROVED", to: "LOCKED" },
    { from: "LOCKED", to: "BANK_CONFIRMING" },
    { from: "BANK_CONFIRMING", to: "SUCCESS" },
    { from: "REVIEW_PENDING", to: "REJECTED" },
    { from: "BANK_CONFIRMING", to: "FAILED" },
    { from: "REVIEW_PENDING", to: "EXPIRED" },
    { from: "LOCKED", to: "APPROVED" },
  ];
  return { nodes, edges };
}

export default function StatusFlowRag(props: { orderType: OrderType; counts: Map<string, number> }) {
  const { nodes, edges } = useMemo(() => layout(props.orderType), [props.orderType]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const edgePath = (from: Node, to: Node): string => {
    const fromMidX = from.x + from.w;
    const fromMidY = from.y + from.h / 2;
    const toMidX = to.x;
    const toMidY = to.y + to.h / 2;

    // Branch down to terminal row: route around node bodies to avoid overlap.
    const isDown = to.y > from.y;
    if (isDown) {
      const x1 = from.x + from.w / 2;
      const y1 = from.y + from.h;
      const x2 = to.x + to.w / 2;
      const y2 = to.y;
      const midY = (y1 + y2) / 2;
      return `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;
    }

    // Horizontal main chain.
    const ctrl = (fromMidX + toMidX) / 2;
    return `M ${fromMidX} ${fromMidY} C ${ctrl} ${fromMidY} ${ctrl} ${toMidY} ${toMidX} ${toMidY}`;
  };

  const viewW = props.orderType === "collect" ? 730 : 1060;
  const viewH = 164;

  return (
    <div className="w-full">
      <svg className="w-full h-auto" viewBox={`0 0 ${viewW} ${viewH}`} role="img" aria-label="status flow graph">
        <defs>
          <marker id="arrowHead" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.55)" />
          </marker>
        </defs>

        {/* edges */}
        {edges.map((e) => {
          const a = nodeMap.get(e.from);
          const b = nodeMap.get(e.to);
          if (!a || !b) return null;
          return (
            <g key={`${e.from}->${e.to}`}>
              <path
                d={edgePath(a, b)}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={2}
                fill="none"
                markerEnd="url(#arrowHead)"
              />
            </g>
          );
        })}

        {/* nodes */}
        {nodes.map((n) => {
          const rag = statusRag(props.orderType, n.id);
          const c = ragColors(rag);
          const pill = orderStatusPill(props.orderType, n.id);
          const cnt = props.counts.get(n.id) ?? 0;
          return (
            <g key={n.id}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={14} fill={c.fill} stroke={c.stroke} />
              <text x={n.x + 12} y={n.y + 27} fill={c.text} fontSize={13} fontWeight={700}>
                {pill.label}
              </text>
              <text x={n.x + n.w - 12} y={n.y + 27} fill="rgba(255,255,255,0.72)" fontSize={12} textAnchor="end" fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New">
                {cnt}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--np-faint)]">
        <span className="np-pill np-pill-ok">绿: 成功</span>
        <span className="np-pill np-pill-warn">黄: 处理中</span>
        <span className="np-pill np-pill-danger">红: 终态/失败</span>
        <span className="np-pill">灰: 创建/其他</span>
      </div>
    </div>
  );
}
