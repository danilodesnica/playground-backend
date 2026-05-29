import { Module } from '@nestjs/common';
import { InteractionsService } from './interactions.service';

@Module({
  providers: [InteractionsService],
  exports: [InteractionsService],
})
export class InteractionsModule {}
