import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requirePersonalToken } from "@/lib/personal-auth";
import { db } from "@/lib/db";
import { bankAccounts, bankTransactions, paymentApps, paymentDeviceApps, paymentDevices, paymentPersonReportLogs } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { id } from "@/lib/id";

const txSchema = z.object({
  direction: z.enum(["IN", "OUT"]),
  amount: z.string().min(1).max(32),
  ref: z.string().min(1).max(120),
  detailsJson: z.string().min(1).max(8000),
  createdAtMs: z.number().int().positive().optional(),
});

const schema = z.object({
  deviceCount: z.coerce.number().min(1).max(10).default(2),
  appsPerDevice: z.coerce.number().min(1).max(5).default(2),
  bankAccountCount: z.coerce.number().min(1).max(10).default(1),
  transactions: z.array(txSchema).max(200).optional(),
});

async function ensurePaymentApp(app: { name: string; packageName: string; versionCode: number; downloadUrl: string; promoted: boolean }) {
  const existing = await db.select({ id: paymentApps.id }).from(paymentApps).where(eq(paymentApps.packageName, app.packageName)).limit(1);
  if (existing.length) {
    await db
      .update(paymentApps)
      .set({ name: app.name, versionCode: app.versionCode, downloadUrl: app.downloadUrl, promoted: app.promoted, enabled: true } as any)
      .where(eq(paymentApps.packageName, app.packageName));
    return existing[0].id;
  }
  const appId = id("pa");
  await db.insert(paymentApps).values({
    id: appId,
    name: app.name,
    packageName: app.packageName,
    versionCode: app.versionCode,
    downloadUrl: app.downloadUrl,
    promoted: app.promoted,
    enabled: true,
    createdAtMs: Date.now(),
  } as any);
  return appId;
}

export async function POST(req: NextRequest) {
  const { personId } = await requirePersonalToken(req as any);
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const now = Date.now();

  // Fixed set of "bank apps" used by the simulator (2 apps by default).
  const appDefs = [
    { name: "NetBank Alpha", packageName: "com.navpay.netbank.alpha", versionCode: 12, downloadUrl: "https://example.invalid/alpha.apk", promoted: true },
    { name: "NetBank Beta", packageName: "com.navpay.netbank.beta", versionCode: 7, downloadUrl: "https://example.invalid/beta.apk", promoted: false },
  ];
  const appIds: string[] = [];
  for (const a of appDefs.slice(0, Math.max(1, body.data.appsPerDevice))) {
    appIds.push(await ensurePaymentApp(a));
  }

  // Devices: upsert by (personId, name).
  const deviceIds: string[] = [];
  for (let i = 0; i < body.data.deviceCount; i++) {
    const name = `Phone-${i + 1}`;
    const existing = await db
      .select({ id: paymentDevices.id })
      .from(paymentDevices)
      .where(and(eq(paymentDevices.personId, personId), eq(paymentDevices.name, name)))
      .limit(1);
    if (existing.length) {
      await db.update(paymentDevices).set({ online: true, lastSeenAtMs: now, updatedAtMs: now } as any).where(eq(paymentDevices.id, existing[0].id));
      deviceIds.push(existing[0].id);
    } else {
      const devId = id("dev");
      await db.insert(paymentDevices).values({ id: devId, personId, name, online: true, lastSeenAtMs: now, createdAtMs: now, updatedAtMs: now } as any);
      deviceIds.push(devId);
    }
  }
  await db.insert(paymentPersonReportLogs).values({
    id: id("pprlog"),
    personId,
    type: "DEVICE_REPORT",
    entityType: "devices",
    entityId: null,
    metaJson: JSON.stringify({ deviceCount: deviceIds.length }),
    createdAtMs: now,
  } as any);

  // Install apps.
  let installCount = 0;
  for (const devId of deviceIds) {
    for (const appId of appIds) {
      const existing = await db
        .select({ id: paymentDeviceApps.id })
        .from(paymentDeviceApps)
        .where(and(eq(paymentDeviceApps.deviceId, devId), eq(paymentDeviceApps.paymentAppId, appId)))
        .limit(1);
      if (existing.length) {
        await db.update(paymentDeviceApps).set({ updatedAtMs: now } as any).where(eq(paymentDeviceApps.id, existing[0].id));
      } else {
        await db.insert(paymentDeviceApps).values({
          id: id("pda"),
          deviceId: devId,
          paymentAppId: appId,
          versionCode: 1,
          installedAtMs: now,
          updatedAtMs: now,
        } as any);
      }
      installCount++;
    }
  }
  await db.insert(paymentPersonReportLogs).values({
    id: id("pprlog"),
    personId,
    type: "APP_REPORT",
    entityType: "installs",
    entityId: null,
    metaJson: JSON.stringify({ appCount: appIds.length, installCount }),
    createdAtMs: now,
  } as any);

  // Bank accounts: upsert by (personId, alias).
  const accountIds: string[] = [];
  for (let i = 0; i < body.data.bankAccountCount; i++) {
    const alias = `账户-${i + 1}`;
    const bankName = "HDFC";
    const accountLast4 = String(1000 + i).slice(-4);
    const existing = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.personId, personId), eq(bankAccounts.alias, alias)))
      .limit(1);
    if (existing.length) {
      await db.update(bankAccounts).set({ bankName, accountLast4, enabled: true, updatedAtMs: now } as any).where(eq(bankAccounts.id, existing[0].id));
      accountIds.push(existing[0].id);
    } else {
      const baId = id("ba");
      await db.insert(bankAccounts).values({ id: baId, personId, bankName, alias, accountLast4, ifsc: "HDFC0000123", enabled: true, createdAtMs: now, updatedAtMs: now } as any);
      accountIds.push(baId);
    }
  }
  await db.insert(paymentPersonReportLogs).values({
    id: id("pprlog"),
    personId,
    type: "BANK_ACCOUNT_REPORT",
    entityType: "bank_accounts",
    entityId: null,
    metaJson: JSON.stringify({ bankAccountCount: accountIds.length }),
    createdAtMs: now,
  } as any);

  // Transactions: attach to latest account.
  const accountId = accountIds[0];
  let txCreated = 0;
  const txs = body.data.transactions ?? [];
  for (const t of txs) {
    await db.insert(bankTransactions).values({
      id: id("tx"),
      accountId,
      direction: t.direction,
      amount: t.amount,
      ref: t.ref,
      detailsJson: t.detailsJson,
      createdAtMs: t.createdAtMs ?? now,
    } as any);
    txCreated++;
  }
  if (txCreated) {
    await db.insert(paymentPersonReportLogs).values({
      id: id("pprlog"),
      personId,
      type: "TX_REPORT",
      entityType: "bank_transactions",
      entityId: null,
      metaJson: JSON.stringify({ count: txCreated }),
      createdAtMs: now,
    } as any);
  }

  return NextResponse.json({ ok: true, synced: { devices: deviceIds.length, apps: appIds.length, installs: installCount, accounts: accountIds.length, transactions: txCreated } });
}

