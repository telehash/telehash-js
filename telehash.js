var dgram = require("dgram");
var os = require("os");
var net = require("net");
var http = require("http");
var async = require("async");
var crypto = require("crypto");
var dns = require("dns");
var ursa = require("ursa"); // only need this to do the rsa encryption, not supported in crypto.*
var dhash = require("./dhash");

var REQUEST_TIMEOUT = 5 * 1000; // default timeout for any request
var warn = console.log; // switch to function(){} to disable
var debug = console.log; //function(){}; // switch to console.log to enable
var MESH_MAX = 200; // how many peers to maintain at most

var PEM_REGEX = /^(-----BEGIN (.*) KEY-----\r?\n[\/+=a-zA-Z0-9\r\n]*\r?\n-----END \2 KEY-----\r?\n)/m;

exports.hash = function(string)
{
  return new dhash.Hash(string);
}

// start a hashname listening and ready to go
exports.hashname = function(space, keys, args)
{
  if(!space || !keys || !keys.public || !keys.private) return undefined;
  if(!args) args = {};

  // configure defaults
  var self = {space:space, cb:{}, operators:[], watch:{}, lines:{}, lineq:[], seen:{}, buckets:[]};
  // parse/validate the private key
  self.prikey = keys.private;
  self.pubkey = keys.public;
  self.hash = new dhash.Hash(self.pubkey+space);
  self.hashname = self.hash.toString();
  if (!args.ip || args.natted) self.nat = true;
  self.ip = args.ip || "0.0.0.0";
  self.port = parseInt(args.port) || 0;

  // udp socket
  var counter = 1;
  self.server = dgram.createSocket("udp4", function(msg, rinfo){
    var packet = decode(msg);
    if(!packet) return warn("failed to decode a packet from", rinfo.address, rinfo.port, msg.toString());
    packet.from = {ip:rinfo.address, port:rinfo.port};
    packet.id = counter++;
    packet.at = Date.now();
    incoming(self, packet);
  });
  self.server.bind(self.port, self.ip, function(){
    // update address after listen completed to be besty
    self.port = self.server.address().port;
    self.address = [self.hashname, self.ip, self.port].join(",");
  });

  // try to set the correct address for logging, not important for telehash
  if(self.ip == "0.0.0.0") {
    var better;
    var ifaces = os.networkInterfaces()
    for (var dev in ifaces) {
      ifaces[dev].forEach(function(details){
        if(!better && details.family == "IPv4" && dev.substr(0,1) == "e") better = details.address;
      });
    }
    if(better) self.ip = better;
  }
  self.address = [self.hashname, self.ip, self.port].join(",");
  
  // try to resolve any dns-defined operators for this space
  dns.resolveSrv("_telehash._udp."+self.space, function(err, srvs){
    // if we didn't resolve anything, sometimes that's worth warning about
    if(err){
      if(!self.operator && self.operators.length === 0) warn("no operators found, couldn't resolve space", self.space, err.toString());
      return;
    }
    srvs.forEach(function(srv){
      var hashname = srv.name.split(".")[0];
      if(!dhash.isSHA1(hashname)) return warn("invalid operator address, not a hashname", srv);
      dns.resolve4(srv.name, function(err, ips){
        if(err) return warn("couldn't resolve operator", srv.name);
        ips.forEach(function(ip){
          var address = [hashname, ip, srv.port].join(",");
          seen(self, address).operator = true;
          debug("adding srv operator", address);
          self.operators.push(address);
        });
      });
    })
  });

  // set up methods (personal prefernce to do this explicitly vs. prototype pattern)
  self.myLookup = function(callback) {
    self.cb.lookup = callback;
    self.operator = true;
  };
  self.setOpen = function() {
    self.operator = true;
    self.open = true;
  };
  self.setOperators = function(addresses) {
    if(!Array.isArray(addresses)) return;
    self.operators = addresses.map(function(address){
      var op = seen(self, address);
      op.operator = true;
      return op.hashname;
    });
  };
  self.doVerify = function(hn, callback) { doVerify(self, hn, callback) };
  self.doLine = function(hn, callback) { doLine(self, hn, callback) };
  self.doStream = function(hn, callback) { return doStream(self, hn, callback) };
  self.doSocket = function(args, callback) { return doSocket(self, args, callback) };
  self.setProxy = function(args) {
    self.proxyBase = args;
  };
  self.doProxy = function(args, callback) { return doProxy(self, args, callback) };
  self.doProxyStream = function(args, callback) { return doProxyStream(self, args, callback) };

  self.setSeeds = function(addresses) {
    // set ourselves in DHT mode
    // line to the operators
    // have a 55sec timer to scan all lines
      // make bucket list
      // .see for closer to us for set amount in each bucket
    // have .see watcher for any new lines in empty buckets
  }

  // start the DHT meshing maintainence
  meshLoop(self);

  return self;
}

// every 25 seconds do the maintenance work for peers
function meshLoop(self)
{
  debug("MESHA")
  meshReap(self);
  meshSeen(self);
  meshElect(self);
  meshPing(self);
  debug("MESHZ")
  setTimeout(function(){meshLoop(self)}, 25*1000);
}

