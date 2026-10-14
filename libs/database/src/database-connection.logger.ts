import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseConnectionLogger implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseConnectionLogger.name);

  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    if (this.dataSource.isInitialized) {
      this.logger.log('Successfully connected to PostgreSQL.');
    } else {
      this.logger.error('PostgreSQL connection is not initialized.');
    }
  }
}
