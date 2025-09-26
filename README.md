# Shipeu Middleware - Integración Shopify

Shipeu Middleware es una aplicación de Shopify diseñada para sincronizar automáticamente el inventario entre tu tienda Shopify y el sistema Shipeu. Esta integración permite una gestión eficiente del inventario y asegura que tus niveles de stock estén siempre actualizados.

## Características Principales

- 🔄 Sincronización automática de inventario
- 📦 Actualización en tiempo real de niveles de stock
- 🔍 Seguimiento de productos por SKU
- 📊 Monitoreo de cambios en el inventario
- 🔐 Integración segura con Shopify y Shipeu

## Requisitos Previos

Antes de comenzar, necesitarás:

1. **Cuenta de Shopify Partner**: [Crear una cuenta](https://partners.shopify.com/signup)
2. **Tienda de Desarrollo Shopify**: [Crear una tienda de desarrollo](https://help.shopify.com/en/partners/dashboard/development-stores#create-a-development-store)
3. **Cuenta Shipeu**: Acceso a la plataforma Shipeu
4. **Node.js**: Versión 18.20 o superior
5. **Base de datos**: PostgreSQL (recomendado) o MySQL

## Instalación

1. **Clonar el repositorio**:
   ```bash
   git clone [URL_DEL_REPOSITORIO]
   cd shipeu-middleware
   ```

2. **Instalar dependencias**:
   ```bash
   npm install
   ```

2.1 **Instalar CLI de shopify**:
   ```
   npm install -D @shopify/cli
   ```


3. **Configurar variables de entorno**:
   Crea un archivo `.env` en la raíz del proyecto con las siguientes variables:
   ```env
   SHOPIFY_API_KEY=tu_api_key
   SHOPIFY_API_SECRET=tu_api_secret
   SHOPIFY_APP_URL=tu_url_de_produccion
   DATABASE_URL=tu_url_de_base_de_datos
   SHIPEU_API_KEY=tu_api_key_de_shipeu
   ```

4. **Configurar la base de datos**:
   ```bash
   npm run prisma studio
   ```

## Desarrollo Local

1. **Iniciar el servidor de desarrollo**:
   ```bash
   npm run dev
   ```

2. **Instalar la aplicación en tu tienda de desarrollo**:
   - Presiona 'P' en la terminal para abrir la URL de la aplicación
   - Sigue el proceso de instalación en tu tienda de desarrollo

3. **Instalar Ngrok**:
   - Ngrok es de sumar importacia en el desarrollo, expone nuestra app y la hace accesible para shipeu.

1. **Iniciar ngrok en el puerto que corre nuestra app**:
   ```bash
   ngrok http [puerto en el que corre]
   ```



## Despliegue

1. **Construir la aplicación**:
   ```bash
   npm run build
   ```

2. **Desplegar la aplicación**:
   ```bash
   npm run deploy
   ```

## Webhooks Configurados

La aplicación maneja los siguientes webhooks de Shopify:

- `inventory_levels/update`: Actualización de niveles de inventario
- `inventory_items/create`: Creación de nuevos items de inventario
- `inventory_items/update`: Actualización de items de inventario
- `inventory_items/delete`: Eliminación de items de inventario

## Estructura del Proyecto

```
shipeu-middleware/
├── app/
│   ├── routes/
│   │   └── webhooks.inventory.jsx    # Manejador de webhooks
│   ├── shopify.server.js            # Configuración de Shopify
│   └── db.server.js                 # Configuración de base de datos
├── prisma/
│   └── schema.prisma                # Esquema de la base de datos
└── public/                          # Archivos estáticos
```

## Solución de Problemas

### Problemas Comunes

1. **Error de autenticación**:
   - Verifica que las credenciales de API estén correctamente configuradas
   - Asegúrate de que la URL de redirección esté correctamente configurada en el panel de Shopify

2. **Webhooks no funcionando**:
   - Verifica que los webhooks estén correctamente registrados
   - Asegúrate de que la URL de la aplicación sea accesible públicamente

3. **Problemas de sincronización**:
   - Verifica los logs de la aplicación
   - Asegúrate de que las credenciales de Shipeu sean correctas

## Soporte

Para soporte técnico, por favor:

1. Revisa la [documentación de Shopify](https://shopify.dev/docs/apps)
2. Consulta la [documentación de Shipeu](https://shipeu.com/docs)
3. Abre un issue en este repositorio

## Contribución

1. Haz fork del repositorio
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## Contacto

Juan Jose M - [@tu_twitter](https://twitter.com/tu_twitter)

Link del Proyecto: [https://github.com/tu_usuario/shipeu-middleware](https://github.com/tu_usuario/shipeu-middleware)
