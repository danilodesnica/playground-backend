import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { InteractionsModule } from './interactions/interactions.module';
import { LocationsModule } from './locations/locations.module';
import { OffersModule } from './offers/offers.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SavedLocationsModule } from './saved-locations/saved-locations.module';
import { SavedOffersModule } from './saved-offers/saved-offers.module';
import { SupabaseModule } from './supabase/supabase.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    AuthModule,
    InteractionsModule,
    LocationsModule,
    SavedLocationsModule,
    OffersModule,
    SavedOffersModule,
    UserModule,
    ReviewsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule {}
