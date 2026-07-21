import { Module } from '@nestjs/common';
import { PredictionsService } from './predictions.service';

@Module({
  providers: [PredictionsService],
  exports: [PredictionsService],
})
export class PredictionsModule {}
