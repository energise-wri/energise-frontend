/*
 * ea_analysis
 *
 * Given a list of active DS's, their weights, domains and scaling
 * functions; create a new DS whose raster is a "normalised weighted average".
 *
 * @param "type" string. That can be:
 *   - The ID of a dataset.
 *   - The shortname of an index: eai, ani, demand or supply.
 *
 * returns DS to be plotted onto a canvas
 */

function ea_analysis(type) {
  const t0 = performance.now();

  const list = (function(t) {
    let idxn;

    if (['supply', 'demand'].indexOf(t) > -1)
      idxn = d => d.indexname === t;

    else if (['eai', 'ani'].indexOf(t) > -1)
      idxn = d => true;

    else
      idxn = d => d.id === t;

    return DS.list.filter(d => d.active && idxn(d));
  }).call(null, type);

  // we use a dataset as a template just for code-clarity.
  //
  const tmp = DS.named('boundaries');

  let cs = ea_default_color_scale;

  let single_input = DS.named(type);

  if (single_input) {
    cs = single_input.heatmap.color_scale;

    if (single_input.configuration && single_input.configuration.mutant)
      cs = DS.named(single_input.configuration.host).heatmap.color_scale;
  }

  const A = {
    id: `analysis-${Date.now()}`,
    domain: [0,1],
    width: tmp.width,
    height: tmp.height,
    raster: new Float32Array(tmp.raster.length).fill(-1),
    nodata: -1,
    color_scale: cs,
  };

  if (!list.length) return A;

  // Add up how much demand and supply datasets will account for. Then, just
  // below, these values will be split into 50-50 of the total analysis.
  //
  const tots = list
        .reduce((a,d) => {
          if (d.indexname) a[d.indexname] += d.weight;
          return a;
        }, { "supply": 0, "demand": 0 });

  const weights = {};

  list.forEach(d => {
    if (d.indexname)
      weights[d.id] = d.weight / (tots[d.indexname] * 2)
  });

  // Each dataset has a different scaling function. We cache these to optimise
  // the huge loop we are about to do.
  //
  const scales = list.map(d => d.scale_fn(type));

  // The values will be normalised. Initialise the values:
  //
  let min = 1;
  let max = 0;

  // NOTICE: if there is only one dataset which has no weight in calculations
  // (boundaries with key-delta scale function, for example), we do NOT want an
  // fully black raster to show as the result. We return the transparent one "A"
  // instead.
  //
  const full_weight = list
        .reduce((a,c) => ((c.heatmap.scale === "key-delta") ? a : c.weight + a), 0);

  if (list.length === 1 && full_weight === 0) return A;

  for (var i = 0; i < A.raster.length; i++) {
    let a = 0;

    for (let j = 0; j < list.length; j++) {
      let c = list[j];

      // For the rest of the datasets, we 'annihilate' points that are already
      // as -1 (or nodata) since we wouldn't know what value to assign for the
      // analysis. In other words, if a dataset has a point has nodata, that
      // point is useless for the analysis as it is incomparable with other
      // datasets.
      //
      // We assume they have been clipped out.
      //
      if (a === -1) continue;

      const v = c.raster[i];
      if (v === c.nodata) {
        a = -1; continue;
      }

      const sv = scales[j](v);

      // Three options: within domain/range, clipping or clamping. This is where
      // the clipping happens. The clamping was done by the scaling function
      // above.
      //
      // If the scaling function clamped, the following will not happen. But if
      // the value falls outside our analysis domain, we clip it (-1 nodata).
      //
      if (sv < 0 || sv > 1) {
        a = -1; continue;
      }

      const w = weights[c.id];
      a = w ? (sv * w) + a : a;
    }

    // Record the new min/max values:
    //
    if (a !== -1) {
      if (a > max) max = a;
      if (a < min) min = a;
    }

    A.raster[i] = a;
  }

  // For user-friendlyness, the new raster is "quantised". It increases the
  // heatmaps' contrast.
  //
  var f = d3.scaleQuantize().domain([min,max]).range([0, 0.25, 0.5, 0.75, 1]);

  for (var i = 0; i < A.raster.length; i++) {
    const r = A.raster[i];
    A.raster[i] = (r === -1) ? -1 : f(r);
  }

  console.log("Finished ea_analysis in:", performance.now() - t0, weights, tots);

  return A;
};

/*
 * ea_overlord
 *
 * Connects the entire app, changes states and updates components accordingly.
 *
 * Any communication between the app's components:
 *   - controls
 *   - layers
 *   - map
 *   - datasets
 *   ... etc. should be done via this function.
 *
 * @param "msg" object.
 *
 *   type (required)
 *      init: init the app. doh!
 *      mode: set the entire app between {outputs, inputs} mode
 *      dataset: change params or (de)activate a DS
 *      index: change the currently shown index
 *      preset: change the preset
 *      sort: sort the datasets/layers
 *      refresh: a auxiliary to re-set the mode
 *
 *      Each type might (and will) do different things depending on the current
 *      mode.
 *
 *   target
 *      Is context specific to the type. They are obvious:
 *
 *      init: null
 *      mode: "inputs" or "outputs"
 *      dataset: a DS object
 *      index: "demand", "supply", "eai" or "ani"
 *      preset: "market", "planning", "investment", or "custom"
 *      sort: an array with the ID's of the active datasets
 *      refresh: "inputs" or "outputs"
 *
 *   caller (required)
 *      The name of the function calling ea_overlord. auxiliary for debugging
 *      purposes.
 * }
 *
 * returns nothing
 */

