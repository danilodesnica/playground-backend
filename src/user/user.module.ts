import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [AuthModule],
  controllers: [UserController, AdminUsersController],
  providers: [UserService, AdminUsersService],
  exports: [UserService],
})
export class UserModule {}
