// Las cuentas del panel que no son las de siempre: el resumen del dinero y el mensaje para
// recordar a un amigo lo que te debe. Las cuentas de stock, comisiones y pagos son las de
// web/calculo.js (las mismas que la hoja y la web). scripts/test-panel.js lo comprueba.
var Panel = (function () {
  'use strict';

  var num = function (v) { return Calculo.num(v); };
  var eur = function (n) {
    return (Math.round(n * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  };

  // El resumen del negocio. `calc` y `cuentas` salen de Calculo; `config` es la pestaña
  // CONFIG ({clave: valor}). Mismas reglas que la pestaña RESUMEN de la hoja.
  function resumen(calc, cuentas, config) {
    config = config || {};
    var r = {
      compradas: 0, vendidas: 0, disponibles: 0, reservadas: 0, enLaCalle: 0,
      ingresado: 0, comisiones: 0, cobrado: 0, teDeben: 0, ventasSinPrecio: 0, valorNetoStock: 0,
    };
    calc.prods.forEach(function (p) {
      r.compradas += p.inicial;
      r.vendidas += p.vendido;
      r.disponibles += Math.max(0, p.disponible);
      r.reservadas += p.reservado;
      r.enLaCalle += p.enVendedores;
      // Lo que te quedaría de lo disponible si lo venden tus amigos a su precio.
      r.valorNetoStock += Math.max(0, p.disponible) * p.pvp * (1 - Calculo.comisionPct(p.pvp, calc.tramos) / 100);
    });
    calc.ventas.forEach(function (v) {
      r.ingresado += v.importe;
      r.comisiones += v.comision;
      if (v.sinPrecio) r.ventasSinPrecio++;
    });
    cuentas.forEach(function (c) {
      r.cobrado += c.liquidado;
      r.teDeben += Math.max(0, c.pendiente);
    });
    r.neto = r.ingresado - r.comisiones;
    r.desembolso = (num(config.mercancia_pagada_usd) + num(config.envio_total_usd)) * num(config.tipo_cambio_usd_eur);
    r.recuperado = r.desembolso > 0 ? Math.min(1, Math.max(0, r.neto / r.desembolso)) : 0;
    r.faltaRecuperar = Math.max(0, r.desembolso - r.neto);
    r.beneficioSiTodo = r.neto + r.valorNetoStock - r.desembolso;
    return r;
  }

  // Mensaje para recordar a un amigo lo que te debe, con sus ventas.
  function mensajeDeuda(nombre, cuenta, ventas) {
    var suyas = ventas.filter(function (v) { return v.vendedor === cuenta.vendedor; });
    var lineas = suyas.slice(-12).map(function (v) {
      return '· ' + v.prod.producto + ' ' + v.prod.modelo + ' (' + v.prod.talla + ')' +
        (v.cantidad > 1 ? ' x' + v.cantidad : '') + ': ' + eur(v.importe) + (v.fecha ? ' — ' + v.fecha : '');
    });
    return 'Hola ' + nombre + '. Te paso las cuentas de lo que has vendido:\n' +
      lineas.join('\n') + (suyas.length > 12 ? '\n· …y ' + (suyas.length - 12) + ' más' : '') + '\n\n' +
      'Vendido: ' + eur(cuenta.bruto) + '\n' +
      'Tu comisión: ' + eur(cuenta.comision) + '\n' +
      'Me has pagado: ' + eur(cuenta.liquidado) + '\n' +
      'Te queda por pagarme: ' + eur(Math.max(0, cuenta.pendiente)) + '\n\n' +
      '¡Gracias!';
  }

  // Enlace de WhatsApp. Con teléfono va directo a su chat (se le añade el 34 si es un móvil
  // español de 9 cifras); sin teléfono, WhatsApp deja elegir a quién mandarlo.
  function enlaceWhatsApp(telefono, texto) {
    var t = String(telefono || '').replace(/\D/g, '');
    if (t.length === 9) t = '34' + t;
    return 'https://wa.me/' + (t.length >= 10 ? t : '') + '?text=' + encodeURIComponent(texto);
  }

  // Un identificador para cada apunte: si el envío se repite, Google lo apunta una sola vez.
  function idPeticion() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  return { resumen: resumen, mensajeDeuda: mensajeDeuda, enlaceWhatsApp: enlaceWhatsApp, idPeticion: idPeticion, eur: eur };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Panel;
