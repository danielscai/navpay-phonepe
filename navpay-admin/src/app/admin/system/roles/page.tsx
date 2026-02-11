import { redirect } from "next/navigation";

export default function Page() {
  redirect("/admin/system/users?tab=roles");
}
