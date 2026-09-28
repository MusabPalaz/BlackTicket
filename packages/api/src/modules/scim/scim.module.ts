import { Module } from '@nestjs/common';
import { ApiKeysService } from '../apikeys/apikeys.service';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ScimController } from './scim.controller';
import { ScimService } from './scim.service';

@Module({
  controllers: [ScimController],
  providers: [ScimService, ApiKeysService, ApiKeyGuard],
})
export class ScimModule {}
