import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
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
import { Role, Severity } from '@black-ticket/shared';

export class ListUsersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: Object.values(Role) })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED', 'LOCKED', 'PENDING_ACTIVATION'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'DISABLED', 'LOCKED', 'PENDING_ACTIVATION'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated labels; an account matching any of them is returned',
  })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  tags?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  size?: number;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 200)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ enum: Object.values(Role) })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @ApiPropertyOptional({ type: [String], description: 'Replaces the whole set' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}

/**
 * One action applied to a set of accounts.
 *
 * Resetting a password stays per-account: it hands back a secret that has to
 * be delivered to one person, which a batch cannot do.
 *
 * Changing a role and deleting are here, but neither is one click away in the
 * client: the first asks for confirmation, the second asks for the count to be
 * typed out. Deleting is a soft delete and refuses accounts that still hold
 * open cases, so it is recoverable — the confirmation is about attention, not
 * about the database.
 */
export class BulkUsersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  userIds!: string[];

  @ApiProperty({
    enum: ['enable', 'disable', 'forceLogout', 'addTags', 'removeTags', 'setRole', 'delete'],
  })
  @IsEnum(['enable', 'disable', 'forceLogout', 'addTags', 'removeTags', 'setRole', 'delete'])
  action!: 'enable' | 'disable' | 'forceLogout' | 'addTags' | 'removeTags' | 'setRole' | 'delete';

  @ApiPropertyOptional({ enum: Object.values(Role), description: 'Required by setRole' })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ type: [String], description: 'Required by addTags and removeTags' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}

export class ImportUsersDto {
  @ApiProperty({ description: 'CSV text: username[,fullname][,email][,role]' })
  @IsString()
  @MaxLength(1_000_000)
  csv!: string;

  @ApiPropertyOptional({ default: true, description: 'Validate without writing anything' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ enum: Object.values(Role), default: Role.ANALYST })
  @IsOptional()
  @IsEnum(Role)
  defaultRole?: Role;
}

export class AuditQueryDto {
  @ApiPropertyOptional({ description: 'Actor account id' })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ example: 'LOGIN_FAILURE' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @ApiPropertyOptional({ example: 'Case' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  size?: number;

  @ApiPropertyOptional({ description: 'Return text/csv instead of JSON' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  csv?: boolean;
}

export class UpsertCategoryDto {
  @ApiProperty({ example: 'supply-chain' })
  @IsString()
  @Length(2, 60)
  slug!: string;

  @ApiProperty({ example: 'Supply chain' })
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiPropertyOptional({ example: '#8b5cf6' })
  @IsOptional()
  @IsString()
  @MaxLength(9)
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateSlaPolicyDto {
  @ApiProperty({ enum: Object.values(Severity) })
  @IsEnum(Severity)
  severity!: Severity;

  @ApiProperty({ description: 'Minutes allowed before the first analyst response' })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(100_000)
  firstResponseMinutes!: number;

  @ApiProperty({ description: 'Minutes allowed before the case must be resolved' })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1_000_000)
  resolutionMinutes!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

const PURGE_TARGETS = [
  'deletedUsers',
  'deletedCases',
  'expiredSessions',
  'readNotifications',
] as const;

export class PurgeableQueryDto {
  @ApiPropertyOptional({ default: 90, minimum: 1, maximum: 3_650 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3_650)
  olderThanDays?: number;
}

/**
 * The audit trail is not a target here on purpose: the database refuses DELETE
 * on it for every role, so accepting it would mean answering "removed 0" to a
 * request the operator believed had worked.
 */
export class PurgeDto {
  @ApiProperty({ enum: PURGE_TARGETS })
  @IsEnum(PURGE_TARGETS)
  target!: (typeof PURGE_TARGETS)[number];

  @ApiPropertyOptional({ default: 90, minimum: 1, maximum: 3_650 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3_650)
  olderThanDays?: number;
}

/**
 * The second factor is the confirmation, not a password: the password is the
 * credential most likely to be sitting in an unlocked browser, which is the
 * case this guard exists for.
 */
export class ResetDataDto {
  @ApiProperty({ description: 'A live code from the caller own authenticator app' })
  @IsString()
  @Length(6, 10)
  totpCode!: string;
}

/** Both switches are optional so either can be flipped on its own. */
export class UpdateSlaMonitoringDto {
  @ApiPropertyOptional({ description: 'Run the sweep at all' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Send breach, first-response and backlog notices' })
  @IsOptional()
  @IsBoolean()
  notifications?: boolean;
}
