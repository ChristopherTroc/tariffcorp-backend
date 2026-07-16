import { NestFactory, Reflector } from '@nestjs/core';
import {
  ValidationPipe,
  ClassSerializerInterceptor,
  HttpException,
  ExceptionFilter,
  ArgumentsHost,
  Catch,
  Logger,
} from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AppModule } from './app.module';

@Catch()
class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      response.status(status).json({
        error:
          typeof res === 'string'
            ? { code: 'error', message: res }
            : { code: 'error', ...(res as Record<string, unknown>) },
      });
      return;
    }

    this.logger.error(
      `Unhandled exception at ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(500).json({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors();

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('TariffCorp API')
    .setDescription(
      'Trade compliance platform — rule-checker, findings, products and transactions.',
    )
    .setVersion('1.0')
    .addTag('dashboard', 'C-level financial rollups')
    .addTag('transactions', 'Import event declarations')
    .addTag('products', 'Master product catalog')
    .addTag('findings', 'Checker findings ordered by exposure')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
    customCssUrl: 'https://unpkg.com/swagger-ui-dist/swagger-ui.css',
    customJs: [
      'https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js',
      'https://unpkg.com/swagger-ui-dist/swagger-ui-standalone-preset.js',
    ],
  });

  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
