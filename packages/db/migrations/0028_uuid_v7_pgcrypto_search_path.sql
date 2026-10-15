-- app.uuid_v7 precisa funcionar também dentro de SECURITY DEFINER com search_path fechado.
-- Qualificar pgcrypto evita depender de `public` no search_path do chamador.
CREATE OR REPLACE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    overlay(
      overlay(
        public.gen_random_bytes(16)
        PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3 FOR 6)
        FROM 1 FOR 6
      )
      PLACING set_byte(
        set_byte('\x0000'::bytea, 0, (get_byte(public.gen_random_bytes(1), 0) & 15) | 112),
        1, (get_byte(public.gen_random_bytes(1), 0) & 63) | 128
      ) FROM 7 FOR 2
    ),
    'hex'
  )::uuid;
$$;
