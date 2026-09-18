import { Controller, Get } from '@nestjs/common';
import { health, type HealthStatus } from '@contaia/shared';

@Controller('health')
export class HealthController {
  @Get()
  obterSaude(): HealthStatus {
    return health('api');
  }
}
