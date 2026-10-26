import { Global, Module } from "@nestjs/common"
import { RuntimeMetricsService } from "./runtime-metrics.service"

@Global()
@Module({ providers: [RuntimeMetricsService], exports: [RuntimeMetricsService] })
export class RuntimeMetricsModule {}
