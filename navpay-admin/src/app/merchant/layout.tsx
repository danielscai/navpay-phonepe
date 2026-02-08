import { requireMerchantSessionUser } from "@/lib/merchant-auth";
import MerchantShell from "@/components/merchant-shell";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  await requireMerchantSessionUser();
  return <MerchantShell>{children}</MerchantShell>;
}

