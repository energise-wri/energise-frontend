function ea_countries_setup() {
  let b = [[-180, -85], [180, 85]];
  let width, height;

  const p = document.querySelector('#playground');
  p.style['height'] = `calc(${window.innerHeight}px - 3.5em)`;

  width = window.innerWidth;
  height = p.clientHeight;

  const svg = d3.select('#svg-map')
        .attr('width', width)
        .attr('height', height);

  const maparea = document.querySelector('#maparea');
  maparea.style['width'] = width + "px";
  maparea.style['height'] = height + "px";

  const cf  = document.querySelector('#country-float');
  const cfn = cf.querySelector('#country-float-name');
  const cff = cf.querySelector('#country-float-flag');

  let curr_c = null;

  Promise.all([
    d3.json(ea_settings.database + '/countries?online'),
    d3.json(ea_settings.app_base + '/lib/world-50m.json'),
    d3.json(ea_settings.app_base + '/lib/countries.json'),
    d3.csv(ea_settings.app_base + '/data/countries-overview.csv')
  ])
    .then(results => {
      let geo = results[1];

      window.countries_online = results[0];
      window.countries = results[2];
      window.countries_overviews = results[3];

      const dropdown = document.querySelector('#country-dropdown');
      const button = document.querySelector('#country-select');

      dropdown.style.height = (document.querySelector('#maparea').clientHeight - 120) + "px";

      countries_overviews.forEach(c => {
        let cc = countries.find(x => x.ccn3 === c.ccn3);

        let e = elem(`
<div class="country-dropdown-element" bind="${cc.ccn3}">
  <div class="country-dropdown-image">
    <img class="flag" src="https://cdn.rawgit.com/mledoze/countries/master/data/${cc.cca3.toLowerCase()}.svg" />
  </div>

  <div class="country-dropdown-name">${cc.name.common}</div>
</div>`);

        e.addEventListener(
          'click',
          _ => ea_countries_overview(
            countries.find(x => x.ccn3 === c.ccn3),
            countries_overviews,
            countries_online
          )
        );

        dropdown.appendChild(e);
      });

      dropdown.addEventListener('mouseleave', _ => dropdown.style.display = 'none');
      dropdown.addEventListener('mouseenter', _ => dropdown.style.display = 'block');

      button.addEventListener('click', _ => dropdown.style.display = 'block');
      button.addEventListener('mouseleave', _ => dropdown.style.display = 'none');
      button.addEventListener('mouseenter', _ => dropdown.style.display = 'block');

      const input = button.querySelector('input');

      const elements = dropdown.querySelectorAll('.country-dropdown-element');

      input.addEventListener('keyup', e => {
        dropdown.style.display = 'block'

        if (e.code === "Enter") {
          for (x of elements) {
            if (x.style.display === 'block') {
              let ccn3 = x.getAttribute('bind');

              if (ccn3)  {
                ea_countries_overview(
                  countries.find(t => t.ccn3 === ccn3),
                  countries_overviews,
                  countries_online
                )
              }

              break;
            }
          };
        }

        let i = input.value;

        if (i === '') {
          elements.forEach(e => e.style.display = 'block');
          return;
        }

        elements.forEach(e => {
          let cname = e.querySelector('.country-dropdown-name').innerText;
          e.style.display = (cname.toLowerCase().indexOf(i.toLowerCase()) != -1) ? 'block' : 'none';
        });
      });

      // button.addEventListener('mouseleave', _ => dropdown.style.display = 'none');

      const topo = topojson.feature(geo, geo.objects.countries);

      ea_map = ea_countries_map_svg(svg, geo, 'countries', { center: [0,0], scale: 350 });

      ea_countries_map_load_features({
        "map": ea_map,
        "features": topo.features,
        "cls": "land",
        "scale": 0,
        "classed": v => typeof countries_overviews.find(c => c.ccn3 === v) !== 'undefined',
        "mousedown": v => ea_countries_overview(countries.find(c => c.ccn3 === v), countries_overviews, countries_online),
        "mouseenter": v => {
          let x = countries.find(c => c.ccn3 === v);

          if (!x) return v;

          cf.style.display = '';
          cfn.style.display = '';

          ea_map.svg.select(`.land#land-${v}`).classed('active', true);

          if (curr_c === x) return;
          else curr_c = x;

          cfn.value = x.name.common;
          cff.innerHTML = (`<img class="flag"
                                 src="https://cdn.rawgit.com/mledoze/countries/master/data/${x.cca3.toLowerCase()}.svg" />`);

          const px = Math.min(window.innerWidth - cf.offsetWidth - 105, (d3.event.pageX + 7));
          const py = Math.min(window.innerHeight - cf.offsetHeight, (d3.event.pageY + 15));

          cf.style.left = `${ px }px`;
          cf.style.top =  `${ py }px`;

          return v;
        },
        "mouseleave": v => {
          ea_map.svg.select(`.land#land-${v}`).classed('active', false);
          cf.style.display = 'none';
        },
      });

      ea_ui_app_loading(false);
    })
    .catch(error => {
      ea_flash
        .type('error')
        .title(error)();

      console.log(error);
    });
};

