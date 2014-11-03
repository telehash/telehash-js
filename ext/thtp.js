var urllib = require('url');
var httplib = require('http');
var streamlib = require('stream');
var lob = require('lob-enc');
var hashname = require('hashname');

// implements https://github.com/telehash/telehash.org/blob/v3/v3/channels/thtp.md
exports.name = 'thtp';

exports.mesh = function(mesh, cbMesh)
{
  var ext = {open:{}};

  ext.link = function(link, cbLink)
  {

    // proxy an existing node http request and send to a result
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
        sdecode.statusCode = parseInt(packet.json[':status'])||500;
        sdecode.reasonPhrase = packet.json[':reason']||'';
        delete packet.json[':status'];
        delete packet.json[':reason'];
        sdecode.headers = packet.json;

        // direct response two ways depending on args
        if(typeof res == 'object')
        {
          res.writeHead(sdecode.statusCode, packet.json);
          sdecode.pipe(res);
        }else if(typeof res == 'function'){
          res(sdecode); // handler must set up stream piping
        }else{
          return cbStream('no result handler');
        }
        cbStream();
      });

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
    
    // create a new request just like http://nodejs.org/api/http.html#http_http_request_options_callback
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

  // accept a request to a url where the hashname is the hostname, calls link.request
  mesh.request = function(req, cbRequest)
  {
    if(typeof req == 'string') req = urllib.parse(req);
    if(!hashname.isHashname(req.hostname)) return cbRequest('invalid hashname',req.hostname);
    return mesh.link(req.hostname).request(req, cbRequest);
  }
  
  // start accepting incoming thtp requests
  mesh.proxy = function(options)
  {
    // provide a url to directly proxy to
    if(typeof options == 'string')
    {
      var proxy = httplib.createServer();
      var to = urllib.parse(options);
      if(to.hostname == '0.0.0.0') to.hostname = '127.0.0.1';
      proxy.on('request', function(req, res){
        var opt = {host:to.hostname,port:to.port,headers:req.headers,method:req.method,path:req.path};
        req.pipe(httplib.request(opt, function(pres){
          pres.pipe(res);
        }));
      });
    }else{
      // local http server given as argument
      var proxy = options;
    }

    // handler for incoming thtp channels
    ext.open.thtp = function(args, open, cbOpen){
      var link = this;
      var channel = link.x.channel(open);
      // pipe the channel into a decoder, then handle it
      var req = mesh.streamize(channel);
      req.pipe(lob.stream(function(packet, cbStream){

        // mimic http://nodejs.org/api/http.html#http_http_incomingmessage
        req.method = packet.json[':method'];
        req.url = packet.json[':path'];
        req.headers = packet.json;
        req.headers['x-hashname'] = link.hashname; // for any http handler visibility

        // now mimic http://nodejs.org/api/http.html#http_class_http_serverresponse
        var res = new streamlib.Transform();
        res.pipe(req); // any output goes back

        // write out the header bytes first
        res.writeHead = function(statusCode, reasonPhrase, headers)
        {
          // don't double!
          if(res.statusCode) return mesh.log.warn('double call to thtp writeHead',(new Error()).stack);
          // be friendly
          if(!headers && typeof reasonPhrase == 'object')
          {
            headers = reasonPhrase;
            reasonPhrase = false;
          }
          res.statusCode = parseInt(statusCode)||500;

          // construct the thtp response
          var json = {};
          json[':status'] = res.statusCode;
          if(reasonPhrase) json[':reason'] = reasonPhrase;
          if(headers) Object.keys(headers).forEach(function(header){
            json[header.toLowerCase()] = headers[header];
          });
          
          // send it
          res.push(lob.encode(json, false));
        }

        // just ensure headers are written before sending data
        res._transform = function(data,enc,cbTransform)
        {
          if(!res.statusCode) res.writeHead(200);
          res.push(data);
        }

        // show the bouncer our fake id
        proxy.emit('request', req, res);
        
        cbStream();
      }));

      channel.receive(open); // actually opens it and handles any body in the stream
      cbOpen();
    }

  }

  cbMesh(undefined, ext);
}