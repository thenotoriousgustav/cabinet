import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
import { RuntimeMetricsService } from "@/health/runtime-metrics.service";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, "query">
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;

  constructor(metrics: RuntimeMetricsService) {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({
      connectionString,
      max: parseInt(process.env.DB_POOL_MAX || "10", 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    const adapter = new PrismaPg(pool);
    super({ adapter, log: [{ emit: "event", level: "query" }] });
    this.$on("query", (event) => metrics.query(event.query, event.duration));
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
