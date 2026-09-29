// Configuración de la web. Editar aquí, no hace falta tocar index.html.
//
// Este archivo viaja con la web a todo el que la reciba, así que aquí NO hay nada
// secreto: ni contraseñas ni enlaces a la hoja. El stock en directo y tus cifras
// privadas los da el formulario de Google (scripts/apps-script.gs), y tus cifras solo
// a quien escriba tu CLAVE_PRIVADA, que se comprueba en Google.
window.CONFIG_WEB = {
  titulo: 'Catálogo — China al por mayor',
  ciudad: 'Madrid',

  // Enlace de la aplicación web de Google (Apps Script → Implementar). Da el stock en
  // directo, el botón "Lo vendí" de cada ficha y las pestañas privadas. Si lo dejas
  // vacío, la web enseña el pedido inicial guardado en datos.js y nada más.
  registroUrl: 'https://script.google.com/macros/s/AKfycby_SHA25U7-AxU0Pkl0ffH7Bl2dmYt0s0nEhjjQPkoI8Y7XI-cCXldb9jNyV3uPZOwQ/exec',
};
