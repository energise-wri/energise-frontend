import * as plot from './plot.js';
import {
  zoomend as mapbox_zoomend,
  dblclick as mapbox_dblclick,
  pointer as mapbox_pointer,
} from './mapbox.js';


/*
 * The following functions fetch and load the different types of data to the
 * datasets geojsons (points, lines or polygons), CSV's or rasters.
 */

function fail(format) {
  ea_flash.push({
    type: 'error',
    timeout: 5000,
    title: "Network error",
    message: `
Failed to process the ${format} for '${this.name}'.
This is not fatal. Dataset disabled.`
  });

  this.disable();

  throw Error(`"Dataset ${this.name} disabled. Failed to fetch ${format}.`);
};

function csv() {
  if (this.csv.data) return;

  return fetch(this.csv.endpoint)
    .catch(err => fail.call(this, "CSV"))
    .then(d => d.text())
    .then(r => d3.csvParse(r))
    .then(d => this.csv.data = d);
};

function tiff() {
  async function run_it(blob) {
    function draw() {
      const r = this.raster;

      if (!r.canvas) {
        r.canvas = plot.drawcanvas({
          canvas: ce('canvas'),
          data: r.data,
          width: r.width,
          height: r.height,
          nodata: r.nodata,
          colorscale: this.colorscale
        });
      }

      this.add_source({
        "type": "canvas",
        "canvas": r.canvas,
        "animate": false,
        "coordinates": MAPBOX.coords
      });

      this.add_layer({
        "type": 'raster',
        "layout": {
          "visibility": "none",
        },
        "paint": {
          "raster-resampling": "nearest"
        }
      });
    };

    if (!maybe(this.raster, 'data')) {
      const tiff = await GeoTIFF.fromBlob(blob);
      const image = await tiff.getImage();
      const rasters = await image.readRasters();

      this.raster.data = rasters[0];
      this.raster.width = image.getWidth();
      this.raster.height = image.getHeight();
      this.raster.nodata = parseFloat(tiff.fileDirectories[0][0].GDAL_NODATA);
    }

    if (this.datatype === 'raster') draw.call(this);
  };

  let t;
  if (maybe(this.raster, 'data')) {
    t = Whatever;
  }

  else {
    t = fetch(this.raster.endpoint)
      .catch(err => fail.call(this, "TIFF"))
      .then(r => {
        if (!(r.ok && r.status < 400)) fail.call(this, "TIFF");
        else return r;
      })
      .then(r => r.blob())
  }

  return t.then(b => run_it.call(this, b));
};

function geojson() {
  if (this.vectors.features)
    return Whatever;

  return fetch(this.vectors.endpoint)
    .catch(err => fail.call(this, "GEOJSON"))
    .then(r => {
      if (!(r.ok && r.status < 400)) fail.call(this, "GEOJSON");
      else return r;
    })
    .then(r => r.json())
    .then(r => {
      this.vectors.features = r;
      if (this.id === 'boundaries') this.vectors.bounds = geojsonExtent(r);
    });
};

function points() {
  return geojson.call(this)
    .then(_ => {
      const v = this.vectors;

      this.add_source({
        "type": "geojson",
        "data": this.vectors.features
      });

      this.add_layer({
        "type": "circle",
        "layout": {
          "visibility": "none",
        },
        "paint": {
          "circle-radius": v.width || 3,
          "circle-opacity": v.opacity,
          "circle-color": v.fill || 'cyan',
          "circle-stroke-width": v['stroke-width'] || 1,
          "circle-stroke-color": v.stroke || 'black',
        },
      });
    });
};

