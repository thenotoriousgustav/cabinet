import { ApiProperty } from "@nestjs/swagger"
import { IsString, Length, Matches, MaxLength } from "class-validator"

export class SavedSearchDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name!: string

  @ApiProperty({ description: "Relative Cabinet library URL including its search and filters" })
  @IsString()
  @MaxLength(2000)
  @Matches(/^\/cabinet(?:\?|\/(?:folders\/[a-f0-9-]+|tags\/[^/?#]+|favorites|archive|trash|broken|duplicates)(?:\?|$)|$)/i)
  url!: string
}
