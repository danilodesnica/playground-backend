import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { AdminLocationsController } from './admin-locations.controller';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  imports: [AuthModule, InteractionsModule],
  controllers: [LocationsController, AdminLocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