// delete any dead hashnames!
function meshReap(self)
{
  function del(who, why)
  {
    if(who.line) delete self.lines[who.line];
    delete self.seen[who.hashname];
    debug("reaping ", who.hashname, why);
  }
  Object.keys(self.seen).forEach(function(h){
    var hn = self.seen[h];
    if(!hn.sentAt) return; // TODO never if these are from app? remove old ones from .see hints?
    if(!hn.recvAt) {
      if(Date.now() - hn.at > 120*1000) return del(hn, "sent, never received, older than 2min");
      return; // allow non-response for up to 2min
    }
    if(Date.now() - hn.sentAt > 60*1000) return del(hn, "we stopped sending to them for more than 1min");
    if(hn.sentAt - hn.recvAt > 60*1000) return del(hn, "no response in 30sec");
  });
}

// look for any newly seen hashnames to request a line to
function meshSeen(self)
{
  // scan the nearest 100
  var nearest;
  Object.keys(self.seen).map(function(h){return self.seen[h]}).sort(function(a, b){
    return self.hash.distanceTo(a.hash) - self.hash.distanceTo(b.hash);
  }).slice(0,100).forEach(function(hn){
    if(!nearest) nearest = hn;
    if(hn.open) return; // line is open or already tried opening a line to them at least once
    // try sending them a line request, no line == !hn.forApp
    doLine(self, hn);
  });
  self.nearest = nearest;
}

// drop hn into it's appropriate bucket
function bucketize(self, hn)
{
  if(!hn.bucket) hn.bucket = self.hash.distanceTo(hn.hash);
  if(!self.buckets[hn.bucket]) self.buckets[hn.bucket] = [];
  self.buckets[hn.bucket].push(hn);
}

// update which lines are elected to keep, rebuild self.buckets array
function meshElect(self)
{
  // sort all lines into their bucket, rebuild buckets from scratch (some may be GC'd)
  self.buckets = []; // sparse array, one for each distance 0...159
  Object.keys(self.lines).forEach(function(line){
    bucketize(self, self.lines[line])
  });
  var spread = parseInt(MESH_MAX / Object.keys(self.buckets).length);
  if(!(spread > 1)) spread = 1;

  // each bucket only gets so many lines elected
  Object.keys(self.buckets).forEach(function(bucket){
    var elected = 0;
    self.buckets[bucket].forEach(function(hn){
      // TODO can use other health quality metrics to elect better/smarter ones
      hn.elected = (elected++ <= spread) ? true : false;
    });
  });
}

// every line that needs to be maintained, ping them
function meshPing(self)
{
  Object.keys(self.lines).forEach(function(line){
    var hn = self.lines[line];
    // have to be elected or a line induced by the app
    if(!hn.elected && !hn.forApp) return;
    // approx no more than once a minute
    if(Date.now() - hn.sentAt < 45*1000) return;
    // seek ourself to discover any new hashnames closer to us for the buckets
    send(self, hn, {js:{seek:self.hashname, see:nearby(self, hn.hashname)}});
  });
}

// ask hashname to answer an http request
function doProxy(self, args, callback)
{
  if(!args || !args.path ||!args.hashname) return callback("no path or hashname");
  self.doLine(args.hashname, function(err){
    if(err) return callback("line failed");

    // create stream and handle responses
    var res = {};
    var body = new Buffer(0);
    var stream = doStream(self, args.hashname, function(err, packet, cbStream){
      if(packet.body) body = Buffer.concat([body, packet.body]);
      if(packet.js.res)
      {
        res.statusCode = packet.js.res.s || 500;
        res.headers = packet.js.res.h || {};
      }
      if(packet.js.end) callback(null, res, body);
      cbStream();
    });
    
    // send request, TODO support a streaming interface
    var js = {end:true, req:{}};
    js.req.p = args.path;
    js.req.m = args.method || "GET";
    if(args.headers) js.req.h = args.headers;
    stream.send(js, args.body);
  });
}

// ask hashname to answer an http request, streamingly
function doProxyStream(self, args, callback)
{
  if(!args || !args.path ||!args.hashname) return callback("no path or hashname");
  // create stream and a req json
  var stream = getStream(self, seen(self, args.hashname));
  var js = {req:{}};
  js.req.p = args.path;
  js.req.m = args.method || "GET";
  if(args.headers) js.req.h = args.headers;

  // give back node streaming interface
  var x = wrapStream(self, stream, function(packet){
    // when the headers show up pass them along
    if(packet.js.res)
    {
      var res = {};
      res.statusCode = packet.js.res.s || 500;
      res.headers = packet.js.res.h || {};
      callback(res);
    }
  });
  x.js(js); // send headers
  return x;
}

// ask hashname to open a socket to this ip:port
function doSocket(self, args, callback)
{
  if(!args || !args.hashname) return callback("no hashname");
  if(!args.to || !args.listen) return callback("need to and listen");
  self.doLine(args.hashname, function(err){
    if(err) return callback("line failed");
    var server = net.createServer(function(client) {
      console.log('server connected');
      var stream = getStream(self, seen(self, args.hashname));
      var tunnel = wrapStream(self, stream);
      client.pipe(tunnel).pipe(client);
      // send sock open now
      stream.send({sock:args.to});
    });
    server.listen(args.listen, callback);
  });
}

