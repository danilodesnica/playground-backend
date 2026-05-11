import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SavedLocationsController } from './saved-locations.controller';
import { SavedLocationsService } from './saved-locations.service';

@Module({
  imports: [AuthModule],
  controllers: [SavedLocationsController],
  providers: [SavedLocationsService],
  exports: [SavedLocationsService],
})
export class SavedLocationsModule {}
