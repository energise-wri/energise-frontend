function ea_inputs_init() {
  const inputs = document.querySelector('#inputs-pane');
  const list = inputs.querySelector('#inputs-list');

  sortable('#inputs-list', {
    "items": 'ds-input',
    "forcePlaceholderSize": true,
    "placeholder": '<div style="margin: 1px; background-color: rgba(0,0,0,0.3);"></div>',
  })[0]
    .addEventListener(
      'sortupdate',
      e => {
        ea_overlord({
          "type": 'sort',
          "target": e.detail.destination.items.map(i => i.getAttribute('bind')),
          "caller": 'ea_inputs_init',
        })
      });
};

function ea_inputs(list) {
  sortable('#inputs-list', 'disable');

  const inputs = document.querySelector('#inputs-pane');
  const inputs_list = inputs.querySelector('#inputs-list');

  const ldc = list.map(i => DS.named(i).input_el);

  const init = inputs_list.children.length === 0;

  for (let i of ldc)
    if (!inputs_list.contains(i)) { (init ? inputs_list.append(i) : inputs_list.prepend(i)) }

  for (let i of inputs_list.children)
    if (!list.includes(i.ds.id)) inputs_list.removeChild(i);

  sortable('#inputs-list', 'enable');
};

async function ea_inputs_sort(list) {
  for (let i of list.slice(0).reverse())
    await DS.named(i).raise();
};

class dsinput extends HTMLElement {
  constructor(d) {
    if (!(d instanceof DS)) throw Error(`dsinput: Expected a DS. Got ${d}.`);
    super();

    this.ds = d;
    attach.call(this, tmpl('#ds-input-template', true));

    this.render();

    return this;
  };

  render() {
    this.setAttribute('bind', this.ds.id);

    slot_populate.call(this, this.ds, {
      "svg": this.svg(),
      "ramp": this.ramp(),
      "opacity": this.opacity(),
      "handle": tmpl("#svg-handle"),
    });

    return this;
  };

  opacity() {
    const e = tmpl('#opacity-control');
    let o = 1;

    const grad = ea_svg_interval(
      true, null, null,
      x => o = x,
      _ => {
        let t = null;

        switch (this.ds.datatype) {
        case 'points':
          t = ['circle-opacity', 'circle-stroke-opacity'];
          break;

        case 'lines':
          t = ['line-opacity'];
          break;

        case 'polygons':
          t = ['fill-opacity'];
          break;

        case 'raster':
          t = ['raster-opacity'];
          break;

        default:
        break;
        }

        for (let i of t)
          ea_mapbox.setPaintProperty(this.ds.id, i, parseFloat(o));
      }
    );

    const b = qs(e, '.box');

    qs(e, '.slider').append(grad.svg);
    qs(e, '.icon').onclick = _ => b.style.display = 'block';
    b.onmouseleave = _ => b.style.display = 'none';

    return e;
  };

  svg() {
    const d = this.ds;
    let e;

    if (['points', 'lines'].includes(d.datatype)) e = d.vectors.symbol_svg;

    if (d.vectors && (d.vectors.color_stops && d.vectors.color_stops.length)) e = d.color_scale_svg;

    else if (!d.vectors && d.heatmap) e = d.color_scale_svg;

    if (d.collection) {
      const el = elem('<ul class="collection">');

      for (let i of d.configuration.collection) {
        let x = DS.named(i);
        let li = ce('li');

        li.append(x.input_el.svg(), elem(`<div class="subheader">${x.name_long}</div>`));

        el.append(li);
      }

      return el;
    }

    return e;
  };

  ramp() {
    const d = this.ds;
    let t = null;
    let el = null;

    if (d.collection) return;

    if (!d.vectors && d.heatmap) {
      el = tmpl("#ramp-label-min-max");

      qs(el, '[bind=min]').innerText = d.heatmap.domain.min * d.heatmap.factor;
      qs(el, '[bind=max]').innerText = d.heatmap.domain.max * d.heatmap.factor;
    }

    if (d.vectors && (d.vectors.color_stops && d.vectors.color_stops.length))
      el = tmpl("#ramp-label-0-100");

    return el;
  };
}

customElements.define('ds-input', dsinput);