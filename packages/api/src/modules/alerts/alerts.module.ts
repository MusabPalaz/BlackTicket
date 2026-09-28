import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { ObservablesModule } from '../observables/observables.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApiKeysService } from '../apikeys/apikeys.service';
import { ApiKeysController } from '../apikeys/apikeys.controller';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { SlaService } from '../sla/sla.service';
import { SlaController } from '../sla/sla.controller';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { IngestController } from './ingest.controller';

@Module({
  imports: [CasesModule, ObservablesModule, NotificationsModule],
  controllers: [IngestController, AlertsController, ApiKeysController, SlaController],
  providers: [AlertsService, ApiKeysService, ApiKeyGuard, SlaService],
  exports: [AlertsService, SlaService],
})
export class AlertsModule {}
