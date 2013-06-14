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
exports.hashname = function(network, keys, args)
{
  if(!network || !keys || !keys.public || !keys.private) return undefined;
  if(!args) args = {};

  // configure defaults
  var self = {network:network, cb:{}, operators:[], watch:{}, lines:{}, lineq:[], seen:{}, buckets:[]};
  // parse/validate the private key
  self.prikey = keys.private;
  self.pubkey = keys.public;
  self.hash = new dhash.Hash(self.pubkey+network);
  self.hashname = self.hash.toString();
  if (!args.ip || args.natted) self.nat = true;
  self.ip = args.ip || "0.0.0.0";
  self.port = parseInt(args.port) || 0;

  // udp socket
  var counter = 1;
  self.server = dgram.createSocket("udp4", function(msg, rinfo){
    var packet = decode(msg);
    if(!packet) return warn("failed to decode a packet from", rinfo.address, rinfo.port, msg.toString());
    packet.sender = {ip:rinfo.address, port:rinfo.port};
    packet.id = counter++;
    packet.at = Date.now();

    // either it's an open
    if(packet.js.type == "open") return inOpen(self, packet);

    // or it's a line
    if(packet.js.type == "line") return inLine(self, packet);
    
    warn("dropping incoming packet of unknown type", packet.js, packet.sender);
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
  
  // instead of using dns, hard-wire the operators
  self.addOperator = function(address, key) {
    if(!address || !key) return warn("invalid args to addOperator");
    var op = seen(self, address);
    op.pubkey = key;
    op.operator = true;
    self.operators.push(op);
  }
  
  // connect 
  self.online = function(callback){
    if(self.opeerators.length == 0) return dnsOps(self, function(err){
      if(err) return callback(err);
      if(self.operators.length == 0) return callback("couldn't find any operators for "+self.network);
      self.online(callback);
    });
    // try to open a line to an op
    var on = false;
    async.forEachSeries(self.operators, function(op, cbOps){
      // TODO open line to an operator, then on=true and cbOps(true);
    }, function(){
      if(!on) return callback("couldn't reach any operators :(");
      meshLoop(self); // start the DHT meshing maintainence
      callback();
    })
  }

  self.custom = function(hn, type, callback) { return doStream(self, hn, callback) };
  self.handler = function(type, callback) { };
  self.tunnel = function(args, callback) { return doSocket(self, args, callback) };
  self.proxy = function(ipp, hn) { };
  self.search = function(q, callback) { };
  self.doSend = function(to, packet) { send(self, to, packet) };


  return self;
}

// TODO ADD CALLBACK HANDLING

function dnsOps(self, callback)
{
  // try to resolve any dns-defined operators for this network
  dns.resolveSrv("_telehash._udp."+self.network, function(err, srvs){
    // if we didn't resolve anything, sometimes that's worth warning about
    if(err){
      if(!self.operator && self.operators.length === 0) warn("no operators found, couldn't resolve network", self.network, err.toString());
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
    inStreamSeries(self, packet, cbQ);
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

function askKey(self, to, key, callback)
{
  var watch = watcher(self, "askKey "+who+to.hashname, REQUEST_TIMEOUT, callback);
  if(watch.callbacks.length > 1) return; // someone sent one here already

  getStream(self, to).send({js:{type:"key", key:key}});
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

  // if we know an ip for this hashname, just ask them!
  if(who.ip)
   return sendWho(self, who, hashname, watch.done);

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
  keywatch(self, "see "+to.hashname, function(err){
    if(err) return callback(err);
    good();
  });
  seek(self, to.hashname);
}

// an internal "lock" function, so that many things can wait for one trigger and have a timeout
function watcher(self, key, timeout, callback)
{
  var watch = self.watch[key];

  // if a watch is running, just add this to the callback list
  if(watch) {
    watch.callbacks.push(callback);
    return watch;
  }

  // start a new watch
  var timer = timeout && setTimeout(function(){done("timeout")}, timeout);
  function done()
  {
    if(!timer) return; // re-entered by accident if answer came after timeout
    clearTimeout(timer);
    timer = false;
    var args = arguments;
    delete self.watch[key];
    watch.callbacks.forEach(function(cb){ cb.call(args); });
  }

  var watch = self.watch[key] = {done:done, callbacks:[]};
  watch.callbacks.push(callback);
  return watch;
}

// create a wire writeable buffer from a packet
function encode(self, to, packet)
{
  debug("ENCODING", JSON.stringify(packet.js), (typeof packet.body == "string")?packet.body:packet.body && "BINARY "+packet.body.length, "\n");

  var jsbuf = new Buffer(JSON.stringify(packet.js), "utf8");
  if(typeof packet.body === "string") packet.body = new Buffer(packet.body, "utf8");
  packet.body = packet.body || new Buffer(0);
  var len = new Buffer(2);
  len.writeInt16BE(jsbuf.length, 0);
  return Buffer.concat([len, jsbuf, packet.body]);
}

// track every hashname we know about
function seen(self, hashname)
{
  // validations
  if(!dhash.isSHA1(hashname)) { warn("seen called without a valid hashname", hashname); return false; }

  // so we can check === self
  if(hashname === self.hashname) return self;

  var ret = self.seen[hashname];
  if(!ret) {
    ret = self.seen[hashname] = {hashname:hashname};
    ret.at = Date.now();
    ret.hash = new dhash.Hash(null, hashname);
    bucketize(self, ret);
  }
  return ret;
}

function openSeek(self, to)
{
  debug("openSeek", to.hashname);
  // use watcher
  // perform seek
  // on finding the to.hashname's ip/port, call send()
}

function sendOpen(self, to)
{
  // only way to get it is to pop whoever told us about the hashname
  if(!to.pubkey)
  {
    if(!to.via) return warn("can't open a line to a hashname with no via", to.hashname);
    Object.keys(to.via).forEach(function(hn){
      var via = seen(self, hn);
      if(!via.lineIn) return;
      // send an empty packet to the target to open any NAT
      if(self.nat) {
        var parts = to.via[hn].split(",");
        sendBuf(self, {port:parseInt(parts[2]), ip:parts[1]}, encode(self, to, {js:{}}));
      }
      // send request to the via so they can relay our pubkey to them to open to us
      var js = {type:"pop"};
      js.pop = [hn];
      getStream(self, via).send(js); // throwaway      
    });
    return;
  }

  debug("sendOpen sending", to.hashname);
  to.sentOpen = true;
  if(!to.secretOut) to.secretOut = dhash.quick(); // gen random secret
  if(!to.lineOut) to.lineOut = dhash.quick(); // gen random outgoing line id
  
  // send an open packet, containing our key
  var packet = {js:{}, body:self.pubkey};
  packet.js.to = to.hashname;
  packet.js.from = self.hashname;
  packet.js.x = Date.now() + 10*1000; // timeout to prevent replay
  packet.js.line = to.lineOut;

  // craft the special open packet wrapper
  var open = {js:{type:"open"}};
  // attach the aes secret, encrypted to the recipients public key
  open.js.open = ursa.coercePublicKey(to.pubkey).encrypt(to.secretOut, "utf8", "base64", ursa.RSA_PKCS1_PADDING);
  // now encrypt the original open packet
  var aes = crypto.createCipher("AES-128-CBC", to.secretOut);
  open.body = Buffer.concat([aes.update(encode(self, to, packet)), aes.final()]);
  // now attach a signature so the recipient can verify the sender
  open.js.sig = crypto.createSign("RSA-MD5").update(open.body).sign(self.prikey, "base64");
  sendBuf(self, to, encode(self, to, open));
}

// wiring wrapper, to is a hashname object from seen(), does the work to open a line first
function send(self, to, packet)
{
  if(typeof to == "string") to = seen(self, to);
  if(!to.outq) to.outq = [];
  if(to.outq.length > 5) return warn("dropping packet, flooding not allowed to", to.hashname);
  if(packet) to.outq.push(packet);

  // if we don't know how to reach them, go find them
  if(!to.ip && !to.via) return openSeek(self, to);

  // if there's no line to send this on yet, try to open one
  if(!to.lineIn) return sendOpen(self, to);

  // flush out all packets
  to.outq.forEach(function(packet){
    var buf = encode(self, to, packet);

    var enc = {js:{type:"line"}};
    enc.js.line = to.lineIn;
    var aes = crypto.createCipher("AES-128-CBC", to.secretOut);
    enc.body = Buffer.concat([aes.update(buf), aes.final()]);

    sendBuf(self, to, encode(self, to, enc))
  });
  to.outq = [];
}

// raw write to the wire
function sendBuf(self, to, buf)
{
  // track some stats
  to.sent ? to.sent++ : to.sent = 1;
  to.sentAt = Date.now();

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
  debug("INCOMING", packet.id, packet.from.hashname, JSON.stringify(packet.js), packet.body && packet.body.toString());

  // allow any packet to send a see (as a hint) and process it
  if(packet.js.see) inSee(self, packet);

  // new line creation
  if(packet.js.type == "open") return inOpen(self, packet);

  // all stream level stuff is decoded here
  if(packet.js.stream) return inStream(self, packet);

  // everything else the app can handle custom
  if(packet.from.inAny) return packet.from.inAny(self, packet);
  if(self.inAny) return self.inAny(self, packet);
  
  warn("unhandled packet", packet.id, packet.from.hashname, JSON.stringify(packet.js));
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
    // sends them to the async queue that calls inStreamSeries()
    stream.q.push(packet);
  }
  
  // start an ack timer to send an ack, will also re-send misses
  // TODO add backpressure support
  if(packet.body && !stream.ackTimeout) stream.ackTimeout = setTimeout(function(){
    packet.stream.send({js:{}}); // it'll fill in empty packet w/ ack and any misses
  }, 200);
}

// worker on the ordered-packet-queue processing
function inStreamSeries(self, packet, callback)
{
  // everything from an outgoing stream has a handler
  if(packet.stream.handler) return packet.stream.handler(self, packet, callback);

  // only new incoming streams end up here, require a type
  if(typeof packet.js.type != "string") {
    warn("unknown stream packet", JSON.stringify(packet.js));
    return callback();
  }

  if(packet.js.type === "sock") return inSock(self, packet, callback);
  if(packet.js.type === "key") return inKey(self, packet, callback);
  if(packet.js.type === "seek") return inSeek(self, packet, callback);

  warn("unknown stream packet type", packet.js.type);
  packet.stream.send({js:{end:true, err:"unknown type"}});
  callback();
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

// any signature must be validated and then the body decrypted+processed
function inOpen(self, packet)
{
  // decrypt the open
  if(!packet.js.open) return warn("missing open value", packet.sender);
  var secret = ursa.coercePrivateKey(self.prikey).decrypt(packet.js.open, "base64", "utf8", ursa.RSA_PKCS1_PADDING);
  if(!secret) return warn("couldn't decrypt open", packet.sender);
  
  // decipher the body as a packet so we can examine it
  if(!packet.body) return warn("body missing on open", packet.sender);
  var aes = crypto.createDecipher("AES-128-CBC", secret);
  var deciphered = decode(Buffer.concat([aes.update(packet.body), aes.final()]));
  if(!deciphered) return warn("invalid body attached", packet.sender);

  // make sure any to is us (for multihosting)
  if(deciphered.js.to !== self.hashname) return warn("packet for", deciphered.js.to, "is not us");

  // make sure it's not expired, and has a valid line
  if(deciphered.js.x < Date.now()) return warn("open packet has expired", deciphered.js.x, packet.sender);
  if(typeof deciphered.js.line != "string" || deciphered.js.line.length == 0) return warn("invalid line id contained");

  // extract attached public key
  if(!deciphered.body) return warn("open missing attached key", packet.sender);
  var key = deciphered.body.toString("utf8");
  if(!PEM_REGEX.exec(key)) return warn("invalid attached key from", packet.sender);

  // verify signature
  var valid = crypto.createVerify("RSA-MD5").update(packet.body).verify(key, packet.js.sig, "base64");
  if(!valid) return warn("invalid signature from:", packet.sender);

  // verify senders hashname
  if(deciphered.js.from !== (new dhash.Hash(key+self.network)).toString()) return warn("invalid hashname", deciphered.js.from);

  // load the sender and update any ip:port/key/etc
  var from = seen(self, deciphered.js.from);
  debug("inOpen verified", from.hashname);
  from.pubkey = key;
  from.ip = packet.sender.ip;
  from.port = packet.sender.port;
  from.address = [from.hashname, from.ip, from.port].join(",");
  from.recvAt = Date.now();

  // was an existing line already, being replaced
  if(from.lineIn && from.lineIn !== deciphered.js.line) {
    debug("changing lines",from);
    from.sentOpen = false; // trigger resending them our open again
    delete self.lines[oldLine]; // delete the old one
  }

  // do we need to send them an open yet?
  if(!from.sentOpen) sendOpen(self, from);

  // line is open now!
  from.lineIn = deciphered.js.line;
  self.lines[from.lineIn] = from;
  from.secretIn = secret;

  // could have queued packets to be sent, flush them
  send(self, from);

  // something might be waiting for a line on this hashname
  var watch = self.watch["line "+from.hashname];
  if(watch) watch.done(null, from);

  // could have queued out-of-order packets waiting, scan them
  queueLine(self);
}

// line packets must be decoded first
function inLine(self, packet){
  packet.line = packet.from = self.lines[packet.js.line];

  // sometimes they come out of order, queue it waiting for the open just in case
  if(!packet.line) return queueLine(self, packet);

  // a matching line is required to decode the packet
  packet.line.recvAt = Date.now();
  var aes = crypto.createDecipher("AES-128-CBC", packet.line.openSecret);
  var deciphered = decode(Buffer.concat([aes.update(packet.body), aes.final()]));
  packet.js = deciphered.js;
  packet.body = deciphered.body;
  incoming(self, packet);
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

  packet.js.pop.forEach(function(hn){
    var pop = seen(self, hn);
    if(!pop.line) return warn("pop requested for", hn, "but no line, from", packet.from);
    // XXX TODO IN STREAM + PUB KEY
    var popping = {js:{popping:packet.from.address}};
    send(self, pop, popping);
  });
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
function inSeek(self, packet, callback)
{
  callback();
  if(!dhash.isSHA1(packet.js.seek)) return warn("invalid seek of ", packet.js.seek, "from:", packet.from);

  // now see if we have anyone to recommend
  var answer = {js:{see:nearby(self, packet.js.seek)}};
  
  packet.stream.send(answer);
}

// see might be in response to a seek, or bundled ad-hoc with any session creation
function inSee(self, packet)
{
  if(!Array.isArray(packet.js.see)) return warn("invalid see of ", packet.js.see, "from:", packet.from);

  var watch = self.watch["seeking"];
  if(watch) watch.done(null, packet);

  // also track each one for the dht meshing maintenance
  packet.js.see.forEach(function(address){
    var parts = address.split(",");
    var see = seen(self, parts[0]);
    if(see === packet.from) return; // common for a see to include the sender
    // store who told us about this hashname and what they said their address is
    if(!see.via) see.via = {};
    if(see.via[packet.from.hashname]) return;
    see.via[packet.from.hashname] = address;
  });
}

function aKey(self, packet)
{
  var hashname = packet.js.hash;
  var watch = self.watch["key "+hashname+packet.from.hashname];
  if(!watch) return warn("unknown key", hashname, "from", packet.from.hashname);

  // some sanity checks
  if(!packet.body) return warn("missing key body from", packet.from.hashname);
  var key = packet.body.toString("utf8");
  if(!PEM_REGEX.exec(key)) return warn("invalid key from", packet.from.hashname);

  // have a key, validate it's for this hashname!
  if(hashname !== dhash.quick(key+self.network)) return warn("key+network hashname mismatch", hashname, "from", packet.from.hashname);
  seen(self, hashname).pubkey = key; // save all public keys we get back
  watch.done(null, key);
}

function inKey(self, packet, callback)
{
  callback();
  var hashname = packet.js.hash;
  if(!dhash.isSHA1(hashname)) return warn("invalid seek of ", hashname, "from:", packet.from);

  getKey(self, hashname, function(err, key)
  {
    if(err || typeof key !== "string") return warn("key lookup fail for", hashname, err);

    // if we haven't cached it yet, do that
    var who = seen(self, hashname);
    if(!who.pubkey) who.pubkey = key;

    packet.stream.send({js:{a:"key", hash:hashname}, body:key});
  });
}

// simple test rigging to replace builtins
exports.test = function(outgoing)
{
  send = outgoing;
  return {incoming:incoming, inStream:inStream, doStream:doStream};
}