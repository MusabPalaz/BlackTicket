import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { IdentityDomainController } from './identity-domain.controller';
import { UsersAdminController } from './users-admin.controller';
import { IdentityDomainService } from './identity-domain.service';
import { UsersAdminService } from './users-admin.service';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { AuditController } from './audit.controller';
import { SettingsController } from './settings.controller';
import { AuthPolicyController } from './auth-policy.controller';
import { MailSettingsController } from './mail-settings.controller';
import { RetentionController } from './retention.controller';
import { HousekeepingService } from './housekeeping.service';
import { MailSettingsService } from './mail-settings.service';
import { AuthPolicyService } from './auth-policy.service';

@Module({
  imports: [UsersModule],
  controllers: [
    IdentityDomainController,
    UsersAdminController,
    AuditController,
    SettingsController,
    SystemController,
    AuthPolicyController,
    MailSettingsController,
    RetentionController,
  ],
  providers: [IdentityDomainService, UsersAdminService, SystemService, AuthPolicyService, MailSettingsService, HousekeepingService],
})
export class AdminModule {}
