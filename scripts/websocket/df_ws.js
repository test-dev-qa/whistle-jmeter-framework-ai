var proto=require('d:\\Documents\\wstest\\proto.js');
var actions = require('d:\\Documents\\wstest\\action_json');
exports.handleWebSocket = async (socket, connect) => {
	// 与服务器建立连接
	const svrSocket = await connect();

	// 获取客户端解析后的帧数据
	socket.on('message', (data, opts) => {
      	rdata=receive_accept_msg(data);
      	console.log("\ud83d\ude80[ data ] -\x3e\u53d1\u9001", rdata);
      	svrSocket.send(data);
	});
	// 获取服务端解析后的帧数据
	svrSocket.on('message', (data, opts) => {
      
      try{
      	rdata=receive_accept_msg(data);
        console.log("\u2604\ufe0f[ data ] -\x3e\u63a5\u6536", rdata);
      }
      catch(e) {
        console.log(e);
        }
		socket.send(data, {binary: true, mask: false});
	});
  // 接收通过whistle.script页面Console的dataSource.emit('toClient', {name: 'toSocketClient'})的数据
    socket.dataSource.on('toClient', (data) => {
       if (typeof data == "object") {
         change_data=data;
       }else if(isJsonString(data)==true){
         change_data=JSON.parse(data);
       }else{
         change_data=actions[data];                
		}
      sdata=send_data(change_data);
      socket.send(sdata,{binary: true, mask: false});
    });
   // 接收通过whistle.script页面Console的dataSource.emit('toServer', {name: 'toSocketClient'})的数据
  	socket.dataSource.on('toServer', (data) => {
        if (typeof data == "object") {
         change_data=data;
       }else if(isJsonString(data)==true){
         change_data=JSON.parse(data);
       }else{
         change_data=actions[data];                
		}
      sdata=send_data(change_data); 
      svrSocket.send(sdata,{binary: true});
    });
};
function receive_accept_msg(data) {
  		a =  new proto.p.baseData.deserializeBinary(data);
        var b = a.getData();
        a = isJsonString(b) ? {
            action: a.getAction(),
            data: JSON.parse(a.getData())
        } : {
            action: a.getAction(),
            data: eval(b)
        };
        a = JSON.stringify(a);
  		return a;
    }

function isJsonString(str) {
        try {
            if (typeof JSON.parse(str) == "object") {
                return true;
            }
        } catch(e) {
        }
        return false;
    }
function send_data(a) {
            console.log("\ud83d\ude80[ data ] -发送数据", a);
            var b = new proto.p.baseData;
            b.setAction(a.action);
            a.data || (a.data = {});
            b.setData(JSON.stringify(a.data));
            b = b.serializeBinary();
  			let c = toBuffer(b);
            return c
    }
function toBuffer(ab) {
	var buf = new Buffer(ab.byteLength);
	var view = new Uint8Array(ab);
	for (var i = 0; i < buf.length; ++i) {
		buf[i] = view[i];
	}
	return buf;
}
