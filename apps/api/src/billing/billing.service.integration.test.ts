import "reflect-metadata";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "./billing.service";
import { MockPaymentProvider, StripePaymentProvider, WechatPayProvider } from "./payment-provider";

loadEnv();
const prisma = new PrismaService();
const billing = new BillingService(prisma, [
  new MockPaymentProvider(), new StripePaymentProvider(), new WechatPayProvider()
]);
const PREFIX = "billing-integration-";

describe("BillingService integration", () => {
  before(cleanup);
  after(async () => { await cleanup(); await prisma.$disconnect(); });

  it("creates a checkout order and activates membership exactly once", async () => {
    const user = await createUser("paid");
    const created = await billing.createOrder(user.id, { provider: "MOCK", durationDays: 30 });
    assert.equal(created.order.status, "PENDING");
    assert.match(created.order.checkoutUrl!, /mock-checkout/);
    const payload = {
      eventId: `evt-${Date.now()}`,
      orderId: created.order.id,
      status: "PAID"
    };
    const signature = sign(payload);
    const first = await billing.processWebhook("MOCK", payload, signature);
    const membershipAfterFirst = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    const replay = await billing.processWebhook("MOCK", payload, signature);
    const membershipAfterReplay = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    const [events, audits] = await Promise.all([
      prisma.paymentEvent.count({ where: { orderId: created.order.id } }),
      prisma.membershipAudit.count({ where: { orderId: created.order.id } })
    ]);
    assert.equal("activated" in first ? first.activated : false, true);
    assert.equal(replay.duplicate, true);
    assert.equal(membershipAfterFirst.plan, "PRO");
    assert.equal(membershipAfterReplay.expiresAt?.toISOString(), membershipAfterFirst.expiresAt?.toISOString());
    assert.equal(events, 1);
    assert.equal(audits, 1);
  });

  it("records failed payments without granting Pro", async () => {
    const user = await createUser("failed");
    const created = await billing.createOrder(user.id, { durationDays: 90 });
    const payload = { eventId: `failed-${Date.now()}`, orderId: created.order.id, status: "FAILED" };
    const result = await billing.processWebhook("mock", payload, sign(payload));
    const order = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: created.order.id } });
    const membership = await prisma.membership.findUnique({ where: { userId: user.id } });
    assert.equal("activated" in result ? result.activated : true, false);
    assert.equal(order.status, "FAILED");
    assert.equal(membership, null);
  });
});

function sign(payload: Record<string, unknown>) {
  return createHmac("sha256", process.env.MOCK_PAYMENT_WEBHOOK_SECRET || "goalmate-mock-payment")
    .update(JSON.stringify(payload)).digest("hex");
}
async function createUser(name: string) {
  return prisma.user.create({ data: { email: `${PREFIX}${name}-${Date.now()}@example.com`, passwordHash: "hash" } });
}
async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}
