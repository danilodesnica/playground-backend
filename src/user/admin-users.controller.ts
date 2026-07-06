import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { AdminUsersService } from './admin-users.service';
import type {
  AdminUserDetail,
  AdminUsersListResponse,
} from './admin-users.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get('users')
  async list(
    @Query() query: AdminUsersQueryDto,
  ): Promise<AdminUsersListResponse> {
    return this.service.list(query.search, query.limit, query.offset);
  }

  @Get('users/:id')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminUserDetail> {
    return this.service.detail(id);
  }
}
