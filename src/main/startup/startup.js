'use strict';

const mac = require('../mac/startup');

function runList() {
  return mac.runList();
}

function toggle(item, enable) {
  return mac.toggle(item, enable);
}

module.exports = { runList, toggle };
