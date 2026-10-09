# FoodApp — notificaciones Web Push de pedidos

Esta entrega incluye la aplicación PWA **y un backend desplegable en Supabase**. Subir el HTML **no activa por sí solo** las notificaciones remotas: se deben realizar los pasos de servidor. Los avisos push no dependen del polling, la pestaña ni de la app abierta.

## Qué recibe cada persona

| Evento en `orders` | Destinatario | Notificación |
| --- | --- | --- |
| INSERT de pedido | **Solo cuentas con rol `admin`** que hayan activado notificaciones | 🔔 Nuevo pedido recibido |
| Cambio `status` a `En Proceso` | **Solo cuenta `user_id` del pedido** (o dispositivo invitado asociado) | 👨‍🍳 Estamos preparando tu pedido |
| Cambio `status` a `Completado` | **Solo cuenta `user_id` del pedido** (o dispositivo invitado asociado) | ✅ ¡Tu pedido está listo! |

No se avisa a todos los clientes y no se envían duplicados por cambios de estado que mantienen el mismo valor. Cada persona debe autorizar las notificaciones mediante la campana 🔔 (en cada dispositivo). El administrador recibe avisos en los dispositivos donde haya autorizado su cuenta.

## Instalación (orden importante)

1. **HTTPS obligatorio.** Servir la app por HTTPS con todos los archivos del ZIP. `localhost` también sirve para pruebas.
2. En Supabase, `Database > Extensions`, habilita **pg_net** si no está activo.
3. En SQL Editor ejecuta `supabase/migrations/20261009_foodapp_push.sql`. Añade una columna nullable `guest_device_id` a `orders`, una tabla de suscripciones con RLS y un trigger `AFTER INSERT OR UPDATE OF status`.
4. Instala Supabase CLI o usa el editor de Edge Functions. Desde la carpeta que incluye `supabase/config.toml`, despliega las funciones `push-register` y `send-order-push`. Ambas tienen `verify_jwt=false` porque esta versión usa un sistema de inicio de sesión personalizado. **La primera valida las credenciales contra `users` en el servidor y la segunda exige un secreto del webhook.**
5. Genera las llaves VAPID **en tu equipo o servidor**:
   ```sh
   npx web-push generate-vapid-keys
   ```
   Nunca coloques la clave **privada** en `index.html`, el repositorio público o el navegador. **La clave pública** se consulta dinámicamente al backend.
6. En Supabase `Project Settings > Edge Functions > Secrets`, configura:

   | Secreto | Valor |
   | --- | --- |
   | `VAPID_PUBLIC_KEY` | Llave VAPID pública generada |
   | `VAPID_PRIVATE_KEY` | Llave VAPID privada generada |
   | `VAPID_SUBJECT` | `mailto:tu-correo@tu-dominio.com` |
   | `FOODAPP_ORIGIN` | **Origen HTTPS exacto** del sitio donde publicas FoodApp (por ejemplo `https://restaurante.ejemplo.com`, sin `/` final) |
   | `FOODAPP_WEBHOOK_SECRET` | Cadena aleatoria larga, de 32+ bytes, que generes tú. La misma cadena se configura en SQL. |

   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se proporcionan automáticamente a Edge Functions en Supabase. Si tu entorno no las provee, añádelas solo en el servidor.

7. Configura la URL y el secreto del webhook ejecutando en **SQL Editor** (reemplaza los valores):
   ```sql
   insert into public.foodapp_push_webhook_config(singleton,url,secret)
   values (
     true,
     'https://TU-REFERENCIA.supabase.co/functions/v1/send-order-push',
     'EL-MISMO-FOODAPP_WEBHOOK_SECRET-QUE-EN-EDGE-FUNCTIONS'
   )
   on conflict (singleton) do update
     set url=excluded.url, secret=excluded.secret;
   ```
   Estos valores **solo existen en la base de datos y secretos de Edge Functions**, no en frontend. No compartas capturas de esta consulta con el secreto visible.
8. Publica la carpeta PWA (`index.html`, `pwa.js`, `push-notifications.js`, `service-worker.js`, `manifest.json`, `version.json`, `offline.html`, `icons/`). La versión del service worker y `version.json` ya fue incrementada para que las instalaciones anteriores detecten la actualización.
9. En cada equipo: inicia sesión y toca la **campana 🔔** del encabezado. Se solicitará permiso del navegador y, para cuentas registradas, la contraseña para verificar la identidad. El icono cambia a verde al completar el registro. Los invitados también pueden autorizar su dispositivo.

### Despliegue con CLI (opcional)

```sh
supabase functions deploy push-register --no-verify-jwt
supabase functions deploy send-order-push --no-verify-jwt
```

## Probar

- **Caso A:** con el administrador suscrito, un cliente distinto crea un pedido. Verifica que el administrador reciba push y **no** los otros clientes.
- **Caso B:** el administrador toca **Tomar Pedido**. Únicamente el usuario del pedido recibe "Estamos preparando tu pedido".
- **Caso C:** marca **Completado**. El mismo usuario recibe "¡Tu pedido está listo!".
- **Caso D:** minimiza o cierra el navegador (no apagues el sistema), vuelve a ejecutar B/C y comprueba el aviso del sistema operativo. En móviles, activa permisos de notificaciones y quita bloqueos de batería si fuese necesario.
- **Caso E:** como invitado, toca la campana **antes** de crear el pedido. El ID del dispositivo se guarda exclusivamente en el pedido creado; otros invitados no reciben su aviso.
- Revisa `Supabase > Edge Functions > Logs` si no se entrega un aviso, `pg_net` si el webhook no se ejecuta, y los permisos de notificaciones del navegador.

## Límites de plataforma

- Las notificaciones Web Push se entregan en segundo plano por el servicio push del navegador **incluso con la web cerrada**, cuando el SO y el navegador permiten procesamiento en segundo plano. No pueden garantizarse si el dispositivo está apagado, sin red, tiene notificaciones bloqueadas o suspende por completo su servicio push.
- En **iPhone/iPad** se requiere la aplicación añadida a **pantalla de inicio**, en iOS/iPadOS 16.4 o posterior, y permiso del usuario. En Android y computadoras, la compatibilidad depende del navegador y del SO.
- Para no molestar al usuario, FoodApp **no** solicita permiso automáticamente al cargar; debe tocar la campana.

## Seguridad importante — revisar antes de exponer al público

El `index.html` existente autentica usuarios mediante `public.users` con **contraseñas en texto claro** y usa datos locales para reconocer el rol. Este mecanismo no es adecuado para proteger datos personales o funciones administrativas en producción: los permisos RLS de `users` / `orders` deben revisarse y las cuentas deberían migrar a **Supabase Auth**. Las nuevas funciones **no confían en el rol enviado por el navegador** ni exponen los tokens VAPID privados; aun así, la seguridad total del requisito "solo admin / solo creador" depende de proteger también las credenciales, permisos y datos de la app preexistente. Antes de ofrecerlo al público, migra la autenticación y aplica RLS apropiado.

Los suscriptores de push se almacenan por **dispositivo**; se desuscribe al cerrar sesión en ese dispositivo. Los invitados sin suscripción pueden crear pedidos, pero no reciben push personalizado hasta activarlo.
