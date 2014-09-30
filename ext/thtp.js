var urllib = require('url');
var httplib = require('http');

exports.name = 'thtp';

exports.mesh = function(mesh, cbMesh)
{
  var tp = {};

  // TODO use mesh.streamize

  tp.link = function(link, cbLink)
  {
    link.request = function(req, res)
    {
      // is req a string, parse as url
      // is res a function, use as callback
      // set up pipes
    }
    cbLink();
  }

  // accept a request to a url where the hashname is the hostname, calls link.request
  mesh.request = function(req, res)
  {
    // is req a string, or req.hostname is hashname, or req.url
    // get the link, then link.request(options, cbRequest)
  }
  
  // start accepting incoming thtp requests
  mesh.proxy = function(options)
  {
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
      // server given as argument
      var proxy = options;
    }

    // handler for incoming thtp channels
    ext.open.thtp = function(args, open, cbOpen){
      var link = this;
      // TODO, create channel and receive until we have a request
      // add header id'ing requesting hashname
      // create a res stream
      // run proxy.request(req, res);
    }

  }

  cbMesh(undefined, tp);

  /*
  self.thtp.request = function(args, cbRequest)
  {
    if(!cbRequest) cbRequest = function(){};
    if(typeof args == "string") args = {uri:args}; // convenience
    if(typeof args != "object" || !(args.uri || args.url || args.hashname)) return errored("invalid args",cbRequest);

    if(args.hashname) args.uri = "thtp://"+args.hashname+args.path;
    var uri = self.uriparse(args.uri||args.url);

    if(uri.protocol != "thtp:") return errored("invalid protocol "+uri.protocol,cbRequest);
    if(uri.hostname == self.hashname) return errored("can't request self",cbRequest);
    var to;
    if(!(to = self.whois(uri.hostname))) return errored("invalid hashname",cbRequest);

    var js = {};
    if(typeof args.headers == "object") Object.keys(args.headers).forEach(function(header){
      js[header.toLowerCase()] = args.headers[header].toString();
    });
    if(args.body) js["content-length"] = args.body.length.toString();
    js.method = args.method || "get";
    js.path = uri.path;

    var body = self.pencode(js,args.body);
    js = {};

    // single-shot requests
    if(body.length <= 1000) js.end = true;

    var pin = new Buffer(0);
//    console.log("REQ",js,body);
    var pipe = streamer(to.start("thtp",{bare:true,js:js,body:body.slice(0,1000)},function(err,packet,chan,cbChan){
      cbChan(true);
//      console.log("PACKET",packet.js,packet.body.length)
      if(pipe.headers)
      {
        pipe.push(packet.body);
        if(err) pipe.emit("end");
        return;
      }

      if(packet.body) pin = Buffer.concat([pin,packet.body]);
      var http;
      if(!(http = self.pdecode(pin)))
      {
        // no packet (yet)
        if(err) cbRequest(500,pipe);
        return;
      }

      pipe.status = parseInt(http.js.status) || 500;
      pipe.headers = http.js;
      cbRequest(pipe.status >= 300?pipe.status.toString():false,pipe); // flag error for status too
      if(http.body) pipe.push(http.body);
      if(err) pipe.emit("end");
    }));

    // any remainder
    if(body.length > 1000) pipe.end(body.slice(1000));

    return pipe;
  }

  self.thtp.listen = function(cbListen)
  {
    self.rels["thtp"] = function(err, packet, chan, cbStart)
    {

      var pipe;
      var pin = new Buffer(0);
      chan.callback = function(err, packet, chan, cbChan)
      {
        cbChan(true);
        // just streaming the body
        if(pipe)
        {
          if(packet.body) pipe.push(packet.body);
          if(err) pipe.emit("end");
          return;          
        }
        
        // if parsing the request yet
        pin = Buffer.concat([pin,packet.body]);
        if(!(http = self.pdecode(pin)))
        {
          if(err) chan.end();
          return;
        }

//        console.log("REQ",http,http.js);
        // new thtp request
        if(typeof http.js.method != "string" || typeof http.js.path != "string") return chan.err("invalid");

        pipe = streamer(chan);
        pipe.method = http.js.method;
        pipe.path = http.js.path;
        delete http.js.method;
        delete http.js.path;
        pipe.headers = http.js;
        cbListen(pipe,function(args){
          if(!args) args = {};
          if(args.err) return errored(err,chan.err);

          var js = {}
          if(typeof args.headers == "object") Object.keys(args.headers).forEach(function(header){
            js[header.toLowerCase()] = args.headers[header].toString();
          });
          js.status = args.status || 200;
          if(args.json) args.body = JSON.stringify(args.json);
          if(args.body) js["content-length"] = args.body.length.toString();
          var phttp = self.pencode(js,args.body);

          var js = {};
          if(args.body && phttp.length <= 1000) js.end = true;
          chan.send({js:js,body:phttp.slice(0,1000)});
          if(phttp.length >1000) pipe.write(phttp.slice(1000));
          return pipe;
        });
        if(http.body) pipe.push(http.body);
        if(err) pipe.emit("end");
      }
      chan.callback(err,packet,chan,cbStart);
    }
  }
  
  var mPaths = {};
  self.thtp.match = function(uri, cbMatch)
  {
    var path = self.uriparse(uri).pathname;
    mPaths[path] = cbMatch;
    if(Object.keys(mPaths).length > 1) return;
    self.thtp.listen(function(req,cbRes){
      var match;
      Object.keys(mPaths).forEach(function(path){
        if(req.path.indexOf(path) != 0) return;
        if(match && match.length > path) return; // prefer longest match
        match = path;
      })
//      console.log("CHECKING",req.path,match);
      if(match) return mPaths[match](req,cbRes);
      cbRes({status:404,body:"not found"});
    });
  }
  
  // this is super simplistic, it'll need a lot of edge case fixes
  self.thtp.proxy = function(args)
  {
    if(args.address == "0.0.0.0") args.address = "127.0.0.1";
    self.thtp.listen(function(req,cbRes){
      var opt = {host:args.address,port:args.port,headers:req.headers,method:req.method,path:req.path};
      req.pipe(httplib.request(opt, function(res){
        res.pipe(cbRes({status:res.statusCode,headers:res.headers}));
      }));
    });
  }
  */

}

// convenience wrapper
function errored(err, cb)
{
  cb(err);
  var pipe = stream.Readable();
  pipe._read = function(){}; // TODO
  pipe.emit("end");
  return pipe;
}

function streamer(chan)
{
  var pipe = stream.Duplex();
  pipe._read = function(){}; // TODO
  pipe.on("finish",function(){
    chan.send({js:{end:true}});
  });
  pipe._write = function(data,enc,cbWrite)
  {
    // chunk it
    while(data.length)
    {
      var chunk = data.slice(0,1000);
      data = data.slice(1000);
      var packet = {js:{},body:chunk};
      // last packet gets confirmed/flag
      if(!data.length)
      {
        packet.callback = cbWrite;
        if(pipe.ended) packet.js.end = true;
      }
      chan.send(packet);
    }
  }
  pipe.end = function(data)
  {
    pipe.ended = true;
    if(!data) data = new Buffer(0);
    pipe.write(data);
  }
  return pipe;
}