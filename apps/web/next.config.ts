import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O login OIDC fixa a origem em 127.0.0.1 (lib/oidc.ts), nunca localhost —
  // sem isso o Next bloqueia o HMR como cross-origin e a hidratação nunca
  // completa: a tela fica presa em "Carregando..." mesmo com a API respondendo.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
