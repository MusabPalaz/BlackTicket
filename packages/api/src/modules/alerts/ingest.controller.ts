import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyScope } from '@black-ticket/shared';
import { Public } from '../../common/decorators/auth.decorators';
import { RequireApiKeyScopes } from '../../common/decorators/api-key.decorators';
import { ApiKeyGuard, type RequestWithApiKey } from '../../common/guards/api-key.guard';
import { AlertsService } from './alerts.service';
import { IngestAlertDto } from './dto/alert.dto';

/**
 * The machine-facing door.
 *
 * `@Public()` only means "no user session"; the ApiKeyGuard below is what
 * actually authenticates, and it also carries the per-key rate limit.
 */
@ApiTags('ingest')
@ApiSecurity('api-key')
@Controller('ingest')
@Public()
@UseGuards(ApiKeyGuard)
@RequireApiKeyScopes(ApiKeyScope.INGEST_WRITE)
export class IngestController {
  constructor(private readonly alerts: AlertsService) {}

  @Post('alerts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit an alert. Idempotent on (source, externalId) so retries are safe.',
  })
  ingest(@Body() dto: IngestAlertDto, @Req() request: RequestWithApiKey) {
    return this.alerts.ingest(dto, request.apiKey);
  }
}