// creates a new stream to the given hashname
function doStream(self, hashname, callback)
{
  var stream = getStream(self, seen(self, hashname));
  stream.handler = function(self, packet, cbHandler) { callback(null, packet, cbHandler); }
  return stream;
}

// use node's stream api wrapper
function wrapStream(self, stream, cbExtra)
{
  var duplex = new require("stream").Duplex();

  // allow for manually injected json
  duplex.bufJS = {};
  duplex.js = function(js){
    Object.keys(js).forEach(function(key){ duplex.bufJS[key] = js[key]; });
    setTimeout(doChunk, 10);
  };
  
  // buffer writes and chunk them out
  duplex.bufBody = new Buffer(0);
  duplex.cbWrite;

  function doChunk(){
    console.log("CHUNKING", duplex.bufJS, duplex.bufBody.length)
    if(duplex.bufBody.length === 0 && Object.keys(duplex.bufJS).length === 0) return;      
    var bodyout;
    var jsout = duplex.bufJS;
    duplex.bufJS = {};
    if(duplex.bufBody.length > 0)
    {
      var len = 1024 - JSON.stringify(jsout).length; // max body size for a packet
      if(duplex.bufBody.length < len) len = duplex.bufBody.length;
      bodyout = duplex.bufBody.slice(0, len);
      duplex.bufBody = duplex.bufBody.slice(len, duplex.bufBody.length - len);
    }
    // send it!
    sendStream(self, stream, {js:jsout, body:bodyout, done:function(){
      // we might be backed up, let more in
      if(duplex.cbWrite)
      {
        // am I being paranoid that a cbWrite() could have set another duplex.cbWrite?
        var cb = duplex.cbWrite;
        delete duplex.cbWrite;
        cb();
      }
    }});
    // recurse nicely
    setTimeout(doChunk, 10);
    
  };

  duplex.end = function(){
    duplex.bufJS.end = true;
    if(stream.errMsg) duplex.bufJS.err = stream.errMsg;
    doChunk();
  }

  duplex._write = function(buf, enc, cbWrite){
    duplex.bufBody = Buffer.concat([duplex.bufBody, buf]);

    // if there's 50 packets waiting to be confirmed, hold up here, otherwise buffer up
    var cbPacket = doChunk;
    if(stream.outq.length > 50)
    {
      duplex.cbWrite = cbWrite;
    }else{
      cbWrite();
    }
    
    // try sending a chunk;
    doChunk();
  }  
  
  duplex._read = function(size){
    // TODO handle backpressure
    // perform duplex.push(body)'s if any waiting, if not .push('')
    // handle return value logic properly
  };

  stream.handler = function(self, packet, cbHandler) {
    // TODO migrate to _read backpressure stuff above
    console.log("HANDLER", packet.js)
    if(cbExtra) cbExtra(packet);
    if(packet.body) duplex.push(packet.body);
    if(packet.js.end) duplex.push(null);
    cbHandler();
  }
  return duplex;  
}

function getStream(self, to, id)
{
  if(!to.streams) to.streams = {};
  if(id && to.streams[id]) return to.streams[id];

  // new stream
  var stream = {inq:[], outq:[], inSeq:0, outSeq:0, inDone:-1, outConfirmed:0, inDups:0, lastAck:-1}
  stream.id = id || dhash.quick();
  stream.to = to;
  // how we process things in order
  stream.q = async.queue(function(packet, cbQ){
    inStreamSeries(self, stream, packet, cbQ);
  }, 1);

  // handy utils, send just one anytime explicitly
  stream.send = function(js, body){ sendStream(self, stream, {js:js, body:body}) };

  to.streams[stream.id] = stream;
  return stream;
}

function sendStream(self, stream, packet)
{
  packet.js.stream = stream.id;
  packet.js.seq = stream.outSeq++;
  packet.js.ack = stream.inSeq;

  // calculate misses;
  if(stream.inq.length > 0)
  {
    packet.js.miss = [];
    for(var i = 0; i < stream.inq.length; i++)
    {
      if(!stream.inq[i]) packet.js.miss.push(stream.inDone + 1 + i);
    }
  }
  
  // reset/update tracking stats
  stream.outConfirmed = stream.inSeq;
  stream.inDups = 0;
  stream.outq.push(packet);
  
  // any ack timer gets cancelled
  if(stream.ackTimeout)
  {
    clearTimeout(stream.ackTimeout);
    stream.ackTimeout = false;
  }

  send(self, stream.to, packet);
}

function sendWho(self, to, who, callback, timeout)
{
  var watch = keywatch(self, "who "+who+to.hashname, callback, timeout);
  if(watch.callbacks.length > 1) return; // someone sent one here already

  var packet = {js:{who:who}};
  packet.sign = true;
  send(self, to, packet);
}

