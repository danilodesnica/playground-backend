import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Restrict CORS to an allowlist when CORS_ORIGINS is set (comma-separated).
  // Falls back to permissive when unset so existing clients keep working until
  // the allowlist is configured in the deploy environment.
  const corsOrigins = process.env.CORS_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins && corsOrigins.length > 0 ? corsOrigins : true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
