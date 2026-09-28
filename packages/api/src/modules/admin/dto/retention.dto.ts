import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from '@black-ticket/shared';

/** `null` is a meaningful value here — "keep indefinitely" — not an omission. */
const Days = () =>
  function (target: object, key: string) {
    ValidateIf((_o, value) => value !== null)(target, key);
    IsInt()(target, key);
    Min(RETENTION_MIN_DAYS)(target, key);
    Max(RETENTION_MAX_DAYS)(target, key);
  };

export class UpdateRetentionPolicyDto {
  @ApiProperty({ minimum: RETENTION_MIN_DAYS, maximum: RETENTION_MAX_DAYS })
  @Days()
  ssoLoginAttemptDays!: number;

  @ApiProperty()
  @Days()
  expiredSessionDays!: number;

  @ApiProperty()
  @Days()
  readNotificationDays!: number;

  @ApiProperty()
  @Days()
  outboundEmailDays!: number;

  @ApiPropertyOptional({ nullable: true, description: 'null keeps soft-deleted rows forever' })
  @IsOptional()
  @Days()
  softDeletedDays!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'null keeps the audit trail forever. A number does NOT make the application delete anything — the trail is append-only and is pruned by the archive maintenance script.',
  })
  @IsOptional()
  @Days()
  auditLogDays!: number | null;
}