// *actively* verify this hashname with an operator
function doVerify(self, hashname, callback)
{
  // this will add the callback to any outstanding verify requests
  var watch = keywatch(self, "verify "+hashname, callback, 10*1000);
  if(watch.callbacks.length > 1) return;

  // ask operators sequentially in random order
  var key;
  async.forEachSeries(self.operators.sort(function(){ return Math.random()-0.5; }), function(op, cbOp){
    var op = seen(self, op);
    sendWho(self, op, hashname, function(err, value){
      if(value) key = value;
      cbOp(value); // stops async when we get a value
    }, 3*1000); // smaller timeout, ops should be fast
  }, function(){
    if(!key) return watch.done("not verified");
    watch.done(null, key);
  });
}

// async fetch the key however possible
function getKey(self, hashname, callback)
{
  // moi?
  if(self.hashname === hashname) return callback(null, self.pubkey);
  
  // already known
  var who = seen(self, hashname);
  if(who.pubkey) return callback(null, who.pubkey);

  // multiple things may be wanting the key, create a watch
  var watch = keywatch(self, "getkey "+hashname, callback, 10*1000);
  if(watch.callbacks.length > 1) return;

  // if we're open and we know an ip for this hashname, just ask them!
  if(self.open && who.ip) return sendWho(self, who, hashname, watch.done);

  // if we have a lookup function, use that
  if(self.cb.lookup) return self.cb.lookup(hashname, watch.done);
  
  // resort to asking the operator
  doVerify(self, hashname, watch.done);
}

// scan through the queue of packets with an unknown line, and optionally add one
function queueLine(self, packet)
{
  if(packet) {
    if(Object.keys(packet.js).join("") === "line") return; // empty packet
    self.lineq.push(packet);
  }
  if(self.lineq.length == 0) return;
  debug("scanning line queue of length", self.lineq.length);
  var q = self.lineq;
  self.lineq = [];
  q.forEach(function(queued){
    if(self.lines[queued.js.line]) return incoming(self, queued);
    if(Date.now() - queued.at < 10*1000) return self.lineq.push(queued);
    warn("dropping expired unknown line packet from", queued.from);
  });
}

function addOpen(self, to)
{
  if(!to.pubkey) throw new Error("missing pub key! "+to.hashname);
  to.openSecret = dhash.quick(); // gen random secret
  to.open = ursa.coercePublicKey(to.pubkey).encrypt(to.openSecret, "utf8", "base64", ursa.RSA_PKCS1_PADDING);
}

// add the proper line or open+signature
function addLine(self, to, packet)
{
  // if we've sent an open and have a line, just use that
  if(to.openSent && to.line) return packet.js.line = to.line;

  // make sure to send a signed open
  to.openSent = true;
  if(!to.open) addOpen(self, to);
  packet.js.open = to.open;
  packet.sign = true;
}

// ask open lines for an address
function seek(self, hash)
{
  // take a random max of three lines and ask them all (TODO use the DHT distance stuff)
  var ask = Object.keys(self.lines).sort(function(){ return Math.random()-0.5; }).slice(0,3);

  // ask them all
  ask.forEach(function(line){
    send(self, self.lines[line], {js:{seek:hash}});
  });
}

// open a line to this hashname, may need to see and who it both
function doLine(self, hashname, callback)
{
  var to = seen(self, hashname);

  // this only happens when opening a transient line (meshing)
  if(!callback)
  {
    callback = function(){};
  }else{
    to.forApp = true;
  }

  // might have it already
  if(to.line) return callback();

  function good(){
    if(to.line) return callback();

    getKey(self, to.hashname, function(err, key){
      if(err) return callback();
      if(!to.pubkey) to.pubkey = key;
      if(to.line) return callback();

      // only callback when they've responded
      keywatch(self, "line "+to.hashname, callback);

      // this is a ping to trigger a response
      var packet = {js:{seek:to.hashname}};
      addLine(self, to, packet);
      send(self, to, packet);
    });
  }

  // any we already have an ip
  if(to.ip) return good();

  // we don't know this hn, seek it and watch for an answer
  keywatch(self, "see "+to.hashname, function(err, address){
    if(err) return callback(err);
    parseAddress(address, to); // updates to this ip/port
    good();
  });
  seek(self, to.hashname);
}

function keywatch(self, key, callback, tout)
{
  var watch = self.watch[key];

  // if a watch is running, just add this to the callback list
  if(watch) {
    watch.callbacks.push(callback);
    return watch;
  }

  // start a new watch
  var timeout = setTimeout(function(){done("timeout")}, tout || REQUEST_TIMEOUT);
  function done(err, value)
  {
    if(!timeout) return; // re-entered by accident if answer came after timeout
    clearTimeout(timeout);
    timeout = false;
    delete self.watch[key];
    watch.callbacks.forEach(function(cb){ cb(err, value); });
  }

  var watch = self.watch[key] = {done:done, callbacks:[], parts:[]};
  watch.callbacks.push(callback);
  return watch;
}

