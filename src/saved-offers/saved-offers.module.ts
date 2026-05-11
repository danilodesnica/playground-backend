import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SavedOffersController } from './saved-offers.controller';
import { SavedOffersService } from './saved-offers.service';

@Module({
  imports: [AuthModule],
  controllers: [SavedOffersController],
  providers: [SavedOffersService],
  exports: [SavedOffersService],
})
export class SavedOffersModule {}
