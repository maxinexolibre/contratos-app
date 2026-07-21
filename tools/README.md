# tools/

`generar-plantilla.mjs` regenera la plantilla maestra `.docx` usando **el mismo
código que la app** (`contrato.js` + `docgen.js`), con los campos vacíos para que
salgan como `[campos]` en naranja.

Correr desde la raíz del repo:

    node tools/generar-plantilla.mjs

Escribe el archivo en la carpeta de Marketing y Diseño. Hay que volver a correrlo
cada vez que cambie una cláusula, para que la plantilla no se desincronice del
sistema.
