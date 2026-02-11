import { redirect } from "next/navigation";

export default function IpWhitelistPage() {
  redirect("/admin/system/config?tab=ip_whitelist");
}
