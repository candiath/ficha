-- Familias de posturas: de mapa plano de strings a grilla anidada y tipada.
--
-- Antes:  {"t1:2:P": "X", "t2:1:F6": "on", "t2:1:Reeq": "000", "t2:1:Pistas": "test"}
-- Ahora:  {"tabla1": {"2": {"P": "X"}},
--          "tabla2": {"1": {"F6": "X", "Reeq": "000", "Pistas": "test"}}}
--
-- Tres cosas cambian a la vez, y por eso van juntas en una sola migración:
--
--   1. La clave `tabla:fila:columna` se desarma en tres niveles de objeto. Nadie
--      vuelve a partir strings para leer una celda.
--   2. Las columnas que eran checkbox guardaban la cadena "on" (el valor que
--      HTML le pone a un checkbox marcado). Las de marca pasan a "X" — una tilde
--      vieja se lee como marca fuerte — y la columna R, que sigue siendo
--      binaria, pasa al booleano `true`.
--   3. Las dos tablas dejan de llamarse t1/t2.
--
-- No hay cambio de schema: la columna sigue siendo JSONB. Lo que cambia es el
-- contenido, y como el shape ahora lo valida @ficha/shared en cada PUT, dejar
-- filas con el formato viejo significaría que la app no puede volver a
-- guardarlas. Por eso se migran todas y no se acepta convivencia de formatos.

WITH celdas AS (
  SELECT
    e.id,
    split_part(kv.key, ':', 1) AS tabla,
    split_part(kv.key, ':', 2) AS fila,
    split_part(kv.key, ':', 3) AS col,
    kv.value                   AS valor
  FROM initial_evaluations e,
       LATERAL jsonb_each_text(e.posture_families) AS kv
  WHERE e.posture_families IS NOT NULL
    -- Solo el formato viejo: la clave plana lleva dos ':'. Hace la migración
    -- repetible sin romper nada si alguna fila ya estuviera migrada.
    AND kv.key LIKE '%:%:%'
),
tipadas AS (
  SELECT
    id, tabla, fila, col,
    CASE
      -- Único checkbox que sobrevive como tal: se guarda como booleano.
      WHEN tabla = 't2' AND col = 'R'    THEN 'true'::jsonb
      -- Las que eran checkbox y ahora son marca de intensidad.
      WHEN valor = 'on'                  THEN '"X"'::jsonb
      ELSE to_jsonb(valor)
    END AS valor
  FROM celdas
  -- Una celda vacía no se guarda: es la ausencia lo que significa "vacío".
  WHERE valor <> ''
),
por_fila AS (
  SELECT id, tabla, fila, jsonb_object_agg(col, valor) AS cols
  FROM tipadas GROUP BY id, tabla, fila
),
por_tabla AS (
  SELECT id, tabla, jsonb_object_agg(fila, cols) AS filas
  FROM por_fila GROUP BY id, tabla
),
grilla AS (
  SELECT
    id,
    jsonb_object_agg(
      CASE tabla WHEN 't1' THEN 'tabla1' WHEN 't2' THEN 'tabla2' ELSE tabla END,
      filas
    ) AS nueva
  FROM por_tabla GROUP BY id
)
UPDATE initial_evaluations e
SET posture_families = g.nueva
FROM grilla g
WHERE e.id = g.id;

-- Una grilla que solo tenía celdas vacías se queda sin nada que guardar: el
-- formulario representa "sin datos" con NULL, no con '{}'.
UPDATE initial_evaluations
SET posture_families = NULL
WHERE posture_families = '{}'::jsonb;
