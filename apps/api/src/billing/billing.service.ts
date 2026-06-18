import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PAYMENT_PROVIDERS, PaymentProvider } from "./payment-provider";

const PRICE_BY_DAYS: Record<number, number> = { 30: 1900, 90: 4900, 365: 16800 };

@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProvider[]
  ) {}

  async createOrder(userId: string, input: unknown) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const provider = this.getProvider(body.provider);
    const durationDays = Number(body.durationDays ?? 30);
    if (!PRICE_BY_DAYS[durationDays]) throw new BadRequestException("会员时长必须是 30、90 或 365 天");
    const order = await this.prisma.paymentOrder.create({
      data: {
        userId, provider: provider.name, plan: "PRO", durationDays,
        amountCents: PRICE_BY_DAYS[durationDays], currency: "CNY"
      }
    });
    const checkout = await provider.createCheckout({
      orderId: order.id, amountCents: order.amountCents, currency: order.currency,
      description: `GoalMate Pro ${durationDays} days`
    });
    const updated = await this.prisma.paymentOrder.update({
      where: { id: order.id }, data: checkout
    });
    return { order: this.serializeOrder(updated) };
  }

  async listOrders(userId: string) {
    const orders = await this.prisma.paymentOrder.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return { orders: orders.map((order) => this.serializeOrder(order)) };
  }

  async processWebhook(providerName: string, input: unknown, signature?: string) {
    const provider = this.getProvider(providerName);
    const event = provider.parseWebhook(input, signature);
    const existing = await this.prisma.paymentEvent.findUnique({ where: { providerEventId: event.eventId } });
    if (existing) return { duplicate: true, eventId: existing.id };
    const order = await this.prisma.paymentOrder.findFirst({ where: { id: event.orderId, provider: provider.name } });
    if (!order) throw new NotFoundException("支付订单不存在");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const paymentEvent = await tx.paymentEvent.create({
          data: {
            orderId: order.id, userId: order.userId, provider: provider.name,
            providerEventId: event.eventId, type: event.type,
            payload: event.payload as Prisma.InputJsonValue, processedAt: new Date()
          }
        });
        if (event.status === "FAILED") {
          await tx.paymentOrder.update({ where: { id: order.id }, data: { status: "FAILED" } });
          return { duplicate: false, activated: false, eventId: paymentEvent.id };
        }
        const current = await tx.membership.findUnique({ where: { userId: order.userId } });
        const now = new Date();
        const base = current?.expiresAt && current.expiresAt > now ? current.expiresAt : now;
        const expiresAt = new Date(base.getTime() + order.durationDays * 86_400_000);
        await tx.paymentOrder.update({ where: { id: order.id }, data: { status: "PAID", paidAt: now, expiresAt } });
        await tx.membership.upsert({
          where: { userId: order.userId },
          create: { userId: order.userId, plan: "PRO", status: "ACTIVE", expiresAt },
          update: { plan: "PRO", status: "ACTIVE", expiresAt }
        });
        await tx.membershipAudit.create({
          data: {
            userId: order.userId, orderId: order.id, action: "PAYMENT_ACTIVATED",
            fromPlan: current?.plan ?? null, toPlan: "PRO",
            fromStatus: current?.status ?? null, toStatus: "ACTIVE", expiresAt,
            reason: `${provider.name} payment confirmed`,
            metadata: { providerEventId: event.eventId, durationDays: order.durationDays }
          }
        });
        return { duplicate: false, activated: true, eventId: paymentEvent.id, expiresAt: expiresAt.toISOString() };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { duplicate: true };
      }
      throw error;
    }
  }

  private getProvider(value: unknown) {
    const name = typeof value === "string" ? value.trim().toUpperCase() : "MOCK";
    const provider = this.providers.find((item) => item.name === name);
    if (!provider || !provider.isConfigured()) throw new BadRequestException("支付渠道未配置");
    return provider;
  }

  private serializeOrder(order: { id: string; provider: string; plan: string; durationDays: number; amountCents: number; currency: string; status: string; checkoutUrl: string | null; paidAt: Date | null; expiresAt: Date | null; createdAt: Date }) {
    return { ...order, paidAt: order.paidAt?.toISOString() ?? null, expiresAt: order.expiresAt?.toISOString() ?? null, createdAt: order.createdAt.toISOString() };
  }
}
