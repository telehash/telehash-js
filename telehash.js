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
  var self = {network:network, operators:[], watch:{}, lines:{}, lineq:[], seen:{}, buckets:[], customs:{}, allowed:{}};
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
    console.log("in",packet.sender.ip+":"+packet.sender.port, packet.js.type, packet.body.length);

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
  self.addOperator = function(ip, port, key) {
    if(!ip || !port || !key) return warn("invalid args to addOperator");
    var hashname = (new dhash.Hash(key+self.network)).toString();
    var op = seen(self, hashname);
    op.pubkey = key;
    op.ip = ip;
    op.port = port;
    op.operator = true;
    self.operators.push(op);
  }
  
  // connect to an operator
  self.online = function(callback) { online(self, callback); };

  // create your own custom streams
  self.stream = function(hn, handler) {return addStream(self, seen(self, hn), handler); };

  // handle new streams coming in
  self.listen = function(type, callback) {
    if(typeof type != "string") return warn("bad arg given for handler, needs string and is", typeof type);
    self.customs[type] = callback;
  };

  // create a socket tunnel
  self.tunnel = function(args, callback) { return doSocket(self, args, callback) };

  // have a callback to determine if a socket proxy request can pass through, fn(ip, port, hn) returns true/false
  self.proxyCheck = function(){ return false; };
  self.proxy = function(check) { self.proxyCheck = check };

  return self;
}

// start/return online status
function online(self, callback)
{
  if(Object.keys(self.lines).length > 0) return callback();
  if(self.operators.length == 0) return dnsOps(self, function(err){
    if(err) return callback(err);
    if(self.operators.length == 0) return callback("couldn't find any operators for "+self.network);
    online(self, callback);
  });
  // try to open a line to an op
  async.forEachSeries(self.operators, function(op, cbOps){
    addStream(self, op, function(self, packet, callback){
      callback();
      delete packet.stream.handler; // so we don't get called again
      if(Array.isArray(packet.js.see)) return cbOps(true);
      cbOps();
    }).send({type:"seek", seek:self.hashname});
  }, function(on){
    if(!on) return callback("couldn't reach any operators :(");
    meshLoop(self); // start the DHT meshing maintainence
    callback();
  })

}

// try to resolve any dns-defined operators for this network, use SRV to get the hashnames+ports, A for IP, TXT for pubkey
function dnsOps(self, callback)
{
  dns.resolveSrv("_telehash._udp."+self.network, function(err, srvs){
    if(err) return callback(err);
    async.forEach(srvs, function(srv, cbSrv){
      var hashname = srv.name.split(".")[0];
      if(!dhash.isSHA1(hashname)) return cbSrv();
      dns.resolve4(srv.name, function(err, ips){
        if(err || ips.length == 0) return cbSrv();
        dns.resolveTxt(srv.name, function(err, txts){
          if(err || txts.length == 0) return cbSrv();
          // verify hashname to key
          if(hashname !== (new dhash.Hash(txts[0]+self.network)).toString()) return cbSrv();
          self.addOperator(ips[0], srv.port, txts[0]);
          cbSrv();
        });
      });
    }, callback);
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
    addStream(self, hn, function(self, packet, callback){
      callback();
      if(!Array.isArray(packet.js.see)) return;
      // store who told us about this hashname and what they said their address is
      packet.js.see.forEach(function(address){
        addVia(self, hn, address);        
      });
    }).send({type:"seek", seek:self.hashname});
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
      var stream = addStream(self, seen(self, args.hashname));
      var tunnel = wrapStream(self, stream);
      client.pipe(tunnel).pipe(client);
      // send sock open now
      stream.send({sock:args.to});
    });
    server.listen(args.listen, callback);
  });
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

