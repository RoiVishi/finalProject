import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { PredictionsModule } from './predictions/predictions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get('DB_HOST', 'localhost'),
        port: cfg.get<number>('DB_PORT', 5432),
        username: cfg.get('DB_USER', 'app'),
        password: cfg.get('DB_PASS', 'app'),
        database: cfg.get('DB_NAME', 'construction'),
        autoLoadEntities: true,
        // dev only — replace with migrations before production deployment
        synchronize: cfg.get('NODE_ENV') !== 'production',
      }),
    }),
    AuthModule,
    UsersModule,
    ProjectsModule,
    TasksModule,
    PredictionsModule,
  ],
})
export class AppModule {}
