/** Request/response streams to and from node http request/responses
 *
 *
 */
var http = require('http')
var util = require('util')
var ChannelStream = require("./stream.class")

var THTP = {
 Request  : {
   //fromHTTP : THTP_Request_fromHTTP,
   toHTTP   : THTP_Request_toHTTP
 },
 Response : {
   //fromHTTP : THTP_Response_fromHTTP,
   //toHTTP   : THTP_Response_toHTTP
 }
}

module.exports = THTP;


util.inherits(THTP_Request_toHTTP, http.IncomingMessage);
//util.inherits(THTP_Response_toHTTP, http.ServerResponse);

function THTP_Request_toHTTP(packet,link, stream){
  // mimic http://nodejs.org/api/http.html#http_http_incomingmessage
  http.IncomingMessage.call(this)
  this.method = packet.json[':method'];
  this.url = packet.json[':path'] || "/";
  this.headers = packet.json;
  this.headers['x-hashname'] = link.hashname; // for any http handler visibility
  this.hashname = link.hashname;


  this.connection = {
    remoteAddress : link.hashname
  }

  this.on = stream.on.bind(stream)
  this.read = stream.read.bind(stream)
  this.pipe = stream.pipe.bind(stream)


}
