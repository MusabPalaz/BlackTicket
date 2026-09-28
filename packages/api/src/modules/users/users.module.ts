import { Module } from '@nestjs/common';
import { PasswordService } from '../../common/security/password.service';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
