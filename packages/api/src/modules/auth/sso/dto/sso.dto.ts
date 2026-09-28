import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SsoExchangeDto {
  @ApiProperty({ description: 'Single-use handoff code from the sign-in redirect' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  code!: string;
}
