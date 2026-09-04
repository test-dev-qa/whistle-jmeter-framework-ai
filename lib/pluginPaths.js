'use strict';

const PLUGIN_WEB_ROOT = '/plugin.' + require('../package.json').name.replace(/^whistle\./, '') + '/';

module.exports = {
  PLUGIN_WEB_ROOT
};
