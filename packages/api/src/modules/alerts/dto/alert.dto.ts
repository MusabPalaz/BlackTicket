import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { API_KEY_SCOPES, AlertStatus, Severity, type ApiKeyScope } from '@black-ticket/shared';
import { ObservableInputDto } from '../../observables/dto/observable.dto';

export class IngestAlertDto {
  @ApiProperty({ example: 'wazuh-1029384', description: 'Identifier in the source system' })
  @IsString()
  @Length(1, 200)
  externalId!: string;

  @ApiProperty({ example: 'Wazuh' })
  @IsString()
  @Length(1, 100)
  source!: string;

  @ApiProperty({ example: 'Multiple failed SSH logins from external IP' })
  @IsString()
  @Length(3, 300)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @ApiPropertyOptional({ enum: Object.values(Severity) })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @ApiPropertyOptional({ description: 'Category slug, e.g. brute-force' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ type: [ObservableInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ObservableInputDto)
  observables?: ObservableInputDto[];

  @ApiPropertyOptional({ type: [String], example: ['T1110.001'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  mitre?: string[];

  @ApiPropertyOptional({ description: 'Raw payload from the source, stored verbatim' })
  @IsOptional()
  @IsObject()
  raw?: Record<string, unknown>;
}

export class ListAlertsQueryDto {
  @ApiPropertyOptional({ enum: Object.values(AlertStatus) })
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({
    description: 'Only alerts received at or after this time — the dashboard counts a window',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

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

export class ImportAlertDto {
  @ApiPropertyOptional({ description: 'Override the alert title on the new case' })
  @IsOptional()
  @IsString()
  @Length(3, 300)
  title?: string;

  @ApiPropertyOptional({ enum: Object.values(Severity) })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @ApiPropertyOptional({ description: 'Assign the new case immediately' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;
}

export class MergeAlertDto {
  @ApiProperty({ description: 'Existing case to fold this alert into' })
  @IsUUID()
  caseId!: string;
}

export class IgnoreAlertDto {
  @ApiPropertyOptional({ description: 'Why it was dismissed; kept in the audit trail' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RestoreAlertDto {
  @ApiPropertyOptional({ description: 'Why it goes back to the queue; kept in the audit trail' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Wazuh production' })
  @IsString()
  @Length(3, 100)
  name!: string;

  @ApiPropertyOptional({ description: 'Optional expiry date' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    enum: API_KEY_SCOPES,
    isArray: true,
    description: 'What the key may do. Defaults to alert ingest.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes?: ApiKeyScope[];
}
