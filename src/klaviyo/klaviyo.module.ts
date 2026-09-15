import { Global, Module } from '@nestjs/common';
import { KlaviyoController } from './klaviyo.controller';
import { KlaviyoService } from './klaviyo.service';

/** Global so the signup and delete paths can inject it without wiring. */
@Global()
@Module({
  controllers: [KlaviyoController],
  providers: [KlaviyoService],
  exports: [KlaviyoService],
})
export class KlaviyoModule {}
