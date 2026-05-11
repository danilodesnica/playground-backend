import { Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserService } from './user.service';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly service: UserService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteUser(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) targetId: string,
  ): Promise<{ success: true }> {
    return this.service.deleteById(user, targetId);
  }
}
