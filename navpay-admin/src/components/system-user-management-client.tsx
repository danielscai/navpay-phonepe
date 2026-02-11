"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SystemUsersClient from "@/components/system-users-client";
import SystemRolesClient from "@/components/system-roles-client";

export default function SystemUserManagementClient() {
  const sp = useSearchParams();
  const tab = (sp.get("tab") ?? "users") as string;
  const active = tab === "roles" ? "roles" : "users";

  return (
    <div className="grid gap-4 min-w-0">
      <div className="np-card p-2" role="tablist" aria-label="user-management-tabs">
        <div className="flex flex-wrap gap-2">
          {[
            ["users", "平台用户"],
            ["roles", "角色权限"],
          ].map(([k, label]) => {
            const on = active === k;
            return (
              <Link
                key={k}
                href={`/admin/system/users?tab=${k}`}
                className={["np-btn px-3 py-2 text-sm inline-flex items-center leading-none", on ? "np-btn-primary" : ""].join(" ")}
                aria-selected={on}
                role="tab"
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      {active === "users" ? <SystemUsersClient /> : null}
      {active === "roles" ? <SystemRolesClient /> : null}
    </div>
  );
}

