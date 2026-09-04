const path = require('path');

const DATA_DIR = process.env.JMETER_EXPORTER_DATA_DIR
  || path.join(__dirname, '..', 'data');

module.exports = {
  DATA_DIR
};