function lines() {
  return geojson.call(this)
    .then(_ => {
      let da = [1];

      // mapbox-gl does not follow SVG's stroke-dasharray convention when it comes
      // to single numbered arrays.
      //
      if (this.vectors.dasharray) {
        da = this.vectors.dasharray.split(' ').map(x => +x);
        if (da.length === 1) {
          (da[0] === 0) ?
            da = [1] :
            da = [da[0], da[0]];
        }
      }

      const fs = this.vectors.features.features;
      const specs = this.vectors.specs;

      const criteria = [];

      for (let i = 0; i < fs.length; i += 1) {
        if (specs) {
          const c = { params: [] };
          let p = false;

          for (let s of specs) {
            let m;

            const r = new RegExp(s.match);
            const v = fs[i].properties[s.key];

            if (!v) continue;

            const vs = v + "";

            if (vs === s.match || (m = vs.match(r))) {
              c[s.key] = vs ? vs : m[1];
              if (c.params.indexOf(s.key) < 0) c.params.push(s.key);

              if (has(s, 'stroke')) {
                fs[i].properties['__color'] = s['stroke'];
                c['stroke'] = s['stroke'];
              }

              if (has(s, 'stroke-width')) {
                fs[i].properties['__width'] = s['stroke-width'];
                c['stroke-width'] = s['stroke-width'];
              }

              p = true;
            }
          }

          if (p && criteria.indexOf(JSON.stringify(c)) < 0) criteria.push(JSON.stringify(c));
        }
        else {
          fs[i].properties['__color'] = this.vectors.stroke;
          fs[i].properties['__width'] = this.vectors.width || 1;
        }
      }

      this.add_source({
        "type": "geojson",
        "data": this.vectors.features
      });

      this.add_layer({
        "type": "line",
        "layout": {
          "visibility": "none",
        },
        "paint": {
          "line-color": ['get', '__color'],
          "line-width": ['get', '__width'],
          // Waiting for mapbox to do something about this...
          //
          // "line-dasharray": ['get', '__dasharray']
          "line-dasharray": da,
        },
      });

      if (criteria.length)
        this.card.line_legends(criteria.map(x => JSON.parse(x)));
    });
};

function polygons() {
  if (MAPBOX.getLayer(this.id)) {
    console.log(this.id, "dsparse.polygons: layer already exists.");
    return;
  }

  return geojson.call(this)
    .then(async _ => {
      if (this.csv) {
        let col = null;

        if (this.timeline) {
          await ea_timeline_datasets_polygons_csv.call(this);
          col = U.timeline;
        }
        else if (this.config.column)
          col = this.config.column;

        polygons_csv.call(this, col);
      }

      const fs = this.vectors.features.features;
      for (let i = 0; i < fs.length; i += 1)
        fs[i].id = fs[i].properties[this.vectors.key];

      this.add_source({
        "type": "geojson",
        "data": this.vectors.features
      });

      this.add_layer({
        "type": "fill",
        "layout": {
          "visibility": "none",
        },
        "paint": {
          "fill-color": this.datatype.match("polygons-") ? ['get', '__color'] : this.vectors.fill,
          "fill-outline-color": this.vectors.stroke,
          "fill-opacity": [ "case", [ "boolean", [ "get", "__hidden" ], false ], 0, 1 * this.vectors.opacity ]
        },
      });

      mapbox_dblclick(this.id);
      mapbox_zoomend(this.id);
    });
};

async function polygons_csv(col) {
  await until(_ => this.csv.data && this.vectors.features);

  if (this.config.column)
    this.csv.table = table.call(this);

  const data = this.csv.data;
  let s;

  if (this.colorscale) {
    if (!data) warn(this.id, "has no csv.data");

    const l = d3.scaleQuantize().domain(this.domain).range(this.colorscale.stops);
    s = x => (null === x || undefined === x || x === "") ? "rgba(155,155,155,1)" : l(+x);

    this.csv.scale = l;
  }

  if (!data) {
    warn("No data for", this.id);
    return;
  }

  const fs = this.vectors.features.features;
  for (let i = 0; i < fs.length; i += 1) {
    let row = data.find(r => +r[this.csv.key] === +fs[i].properties[this.vectors.key]);
    fs[i].properties.__color = (this.colorscale && row) ? s(row[col]) : "white";
  }

  this.update_source(this.vectors.features);

  if (this.card) this.card.refresh();
};

function table() {
  const table = {};
  const data = this.csv.data;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    table[d[this.csv.key]] = +d[this.config.column];
  }

  return table;
};

function polygons_feature_info(et, e) {
  console.log("Feature Properties:", et.properties);

  let at = [];

  if (this.category.name === 'boundaries' ||
      this.category.name.match(/^indicator/)) {
    at.push({
      "target": DST.get('boundaries').config.boundaries_name || "Geography Name",
      "dataset": "_boundaries_name",
    });

    et.properties["_boundaries_name"] = BOUNDARIES[et.properties[this.vectors.key]];
  }

  if (this.config.column) {
    at.push({
      "target": this.name,
      "dataset": "_" + this.config.column,
    });

    et.properties["_" + this.config.column] = this.csv.table[et.properties[this.vectors.key]];
  }

  if (this.config.features_attr_map) {
    at = at.concat(this.config.features_attr_map);
  }

  at = at.filter(x => x['dataset'] !== "_OBJECTID");

  let td = table_data(at, et.properties);
  table_add_lnglat(td, [e.lngLat.lng, e.lngLat.lat]);

  mapbox_pointer(
    td,
    e.originalEvent.pageX,
    e.originalEvent.pageY
  );
};

export {
  tiff,
  polygons,
  points,
  lines,
  csv,
  polygons_csv,
  polygons_feature_info
};