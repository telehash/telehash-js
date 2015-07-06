/** Request/response streams to and from node http request/responses
 *
 *
 */
var http = require('http')
var util = require('util')
var lob = require("lob-enc")
var ChannelStream = require("./stream.class")
var response = require("express/lib/response.js")

var THTP = {
 Request  : {
   //fromHTTP : THTP_Request_fromHTTP,
   toHTTP   : THTP_Request_toHTTP
 },
 Response : {
   fromHTTP : THTP_Response_fromHTTP,
   //toHTTP   : THTP_Response_toHTTP
 }
}

module.exports = THTP;


util.inherits(THTP_Request_toHTTP, http.IncomingMessage);
util.inherits(THTP_Response_fromHTTP, http.ServerResponse);

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

function THTP_Response_fromHTTP(req, link, stream){
  // mimic http://nodejs.org/api/http.html#http_http_incomingmessage
  http.ServerResponse.call(this, req)
  this.connection = {
    remoteAddress : link.hashname,
    _httpMessage : this
  }

  var head = false
  //this.on = stream.on.bind(stream)
  this._writeRaw = stream._write.bind(stream);
  this._write = stream._write.bind(stream)
  this.on('pipe',function(from){
    from.on('end',function(body, a2, a3){
      stream.end()
    })
  })

  this.on('finish',function(end){
    console.log("res finishe")
    stream.end()
  })



  this.writeHead = function(statusCode, reasonPhrase, headers)
  {
    // don't double!
    if(head){
      //console.log('double call to thtp writeHead',this.statusCode,(new Error()).stack)
      return this;
    };

    head = true;
    // be friendly
    if(!headers && typeof reasonPhrase == 'object')
    {
      console.log("head")
      headers = reasonPhrase;
      reasonPhrase = false;
    } else if (!headers ){
      //console.log("headers", this)
      headers = this._headers
    }
    this.statusCode = parseInt(statusCode) || 500
    //console.log(this.statusCode)
    // construct the thtp response
    var json = {};
    json[':status'] = this.statusCode;
    if(reasonPhrase) json[':reason'] = reasonPhrase;
    if(headers) Object.keys(headers).forEach(function(header){
      console.log("header["+header+"] : " + headers[header]  )
      json[header.toLowerCase()] = headers[header];
    });

    stream.write(lob.encode(json, false));
    return this;
  }
}
