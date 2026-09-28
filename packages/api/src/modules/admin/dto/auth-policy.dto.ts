import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AuthMode, Role } from '@black-ticket/shared';

export class RoleMappingDto {
  @ApiProperty({ description: 'Directory group object id' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  groupId!: string;

  @ApiProperty({ description: 'Display name, so the mapping is readable' })
  @IsString()
  @MaxLength(200)
  groupName!: string;

  @ApiProperty({ enum: Object.values(Role) })
  @IsIn(Object.values(Role))
  role!: Role;
}

export class UpdateAuthPolicyDto {
  @ApiProperty({ enum: Object.values(AuthMode) })
  @IsEnum(AuthMode)
  mode!: AuthMode;

  @ApiPropertyOptional({ example: 'https://login.microsoftonline.com/<tenant>/v2.0' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  issuer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;

  @ApiPropertyOptional({ description: 'Omit to keep the stored secret' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientSecret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  redirectUri?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  scopes?: string[];

  @ApiPropertyOptional({ default: 'preferred_username' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  usernameClaim?: string;

  @ApiPropertyOptional({ default: 'groups' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  groupsClaim?: string;

  @ApiPropertyOptional({ type: [RoleMappingDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RoleMappingDto)
  roleMap?: RoleMappingDto[];

  @ApiPropertyOptional({ enum: Object.values(Role), nullable: true })
  @IsOptional()
  @IsIn([...Object.values(Role), null])
  defaultRole?: Role | null;
}
