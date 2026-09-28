import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@black-ticket/shared';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { SlaService } from './sla.service';

@ApiTags('admin')
@Controller('admin/sla')
@RequirePermissions(Permission.SETTINGS_MANAGE)
export class SlaController {
  constructor(private readonly sla: SlaService) {}

  /**
   * The sweep runs every minute on its own. This endpoint exists so an
   * administrator can force a re-check after changing SLA policies — and so
   * the behaviour is testable without waiting on the clock.
   */
  @Post('sweep')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run the SLA sweep now' })
  async sweep() {
    await this.sla.sweep();
    return { ...(await this.sla.pressure()), ranAt: new Date().toISOString() };
  }
}
