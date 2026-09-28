import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import {
  AuditAction,
  ObservableType,
  Permission,
  isValidIpv4Cidr,
  normalizeObservable,
} from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CorrelationService } from './correlation.service';
import { CreateWhitelistRuleDto } from './dto/observable.dto';

/**
 * Indicators that must never generate automatic correlations: internal ranges,
 * the organisation's own domains, and high-noise infrastructure such as public
 * resolvers. Managed from Admin, not from code.
 */
@ApiTags('admin')
@Controller('admin/whitelist')
@RequirePermissions(Permission.TAXONOMY_MANAGE)
export class WhitelistController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly correlation: CorrelationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Correlation whitelist rules' })
  async list() {
    const items = await this.prisma.correlationWhitelist.findMany({
      orderBy: [{ type: 'asc' }, { pattern: 'asc' }],
    });
    return {
      items: items.map((rule) => ({
        id: rule.id,
        type: rule.type,
        pattern: rule.pattern,
        isCidr: rule.isCidr,
        reason: rule.reason,
        createdAt: rule.createdAt.toISOString(),
      })),
      fanoutLimit: this.correlation.fanoutLimit,
    };
  }

  @Post()
  @ApiOperation({ summary: 'Add a whitelist rule' })
  async create(@Body() dto: CreateWhitelistRuleDto, @CurrentUser() user: User, @Req() request: Request) {
    const isCidr = dto.isCidr ?? dto.pattern.includes('/');
    const pattern = dto.pattern.trim().toLowerCase();

    // A rule that does not parse would silently never match, leaving an
    // administrator convinced an indicator is excluded when it is not.
    if (isCidr) {
      if (dto.type !== ObservableType.IP) {
        throw new BadRequestException('CIDR rules only apply to IP observables.');
      }
      if (!isValidIpv4Cidr(pattern)) {
        throw new BadRequestException('That is not a valid IPv4 CIDR block, e.g. 10.0.0.0/8.');
      }
    } else if (!pattern.startsWith('*.')) {
      const check = normalizeObservable(dto.type, pattern);
      if (!check.ok) throw new BadRequestException(check.reason);
    }

    const rule = await this.prisma.correlationWhitelist.upsert({
      where: { type_pattern: { type: dto.type, pattern } },
      update: { isCidr, reason: dto.reason ?? null },
      create: { type: dto.type, pattern, isCidr, reason: dto.reason ?? null },
    });

    this.correlation.invalidateWhitelist();

    await this.audit.record({
      action: AuditAction.SETTINGS_CHANGED,
      entityType: 'CorrelationWhitelist',
      entityId: rule.id,
      actorId: user.id,
      actorIp: request.ip ?? null,
      actorUserAgent: request.get('user-agent') ?? null,
      after: { type: rule.type, pattern: rule.pattern, isCidr: rule.isCidr },
    });

    return { id: rule.id, type: rule.type, pattern: rule.pattern, isCidr: rule.isCidr, reason: rule.reason };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a whitelist rule' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Req() request: Request) {
    const rule = await this.prisma.correlationWhitelist.delete({ where: { id } });
    this.correlation.invalidateWhitelist();

    await this.audit.record({
      action: AuditAction.SETTINGS_CHANGED,
      entityType: 'CorrelationWhitelist',
      entityId: id,
      actorId: user.id,
      actorIp: request.ip ?? null,
      actorUserAgent: request.get('user-agent') ?? null,
      before: { type: rule.type, pattern: rule.pattern },
    });
  }
}