// create a wire writeable buffer from a packet
function encode(self, to, packet)
{
  // signed packets are special, everything else gets common things added
  if(!packet.js.sig)
  {
    // if we need a line and it's not added, add it, convenience
    if(to.line || to.opened) addLine(self, to, packet);

    // if there's no line, always add extra identifiers
    if(!packet.js.line) {
      if(to.ref) packet.js.ref = to.ref.hashname;
      packet.js.to = to.hashname;
      packet.js.from = self.hashname;
      if(packet.sign) packet.js.x = Date.now() + 10*1000; // add timeout for signed packets
    }    
  }
  
  debug("ENCODING", packet.js, packet.body && packet.body.toString(), "\n");

  var jsbuf = new Buffer(JSON.stringify(packet.js), "utf8");
  if(typeof packet.body === "string") packet.body = new Buffer(packet.body, "utf8");
  packet.body = packet.body || new Buffer(0);
  var len = new Buffer(2);
  len.writeInt16BE(jsbuf.length, 0);
  return Buffer.concat([len, jsbuf, packet.body]);
}

// just parse the "60518c1c11dc0452be71a7118a43ab68e3451b82,172.16.42.34,65148" format
function parseAddress(str, hn)
{
  if(typeof str !== "string")
  {
    warn("invalid address", str);
    return {};
  }
  var parts = str.split(",");
  if(!dhash.isSHA1(parts[0]))
  {
    warn("invalid address hashname part", str);
    return {};
  }
  var ret = hn || {}; // update existing or create new
  ret.hashname = parts[0];
  ret.ip = parts[1];
  ret.port = parseInt(parts[2]);
  ret.address = str;
  ret.hash = new dhash.Hash(null, parts[0]);
  return ret;
}

function updateAddress(hn, ip, port)
{
  hn.ip = ip;
  hn.port = port;
  hn.address = [hn.hashname, hn.ip, hn.port].join(",");
}

// track every hashname we know about
function seen(self, to)
{
  if(typeof to === "string") to = parseAddress(to);
  if(typeof to !== "object" || !to.hashname) return {}; // could be bad data, empty object allows for .X checks
  if(to.hashname === self.hashname) return self; // so we can check === self
  var ret = self.seen[to.hashname];
  if(!ret) {
    ret = self.seen[to.hashname] = to;
    ret.at = Date.now();
    bucketize(self, ret);
  }else if(!ret.ip){
    // add ip/port if not set
    ret.ip = to.ip;
    ret.port = to.port;
  }
  return ret;
}

// wiring wrapper, to may be ephemeral (just ip+port, or usually a hashname object)
function send(self, to, packet)
{
  if(!to.ip || !(to.port > 0)) return warn("invalid address", to);

  var buf = encode(self, to, packet);

  // if this packet is to be signed, wrap it and do that
  if(packet.sign && !packet.js.line)
  {
    var signed = {js:{}};
    signed.body = buf;
    signed.js.sig = crypto.createSign("RSA-MD5").update(buf).sign(self.prikey, "base64");
    buf = encode(self, to, signed);
    packet = signed;
  }

  if(to.cipher)
  {
    var enc = {js:{}};
    enc.js.line = packet.js.line;
    enc.js.cipher = true;
    var aes = crypto.createCipher("AES-128-CBC", to.openedSecret);
    enc.body = Buffer.concat([aes.update(buf), aes.final()]);
    buf = encode(self, to, enc);
    packet = enc;
  }

  // track some stats
  to.sent ? to.sent++ : to.sent = 1;
  to.sentAt = Date.now();

  // if there's a hashname, this is the best place to handle clearing the pop'd state on any send
  if(to.hashname && to.popping) delete to.popping;

  // special, first packet + nat + via'd, send a pop too
  if(to.via && to.sent === 1 && self.nat)
  {
    to.popping = packet; // cache first packet for possible resend
    send(self, to.via, {js:{pop:[[to.hashname,to.ip,to.port].join(",")]}});
  }

  self.server.send(buf, 0, buf.length, to.port, to.ip);
}

// decode a packet from a buffer
function decode(buf)
{
  // read and validate the json length
  var len = buf.readUInt16BE(0);
  if(len == 0 || len > (buf.length - 2)) return undefined;

  // parse out the json
  var packet = {};
  try {
      packet.js = JSON.parse(buf.toString("utf8",2,len+2));
  } catch(E) {
    return undefined;
  }

  // if any body, attach it as a buffer
  if(buf.length > (len + 2)) packet.body = buf.slice(len + 2);
  
  return packet;
}

