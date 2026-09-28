import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../../../common/security/password.constants';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;

  @ApiPropertyOptional({ description: 'TOTP code or a single-use recovery code' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  totpCode?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Refresh token to revoke along with the session' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, 256)
  newPassword!: string;
}

export class EnableTotpDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Two-factor code must be 6 digits.' })
  code!: string;
}

export class DisableTotpDto {
  @ApiProperty({ description: 'Current password — removing a factor is re-authenticated' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}
