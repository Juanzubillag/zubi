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

  // ---- Datos para las gráficas ----
  var dia = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  // Ventas de los últimos `dias` días, hasta `hoy` incluido (también los días sin ventas).
  function ventasPorDia(ventas, dias, hoy) {
    var fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    var serie = [], pos = {};
    for (var i = dias - 1; i >= 0; i--) {
      var d = new Date(fin); d.setDate(fin.getDate() - i);
      pos[dia(d)] = serie.length;
      serie.push({ fecha: dia(d), importe: 0, uds: 0 });
    }
    ventas.forEach(function (v) {
      var k = pos[String(v.fecha).slice(0, 10)];
      if (k != null) { serie[k].importe += v.importe; serie[k].uds += v.cantidad; }
    });
    return serie;
  }
  // Ventas agrupadas por lo que diga `clave(v)`, de más a menos importe.
  function ventasPor(ventas, clave) {
    var m = new Map();
    ventas.forEach(function (v) {
      var k = clave(v) || 'Sin indicar';
      if (!m.has(k)) m.set(k, { nombre: k, importe: 0, uds: 0 });
      var x = m.get(k); x.importe += v.importe; x.uds += v.cantidad;
    });
    return Array.from(m.values()).sort(function (a, b) { return b.importe - a.importe || b.uds - a.uds; });
  }
  // Por categoría: vendidas, en casa de tus amigos y en tu casa (suman lo comprado). Si se
  // ha apuntado más de lo que había de una talla, `deMas` dice cuántas sobran.
  function stockPorCategoria(prods) {
    var m = new Map();
    prods.forEach(function (p) {
      if (!m.has(p.categoria)) m.set(p.categoria, { categoria: p.categoria, vendidas: 0, enLaCalle: 0, enCasa: 0, total: 0, deMas: 0 });
      var x = m.get(p.categoria);
      x.vendidas += p.vendido; x.enLaCalle += p.enVendedores; x.enCasa += Math.max(0, p.enAlmacen); x.total += p.inicial;
      x.deMas += Math.max(0, -p.enAlmacen);
    });
    return Array.from(m.values()).sort(function (a, b) { return b.total - a.total; });
  }

  return { resumen: resumen, mensajeDeuda: mensajeDeuda, enlaceWhatsApp: enlaceWhatsApp, idPeticion: idPeticion, eur: eur,
    ventasPorDia: ventasPorDia, ventasPor: ventasPor, stockPorCategoria: stockPorCategoria };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Panel;
