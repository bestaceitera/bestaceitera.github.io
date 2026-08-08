import { makeSimpleCatalogModule } from './simpleCatalog.js';
import { getAll } from '../data.js';

/**
 * Lee el catálogo de bancos SIN romper la pantalla que lo pide.
 *
 * Los bancos son una colección nueva: mientras no se publiquen las reglas de
 * Firestore, pedirla falla por permisos. Si eso reventara la carga, el formulario
 * de venta dejaría de abrir — y esa pantalla se usa todo el día. Ante cualquier
 * problema se devuelve una lista vacía: el formulario funciona igual, solo sin
 * preguntar el banco.
 */
export async function listarBancos() {
  try {
    const bancos = await getAll('banks', { order: 'nombre' });
    return bancos.filter((b) => b.activo !== false);
  } catch (err) {
    console.warn('No se pudo leer el catálogo de bancos:', err.code || err.message);
    return [];
  }
}

export default makeSimpleCatalogModule({
  collectionName: 'banks',
  singular: 'Banco',
  plural: 'Bancos',
  genero: 'm',
});
