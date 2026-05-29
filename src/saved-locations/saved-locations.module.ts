import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { SavedLocationsController } from './saved-locations.controller';
import { SavedLocationsService } from './saved-locations.service';

@Module({
  imports: [AuthModule, InteractionsModule],
  controllers: [SavedLocationsController],
  providers: [SavedLocationsService],
  exports: [SavedLocationsService],
})
export class SavedLocationsModule {}