function addStream(self, to, handler, id)
{
  var stream = {inq:[], outq:[], inSeq:0, outSeq:0, inDone:-1, outConfirmed:0, inDups:0, lastAck:-1}
  stream.id = id || dhash.quick();
  to.streams[stream.id] = stream;
  stream.to = to;

  // how we process things in order
  stream.q = async.queue(function(packet, cbQ){
    inStreamSeries(self, packet, cbQ);
  }, 1);

  // as a convenience, as soon as we send out a stream, ensure there's at least a dummy handler
  if(handler === undefined) stream.handler = function(self, packet, callback){ callback(); };

  // handy util, send just one anytime explicitly
  stream.send = function(js, body){ sendStream(self, stream, {js:js, body:body}) };

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
  stream.ended = packet.js.end;
  
  // any ack timer gets cancelled
  if(stream.ackTimeout)
  {
    clearTimeout(stream.ackTimeout);
    stream.ackTimeout = false;
  }

  send(self, stream.to, packet);
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

// happens whenever we're processing a .see response in different contexts
function addVia(self, from, address)
{
  var see = seen(self, address);
  if(!see) return;
  if(!see.via) see.via = {};
  if(see.via[from.hashname]) return;
  see.via[from.hashname] = address; // TODO handle multiple addresses per hn (ipv4+ipv6)
}

// ask open lines for a hashname, recurse through the DHT looking for it
function openSeek(self, to)
{
  if(to === self) return; // safety

  // queue of concurrency 3, any that are closer than the closest are unshifted, any closer than the request are pushed
  var asked = {};
  var closest = self;
  var q = async.queue(function(hn, cbQ){
    if(to.via) return cbQ(); // already found!
    if(asked[hn.hashname]) return cbQ(); // someone else already asked
    asked[hn.hashname] = true;
    addStream(self, hn, function(self, packet, callback){
      callback();
      if(!Array.isArray(packet.js.see)) return cbQ();
      if(to.via) return cbQ();
      // any see's, if close, add to the queue, otherwise we might be done!
      packet.js.see.forEach(function(address){
        var see = seen(self, address);
        if(!see) return;
        if(asked[see.hashname]) return;
        addVia(self, hn, address); // store who told us about this hashname and what they said their address is
        // if it's further than the closest yet, just add to the end of the queue as a fallback
        if(see.hash.distanceTo(to.hash) > closest.hash.distanceTo(to.hash)) return q.push(see);
        // if it's a new closer one, put at the top of the list!
        closest = see;
        q.unshift(see);
      });
      cbQ();
    }).send({type:"seek",seek:to.hashname});
  }, 3);
  
  // when all done, if we found the hashname, trigger the open!
  q.drain = function(){
    if(to.via) return send(self, to);
    warn("seek failed to", to.hashname);
  };

  // take the closest lines and ask them
  nearby(self, to.hashname).map(function(hn){ q.push(hn); });
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
  if(!typeof hashname != "string") hashname = hashname.toString();
  hashname = hashname.split(",")[0]; // convenience if an address is passed in
  if(!dhash.isSHA1(hashname)) { warn("seen called without a valid hashname", hashname); return false; }

  // so we can check === self
  if(hashname === self.hashname) return self;

  var ret = self.seen[hashname];
  if(!ret) {
    ret = self.seen[hashname] = {hashname:hashname, streams:{}};
    ret.at = Date.now();
    ret.hash = new dhash.Hash(null, hashname);
    bucketize(self, ret);
  }
  return ret;
}

function sendOpen(self, to)
{
  // only way to get it is to pop whoever told us about the hashname
  if(!to.pubkey)
  {
    var popped = false;
    if(to.via) Object.keys(to.via).forEach(function(hn){
      var via = seen(self, hn);
      if(!via.lineIn) return;
      // send an empty packet to the target to open any NAT
      if(self.nat) {
        var parts = to.via[hn].split(",");
        sendBuf(self, {port:parseInt(parts[2]), ip:parts[1]}, encode(self, to, {js:{}}));
      }
      var js = {type:"pop"};
      js.pop = [hn];
      addStream(self, via).send(js);
      popped = true;
    });
    // if we didn't have a working via, try again
    if(!popped) {
      warn("re-seeking since via failed", to.hashname);
      delete to.via;
      openSeek(self, to);
    }
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
    enc.js.line = to.lineOut;
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

  console.log("out",to.ip+":"+to.port, buf.length);
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

function inStream(self, packet)
{
  if(!dhash.isSHA1(packet.js.stream)) return warn("invalid stream value", packet.js.stream, packet.from);

  var stream = (packet.from.streams[packet.js.stream]) ? packet.from.streams[packet.js.stream] : addStream(self, packet.from, false, packet.js.stream);

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

  // branch out based on what type of stream it is
  if(packet.js.type === "sock") inSock(self, packet);
  else if(packet.js.type === "pop") inPop(self, packet);
  else if(packet.js.type === "popping") inPopping(self, packet);
  else if(packet.js.type === "seek") inSeek(self, packet);
  else if(self.customs[packet.js.type]) inCustom(self, packet);
  else {
    warn("unknown stream packet type", packet.js.type);
    packet.stream.send({js:{end:true, err:"unknown type"}});
  }

  // if nobody is handling or has replied, automatically end it
  if(!packet.stream.handler && !packet.stream.ended) packet.stream.send({end:true});

  callback();
}

// new socket proxy request!
function inSock(self, packet)
{
  var parts = packet.js.sock.split(":");
  var ip = parts[0];
  var port = parseInt(parts[1]);
  if(!(port > 0 && port < 65536)) return packet.stream.send({end:true, err:"invalid address"});
  
  // make sure the destination is allowed
  if(!self.proxyCheck(ip, port, hn)) return packet.stream.send({end:true, err:"denied"});

  // wrap it w/ a node stream
  var client = net.connect({host:ip, port:port});
  var tunnel = wrapStream(self, packet.stream);
  client.pipe(tunnel).pipe(client);
  client.on('error', function(err){
    packet.stream.errMsg = err.toString();
  });
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
  debug("added line",from.lineIn, from.address);

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
  var aes = crypto.createDecipher("AES-128-CBC", packet.line.secretIn);
  var deciphered = decode(Buffer.concat([aes.update(packet.body), aes.final()]));
  if(!deciphered) return warn("decryption failed for", packet.from.hashname, packet.body.toString())
  packet.js = deciphered.js;
  packet.body = deciphered.body;
  
  // now let the stream processing happen
  inStream(self, packet);
}

// someone's trying to connect to us, send an open to them
function inPopping(self, packet)
{
  var to = seen(self, packet.js.popping);
  // only do this once, prevent abuse
  if(to.openSent) return warn("redundant popping from",packet.from.hashname,"for",to.hashname);
  // verify destination hashname+key
  if(to.hashname !== (new dhash.Hash(packet.body.toString()+self.network)).toString()) return warn("invalid popping from", packet.from.hashname);
  to.pubkey = packet.body.toString();
  sendOpen(self, to);
}

// be the middleman to help NAT hole punch
function inPop(self, packet)
{
  if(!Array.isArray(packet.js.pop) || packet.js.pop.length == 0) return warn("invalid pop of", packet.js.pop, "from", packet.from);
  if(!dhash.isSHA1(packet.js.from)) return warn("invalid pop from of", packet.js.from, "from", packet.from);

  packet.js.pop.forEach(function(hn){
    var pop = seen(self, hn);
    if(!pop.line) return warn("pop requested for", hn, "but no line, from", packet.from);
    addStream(self, pop).send({type:"popping", popping:packet.from.address}, pop.pubkey);
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
      ret.push(hn);
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
  var answer = {js:{see:nearby(self, packet.js.seek).map(function(hn){ return hn.address; }), end:true}};  
  packet.stream.send(answer);
}

// simple test rigging to replace builtins
exports.test = function(outgoing)
{
  send = outgoing;
  return {incoming:incoming, inStream:inStream, doStream:doStream};
}