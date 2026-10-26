import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ImportBookmarksDto {
  @ApiProperty({ description: 'Netscape HTML bookmark file content as raw string' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000000)
  htmlContent: string;
}
