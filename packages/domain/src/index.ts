export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type CorrelationId = Brand<string, 'CorrelationId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type EmpresaId = Brand<string, 'EmpresaId'>;
