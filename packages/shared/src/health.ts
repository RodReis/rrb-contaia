export type ServiceName = 'web' | 'api' | 'workers' | 'signer';

export type HealthStatus = {
  readonly service: ServiceName;
  readonly status: 'ok';
};

export const health = (service: ServiceName): HealthStatus => ({ service, status: 'ok' });
