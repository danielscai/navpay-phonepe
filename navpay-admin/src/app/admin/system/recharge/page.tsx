import { redirect } from "next/navigation";

export default function SystemRechargePage() {
  redirect("/admin/ops/settings?tab=recharge");
}
