var urllib = require('url');
var httplib = require('http');
var streamlib = require('stream');
var lob = require('lob-enc');
var hashname = require('hashname');
var util = require("util");
var THTP = require('./thtp.class')

// implements https://github.com/telehash/telehash.org/blob/v3/v3/channels/thtp.md
exports.name = 'thtp';

function sanitizeheaders(headers){
  delete headers[":path"]
  delete headers[":method"]
  return headers;
}

exports.mesh = function(mesh, cbMesh)
{
  var ext = {open:{}};

  ext.link = function(link, cbLink)
  {

    /** proxy an existing node http request and response pair to this link over thtp.
     * @memberOf TLink
     * @param {httpIncomingMessage} request - typically generated from node's http server
     * @param {httpResponseObject} response - typically generated from node's http server
     * @return {ChannelStream} proxied response
     */
    link.proxy = function(req, res)
    {
      // create the thtp request json
      var json = {};
      if(typeof req.headers == 'object') Object.keys(req.headers).forEach(function(header){
        json[header.toLowerCase()] = req.headers[header];
      });
      json[':method'] = (req.method || 'GET').toUpperCase();
      // convenience pattern
      if(req.url)
      {
        var url = urllib.parse(req.url);
        json[':path'] = url.path;
      }else{
        json[':path'] = (req.path || '/');
      }
      var packet = lob.encode(json, false);

      // create the channel request
      var open = {json:{type:'thtp'}};
      open.json.seq = 1; // always reliable
      open.body = packet.slice(0,1000); // send as much of the headers as we can
      var channel = link.x.channel(open);

      // create a stream to encode the http->thtp
      var sencode = mesh.streamize(channel);



      // create a stream to decode the thtp->http
      var sdecode = lob.stream(function(packet, cbStream){
        // mimic http://nodejs.org/api/http.html#http_http_incomingmessage
        console.log("sdecode")
        sdecode.statusCode = parseInt(packet.json[':status'])||500;
        sdecode.reasonPhrase = packet.json[':reason']||'';
        delete packet.json[':status'];
        delete packet.json[':reason'];
        sdecode.headers = packet.json;
        //console.log(packet.json)

        // direct response two ways depending on args
        if(typeof res == 'object')
        {
          console.log("sdecode.statusCode", sdecode.statusCode, packet.json)
          res.writeHead(sdecode.statusCode, packet.json);
          sdecode.pipe(res);
          console.log("pipe sdecode->res")
        }else if(typeof res == 'function'){
          res(sdecode); // handler must set up stream piping
        }else{
          return cbStream('no result handler');
        }
        cbStream();
      }).on('error', function(err){
        mesh.log.error('got thtp error',err);
      })


      // any response is decoded
      sencode.pipe(sdecode);



      // finish sending the open
      channel.send(open);

      // if more header data, send it too
      if(packet.length > 1000) sencode.write(packet.slice(1000));

      // auto-pipe in any request body
      if(typeof req.pipe == 'function') req.pipe(sencode);

      return sencode;
    }


    /** create a thtp request just like http://nodejs.org/api/http.html#http_http_request_options_callback
     * @memberOf TLink
     * @param {object} options - see node docs
     * @param {function} callback - see node docs
     * @return {ChannelStream} http style response stream
     */
    link.request = function(options, cbRequest)
    {
      // allow string url as the only arg
      if(typeof options == 'string') options = urllib.parse(options);
      if(!options.method) options.method = 'GET';
      // TODO, handle friendly body/json options like the request module?
      var proxy = link.proxy(options, function(response){
        if(cbRequest) cbRequest(undefined, response);
        cbRequest = false;
      });
      proxy.on('error', function(err){
        if(cbRequest) cbRequest(err);
        cbRequest = false;
      });


      // friendly
      if(options.method.toUpperCase() == 'GET') proxy.end();
      return proxy;
    }

    cbLink();
  }

  /** make a thtp GET request to a url where the hashname is the hostname
   * @memberOf Mesh
   * @param {string} req - url: http://[hashname]/[path]
   * @param {function} callback - see node docs
   * @return {ChannelStream} http style response stream
   */
  mesh.request = function(req, cbRequest)
  {
    if(typeof req == 'string') req = urllib.parse(req);
    if(!hashname.isHashname(req.hostname)) return cbRequest('invalid hashname',req.hostname);
    return mesh.link(req.hostname).request(req, cbRequest);
  }

  var mPaths = {};
  mesh.match = function(path, cbMatch)
  {
    mPaths[path] = cbMatch;
  }

  // start accepting incoming thtp requests
  var proxy = false;
  /** begin accepting incoming thtp requests, either to proxy to a remote http server, or directly into a local server
   * @memberOf Mesh
   * @param {httpServer|string} options - either a httpserver or a url denoting the host and port to proxy to.
   */
  mesh.proxy = function(options)
  {
    // provide a url to directly proxy to
    if(typeof options == 'string')
    {
      proxy = httplib.createServer();
      var to = urllib.parse(options);
      if(to.hostname == '0.0.0.0') to.hostname = '127.0.0.1';
      proxy.on('request', function(req, res){
        var opt = {host:to.hostname,port:to.port,method:req.headers[":method"],path:req.headers[":path"],headers:sanitizeheaders(req.headers)};
        req.pipe(httplib.request(opt, function(pres){
          pres.pipe(res)
        }));
      });
    }else{
      // local http server given as argument
      proxy = options;
    }
    mesh._proxy = proxy;
  }

  // handler for incoming thtp channels
  ext.open.thtp = function(args, open, cbOpen){
    var link = this;
    var channel = link.x.channel(open);
    // pipe the channel into a decoder, then handle it
    var req = mesh.streamize(channel);
    req.pipe(lob.stream(function(packet, cbStream){

      var Req = new THTP.Request.toHTTP(packet, link, req)

      // now mimic http://nodejs.org/api/http.html#http_class_http_serverresponse
      var res = new THTP.Response.fromHTTP(Req, link, req);



      // see if it's an internal path
      var match;
      Object.keys(mPaths).forEach(function(path){
        if(req.url.indexOf(path) != 0) return;
        if(match && match.length > path) return; // prefer longest match
        match = path;
      });

      // internal handler
      if(match) mPaths[match](req, res);

      // otherwise show the bouncer our fake id
      else if(mesh._proxy){
        mesh._proxy.emit('request', Req, res);
      }

      // otherwise error
      else res.writeHead(500,'not supported').end();

      cbStream();
    }));

    channel.receive(open); // actually opens it and handles any body in the stream
    cbOpen();
  }

  cbMesh(undefined, ext);
}
