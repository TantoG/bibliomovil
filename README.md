# BiblioMóvil

Aplicación web estática (pensada para **iPhone / iOS** y **GitHub Pages**) para buscar y navegar la base de datos SQLite `Base/tgl1.db` sin necesidad de compilar ni instalar apps nativas.

## Qué hace

- Lee directamente `Base/tgl1.db` en el navegador usando `sql.js` (WebAssembly incluido en `vendor/sqljs/`).
- **Búsqueda instantánea sin distinguir tildes ni mayúsculas** por título, autor, editorial, género, ISBN o número de caja.
- **3 vistas simples**:
  - **Libros**: listado con número de **Caja**, posición (`#`) y tamaño (`S`, `M`, `L`, `XL`), con filtros por caja, género y tamaño.
  - **Cajas**: grilla de todas las cajas para ver qué hay dentro de cada una en orden.
  - **Explorar**: índice rápido de géneros y autores con cantidad de volúmenes.
- **Instalable en iOS** (PWA): en Safari tocá **Compartir → Agregar a pantalla de inicio**. También funciona sin conexión una vez abierta.

## Probar en tu Mac antes de subir

Desde la carpeta del proyecto ejecutá:

```bash
python3 -m http.server 8080
```

Luego abrí `http://localhost:8080` en el navegador (o desde tu iPhone conectado al mismo Wi-Fi usando la IP local de tu Mac).

## Publicar en GitHub Pages

1. Inicializá el repositorio y subilo a GitHub:
   ```bash
   git init
   git add .
   git commit -m "Primera versión de BiblioMóvil"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/BiblioMovil.git
   git push -u origin main
   ```
2. En GitHub entrá a **Settings → Pages**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` / `/ (root)`
3. En ~1 minuto vas a tener tu URL `https://TU_USUARIO.github.io/BiblioMovil/`.

## Cómo actualizar la base cuando agregues más volúmenes

Como `tgl1.db` es preliminar y no hay paso de build, solo tenés que reemplazar el archivo `Base/tgl1.db` por la versión nueva y hacer:

```bash
git add Base/tgl1.db
git commit -m "Actualización de catálogo tgl1.db"
git push
```