// figure out what this packet is and have some fun
function incoming(self, packet)
{
  debug("INCOMING", self.hashname, packet.id, "packet from", packet.from.address, packet.js, packet.body && packet.body.toString());

  // signed packets must be processed and verified straight away
  if(packet.js.sig) inSig(self, packet);

  // make sure any to is us (for multihosting)
  if(packet.js.to)
  {
    if(packet.js.to !== self.hashname) return warn("packet for", packet.js.to, "is not us");
    delete packet.js.to;
  }

  // copy back their sender name if we don't have one yet for the "to" on answers
  if(!packet.from.hashname && dhash.isSHA1(packet.js.from)) packet.from.hashname = packet.js.from;

  // these are only valid when requested, no trust needed
  if(packet.js.popped) inPopped(self, packet);

  // new line creation
  if(packet.js.open) inOpen(self, packet);

  // incoming lines can happen out of order or before their open is verified, queue them
  if(packet.js.line)
  {
    // a matching line is required
    packet.line = packet.from = self.lines[packet.js.line];
    if(!packet.line) return queueLine(self, packet);
    packet.line.recvAt = Date.now();
    delete packet.js.line;
  }
  
  // must decrypt and start over
  if(packet.line && packet.js.cipher)
  {
    debug("deciphering!")
    var aes = crypto.createDecipher("AES-128-CBC", packet.line.openSecret);
    var deciphered = decode(Buffer.concat([aes.update(packet.body), aes.final()]));
    deciphered.id = packet.id + (packet.id * .2);
    deciphered.from = packet.from;
    deciphered.ciphered = true;
    return incoming(self, deciphered);
  }

  // any ref must be validated as someone we're connected to
  if(packet.js.ref)
  {
    var ref = seen(self, packet.js.ref);
    if(!ref.line) return warn("invalid ref of", packet.js.ref, "from", packet.from);
    packet.ref = ref;
    delete packet.js.ref;
  }

  // process the who "key" responses since we know the sender best now
  if(packet.js.key) inKey(self, packet);

  // answer who/see here so we have the best from info to decide if we care
  if(packet.js.who) inWho(self, packet);
  if(packet.js.see) inSee(self, packet);

  // everything else must have some level of from trust!
  if(!packet.line && !packet.signed && !packet.ref) return inApp(self, packet);

  if(dhash.isSHA1(packet.js.seek)) inSeek(self, packet);
  if(packet.js.pop) inPop(self, packet);

  // now, only proceed if there's a line
  if(!packet.line) return inApp(self, packet);

  // these are line-only things
  if(packet.js.popping) inPopping(self, packet);

  // only proceed if there's a stream
  if(!packet.js.stream) return inApp(self, packet);

  // this makes sure everything is in sequence before continuing
  inStream(self, packet);

}

function inStream(self, packet)
{
  if(!dhash.isSHA1(packet.js.stream)) return warn("invalid stream value", packet.js.stream, packet.from);
  var stream = getStream(self, packet.from, packet.js.stream);

  packet.js.seq = parseInt(packet.js.seq);
  if(!(packet.js.seq >= 0)) return warn("invalid sequence on stream", packet.js.seq, stream.id, packet.from);
  stream.inSeq = packet.js.seq;

  // so, if there's a lot of "gap" or or dups coming in, be kind and send an update
  if(packet.js.seq - stream.outConfirmed > 30 || stream.inDups) sendStream(self, stream, {js:{}});

  // track and drop duplicate packets
  if(packet.js.seq <= stream.inDone || stream.inq[packet.js.seq - (stream.inDone+1)]) return stream.inDups++;

  // process any valid newer incoming ack/miss
  var ack = parseInt(packet.js.ack);
  var miss = Array.isArray(packet.js.miss) ? packet.js.miss : [];
  if(miss.length > 100) return warn("too many misses", miss.length, stream.id, packet.from);
//console.log(">>>ACK", ack, stream.lastAck, stream.outSeq, "len", stream.outq.length, stream.outq.map(function(p){return p.js.seq}).join(","));
  if(ack > stream.lastAck && ack <= stream.outSeq)
  {
    stream.lastAck = ack;
    // rebuild outq, only keeping missed/newer packets
    var outq = stream.outq;
    stream.outq = [];
    outq.forEach(function(pold){
      // packet acknowleged!
      if(pold.js.seq <= ack && miss.indexOf(pold.js.seq) == -1) {
        if(pold.done) pold.done();
        return;
      }
      stream.outq.push(pold);
      if(miss.indexOf(pold.js.seq) == -1) return;
      // resend misses but not too frequently
      if(Date.now() - pold.resentAt < 5*1000) return;
      pold.resentAt = Date.now();
      send(self, stream.to, pold);
    });
//    console.log("OUTQLEN", stream.outq.length);
  }
  
  // drop out of bounds
  if(packet.js.seq - stream.inDone > 100) return warn("stream too far behind, dropping", stream.id, packet.from);

  // stash this seq and process any in sequence
  packet.stream = stream;
  stream.inq[packet.js.seq - (stream.inDone+1)] = packet;
  while(stream.inq[0])
  {
    packet = stream.inq.shift();
    stream.inDone++;
    delete packet.js.stream;
    delete packet.js.seq;
    delete packet.js.miss;
    delete packet.js.ack;
    // sends them to the async queue that calls inStreamSeries()
    stream.q.push(packet);
  }
  
  // start an ack timer to send an ack, will also re-send misses
  // TODO add backpressure support
  if(packet.body && !stream.ackTimeout) stream.ackTimeout = setTimeout(function(){
    sendStream(self, stream, {js:{}}); // it'll fill in empty packet w/ ack and any misses
  }, 200);
}

// worker on the ordered-packet-queue processing
function inStreamSeries(self, stream, packet, callback)
{
  if(stream.handler) return stream.handler(self, packet, callback);
  if(packet.js.sock) return inSock(self, packet, callback);
  if(packet.js.req || stream.proxy) return inProxy(self, packet, callback);

  // anything leftover in a stream, pass along to app
  if(!self.inAnyStream) return callback();
  self.inAnyStream(null, packet, callback);
}

