import { Module } from "@nestjs/common"
import { BullModule } from "@nestjs/bullmq"
import { BookmarksController } from "./bookmarks.controller"
import { BookmarksService } from "./bookmarks.service"
import { MetadataService } from "@/modules/cabinet/services/metadata.service"
import { LinkCheckerService } from "@/modules/cabinet/services/link-checker.service"
import { EnrichmentProcessor } from "@/modules/cabinet/workers/enrichment.processor"
import { GenericMetadataProvider } from "@/modules/cabinet/providers/metadata/generic.metadata-provider"
import { CabinetMediaService } from "@/modules/cabinet/services/cabinet-media.service"
import { MetadataQueueService } from "../services/metadata-queue.service"
import { BackgroundTasksService } from "../services/background-tasks.service"
import { BackgroundTaskProcessor } from "../workers/background-task.processor"
import { ActivityController } from "../services/activity.controller"
import { R2StorageService } from "../storage/r2-storage.service"
import { UploadsController } from "../storage/uploads.controller"

@Module({
  imports: [
    BullModule.registerQueue({
      name: "bookmark-enrichment",
    }),
    BullModule.registerQueue({ name: "cabinet-tasks" }),
  ],
  controllers: [BookmarksController, ActivityController, UploadsController],
  providers: [
    BookmarksService,
    MetadataService,
    LinkCheckerService,
    EnrichmentProcessor,
    CabinetMediaService,
    GenericMetadataProvider,
    MetadataQueueService,
    BackgroundTasksService,
    BackgroundTaskProcessor,
    R2StorageService,
  ],
  exports: [BookmarksService, MetadataService, CabinetMediaService, R2StorageService],
})
export class BookmarksModule {}
