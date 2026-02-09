import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { bankAccounts, paymentDeviceApps, paymentDevices, paymentPersons, paymentApps, users } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";
import { getLastLoginByPersonIds, getTodayOrderStatsByPersonIds, getTodayRebateStatsByPersonIds, getDirectDownlineCountByPersonIds, getUplineChain } from "@/lib/payment-person-stats";

export async function GET(req: NextRequest, ctx: { params: Promise<{ personId: string }> }) {
  await requireApiPerm(req, "payout.channel.read");
  const { personId } = await ctx.params;

  const personRows = await db
    .select({
      id: paymentPersons.id,
      userId: paymentPersons.userId,
      username: users.username,
      name: paymentPersons.name,
      balance: paymentPersons.balance,
      enabled: paymentPersons.enabled,
      inviteCode: paymentPersons.inviteCode,
      inviterPersonId: paymentPersons.inviterPersonId,
      createdAtMs: paymentPersons.createdAtMs,
      updatedAtMs: paymentPersons.updatedAtMs,
    })
    .from(paymentPersons)
    .leftJoin(users, eq(users.id, paymentPersons.userId))
    .where(eq(paymentPersons.id, personId))
    .limit(1);
  const person = personRows[0] ?? null;
  if (!person) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const nowMs = Date.now();
  const [lastLoginMap, todayOrdersMap, todayRebatesMap, downlineMap, upline] = await Promise.all([
    getLastLoginByPersonIds([personId]),
    getTodayOrderStatsByPersonIds({ personIds: [personId], nowMs }),
    getTodayRebateStatsByPersonIds({ personIds: [personId], nowMs }),
    getDirectDownlineCountByPersonIds([personId]),
    getUplineChain({ personId, maxDepth: 3 }),
  ]);
  const devices = await db
    .select()
    .from(paymentDevices)
    .where(eq(paymentDevices.personId, personId))
    .orderBy(desc(paymentDevices.updatedAtMs))
    .limit(50);

  const deviceIds = (devices as any[]).map((d) => String(d.id));
  const deviceApps = deviceIds.length
    ? await db
        .select({
          id: paymentDeviceApps.id,
          deviceId: paymentDeviceApps.deviceId,
          paymentAppId: paymentDeviceApps.paymentAppId,
          versionCode: paymentDeviceApps.versionCode,
          installedAtMs: paymentDeviceApps.installedAtMs,
          updatedAtMs: paymentDeviceApps.updatedAtMs,
          appName: paymentApps.name,
          packageName: paymentApps.packageName,
        })
        .from(paymentDeviceApps)
        .leftJoin(paymentApps, eq(paymentApps.id, paymentDeviceApps.paymentAppId))
        .where(inArray(paymentDeviceApps.deviceId, deviceIds as any))
        .orderBy(desc(paymentDeviceApps.updatedAtMs))
    : [];

  const accounts = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.personId, personId))
    .orderBy(desc(bankAccounts.updatedAtMs))
    .limit(50);
  return NextResponse.json({
    ok: true,
    person,
    upline,
    directDownlineCount: downlineMap[personId] ?? 0,
    lastLogin: lastLoginMap[personId] ?? null,
    todayOrders: todayOrdersMap[personId] ?? null,
    todayRebates: todayRebatesMap[personId] ?? null,
    devices,
    deviceApps,
    accounts,
  });
}
