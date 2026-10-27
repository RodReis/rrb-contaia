-- app.uuid_v7 precisa funcionar também dentro de SECURITY DEFINER com search_path fechado.
-- Qualificar pgcrypto evita depender de `public` no search_path do chamador.
CREATE OR REPLACE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_byte(
      set_byte(
        overlay(
          public.gen_random_bytes(16)
          PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3 FOR 6)
          FROM 1 FOR 6
        ),
        6, (get_byte(public.gen_random_bytes(1), 0) & 15) | 112
      ),
      8, (get_byte(public.gen_random_bytes(1), 0) & 63) | 128
    ),
    'hex'
  )::uuid;
$$;
