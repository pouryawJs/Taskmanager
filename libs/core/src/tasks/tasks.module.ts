import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [GamificationModule],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
