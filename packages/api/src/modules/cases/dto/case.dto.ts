import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CaseResolution, CaseStatus, Severity, Tlp } from '@black-ticket/shared';

export class CreateCaseDto {
  @ApiProperty({ example: 'Phishing campaign targeting finance' })
  @IsString()
  @Length(3, 300)
  title!: string;

  @ApiPropertyOptional({ description: 'Markdown' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @ApiPropertyOptional({ enum: Object.values(Severity) })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @ApiPropertyOptional({ enum: Object.values(Tlp) })
  @IsOptional()
  @IsEnum(Tlp)
  tlp?: Tlp;

  @ApiPropertyOptional({ enum: Object.values(Tlp) })
  @IsOptional()
  @IsEnum(Tlp)
  pap?: Tlp;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Leave empty to keep the case unassigned' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ description: 'When the incident actually happened' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String], description: 'MITRE technique ids, e.g. T1566.001' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  mitre?: string[];
}

export class UpdateCaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 300)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @ApiPropertyOptional({ enum: Object.values(Severity) })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @ApiPropertyOptional({ enum: Object.values(Tlp) })
  @IsOptional()
  @IsEnum(Tlp)
  tlp?: Tlp;

  @ApiPropertyOptional({ enum: Object.values(Tlp) })
  @IsOptional()
  @IsEnum(Tlp)
  pap?: Tlp;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}

export class AssignCaseDto {
  @ApiPropertyOptional({ nullable: true, description: 'null clears the assignment' })
  @IsOptional()
  @IsUUID()
  userId?: string | null;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: [CaseStatus.NEW, CaseStatus.IN_PROGRESS, CaseStatus.PENDING] })
  @IsEnum(CaseStatus)
  status!: CaseStatus;
}

export class CloseCaseDto {
  @ApiProperty({ enum: Object.values(CaseResolution) })
  @IsEnum(CaseResolution)
  resolution!: CaseResolution;

  @ApiProperty({ description: 'What happened and what was done — required to close' })
  @IsString()
  @Length(10, 5_000)
  summary!: string;
}

export class SetMitreDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  techniqueIds!: string[];
}

/** Everything the case list can be narrowed by. */
export class ListCasesQueryDto {
  @ApiPropertyOptional({ enum: Object.values(CaseStatus), isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')))
  @IsEnum(CaseStatus, { each: true })
  status?: CaseStatus[];

  @ApiPropertyOptional({ enum: Object.values(Severity), isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')))
  @IsEnum(Severity, { each: true })
  severity?: Severity[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @ApiPropertyOptional({ description: 'Free text over title, case number and tags' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    enum: ['occurredAt', 'createdAt'],
    default: 'occurredAt',
    description:
      'Which date the from/to window applies to. The dashboard trend counts when cases were opened, so drilling into a day has to filter on the same field.',
  })
  @IsOptional()
  @IsEnum(['occurredAt', 'createdAt'])
  dateField?: 'occurredAt' | 'createdAt';

  @ApiPropertyOptional({ description: 'Only cases that breached or are near their SLA' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  atRisk?: boolean;

  @ApiPropertyOptional({ description: 'Only cases already past their resolution target' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  breached?: boolean;

  @ApiPropertyOptional({ description: 'MITRE technique id, e.g. T1566.001' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  mitre?: string;

  @ApiPropertyOptional({ description: 'Only cases nobody has picked up' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  unassigned?: boolean;

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

  @ApiPropertyOptional({
    enum: ['createdAt', 'updatedAt', 'severity', 'slaDueAt', 'number'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsEnum(['createdAt', 'updatedAt', 'severity', 'slaDueAt', 'number'])
  sort?: 'createdAt' | 'updatedAt' | 'severity' | 'slaDueAt' | 'number';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
