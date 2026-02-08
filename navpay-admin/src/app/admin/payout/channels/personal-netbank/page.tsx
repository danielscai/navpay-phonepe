import { redirect } from "next/navigation";

export default function PersonalNetbankChannelRedirect() {
  redirect("/admin/payout/channels");
}

