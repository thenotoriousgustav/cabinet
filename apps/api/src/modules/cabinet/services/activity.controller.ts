import { Body, Controller, DefaultValuePipe, Get, Header, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { ApiCookieAuth, ApiProperty, ApiQuery, ApiTags } from "@nestjs/swagger"
import { IsBoolean } from "class-validator"
import { AuthGuard } from "@/auth/guards/auth.guard"
import { CurrentUser } from "@/common/decorators/current-user.decorator"
import { BackgroundTasksService } from "./background-tasks.service"
import { BookmarksService } from "../bookmarks/bookmarks.service"

class OnboardingDto {
  @ApiProperty()
  @IsBoolean()
  dismissed!: boolean
}

@ApiTags("activity")
@ApiCookieAuth()
@Controller("v1/activity")
@UseGuards(AuthGuard)
export class ActivityController {
  constructor(private tasks: BackgroundTasksService, private bookmarks: BookmarksService) {}
  @Get()
  @ApiQuery({ name: "page", required: false, schema: { type: "integer", default: 1, minimum: 1, maximum: 10000 } })
  @Header("Cache-Control", "private, no-store")
  list(@CurrentUser() user: { id: string }, @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number) { return this.tasks.list(user.id, page) }
  @Get("overview")
  @Header("Cache-Control", "private, no-store")
  overview(@CurrentUser() user: { id: string }) { return this.tasks.overview(user.id) }
  @Post("tasks/:id/retry")
  @HttpCode(202)
  retry(@CurrentUser() user: { id: string }, @Param("id", new ParseUUIDPipe()) id: string) { return this.tasks.retry(user.id, id) }
  @Post("metadata/:id/retry")
  @HttpCode(202)
  retryMetadata(@CurrentUser() user: { id: string }, @Param("id", new ParseUUIDPipe()) id: string) { return this.bookmarks.refreshEnrichment(user.id, id) }
  @Patch("onboarding")
  dismiss(@CurrentUser() user: { id: string }, @Body() dto: OnboardingDto) { return this.tasks.dismissOnboarding(user.id, dto.dismissed) }
}
