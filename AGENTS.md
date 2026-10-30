# Reglas del proyecto

## Conservación de builds APK

- Cada vez que se genere una APK nueva, eliminar las versiones anteriores y conservar únicamente la APK nueva como artefacto entregable en `artifacts/`.
- Eliminar las APK anteriores **solo después** de que la nueva compilación finalice correctamente y se verifique que la APK nueva es válida y está firmada cuando corresponda.
- Si la compilación o la verificación falla, conservar la última APK válida; nunca borrarla anticipadamente.
- Esta limpieza se limita a las APK anteriores: no eliminar código fuente, claves de firma, respaldos ni evidencias de verificación.
