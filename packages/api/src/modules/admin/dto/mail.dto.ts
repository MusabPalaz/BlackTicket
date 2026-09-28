import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MailTransportKind } from '@black-ticket/shared';

export class UpdateMailSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ enum: Object.values(MailTransportKind) })
  @IsOptional()
  @IsIn(Object.values(MailTransportKind))
  kind?: MailTransportKind;

  @ApiPropertyOptional({ example: 'soc-noreply@blackticket.local' })
  @IsOptional()
  @IsEmail()
  fromAddress?: string;

  @ApiPropertyOptional({ example: 'Black Ticket' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fromName?: string;

  @ApiPropertyOptional({ example: 'smtp.blackticket.local' })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  host?: string;

  @ApiPropertyOptional({ example: 587 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ApiPropertyOptional({ description: 'Implicit TLS (465). False means STARTTLS.' })
  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(320)
  username?: string;

  @ApiPropertyOptional({ description: 'Omit to keep the stored password' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  @ApiPropertyOptional({ description: 'Entra directory (tenant) id' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tenantId?: string;

  @ApiPropertyOptional({ description: 'Application (client) id of the app registration' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;

  @ApiPropertyOptional({ description: 'Omit to keep the stored client secret' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientSecret?: string;

  @ApiPropertyOptional({ description: 'Mailbox to send as: object id or userPrincipalName' })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  senderUserId?: string;
}