function ea_countries_overview(c, list, online) {
  const r = list.find(i => i.country === c.name.common);

  const co = elem('<div class="country-overview">');

  let demo, pop, area, urban_rural, pol, gdp, pies, ease, dev, btn, rate;

  if (r) {
    if (+r['population'] > 0)
      pop = elem(`
<div class="overview-line">
  <strong>Population:</strong> ${(+r['population']).toLocaleString()} Million
</div>`);

    if (+r['area'] > 0)
      area = elem(`
<div class="overview-line">
  <strong>Area:</strong> ${(+c['area']).toLocaleString()} km<sup>2</sup>
</div>`);


    if (+r['urban-perc'] + +r['rural-perc'] === 100)
      urban_rural = elem(`
<div><br>
  <div style="display: flex; width: 300px; justify-content: space-around;">
    <h5>Urban:&nbsp;${r['urban-perc']}%</h5>
    <h5>Rural:&nbsp;${r['rural-perc']}%</h5>
  </div>
</div>`);

    if (+r['energy-access-policy-support'] > 0)
      pol = elem(`
<div class="overview-line">
  <strong>Policy support for energy access:</strong> ${(r['energy-access-policy-support'])}/100
</div>`);

    if (+r['energy-access-comprehensive-policy-support'] > 0)
      gdp = elem(`<div>GDP per capita: USD ${(+r['gdp-per-capita']).toFixed(2).toLocaleString()}</div>`);

    pies = elem(`
<div class="overview-line">
  <div class="pie-charts-legends" style="display: flex; width: 300px; justify-content: space-around;"></div>
  <div class="pie-charts" style="display: flex; width: 300px; justify-content: space-around;"></div>
</div>`);


    if (+r['electrification-rate-national'] > 0)
      rate = elem(`
<div class="overview-line">
  <strong>Electrification Rate:</strong> ${r['electrification-rate-national']}%
</div>`);

    if (+r['ease-business'] > 0)
      ease = elem(`
<div class="overview-line">
  <strong>Ease of doing business:</strong> ${r['ease-business']}/190
</div>`);

    if (online.map(x => x['ccn3']).indexOf(+r['ccn3']) > -1)
      btn = elem(`<div><br><button id="eae" onclick="window.location = '/maps-and-data/tool?ccn3=${r['ccn3']}'">Click to launch tool</a></div>`);

    [pop, urban_rural, pies, gdp, dev, area, pol, rate, ease, btn].forEach(t => t ? co.appendChild(t) : null);

    if (+r['electrification-rate-urban'] > 0) {
      co.querySelector('.pie-charts-legends')
        .appendChild(elem(`
<div class="overview-line">
  Electrified:&nbsp;<strong>${r['electrification-rate-urban']}%</strong>
</div>`));

      let eru = ea_svg_pie(
        [
          [+r['electrification-rate-urban']],
          [100 - +r['electrification-rate-urban']]
        ],
        50, 0,
        [
          getComputedStyle(document.body).getPropertyValue('--the-light-green'),
          getComputedStyle(document.body).getPropertyValue('--the-green')
        ],
        ""
      );

      co.querySelector('.pie-charts').appendChild(eru.svg);
      eru.change(0);
    }

    if (+r['electrification-rate-rural'] > 0) {
      co.querySelector('.pie-charts-legends')
        .appendChild(elem(`
<div class="overview-line">
  Electrified:&nbsp;<strong>${r['electrification-rate-rural']}%</strong>
</div>`));

      let err = ea_svg_pie(
        [
          [+r['electrification-rate-rural']],
          [100 - (+r['electrification-rate-rural'])]
        ],
        50, 0,
        [
          getComputedStyle(document.body).getPropertyValue('--the-light-green'),
          getComputedStyle(document.body).getPropertyValue('--the-green')
        ],
        ""
      );

      co.querySelector('.pie-charts').appendChild(err.svg);
      err.change(0);
    }

  } else {
    co.innerHTML = `<strong>${c.name.common}</strong> not included`;
  }

  ea_modal
    .header(`<div style="text-transform: uppercase; color: var(--the-white)">${c.name.common}</div>`)
    .content(co)();
};

