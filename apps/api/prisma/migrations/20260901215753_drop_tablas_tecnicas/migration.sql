-- Segundo paso del borrado de técnicas. El primero (release anterior) sacó
-- todo el código que leía estas tablas; recién ahora, con ese código ya
-- sirviendo en producción, se pueden tirar sin dejar una ventana en la que el
-- proceso viejo consulte tablas inexistentes.
--
-- No hay vuelta atrás: se pierden las técnicas aplicadas registradas por
-- sesión y los catálogos de técnicas, regiones corporales y cadenas
-- musculares. Es lo pedido — el tratamiento se registra en texto libre, en el
-- campo `observations` de la sesión.

-- DropForeignKey
ALTER TABLE "session_techniques" DROP CONSTRAINT "session_techniques_body_region_id_fkey";

-- DropForeignKey
ALTER TABLE "session_techniques" DROP CONSTRAINT "session_techniques_muscular_chain_id_fkey";

-- DropForeignKey
ALTER TABLE "session_techniques" DROP CONSTRAINT "session_techniques_session_id_fkey";

-- DropForeignKey
ALTER TABLE "session_techniques" DROP CONSTRAINT "session_techniques_technique_id_fkey";

-- DropForeignKey
ALTER TABLE "techniques" DROP CONSTRAINT "techniques_tenant_id_fkey";

-- DropTable
DROP TABLE "session_techniques";

-- DropTable
DROP TABLE "techniques";

-- DropTable
DROP TABLE "body_regions";

-- DropTable
DROP TABLE "muscular_chains";
