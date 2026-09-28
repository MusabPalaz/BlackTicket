import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Role } from '@black-ticket/shared';
import { MIN_PASSWORD_LENGTH } from '../../../common/security/password.constants';

export class CreateUserDto {
  @ApiProperty({ example: 'jdoe' })
  @IsString()
  @Length(3, 64)
  username!: string;

  @ApiPropertyOptional({
    description: 'Omit to derive `<username>@<organisation domain>` automatically',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @Length(2, 200)
  fullName!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH, description: 'Initial password; must be changed at first sign-in' })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, 256)
  password!: string;

  @ApiProperty({ enum: Object.values(Role) })
  @IsEnum(Role)
  role!: Role;
}