// new socket proxy request!
function inSock(self, packet, callback)
{
  // TODO see if the requested ip:port is whitelisted
  var parts = packet.js.sock.split(":");
  var ip = parts[0];
  var port = parseInt(parts[1]);
  if(!(port > 0 && port < 65536))
  {
    packet.stream.send({end:true, err:"invalid address"});
    return callback();
  }

  // wrap it w/ a node stream
  var client = net.connect({host:ip, port:port});
  var tunnel = wrapStream(self, packet.stream);
  client.pipe(tunnel).pipe(client);
  client.on('error', function(err){
    packet.stream.errMsg = err.toString();
  });
  callback();
}

function inProxy(self, packet, callback)
{
  callback(); // everything we do is async here

  // handy wrapper
  function err(msg)
  {
    debug("PROXY ERROR", msg);
    packet.stream.send({end:true, res:{"s":500}}, msg.toString());
  }

  // new request
  if(packet.js.req)
  {
    if(!self.proxyBase) return err("not supported");
    if(typeof packet.js.req !== "object") return err("invalid req");

    // copy in any defaults
    var options = {};
    Object.keys(self.proxyBase).forEach(function(key){ options[key] = self.proxyBase[key]; });
    options.path = packet.js.req.p || "/";
    options.method = packet.js.req.m || "GET";
    if(typeof packet.js.req.h === "object") options.headers = packet.js.req.h;

    packet.stream.proxy = http.request(options, function(res){
      console.log("PROXY RESPONSE", options, res.statusCode);
      var wrap = wrapStream(self, packet.stream);
      wrap.js({req:{s:res.statusCode, h:res.headers}});
      res.pipe(wrap);
    });
    packet.stream.proxy.on("error", err);
  }
  
  // incoming request data
  if(packet.body) packet.stream.proxy.write(packet.body);

  if(packet.js.end) packet.stream.proxy.end();
}

// any signature must be validated and then the body processed
function inSig(self, packet)
{
  // decode the body as a packet so we can examine it
  var signed = decode(packet.body);
  var sig = packet.js.sig;
  var body = packet.body;
  delete packet.js.sig;
  delete packet.js.body;
  signed.id = packet.id + (packet.id * .1);
  if(!signed.js || !dhash.isSHA1(signed.js.from)) return warn("signed packet missing from value from", packet.from);
  signed.from = seen(self, signed.js.from);
  if(!signed.from.ip) updateAddress(signed.from, packet.from.ip, packet.from.port); // may exist already, don't override until verified

  // if a signed packet has a key, it might be the one for this signature! so process it :)
  if(signed.js.key) inKey(self, signed);

  // who requests don't need to be verified
  if(signed.js.who) inWho(self, signed);

  // where we handle validation if/when there's a key
  getKey(self, signed.from.hashname, function(err, pubkey)
  {
    if(!pubkey) return warn("signed packet, no public key for", signed.from.hashname, "from", packet.from, err);

    // validate packet.js.sig against packet.body
    var valid = crypto.createVerify("RSA-MD5").update(body).verify(pubkey, sig, "base64");
    if(!valid) return warn("invalid signature from:", packet.from);

    // make sure our values are correct/current
    updateAddress(signed.from, packet.from.ip, packet.from.port);
    signed.from.pubkey = pubkey;

    // process body as a new packet with a real from
    signed.signed = signed.from;
    signed.signed.recvAt = Date.now();
    incoming(self, signed);
  });
}

// NAT is open
function inPopped(self, packet)
{
  delete packet.js.popped;
  var popped = seen(self, packet.js.from);
  if(!popped.popping) return warn("popped when not popping from", packet.from);
  
  // make sure we use the ip/port we received from (could be different)
  popped.ip = packet.from.ip;
  popped.port = packet.from.port;
  
  // resend the first packet, this clears .popping too
  send(self, popped, popped.popping);
}

// someone's trying to connect to us
function inPopping(self, packet)
{
  var to = seen(self, packet.js.popping);
  delete packet.js.popping;
  if((Date.now() - to.sentAt) < 60*1000) return; // we already sent them something recently
  send(self, to, {js:{popped:true}});
}

// be the middleman to help NAT hole punch
function inPop(self, packet)
{
  if(!Array.isArray(packet.js.pop) || packet.js.pop.length == 0) return warn("invalid pop of", packet.js.pop, "from", packet.from);
  if(!dhash.isSHA1(packet.js.from)) return warn("invalid pop from of", packet.js.from, "from", packet.from);

  packet.js.pop.forEach(function(address){
    var pop = seen(self, address);
    if(!pop.line) return warn("pop requested for", address, "but no line, from", packet.from);
    var popping = {js:{popping:[packet.js.from, packet.from.ip, packet.from.port].join(',')}};
    send(self, pop, popping);
  });
  delete packet.js.pop;
}

// return array of nearby addresses (for .see)
function nearby(self, hash)
{
  var ret = [];
  if(hash === self.hashname) ret.push(self.address);
  
  // return up to 5 closest, in the same or higher (further) bucket
  var bucket = self.hash.distanceTo(new dhash.Hash(null, hash));
  var max = 5;
  while(bucket <= 159 && max > 0)
  {
    if(self.buckets[bucket]) self.buckets[bucket].forEach(function(hn){
      if(!hn.line) return; // only see ones we have a line with
      max--;
      ret.push(hn.address);
    });
    bucket++;
  }
  return ret;
}

