'use strict';

// Load the polling unit registry produced by Polling-Units/scraper.js.
// Each per-state JSON is shaped:
//   { state: {code, name}, lgas: [ { code, name, wards: [ { code, name, polling_units: [...] } ] } ] }

const fs = require('fs');
const path = require('path');

const config = require('../config');

function* walkPollingUnits({ stateFilter = null } = {}) {
  if (!fs.existsSync(config.geoRegistryDir)) {
    throw new Error(
      `geo registry not found at ${config.geoRegistryDir} - run Polling-Units/scraper.js first`
    );
  }
  const files = fs
    .readdirSync(config.geoRegistryDir)
    .filter((f) => f.endsWith('.json') && f !== 'summary.json' && f !== 'all-polling-units.json');

  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(path.join(config.geoRegistryDir, file), 'utf-8'));
    const state = payload.state || { code: file.replace('.json', '').toUpperCase() };
    if (stateFilter && state.code !== stateFilter && state.name !== stateFilter) continue;

    for (const lga of payload.lgas || []) {
      for (const ward of lga.wards || []) {
        for (const pu of ward.polling_units || ward.pollingUnits || []) {
          yield {
            state_code: state.code,
            state_name: state.name,
            lga_code: lga.code,
            ward_code: ward.code,
            pu_code: pu.code,
            pu_name: pu.name,
            lat: pu.lat ?? null,
            lng: pu.lng ?? null,
          };
        }
      }
    }
  }
}

function countPollingUnits({ stateFilter = null } = {}) {
  let n = 0;
  // eslint-disable-next-line no-unused-vars
  for (const _ of walkPollingUnits({ stateFilter })) n += 1;
  return n;
}

module.exports = { walkPollingUnits, countPollingUnits };
