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

  // Una línea por venta sin pagar: «13/08 · Zapatillas New Balance (42), la vendiste a 50,00 €: …».
  var fechaCorta = function (f) { f = String(f || ''); return f ? f.slice(8, 10) + '/' + f.slice(5, 7) : ''; };
  function lineaDeuda(x) {
    var v = x.venta, p = v.prod;
    return fechaCorta(v.fecha) + ' · ' + p.producto + ' ' + p.modelo + ' (' + p.talla + ')' + (v.cantidad > 1 ? ' ×' + v.cantidad : '') +
      ', vendida a ' + eur(v.importe) + ': ' + (x.pagado > 0.004
        ? 'me tocan ' + eur(x.tuParte) + ', ya me diste ' + eur(x.pagado) + ', faltan ' + eur(x.pendiente)
        : 'me tocan ' + eur(x.pendiente));
  }

  // Mensaje para reclamar a un amigo lo que te debe: prenda a prenda, las más antiguas primero.
  // `deuda` sale de Calculo.deudas().
  function mensajeDeuda(nombre, deuda) {
    var lista = deuda.pendientes || [];
    var lineas = lista.slice(0, 15).map(function (x) { return '· ' + lineaDeuda(x); });
    if (lista.length > 15) lineas.push('· …y ' + (lista.length - 15) + ' más');
    if (deuda.extra > 0.004) lineas.push('· Ajuste apuntado aparte: ' + eur(deuda.extra));
    return 'Hola ' + nombre + '. Te paso lo que tengo apuntado pendiente de pagarme:\n' +
      lineas.join('\n') + '\n\n' +
      'Total: ' + eur(deuda.debe) + (lista.length > 1 ? ' (' + lista.length + ' ventas)' : '') + '\n\n' +
      '¿Cuándo te viene bien? ¡Gracias!';
  }

  // Lo que pide atención, de más a menos urgente. Cada aviso dice a qué pestaña lleva.
  // nivel: 'mal' (dinero o un error), 'aviso' (hay que hacer algo) o 'info'.
  function avisos(calc, deudas, fichas, nombres, hoy) {
    var out = [];
    var nombre = function (id) { return (nombres && nombres.get && nombres.get(id)) || id; };
    deudas.forEach(function (d) {
      if (!(d.debe >= 0.5)) return;
      var vieja = d.pendientes.length ? diasDesde(d.pendientes[0].venta.fecha, hoy) : null;
      out.push({ nivel: 'mal', peso: d.debe, vista: 'cuentas', vendedor: d.vendedor,
        texto: nombre(d.vendedor) + ' te debe ' + eur(d.debe) +
          (d.pendientes.length ? ' por ' + d.pendientes.length + (d.pendientes.length === 1 ? ' prenda' : ' prendas') : '') +
          (vieja != null && vieja > 0 ? ' (la más antigua, hace ' + vieja + (vieja === 1 ? ' día)' : ' días)') : '') });
    });
    var negativas = calc.prods.filter(function (p) { return p.disponible < 0; });
    if (negativas.length) {
      out.push({ nivel: 'mal', peso: 0, vista: 'stock', filtro: 'agotado',
        texto: negativas.length + (negativas.length === 1 ? ' talla tiene' : ' tallas tienen') + ' más vendido que comprado: revisa los apuntes (' +
          negativas.slice(0, 3).map(function (p) { return p.sku; }).join(', ') + ')' });
    }
    (fichas || []).forEach(function (f) {
      if (f.paradas) out.push({ nivel: 'aviso', peso: f.paradas, vista: 'reparto', vendedor: f.id,
        texto: f.nombre + ' tiene ' + f.paradas + (f.paradas === 1 ? ' prenda parada' : ' prendas paradas') + ' (3 semanas o más sin venderse): pídeselas o bájales el precio' });
    });
    var sinPrecio = calc.ventas.filter(function (v) { return v.sinPrecio; }).length;
    if (sinPrecio) out.push({ nivel: 'aviso', peso: sinPrecio, vista: 'movimientos', tipo: 'VENTA',
      texto: sinPrecio + (sinPrecio === 1 ? ' venta sin precio: cuenta 0 €' : ' ventas sin precio: cuentan 0 €') + ' hasta que lo pongas' });
    var agotadas = calc.prods.filter(function (p) { return p.inicial > 0 && p.disponible === 0; });
    if (agotadas.length) out.push({ nivel: 'info', peso: agotadas.length, vista: 'pedido',
      texto: agotadas.length + (agotadas.length === 1 ? ' talla agotada' : ' tallas agotadas') + ': mira en Segundo pedido si vale la pena volver a pedirlas' });
    var reservadas = calc.prods.reduce(function (a, p) { return a + p.reservado; }, 0);
    if (reservadas) out.push({ nivel: 'info', peso: reservadas, vista: 'stock', filtro: 'reservado',
      texto: reservadas + (reservadas === 1 ? ' prenda reservada' : ' prendas reservadas') + ' sin vender todavía' });
    var ultima = calc.ventas.reduce(function (a, v) { return v.fecha > a ? v.fecha : a; }, '');
    var parado = ultima ? diasDesde(ultima, hoy) : null;
    if (parado != null && parado >= 7) out.push({ nivel: 'info', peso: parado, vista: 'resumen',
      texto: 'Llevas ' + parado + ' días sin apuntar ninguna venta' });
    var orden = { mal: 0, aviso: 1, info: 2 };
    return out.sort(function (a, b) { return orden[a.nivel] - orden[b.nivel] || b.peso - a.peso; });
  }

  // Cuánto se vende: hoy, los últimos 7 días, los 7 de antes y lo que va de mes.
  function ritmo(ventas, hoy) {
    var h = dia(hoy);
    var menos = function (n) { return dia(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n)); };
    var suma = function (desde, hasta) {
      var r = { importe: 0, uds: 0 };
      ventas.forEach(function (v) {
        var f = String(v.fecha).slice(0, 10);
        if (f >= desde && f <= hasta) { r.importe += v.importe; r.uds += v.cantidad; }
      });
      return r;
    };
    return { hoy: suma(h, h), semana: suma(menos(6), h), semanaAntes: suma(menos(13), menos(7)), mes: suma(h.slice(0, 8) + '01', h) };
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

  // ---- Fechas del tipo 2026-08-20 ----
  var aFecha = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  // Días desde la fecha `s` hasta `hoy` (0 si es hoy; null si no hay fecha).
  var diasDesde = function (s, hoy) {
    var f = aFecha(s);
    if (!f) return null;
    return Math.round((new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) - f) / 864e5);
  };
  var mayus = function (v) { return String(v == null ? '' : v).trim().toUpperCase(); };

  // ---- La ficha de cada amigo ----
  // Una prenda que lleva tanto tiempo en casa de un amigo sin venderse se marca como parada.
  var DIAS_PARADA = 21;
  function fichas(calc, cuentas, movimientos, vendedores, contactos, hoy) {
    var porId = new Map();
    var ficha = function (id) {
      if (!porId.has(id)) {
        porId.set(id, { id: id, nombre: id, contacto: '', propio: id === calc.propio,
          uds: 0, bruto: 0, comision: 0, liquidado: 0, pendiente: 0,
          enCasa: [], udsEnCasa: 0, valorEnCasa: 0, paradas: 0,
          ultimaVenta: '', diasSinVender: null, ultimoMovimiento: '', ventas: [], canales: [] });
      }
      return porId.get(id);
    };
    (vendedores || []).forEach(function (v) {
      var id = mayus(v.id);
      if (id) ficha(id).nombre = String(v.nombre || '').trim() || id;
    });
    cuentas.forEach(function (c) {
      var f = ficha(c.vendedor);
      f.uds = c.uds; f.bruto = c.bruto; f.comision = c.comision; f.liquidado = c.liquidado; f.pendiente = c.pendiente;
    });
    // Desde cuándo tiene cada prenda: la última vez que se le dio esa talla.
    var desde = {};
    (movimientos || []).forEach(function (m) {
      var id = mayus(m.vendedor_id), fe = String(m.fecha || '').slice(0, 10);
      if (!id) return;
      var f = ficha(id);
      if (fe > f.ultimoMovimiento) f.ultimoMovimiento = fe;
      if (mayus(m.tipo) === 'CONSIGNA') desde[id + '|' + mayus(m.sku)] = fe;
    });
    calc.mano.forEach(function (suyo, id) {
      var f = ficha(id);
      suyo.forEach(function (n, sku) {
        if (n <= 0) return;
        var p = calc.porSku.get(sku.toUpperCase());
        var d = desde[id + '|' + sku.toUpperCase()] || '';
        f.enCasa.push({ sku: sku, prod: p, n: n, desde: d, dias: diasDesde(d, hoy) });
        f.udsEnCasa += n;
        f.valorEnCasa += n * p.pvp;
      });
    });
    calc.ventas.forEach(function (v) {
      var f = ficha(v.vendedor);
      f.ventas.push(v);
      if (v.fecha > f.ultimaVenta) f.ultimaVenta = v.fecha;
    });
    porId.forEach(function (f) {
      f.contacto = String((contactos || {})[f.id] || '');
      f.diasSinVender = f.ultimaVenta ? diasDesde(f.ultimaVenta, hoy) : null;
      f.canales = ventasPor(f.ventas, function (v) { return v.canal; });
      f.enCasa.sort(function (a, b) { return (b.dias || 0) - (a.dias || 0); });
      f.paradas = f.enCasa.filter(function (x) { return x.dias != null && x.dias >= DIAS_PARADA; })
        .reduce(function (a, x) { return a + x.n; }, 0);
      f.ventas = f.ventas.slice().reverse();   // la última primero
    });
    // Primero quien te debe más; tú, al final.
    return Array.from(porId.values()).sort(function (a, b) {
      return (a.propio - b.propio) || (b.pendiente - a.pendiente) || (b.udsEnCasa - a.udsEnCasa) || (a.id < b.id ? -1 : 1);
    });
  }

  // ---- Segundo pedido: qué se vende, a qué ritmo y cuánto volver a pedir ----
  // El ritmo se cuenta desde el primer apunte (cuando empezó a moverse la mercancía). Lo
  // sugerido es lo que se vendería en `semanasACubrir` semanas a ese ritmo, menos lo que queda.
  function rotacion(calc, movimientos, config, hoy, semanasACubrir) {
    var inicio = '';
    (movimientos || []).forEach(function (m) {
      var f = String(m.fecha || '').slice(0, 10);
      if (aFecha(f) && f <= dia(hoy) && (!inicio || f < inicio)) inicio = f;
    });
    var semanas = inicio ? Math.max(1, (diasDesde(inicio, hoy) + 1) / 7) : 0;
    var compradasTodo = calc.prods.reduce(function (a, p) { return a + p.inicial; }, 0);
    // La parte del envío que toca a cada prenda.
    var envioUd = compradasTodo ? num(config && config.envio_total_usd) * num(config && config.tipo_cambio_usd_eur) / compradasTodo : 0;
    var m = new Map();
    calc.prods.forEach(function (p) {
      if (!m.has(p.cod)) {
        m.set(p.cod, { cod: p.cod, categoria: p.categoria, producto: p.producto, modelo: p.modelo, coste: p.coste,
          compradas: 0, vendidas: 0, quedan: 0, cobrado: 0, comision: 0, tallas: [] });
      }
      var x = m.get(p.cod);
      x.compradas += p.inicial; x.vendidas += p.vendido; x.quedan += Math.max(0, p.inicial - p.vendido);
      x.tallas.push({ talla: p.talla, vendidas: p.vendido, quedan: Math.max(0, p.inicial - p.vendido) });
    });
    calc.ventas.forEach(function (v) {
      var x = m.get(v.prod.cod);
      x.cobrado += v.importe; x.comision += v.comision;
    });
    var productos = Array.from(m.values()).map(function (x) {
      x.pctVendido = x.compradas ? x.vendidas / x.compradas : 0;
      x.ritmo = semanas ? x.vendidas / semanas : 0;                       // prendas por semana
      x.semanasDeStock = x.ritmo > 0 ? x.quedan / x.ritmo : null;
      x.gananciaUd = x.vendidas ? (x.cobrado - x.comision) / x.vendidas - x.coste - envioUd : null;
      x.sugerido = x.ritmo > 0 ? Math.max(0, Math.ceil(x.ritmo * semanasACubrir - x.quedan)) : 0;
      x.tallasTop = x.tallas.filter(function (t) { return t.vendidas > 0; })
        .sort(function (a, b) { return b.vendidas - a.vendidas; });
      return x;
    }).sort(function (a, b) { return b.ritmo - a.ritmo || b.pctVendido - a.pctVendido || b.compradas - a.compradas; });
    return { inicio: inicio, semanas: semanas, envioUd: envioUd, productos: productos };
  }

  // ---- Contar la caja ----
  // `contados`: {sku: unidades contadas}. Devuelve las tallas contadas que no cuadran.
  function recuento(prods, contados) {
    var r = { contadas: 0, total: prods.length, faltan: 0, sobran: 0, diferencias: [] };
    prods.forEach(function (p) {
      var c = contados[p.sku];
      if (c === '' || c == null || !isFinite(Number(c))) return;
      c = Math.max(0, Math.floor(Number(c)));
      r.contadas++;
      if (c !== p.inicial) {
        r.diferencias.push({ sku: p.sku, prod: p, esperado: p.inicial, contado: c, diferencia: c - p.inicial });
        if (c < p.inicial) r.faltan += p.inicial - c; else r.sobran += c - p.inicial;
      }
    });
    return r;
  }
  // El mensaje para el proveedor con lo que falta y lo que sobra.
  function textoRecuento(r) {
    var linea = function (d) { return '· ' + d.prod.producto + ' ' + d.prod.modelo + ', talla ' + d.prod.talla + ' (' + d.sku + '): '; };
    var faltan = r.diferencias.filter(function (d) { return d.diferencia < 0; });
    var sobran = r.diferencias.filter(function (d) { return d.diferencia > 0; });
    if (!faltan.length && !sobran.length) return 'Hola. He contado la caja y ha llegado todo. ¡Gracias!';
    return 'Hola. He contado la caja y no cuadra con el pedido:\n' +
      (faltan.length ? '\nFaltan (' + r.faltan + '):\n' + faltan.map(function (d) {
        return linea(d) + 'pedí ' + d.esperado + ', han llegado ' + d.contado;
      }).join('\n') + '\n' : '') +
      (sobran.length ? '\nSobran (' + r.sobran + '):\n' + sobran.map(function (d) {
        return linea(d) + 'pedí ' + d.esperado + ', han llegado ' + d.contado;
      }).join('\n') + '\n' : '') +
      '\n¿Cómo lo arreglamos?';
  }

  return { resumen: resumen, mensajeDeuda: mensajeDeuda, enlaceWhatsApp: enlaceWhatsApp, idPeticion: idPeticion, eur: eur,
    ventasPorDia: ventasPorDia, ventasPor: ventasPor, stockPorCategoria: stockPorCategoria,
    fichas: fichas, rotacion: rotacion, recuento: recuento, textoRecuento: textoRecuento, diasDesde: diasDesde, DIAS_PARADA: DIAS_PARADA,
    lineaDeuda: lineaDeuda, avisos: avisos, ritmo: ritmo, fechaCorta: fechaCorta };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Panel;
