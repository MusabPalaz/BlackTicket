import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { MailService } from '../mail/mail.service';
import { MailWorker } from '../mail/mail.worker';
import { MailSettingsService } from './mail-settings.service';
import { UpdateMailSettingsDto } from './dto/mail.dto';

@ApiTags('admin')
@Controller('admin/settings/mail')
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class MailSettingsController {
  constructor(
    private readonly settings: MailSettingsService,
    private readonly mail: MailService,
    private readonly worker: MailWorker,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Outbound mail settings; the password is never returned' })
  get() {
    return this.settings.view();
  }

  @Get('log')
  @ApiOperation({ summary: 'What was sent recently, and what became of it' })
  log(@Query('limit') limit?: string) {
    return this.mail.recent(Math.min(100, Number(limit ?? 20) || 20));
  }

  @Put()
  @ApiOperation({ summary: 'Update the settings. Omit password to keep the stored one.' })
  update(@Body() dto: UpdateMailSettingsDto, @CurrentUser() user: User, @Req() request: Request) {
    return this.settings.update(dto, {
      id: user.id,
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    });
  }

  @Post('test-connection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check the host and credentials without sending anything' })
  testConnection() {
    return this.mail.testConnection();
  }

  /**
   * Queues a message to the administrator and drains immediately, so the answer
   * is about the whole path rather than only the connection.
   */
  @Post('test-send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test message to your own address' })
  async testSend(@CurrentUser() user: User) {
    await this.mail.sendTest(user.email, user.fullName, user.id);
    const sent = await this.worker.drain();
    return { queued: true, sentInThisPass: sent };
  }
}
