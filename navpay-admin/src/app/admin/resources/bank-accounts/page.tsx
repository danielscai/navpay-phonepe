import { redirect } from "next/navigation";

export default function BankAccountsPage() {
  redirect("/admin/resources?tab=bank_accounts");
}
