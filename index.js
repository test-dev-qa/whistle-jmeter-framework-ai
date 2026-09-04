// Whistle 插件页 iframe 走 uiServer；默认导出会被当成 pluginServer，不能用来挂 UI。
const websocketCapture = require('./lib/websocketFrameCapture').startWebSocketCapture();

module.exports.uiServer = require('./ui/app');
module.exports.resStatsServer = require('./resStatsServer');
module.exports.wsReqRead = websocketCapture.wsReqRead;
module.exports.wsResRead = websocketCapture.wsResRead;
