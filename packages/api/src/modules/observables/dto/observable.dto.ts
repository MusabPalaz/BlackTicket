import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CaseLinkType, ObservableType, Tlp } from '@black-ticket/shared';

export class ObservableInputDto {
  @ApiProperty({ enum: Object.values(ObservableType) })
  @IsEnum(ObservableType)
  type!: ObservableType;

  @ApiProperty({ example: '185.220.101[.]4', description: 'Defanged input is accepted' })
  @IsString()
  @Length(1, 2_048)
  value!: string;

  @ApiPropertyOptional({ description: 'Mark as an indicator of compromise, not just context' })
  @IsOptional()
  @IsBoolean()
  isIoc?: boolean;

  @ApiPropertyOptional({ enum: Object.values(Tlp) })
  @IsOptional()
  @IsEnum(Tlp)
  tlp?: Tlp;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class AddObservablesDto {
  @ApiProperty({ type: [ObservableInputDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ObservableInputDto)
  items!: ObservableInputDto[];
}

export class UpdateCaseObservableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isIoc?: boolean;

  @ApiPropertyOptional({ enum: Object.values(Tlp) })
  @IsOptional()
  @IsEnum(Tlp)
  tlp?: Tlp;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class SearchObservablesDto {
  @ApiPropertyOptional({ description: 'Value fragment; defanged input is accepted' })
  @IsOptional()
  @IsString()
  @MaxLength(2_048)
  q?: string;

  @ApiPropertyOptional({ enum: Object.values(ObservableType) })
  @IsOptional()
  @IsEnum(ObservableType)
  type?: ObservableType;

  @ApiPropertyOptional({ description: 'Only indicators flagged as IOC on at least one case' })
  @IsOptional()
  @IsString()
  iocOnly?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}

export class CreateCaseLinkDto {
  @ApiProperty()
  @IsUUID()
  targetCaseId!: string;

  @ApiPropertyOptional({ enum: Object.values(CaseLinkType) })
  @IsOptional()
  @IsEnum(CaseLinkType)
  linkType?: CaseLinkType;

  @ApiProperty({ description: 'Why these cases belong together' })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class CreateWhitelistRuleDto {
  @ApiProperty({ enum: Object.values(ObservableType) })
  @IsEnum(ObservableType)
  type!: ObservableType;

  @ApiProperty({ example: '10.0.0.0/8', description: 'Exact value, IPv4 CIDR, or *.domain.tld' })
  @IsString()
  @Length(1, 2_048)
  pattern!: string;

  @ApiPropertyOptional({ description: 'Set for IPv4 CIDR blocks' })
  @IsOptional()
  @IsBoolean()
  isCidr?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
