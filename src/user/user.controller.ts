import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserProfile } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly service: UserService) {}

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async updateUser(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) targetId: string,
    @Body() body: UpdateUserDto,
  ): Promise<UserProfile> {
    return this.service.updateById(user, targetId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteUser(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) targetId: string,
  ): Promise<{ success: true }> {
    return this.service.deleteById(user, targetId);
  }
}
