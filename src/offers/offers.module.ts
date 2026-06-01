import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminOffersController } from './admin-offers.controller';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [AuthModule],
  controllers: [OffersController, AdminOffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
