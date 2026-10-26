import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { PrismaModule } from "./prisma/prisma.module"
import { AuthModule } from "./auth/auth.module"
import { UserModule } from "./user/user.module"
import { CabinetModule } from "./modules/cabinet/cabinet.module"
import { HealthController } from "./health/health.controller"
import { OperationsController } from "./health/operations.controller"
import { RuntimeMetricsModule } from "./health/runtime-metrics.module"

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/api/.env', '../apps/api/.env'],
    }),
    RuntimeMetricsModule,
    PrismaModule,
    AuthModule,
    UserModule,
    CabinetModule,
  ],
  controllers: [HealthController, OperationsController],
})
export class AppModule {}
