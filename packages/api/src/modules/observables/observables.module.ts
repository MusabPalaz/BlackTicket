import { Module } from '@nestjs/common';
import { ObservablesController } from './observables.controller';
import { ObservablesService } from './observables.service';
import { CorrelationService } from './correlation.service';
import { WhitelistController } from './whitelist.controller';

@Module({
  controllers: [ObservablesController, WhitelistController],
  providers: [ObservablesService, CorrelationService],
  exports: [ObservablesService, CorrelationService],
})
export class ObservablesModule {}
