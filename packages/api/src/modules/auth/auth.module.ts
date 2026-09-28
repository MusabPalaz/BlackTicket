import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';
import { SsoController } from './sso/sso.controller';
import { SsoService } from './sso/sso.service';
import { OidcService } from './sso/oidc.service';
import { SsoProvisioningService } from './sso/sso-provisioning.service';
import { LoginThrottleGuard } from '../../common/guards/login-throttle.guard';
import type { AppEnv } from '../../common/config/env.config';

@Global()
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }),
          issuer: 'black-ticket',
        },
        verifyOptions: { issuer: 'black-ticket' },
      }),
    }),
  ],
  controllers: [AuthController, SsoController],
  providers: [
    AuthService,
    TokenService,
    TotpService,
    LoginThrottleGuard,
    SsoService,
    OidcService,
    SsoProvisioningService,
  ],
  exports: [AuthService, TokenService, TotpService, SsoService, OidcService],
})
export class AuthModule {}
