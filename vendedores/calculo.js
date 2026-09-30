// Las cuentas del negocio a partir de PRODUCTOS y MOVIMIENTOS: stock, reservas, quién
// tiene qué, ventas, comisiones y pagos.
//
// Es el MISMO código en los dos sitios que lo necesitan:
//   - la web (web/index.html lo carga), y
//   - el formulario de Google: `node scripts/generar.js` lo copia dentro de
//     scripts/apps-script.gs.
// Y da lo mismo que las fórmulas de la hoja: scripts/test-excel.js y scripts/test-gs.js
// lo comprueban con los mismos movimientos. Si cambias una regla aquí, cámbiala también
// en scripts/hoja.js o los tests fallarán.
var Calculo = (function () {
  'use strict';

  var TRAMOS_POR_DEFECTO = [{ hasta: 25, pct: 20 }, { hasta: 45, pct: 15 }, { hasta: null, pct: 10 }];

  function txt(v) { return String(v == null ? '' : v).trim(); }

  // Importe escrito de cualquier forma razonable -> número (0 si no hay número).
  //   12.5 · "12,50" · "12.50" · "35,00 €" · "1.234,50 €" · "1.200" (mil doscientos)
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = txt(v).replace(/[^0-9,.\-]/g, '');
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,50
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');      // 1.200
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  // % de comisión que toca a un precio de venta, según los tramos.
  function comisionPct(precio, tramos) {
    tramos = tramos || TRAMOS_POR_DEFECTO;
    for (var i = 0; i < tramos.length; i++) {
      if (tramos[i].hasta == null || precio <= tramos[i].hasta) return tramos[i].pct;
    }
    return tramos[tramos.length - 1].pct;
  }

  // productos:   [{ sku, categoria, producto, modelo, talla, stock_inicial, pvp_eur, ... }]
  // movimientos: [{ fecha, sku, tipo, vendedor_id, cantidad, precio_venta_eur, canal, notas }]
  //              en el orden de la hoja (el de arriba es el más antiguo).
  // opc:         { tramos, propio }   propio = tu id de vendedor ('V1').
  function calcular(productos, movimientos, opc) {
    opc = opc || {};
    var tramos = opc.tramos || TRAMOS_POR_DEFECTO;
    var propio = txt(opc.propio || 'V1').toUpperCase();

    var prods = productos.filter(function (p) { return txt(p.sku) !== ''; }).map(function (p) {
      var sku = txt(p.sku);
      return {
        sku: sku, categoria: txt(p.categoria), producto: txt(p.producto),
        modelo: txt(p.modelo), talla: txt(p.talla),
        inicial: num(p.stock_inicial), pvp: num(p.pvp_eur), coste: num(p.coste_eur),
        imagen: txt(p.imagen_url),
        // El sku es `codigo-talla`; el código identifica el producto (y su foto, img/<codigo>.jpg).
        cod: sku.replace(/-[^-]+$/, ''),
        vendido: 0, reservasBrutas: 0,
      };
    });
    var porSku = new Map();
    prods.forEach(function (p) { porSku.set(p.sku.toUpperCase(), p); });

    // Lo que tiene cada vendedor en su casa: vendedor -> (sku -> unidades).
    // Se recorre en orden: una venta o una devolución solo descuenta lo que tenía en ese
    // momento. Si vende algo que no tenía (lo mandaste tú desde el almacén), no le queda
    // en negativo, y lo que le des después cuenta entero.
    var mano = new Map();
    var enMano = function (vid, sku) { return (mano.get(vid) && mano.get(vid).get(sku)) || 0; };
    var ponerEnMano = function (vid, sku, n) {
      if (!mano.has(vid)) mano.set(vid, new Map());
      mano.get(vid).set(sku, n);
    };
    // Reservas de cada vendedor: 'SKU|VENDEDOR' -> RESERVA menos QUITA_RESERVA.
    var reservasVend = new Map();

    var ventas = [];
    var pagos = [];

    movimientos.forEach(function (m) {
      var tipo = txt(m.tipo).toUpperCase();
      var vid = txt(m.vendedor_id).toUpperCase();
      // Un PAGO no va ligado a una prenda: es dinero que un vendedor te da.
      if (tipo === 'PAGO') {
        pagos.push({
          fecha: txt(m.fecha), vendedor: vid, importe: num(m.precio_venta_eur),
          notas: txt(m.notas), sku: txt(m.sku),
        });
        return;
      }
      var p = porSku.get(txt(m.sku).toUpperCase());
      if (!p) return;
      var cant = num(m.cantidad);
      var clave = p.sku + '|' + vid;

      if (tipo === 'CONSIGNA') ponerEnMano(vid, p.sku, enMano(vid, p.sku) + cant);
      else if (tipo === 'DEVOLUCION') ponerEnMano(vid, p.sku, Math.max(0, enMano(vid, p.sku) - cant));
      else if (tipo === 'RESERVA' || tipo === 'QUITA_RESERVA') {
        var d = tipo === 'RESERVA' ? cant : -cant;
        p.reservasBrutas += d;
        reservasVend.set(clave, (reservasVend.get(clave) || 0) + d);
      } else if (tipo === 'VENTA') {
        ponerEnMano(vid, p.sku, Math.max(0, enMano(vid, p.sku) - cant));
        p.vendido += cant;
        // El precio es el cobrado de verdad. Si falta, cuenta 0 (igual que la hoja) y la
        // venta se marca para que se vea que hay que completarla.
        var precio = num(m.precio_venta_eur);
        var pct = vid === propio ? 0 : comisionPct(precio, tramos);
        ventas.push({
          fecha: txt(m.fecha), sku: p.sku, vendedor: vid, cantidad: cant, precio: precio,
          canal: txt(m.canal), prod: p, comisionPct: pct,
          importe: precio * cant, comision: precio * cant * pct / 100,
          propia: vid === propio, sinPrecio: !(precio > 0),
        });
      }
    });

    prods.forEach(function (p) {
      p.reservado = Math.max(0, p.reservasBrutas);
      // Puede salir negativo si se ha apuntado más venta de la que había: así se ve el error.
      p.disponible = p.inicial - p.vendido - p.reservado;
      p.enVendedores = 0;
    });
    mano.forEach(function (suyo) {
      suyo.forEach(function (n, sku) { if (n > 0) porSku.get(sku.toUpperCase()).enVendedores += n; });
    });
    prods.forEach(function (p) {
      // Lo que está físicamente en tu casa, reservado o no.
      p.enAlmacen = p.inicial - p.vendido - p.enVendedores;
    });

    return {
      prods: prods, porSku: porSku, mano: mano, ventas: ventas, pagos: pagos,
      propio: propio, tramos: tramos,
      enMano: enMano,
      reservaDe: function (sku, vid) {
        return Math.max(0, reservasVend.get(txt(sku) + '|' + txt(vid).toUpperCase()) || 0);
      },
    };
  }

  // Cuentas con cada vendedor: vendido, su comisión, lo que te ha pagado y lo que falta.
  function cuentas(calc) {
    var por = new Map();
    var dato = function (vid) {
      if (!por.has(vid)) {
        por.set(vid, { vendedor: vid, uds: 0, bruto: 0, comision: 0, liquidado: 0,
          propio: vid === calc.propio });
      }
      return por.get(vid);
    };
    calc.ventas.forEach(function (v) {
      var a = dato(v.vendedor);
      a.uds += v.cantidad;
      a.bruto += v.importe;
      a.comision += v.comision;
    });
    calc.pagos.forEach(function (pg) { if (pg.vendedor) dato(pg.vendedor).liquidado += pg.importe; });
    por.forEach(function (a) {
      a.tuParte = a.bruto - a.comision;
      // Lo tuyo no es una deuda: el dinero de tus ventas ya lo tienes.
      a.pendiente = a.propio ? 0 : a.tuParte - a.liquidado;
    });
    return por;
  }

  // Qué ventas concretas faltan por pagar, vendedor a vendedor (para saber qué reclamar).
  // Un PAGO que lleva prenda paga primero las ventas de esa prenda (la más antigua antes); lo
  // que sobre, y los pagos generales, pagan las ventas más antiguas. Lo que sobre al final es
  // a su favor. Si un PAGO de ajuste en negativo sube la deuda por encima de lo vendido, esa
  // parte va en `extra` (no es de ninguna prenda). Siempre: debe - aFavor = la cuenta de cuentas().
  function deudas(calc) {
    var r2 = function (n) { return Math.round(n * 100) / 100; };
    var por = new Map();
    var dato = function (vid) {
      if (!por.has(vid)) por.set(vid, { vendedor: vid, ventas: [], pagos: [], aFavor: 0, extra: 0, sinPrecio: 0 });
      return por.get(vid);
    };
    calc.ventas.forEach(function (v) {
      if (v.propia) return;
      var d = dato(v.vendedor);
      d.ventas.push({ venta: v, tuParte: r2(v.importe - v.comision), pagado: 0 });
      if (v.sinPrecio) d.sinPrecio++;
    });
    calc.pagos.forEach(function (p) { if (p.vendedor) dato(p.vendedor).pagos.push(p); });
    var pagar = function (lista, resto) {
      for (var i = 0; i < lista.length && resto > 0.004; i++) {
        var q = Math.min(r2(lista[i].tuParte - lista[i].pagado), resto);
        if (q > 0) { lista[i].pagado = r2(lista[i].pagado + q); resto = r2(resto - q); }
      }
      return resto;
    };
    por.forEach(function (d) {
      var total = r2(d.pagos.reduce(function (a, p) { return a + p.importe; }, 0));
      var aplicado = 0;
      d.pagos.forEach(function (p) {
        if (!p.sku || !(p.importe > 0)) return;
        var sku = p.sku.toUpperCase();
        var suyas = d.ventas.filter(function (x) { return x.venta.sku.toUpperCase() === sku; });
        aplicado = r2(aplicado + p.importe - pagar(suyas, p.importe));
      });
      var bolsa = r2(total - aplicado);
      if (bolsa >= 0) d.aFavor = pagar(d.ventas, bolsa);
      else d.extra = -bolsa;
      d.ventas.forEach(function (x) { x.pendiente = r2(x.tuParte - x.pagado); });
      d.pendientes = d.ventas.filter(function (x) { return x.pendiente > 0.004; });
      d.pendiente = r2(d.pendientes.reduce(function (a, x) { return a + x.pendiente; }, 0));
      d.debe = r2(d.pendiente + d.extra);
    });
    return por;
  }

  return { num: num, comisionPct: comisionPct, calcular: calcular, cuentas: cuentas, deudas: deudas };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Calculo;