async function ea_overlord(msg) {
  if (!msg) throw "Argument Error: Overlord: I have nothing to do!";
  if (typeof msg.caller === 'undefined' || !msg.caller) throw "Argument Error: Overlord: Who is the caller?";

  const state = ea_state_sync();

  switch (msg.type) {
  case "init": {
    document.body.append(elem('<canvas id="output" style="display: none;">'));

    const ccn3 = location.get_query_param('ccn3');
    let country; await ea_client(`${ea_settings.database}/countries?ccn3=eq.${ccn3}`, 'GET', 1, r => country = r);

    /* TODO: these are the global objects. Fix it: remove. */
    ea_mapbox = null;
    ea_category_tree = country.category_tree;

    const list = await ea_datasets_list_init(country.id, state.inputs, state.preset);

    const b = list.find(d => d.id === 'boundaries');

    if (!b) {
      ea_flash
        .type('error')
        .title("Misconfigured country")
        .message(`
It's missing a boundaries dataset. <b>I'm stoping here.</b>
Please reporty this to energyaccessexplorer@wri.org.
`)();

      throw `Country is missing a boundaries dataset.`;
    }

    else {
      await b.heatmap.parse.call(b);

      document.querySelector('#controls-wrapper')
        .insertBefore(ea_controls(b), document.querySelector('#controls'));
    }

    const inputs = list
          .filter(t => t.active)
          .map(x => x.id)
          .sort((a,b) => (state.inputs.indexOf(a) < state.inputs.indexOf(b)) ? -1 : 1);

    state.set_inputs_param(inputs);

    ea_ui_views_init();

    ea_layers_init();

    ea_controls_country_setup();
    ea_controls_presets_init(state.preset);
    ea_controls_tree(country.category_tree, DS.list);

    ea_ui_layout_map(country.bounds);
    mapbox_setup(country.bounds);

    await Promise.all(inputs.map(id => DS.named(id).turn(true, false)));

    mapbox_change_theme(ea_settings.mapbox_theme);

    ea_ui_app_loading(false);

    break;
  }

  case "mode": {
    let t = msg.target;

    state.set_mode_param(t);

    if (t === "outputs") {
      ea_layers_outputs(state.output);

      state.inputs.forEach(i => {
        let x; if (x = DS.named(i)) x.hide();
      });

      ea_canvas_plot(ea_analysis(state.output));

      ea_mapbox.setLayoutProperty('canvas-layer', 'visibility', 'visible');
    }

    else if (t === "inputs") {
      ea_mapbox.setLayoutProperty('canvas-layer', 'visibility', 'none');

      ea_layers_inputs(state.inputs);

      await Promise.all(state.inputs.map(id => DS.named(id).turn(true, true)));

      ea_layers_sort_inputs(state.inputs);
    }

    else {
      throw `Argument Error: Overlord: Could not set/find the mode '${state.mode}'.`;
    }

    break;
  }

  case "dataset": {
    const ds = msg.target;

    state.set_preset_param(null);

    ds.active ?
      state.inputs.unshift(ds.id) :
      state.inputs.splice(state.inputs.indexOf(ds.id), 1); // REMOVE()

    const inputs = [...new Set(state.inputs)]; // UNIQUE()

    if (state.mode === "outputs") {
      await ds.turn(ds.active, false);

      ea_layers_outputs(state.output);
      ea_canvas_plot(ea_analysis(state.output));
    }

    else if (state.mode === "inputs") {
      await ds.turn(ds.active, true);

      ea_layers_inputs(inputs);
      ds.raise();
    }

    else {
      throw `Argument Error: Overlord: Could not set the mode ${state.mode}`;
    }

    state.set_output_param();
    state.set_inputs_param(inputs);

    break;
  }

  case "index": {
    if (state.mode === "outputs") {
      ea_canvas_plot(ea_analysis(msg.target));
      state.set_output_param(msg.target);
    }

    else {
      throw `Argument Error: Overlord: Could set the mode ${state.mode}`;
    }

    break;
  }

  case "preset": {
    if (!msg.target) throw `Argument error: Overlord: Could not set ${msg.target} preset`;

    const inputs = DS.list.filter(d => ea_controls_presets_set(d, msg.target)).map(d => d.id);

    if (state.mode === "outputs") {
      ea_layers_outputs(state.output);
      await Promise.all(DS.list.map(d => d.turn(d.active, false)));
      ea_canvas_plot(ea_analysis(state.output));
    }

    else if (state.mode === "inputs") {
      await Promise.all(DS.list.map(d => d.turn(d.active, true)));
      ea_layers_inputs(inputs);
    }

    state.set_preset_param(msg.target);
    state.set_inputs_param(inputs);

    break;
  }

  case "sort": {
    if (state.mode === "inputs") {
      ea_layers_sort_inputs(msg.target);
      state.set_inputs_param(msg.target);
    }

    else if (state.mode === "outputs") {
      console.info("Overlord: Sorting in outputs mode has no efect... OK.");
    }

    else {
      throw `Argument Error: Overlord: Could set the mode ${state.mode}`;
    }

    break;
  }

  case "refresh": {
    ea_overlord({
      "type": "mode",
      "target": state.mode,
      "caller": "ea_overlord refresh"
    });

    break;
  }

  default:
    throw `Overlord: I don't know message type '${msg.type}'`
  }

  // 'animate' is set to false on mapbox's configuration, since we don't want
  // mapbox eating the CPU at 60FPS for nothing.
  //
  // TODO: remove this hack. find a better way to redraw the canvas. as of v0.50
  // there doesn't seem to be a good way to do this... mapboxgl should return
  // promises. It doesn't.
  //
  let canvas_source = ea_mapbox.getSource('canvas-source');
  if (canvas_source) {
    canvas_source.play();
    setTimeout(_ => {
      canvas_source.pause();
    }, 1000);
  }

  if (typeof msg.callback === 'function') msg.callback();
};
