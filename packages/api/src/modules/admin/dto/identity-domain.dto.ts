import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetIdentityDomainDto {
  @ApiProperty({ example: 'blackticket.local' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  domain!: string;

  @ApiProperty({ description: 'Must equal `domain` — guards against a typo becoming permanent' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  confirmDomain!: string;
}

/** Same shape as the primary: the domain, typed twice. */
export class AddIdentityDomainDto extends SetIdentityDomainDto {}

export class LockIdentityDomainDto {
  @ApiProperty({ description: 'Retype the domain to confirm the lock' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  confirmDomain!: string;

  @ApiPropertyOptional({
    description: 'Lock anyway even though some existing accounts sit outside the domain',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeMismatch?: boolean;
}

export class UnlockIdentityDomainDto {
  @ApiProperty({ description: 'Your own password — unlocking is re-authenticated' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;

  @ApiProperty({ description: 'Why the domain is being unlocked; stored in the audit trail' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
