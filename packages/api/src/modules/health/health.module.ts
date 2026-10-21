import { Module } from '@nestjs/common';
import { AboutController } from './about.controller';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, AboutController],
})
export class HealthModule {}
