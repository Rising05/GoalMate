import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QUOTA_CAPABILITIES, QuotaCapability } from "../quota/quota.service";
import { FieldEncryptionService } from "../security/field-encryption.service";
import { PAYMENT_PROVIDERS, ParsedPaymentEvent, PaymentProvider, PaymentWebhookHeaders } from "./payment-provider";

const DEFAULT_PLAN_CODE_BY_DAYS: Record<number, string> = {
  30: "PRO_30D",
  90: "PRO_90D",
  365: "PRO_365D"
};

export const BILLING_PRO_ENTITLEMENT_LIMITS: Record<QuotaCapability, number | null> = {
  ACTIVE_GOAL: null,
  PLAN_GENERATION: 30,
  CHECKIN_SCORING: 30,
  SCORE_APPEAL: 10,
  GOAL_REPLAN: 10,
  REPORT_GENERATION: 20,
  REWARD_CARD: 100,
  UPLOAD_STORAGE_KIB: 5 * 1024 * 1024
};

type PaymentOrderShape = Prisma.PaymentOrderGetPayload<{
  include: { subscription: true; billingPlan: true };
}>;

@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProvider[],
    @Optional()
    @Inject(FieldEncryptionService)
    private readonly fields: FieldEncryptionService = new FieldEncryptionService()
  ) {}

  async listPlans() {
    const plans = await this.prisma.billingPlan.findMany({
      where: { status: "ACTIVE" },
      orderBy: { durationDays: "asc" }
    });

    return { plans: plans.map((plan) => this.serializeBillingPlan(plan)) };
  }

  async createOrder(userId: string, input: unknown) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const provider = this.getProvider(body.provider);
    const plan = await this.getBillingPlan(body);
    const order = await this.prisma.paymentOrder.create({
      data: {
        userId,
        billingPlanId: plan.id,
        provider: provider.name,
        plan: plan.plan,
        durationDays: plan.durationDays,
        amountCents: plan.amountCents,
        currency: plan.currency
      }
    });
    const checkout = await provider.createCheckout({
      orderId: order.id,
      amountCents: order.amountCents,
      currency: order.currency,
      description: `${plan.name}`
    });
    const updated = await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: checkout
    });
    const hydrated = await this.prisma.paymentOrder.findUniqueOrThrow({
      where: { id: updated.id },
      include: { billingPlan: true, subscription: true, payments: { orderBy: { createdAt: "desc" } } }
    });

    return { order: this.serializeOrder(hydrated) };
  }

  async listOrders(userId: string) {
    const orders = await this.prisma.paymentOrder.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { billingPlan: true, subscription: true, payments: { orderBy: { createdAt: "desc" } } }
    });

    return { orders: orders.map((order) => this.serializeOrder(order)) };
  }

  async processWebhook(providerName: string, input: unknown, signature?: string | PaymentWebhookHeaders) {
    const provider = this.getProvider(providerName);
    const event = provider.parseWebhook(input, signature);
    const existing = await this.prisma.paymentEvent.findUnique({
      where: { providerEventId: event.eventId }
    });

    if (existing) {
      return { duplicate: true, eventId: existing.id };
    }

    const order = await this.prisma.paymentOrder.findFirst({
      where: { id: event.orderId, provider: provider.name },
      include: { subscription: true, billingPlan: true }
    });

    if (!order) {
      throw new NotFoundException("支付订单不存在");
    }

    this.assertEventAmount(order.amountCents, event);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const paymentEvent = await tx.paymentEvent.create({
          data: {
            orderId: order.id,
            userId: order.userId,
            provider: provider.name,
            providerEventId: event.eventId,
            type: event.type,
            payload: event.payload as Prisma.InputJsonValue,
            processedAt: new Date()
          }
        });

        if (event.status === "FAILED") {
          await this.markOrderFailed(tx, order.id);
          await this.createPaymentTransaction(tx, order, event, "FAILED");
          return { duplicate: false, activated: false, eventId: paymentEvent.id };
        }

        if (event.status === "REFUNDED" || event.status === "DISPUTED") {
          const result = await this.revokeOrderEntitlements(tx, order, event);
          return { duplicate: false, activated: false, revoked: result.revoked, eventId: paymentEvent.id };
        }

        if (event.status === "CANCELED") {
          const result = await this.cancelSubscriptionAtPeriodEnd(tx, order, event);
          return { duplicate: false, activated: false, canceled: result.canceled, eventId: paymentEvent.id };
        }

        const result = await this.activateOrder(tx, order, event);
        return {
          duplicate: false,
          activated: result.activated,
          eventId: paymentEvent.id,
          subscriptionId: result.subscriptionId,
          expiresAt: result.expiresAt?.toISOString() ?? null,
          reason: result.reason
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { duplicate: true };
      }

      throw error;
    }
  }

  async adminRefundOrder(actorUserId: string, orderId: string, input: unknown = {}) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    if (reason.length < 6) {
      throw new BadRequestException("退款必须填写至少 6 个字符的原因");
    }

    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
      include: { subscription: true, billingPlan: true }
    });

    if (!order) {
      throw new NotFoundException("支付订单不存在");
    }

    return this.prisma.$transaction(async (tx) => {
      const event = await tx.paymentEvent.create({
        data: {
          orderId: order.id,
          userId: order.userId,
          provider: order.provider,
          providerEventId: `ADMIN_REFUND:${order.id}:${Date.now()}`,
          type: "ADMIN_REFUND",
          payload: { orderId: order.id, actorUserId, hasReason: true },
          processedAt: new Date()
        }
      });
      const result = await this.revokeOrderEntitlements(tx, order, {
        eventId: event.providerEventId,
        orderId: order.id,
        status: "REFUNDED",
        type: "ADMIN_REFUND",
        payload: { orderId: order.id, actorUserId, hasReason: true },
        amountCents: order.amountCents,
        providerPaymentId: null,
        providerSubscriptionId: null,
        reason
      });

      return {
        eventId: event.id,
        order: this.serializeOrder(result.order),
        revoked: result.revoked
      };
    });
  }

  private async activateOrder(
    tx: Prisma.TransactionClient,
    order: PaymentOrderShape,
    event: ParsedPaymentEvent
  ) {
    if (order.status === "PAID" || order.status === "REFUNDED" || order.status === "DISPUTED") {
      await this.createPaymentTransaction(tx, order, event, order.status === "PAID" ? "DUPLICATE" : "IGNORED");
      return { activated: false, subscriptionId: order.subscriptionId, expiresAt: order.expiresAt, reason: `ORDER_${order.status}` };
    }

    const now = new Date();
    const activeSubscription = await tx.subscription.findFirst({
      where: {
        userId: order.userId,
        plan: order.plan,
        status: "ACTIVE",
        currentPeriodEnd: { gt: now }
      },
      orderBy: { currentPeriodEnd: "desc" }
    });
    const base = activeSubscription?.currentPeriodEnd && activeSubscription.currentPeriodEnd > now
      ? activeSubscription.currentPeriodEnd
      : now;
    const expiresAt = new Date(base.getTime() + order.durationDays * 86_400_000);
    const subscription = activeSubscription
      ? await tx.subscription.update({
          where: { id: activeSubscription.id },
          data: {
            provider: order.provider,
            providerSubscriptionId: event.providerSubscriptionId ?? activeSubscription.providerSubscriptionId,
            billingPlanId: order.billingPlanId,
            currentPeriodEnd: expiresAt,
            sourceOrderId: order.id,
            status: "ACTIVE",
            cancelAtPeriodEnd: false,
            canceledAt: null,
            metadata: { lastProviderEventId: event.eventId }
          }
        })
      : await tx.subscription.create({
          data: {
            userId: order.userId,
            provider: order.provider,
            providerSubscriptionId: event.providerSubscriptionId,
            billingPlanId: order.billingPlanId,
            plan: order.plan,
            status: "ACTIVE",
            currentPeriodStart: now,
            currentPeriodEnd: expiresAt,
            sourceOrderId: order.id,
            metadata: { providerEventId: event.eventId }
          }
        });

    const updatedOrder = await tx.paymentOrder.update({
      where: { id: order.id },
      data: { status: "PAID", paidAt: now, expiresAt, subscriptionId: subscription.id }
    });
    await this.createPaymentTransaction(tx, updatedOrder, event, "SUCCEEDED");
    await this.grantProEntitlements(tx, updatedOrder, subscription.id, expiresAt, now);
    const current = await tx.membership.findUnique({ where: { userId: order.userId } });
    await tx.membership.upsert({
      where: { userId: order.userId },
      create: { userId: order.userId, plan: "PRO", status: "ACTIVE", expiresAt },
      update: { plan: "PRO", status: "ACTIVE", expiresAt }
    });
    await this.createMembershipAudit(tx, {
      userId: order.userId,
      orderId: order.id,
      action: "PAYMENT_ACTIVATED",
      fromPlan: current?.plan ?? null,
      toPlan: "PRO",
      fromStatus: current?.status ?? null,
      toStatus: "ACTIVE",
      expiresAt,
      reason: `${order.provider} payment confirmed`,
      metadata: { providerEventId: event.eventId, durationDays: order.durationDays, subscriptionId: subscription.id }
    });

    return { activated: true, subscriptionId: subscription.id, expiresAt, reason: null };
  }

  private async revokeOrderEntitlements(
    tx: Prisma.TransactionClient,
    order: PaymentOrderShape,
    event: ParsedPaymentEvent
  ) {
    const now = new Date();
    const status = event.status === "DISPUTED" ? "DISPUTED" : "REFUNDED";
    const source = this.getEntitlementSource(order.provider, order.id);
    const revoked = await tx.entitlement.updateMany({
      where: {
        userId: order.userId,
        source,
        OR: [{ validUntil: null }, { validUntil: { gt: now } }]
      },
      data: { validUntil: now }
    });
    const updatedOrder = await tx.paymentOrder.update({
      where: { id: order.id },
      data: { status }
    });

    if (order.subscriptionId) {
      await tx.subscription.updateMany({
        where: { id: order.subscriptionId },
        data: {
          status: "CANCELED",
          currentPeriodEnd: now,
          cancelAtPeriodEnd: false,
          canceledAt: now,
          metadata: { revokedByEventId: event.eventId, reason: event.reason ?? null }
        }
      });
    }

    await this.createPaymentTransaction(tx, updatedOrder, event, status);
    await this.refreshMembershipProjection(tx, order.userId, now);
    await this.createMembershipAudit(tx, {
      userId: order.userId,
      orderId: order.id,
      action: status === "DISPUTED" ? "PAYMENT_DISPUTED" : "PAYMENT_REFUNDED",
      fromPlan: "PRO",
      toPlan: "FREE",
      fromStatus: "ACTIVE",
      toStatus: "EXPIRED",
      expiresAt: now,
      reason: event.reason ?? `${order.provider} ${status.toLowerCase()}`,
      metadata: { providerEventId: event.eventId, revokedEntitlements: revoked.count }
    });

    return { revoked: revoked.count, order: updatedOrder };
  }

  private async cancelSubscriptionAtPeriodEnd(
    tx: Prisma.TransactionClient,
    order: PaymentOrderShape,
    event: ParsedPaymentEvent
  ) {
    if (!order.subscriptionId) {
      return { canceled: false };
    }

    const now = new Date();
    const updated = await tx.subscription.updateMany({
      where: { id: order.subscriptionId, status: "ACTIVE" },
      data: { cancelAtPeriodEnd: true, canceledAt: now, metadata: { canceledByEventId: event.eventId, reason: event.reason ?? null } }
    });
    await tx.paymentOrder.update({ where: { id: order.id }, data: { status: "CANCELED" } });
    await this.createPaymentTransaction(tx, order, event, "CANCELED");

    return { canceled: updated.count === 1 };
  }

  private async markOrderFailed(tx: Prisma.TransactionClient, orderId: string) {
    await tx.paymentOrder.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "FAILED" }
    });
  }

  private async grantProEntitlements(
    tx: Prisma.TransactionClient,
    order: { id: string; userId: string; provider: string },
    subscriptionId: string,
    expiresAt: Date,
    now: Date
  ) {
    const source = this.getEntitlementSource(order.provider, order.id);
    await tx.entitlement.createMany({
      data: QUOTA_CAPABILITIES.map((capability) => ({
        userId: order.userId,
        capability,
        limitValue: BILLING_PRO_ENTITLEMENT_LIMITS[capability],
        source,
        validFrom: now,
        validUntil: expiresAt,
        metadata: { orderId: order.id, subscriptionId, plan: "PRO" }
      }))
    });
  }

  private async refreshMembershipProjection(tx: Prisma.TransactionClient, userId: string, now: Date) {
    const current = await tx.membership.findUnique({ where: { userId } });
    if (current?.status === "MANUAL" && (!current.expiresAt || current.expiresAt > now)) {
      return current;
    }

    const activeSubscription = await tx.subscription.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        currentPeriodEnd: { gt: now }
      },
      orderBy: { currentPeriodEnd: "desc" }
    });

    if (activeSubscription) {
      return tx.membership.upsert({
        where: { userId },
        create: { userId, plan: "PRO", status: "ACTIVE", expiresAt: activeSubscription.currentPeriodEnd },
        update: { plan: "PRO", status: "ACTIVE", expiresAt: activeSubscription.currentPeriodEnd }
      });
    }

    return tx.membership.upsert({
      where: { userId },
      create: { userId, plan: "FREE", status: "EXPIRED", expiresAt: now },
      update: { plan: "FREE", status: "EXPIRED", expiresAt: now }
    });
  }

  private async createPaymentTransaction(
    tx: Prisma.TransactionClient,
    order: { id: string; userId: string; provider: string; amountCents: number; currency: string },
    event: ParsedPaymentEvent,
    status: string
  ) {
    const type =
      event.status === "REFUNDED" || event.status === "DISPUTED"
        ? "REFUND"
        : event.status === "CANCELED"
          ? "CANCELLATION"
          : "PAYMENT";
    const providerPaymentId = event.providerPaymentId ?? `${event.eventId}:${type}`;
    const existing = await tx.paymentTransaction.findUnique({
      where: { providerPaymentId }
    });

    if (existing) return existing;

    return tx.paymentTransaction.create({
      data: {
        orderId: order.id,
        userId: order.userId,
        provider: order.provider,
        providerPaymentId,
        type,
        status,
        amountCents: event.amountCents ?? order.amountCents,
        refundedCents: type === "REFUND" ? event.amountCents ?? order.amountCents : 0,
        currency: order.currency,
        reason: event.reason,
        metadata: { providerEventId: event.eventId, providerSubscriptionId: event.providerSubscriptionId ?? null }
      }
    });
  }

  private async createMembershipAudit(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      orderId: string;
      action: string;
      fromPlan: string | null;
      toPlan: string;
      fromStatus: string | null;
      toStatus: string;
      expiresAt: Date | null;
      reason: string;
      metadata: Prisma.InputJsonValue;
    }
  ) {
    const reason = this.fields.encrypt(input.reason);
    return tx.membershipAudit.create({
      data: {
        userId: input.userId,
        orderId: input.orderId,
        action: input.action,
        fromPlan: input.fromPlan,
        toPlan: input.toPlan,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        expiresAt: input.expiresAt,
        reason: reason.ciphertext,
        reasonKeyVersion: reason.keyVersion,
        metadata: input.metadata
      }
    });
  }

  private assertEventAmount(expectedAmountCents: number, event: ParsedPaymentEvent) {
    if (event.amountCents !== undefined && event.amountCents !== expectedAmountCents) {
      throw new BadRequestException("支付回调金额与订单不一致");
    }
  }

  private async getBillingPlan(body: Record<string, unknown>) {
    const code = typeof body.planCode === "string" ? body.planCode.trim().toUpperCase() : "";
    const durationDays = Number(body.durationDays ?? 30);
    const planCode = code || DEFAULT_PLAN_CODE_BY_DAYS[durationDays];

    if (!planCode) {
      throw new BadRequestException("会员时长必须是 30、90 或 365 天");
    }

    const plan = await this.prisma.billingPlan.findFirst({
      where: { code: planCode, status: "ACTIVE" }
    });

    if (!plan) {
      throw new BadRequestException("会员套餐未配置或已下线");
    }

    return plan;
  }

  private getEntitlementSource(provider: string, orderId: string) {
    return `PAYMENT:${provider}:${orderId}`;
  }

  private getProvider(value: unknown) {
    const name = typeof value === "string" ? value.trim().toUpperCase() : "MOCK";
    const provider = this.providers.find((item) => item.name === name);
    if (!provider || !provider.isConfigured()) throw new BadRequestException("支付渠道未配置");
    return provider;
  }

  private serializeBillingPlan(plan: {
    id: string;
    code: string;
    name: string;
    plan: string;
    durationDays: number;
    amountCents: number;
    currency: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...plan,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString()
    };
  }

  private serializeOrder(order: {
    id: string;
    provider: string;
    plan: string;
    durationDays: number;
    amountCents: number;
    currency: string;
    status: string;
    checkoutUrl: string | null;
    providerOrderId?: string | null;
    subscriptionId?: string | null;
    paidAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    billingPlan?: { code: string; name: string } | null;
    subscription?: { status: string; currentPeriodEnd: Date; cancelAtPeriodEnd: boolean } | null;
    payments?: Array<{ type: string; status: string; amountCents: number; refundedCents: number; createdAt: Date }>;
  }) {
    return {
      id: order.id,
      provider: order.provider,
      plan: order.plan,
      planCode: order.billingPlan?.code ?? null,
      planName: order.billingPlan?.name ?? null,
      durationDays: order.durationDays,
      amountCents: order.amountCents,
      currency: order.currency,
      status: order.status,
      providerOrderId: order.providerOrderId ?? null,
      subscriptionId: order.subscriptionId ?? null,
      subscription: order.subscription
        ? {
            status: order.subscription.status,
            currentPeriodEnd: order.subscription.currentPeriodEnd.toISOString(),
            cancelAtPeriodEnd: order.subscription.cancelAtPeriodEnd
          }
        : null,
      payments: order.payments?.map((payment) => ({
        type: payment.type,
        status: payment.status,
        amountCents: payment.amountCents,
        refundedCents: payment.refundedCents,
        createdAt: payment.createdAt.toISOString()
      })) ?? [],
      checkoutUrl: order.checkoutUrl,
      paidAt: order.paidAt?.toISOString() ?? null,
      expiresAt: order.expiresAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString()
    };
  }
}