// return a see to anyone closer
function inSeek(self, packet)
{
  if(!dhash.isSHA1(packet.js.seek)) return warn("invalid seek of ", packet.js.seek, "from:", packet.from);

  // now see if we have anyone to recommend
  var answer = {js:{see:nearby(self, packet.js.seek)}};
  
  delete packet.js.seek;
  send(self, packet.from, answer);
}

// any packet can have a .see, anything might want to know
function inSee(self, packet)
{
  if(!Array.isArray(packet.js.see)) return warn("invalid see of ", packet.js.see, "from:", packet.from);
  
  // to trust a .see, we just need to know who they are or that we've sent them something
  var via = packet.from;
  if(!via.hashname) via = seen(packet.js.from); // ephemeral responses only have a from
  if(!packet.from.hashname && !(via.sent > 0)) return warn("incoming see from someone unknown", packet.from);

  packet.js.see.forEach(function(address){
    var see = seen(self, address);
    if(see !== via) see.via = via;
    // check if anyone is waiting for this one specifically
    var watch = self.watch["see "+see.hashname];
    if(watch) watch.done(null, see);
    // TODO also check anyone watching for ones closer to recurse
  });
  delete packet.js.see;
}

// optionally send it up to the app if there's any data that isn't processed yet
function inApp(self, packet)
{
  // make sure there's something to do yet (signed packets usually fall through here empty)
  if(Object.keys(packet.js) == 0 && !packet.body) return debug("empty packet done", packet.id);

  // stream callbacks
  if(packet.stream && packet.stream.inAny) return packet.stream.inAny(null, packet);

  // line stuff
  if(packet.line && packet.line.inAny) return packet.line.inAny(null, packet);
  
  // ad-hoc packets
  if(self.inAny) packet.line.inAny(null, packet);
}

// they want to open a line to us
function inOpen(self, packet)
{
  // if the from isn't verified, bail
  if(!packet.signed) return warn("unsigned open from", packet.from);

  // trigger resending them our open if it's a new one from them
  if(packet.from.openSent && packet.from.opened && packet.from.opened !== packet.js.open) packet.from.openSent = false;

  // store the (new) open value for line generation
  packet.from.opened = packet.js.open;
  delete packet.js.open;

  // may need to generate our open secret yet
  if(!packet.from.open) addOpen(self, packet.from);

  // line is the hash of the sort of the two open secrets (decrypted from open)
  packet.from.openedSecret = ursa.coercePrivateKey(self.prikey).decrypt(packet.from.opened, "base64", "utf8", ursa.RSA_PKCS1_PADDING);
  packet.from.line = dhash.quick([packet.from.openedSecret, packet.from.openSecret].sort().join(""));

  // set up tracking/flags
  packet.line = self.lines[packet.from.line] = packet.from;

  // something might be waiting for a line on this hashname
  var watch = self.watch["line "+packet.from.hashname];
  if(watch) watch.done(null, packet.from);

  // could have queued out-of-order packets waiting, scan them
  queueLine(self);
}

function inKey(self, packet)
{
  var hashname = packet.js.key;
  delete packet.js.key;
  var watch = self.watch["who "+hashname+packet.from.hashname];
  if(!watch) return warn("unknown key", hashname, "from", packet.from);

  // some sanity checks
  if(!packet.body) return warn("missing key body from", packet.from);
  var seq = parseInt(packet.js.seq || 0);
  if(seq === NaN || seq < 0 || seq > 10) return warn("invalid seq", packet.js.seq, packet.from);
  delete packet.js.seq;

  watch.parts[seq] = packet.body.toString("utf8");

  // check if it's a valid public key yet, bail if not
  var key = watch.parts.join("");
  if(!PEM_REGEX.exec(key)) return;
  
  // have a key, validate it's for this hashname!
  if(hashname !== dhash.quick(key+self.space)) return warn("key+space hashname mismatch", hashname, "from", packet.from);
  seen(self, hashname).pubkey = key; // save all public keys we get back
  watch.done(null, key);
}

function inWho(self, packet)
{
  if(!dhash.isSHA1(packet.js.who)) return warn("invalid seek of ", packet.js.seek, "from:", packet.from);

  // TODO - do we care to enforce signature validation?  
  var who = seen(self, packet.js.who);
  delete packet.js.who;

  getKey(self, who.hashname, function(err, key)
  {
    // only warn if we're not open
    if(err || typeof key !== "string") return self.open || warn("key lookup fail for", who.hashname, err);

    // if we haven't cached it yet, do that
    if(!who.pubkey) who.pubkey = key;

    // split into 1k chunks max
    var chunks = [].concat.apply([], key.split('').map(function(x,i){ return i%1000 ? [] : key.slice(i,i+1000) }));
    for(var i = 0; i < chunks.length; i++)
    {
      send(self, packet.from, {js:{key:who.hashname, seq:i}, body:chunks[i]});
    }
  });
}

// simple test rigging to replace builtins
exports.test = function(outgoing)
{
  send = outgoing;
  return {incoming:incoming, inStream:inStream, doStream:doStream, inProxy:inProxy};
}