function ea_countries_map_svg(svg, topofile, name, options) {
  let width, height;

  let projection, geopath, scale;

  let opts = options || {};

  const map = svg.select('#map');
  const land = map.append('g').attr('id', "land")
        .attr('fill', "none");

  switch (topofile.type) {
  case "FeatureCollection": {
    topo = topofile
    break;
  }

  case "Topology": {
    topo = topojson.feature(topofile, topofile.objects[name]);
    break;
  }

  default: {
    console.warn("Don't know what to do with topofile type:", topofile.type)
    ea_flash
      .type('error')
      .message(topofile.type)();
    break;
  }
  }

  width = +svg.attr('width');
  height = +svg.attr('height');

  projection = d3.geoMercator();

  projection
    .scale(1)
    .center([0,0])
    .translate([0,0]);

  geopath = d3.geoPath()
    .projection(projection);

  const b = geopath.bounds(topo);
  const geo_width = (b[1][0] - b[0][0]);
  const geo_height = (b[1][1] - b[0][1]);

  scale = 1 / (Math.max(geo_width / width, geo_height / height));
  translate = [width/2 , height/2];

  projection
    .scale(opts.scale || scale)
    .center(opts.center || [0,0])
    .translate(opts.translate || translate)

  const _map = {
    topo: topo,
    projection: projection,
    geopath: geopath,
    svg: svg,
    map: map,
    init: null,
    land: land,
    scale: scale,
    width: width,
    height: height,
  };

  // ZOOM AND MOUSE EVENTS
  //
  {
    const comfy = 4/5;
    let mask;
    let zt = d3.zoomIdentity;
    const tooltip = d3.select('#coord-tooltip');

    let mouseenter = _ => tooltip.style('display', "block");

    let mouseleave = _ => tooltip.style('display', "none");

    let mousemove = _ => {
      const p = projection.invert(zt.invert(d3.mouse(svg.node())))

      tooltip
        .html(`${ p[0].toFixed(4) }, ${ p[1].toFixed(4) }`)
        .style('left', `${ (d3.event.pageX + 7) }px`)
        .style('top', `${ (d3.event.pageY + 15) }px`);
    };

    let zoomstart = _ => {
      if (!mask || mask.empty()) mask = d3.select('#mask');
    };

    let zoomend = _ => {
      let k;

      if (d3.event)
        k = d3.event.transform.k;
      else
        k = comfy;
    };

    let zooming = _ => {
      let et;

      if (d3.event)
        et = zt = d3.event.transform;
      else
        et = zt = d3.zoomIdentity.translate(width/10, height/10).scale(comfy);

      const nw = projection.invert(et.invert([0,0]));
      const se = projection.invert(et.invert([width, height]));

      if (typeof ea_mapbox !== 'undefined' && ea_mapbox !== null)
        ea_mapbox.fitBounds([[nw[0], se[1]], [se[0], nw[1]]], { animate: false });

      map.attr("transform", et);
      mask.attr("transform", et);
    };

    let zoom = d3.zoom()
        .translateExtent([[0, 0], [width, height]])
        .scaleExtent([comfy, 200])
        .on("start", zoomstart)
        .on("zoom", zooming)
        .on("end", zoomend);

    svg.call(zoom)
      .on('mousemove', mousemove)
      .on('mouseenter', mouseenter)
      .on('mouseleave', mouseleave);

    zoom.scaleBy(svg, comfy);
    zoom.translateTo(svg, _map.width/10, _map.height/10);

    _map.init = _ => {
      var d = d3.dispatch("init");

      d.on("init", _ => {
        zoomstart();
        zooming();
        zoomend();
      });

      d.call("init");
    }
  }

  return _map;
};

function ea_countries_map_load_features(o) {
  if (!o.map)
    throw "Argument Error: o.map is missing";

  if (!o.map.map)
    throw "Argument Error: o.map.map is missing";

  if (!o.map.geopath)
    throw "Argument Error: o.map.geopath is missing";

  if (!o.features)
    throw "Argument Error: o.features is missing";

  if (o.features.some(f => f.type !== "Feature")) {
    console.log(o.features);
    throw "Argument Error: o.features is not an array of Features";
  }

  let container = o.map.map.select(`#${o.cls}`);
  let paths;

  if (container.empty())
    container = o.map.map.append('g').attr('id', o.cls);

  container.selectAll(`path.${ o.cls }`).remove();

  paths = container.selectAll(`path.${ o.cls }`)
    .data(o.features).enter()
    .append('path')
    .attr('class', (o.cls || ''))
    .attr('id', d => o.cls + "-" + (d.gid || d.id || null))
    .attr('d', o.map.geopath)
    .attr('stroke-width', o.scale ? (0.5/o.scale) : 0);

  if (typeof o.classed === 'function')
    paths.classed("selectable", d => o.classed(d.gid || d.id || null));

  if (typeof o.mouseover === 'function')
    paths.on('mouseover', d => o.mouseover(d.gid || d.id || ''));

  if (typeof o.mouseenter === 'function')
    paths.on('mouseenter', d => o.mouseenter(d.gid || d.id || ''));

  if (typeof o.mouseleave === 'function')
    paths.on('mouseleave', d => o.mouseleave(d.gid || d.id || ''));

  if (typeof o.mousedown === 'function')
    paths.on('mousedown', d => o.mousedown(d.gid || d.id || ''));

  return container;
};