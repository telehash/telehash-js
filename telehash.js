var dgram = require("dgram");
var os = require("os");
var net = require("net");
var async = require("async");
var ursa = require("ursa")
var dhash = require("./dhash");

var REQUEST_TIMEOUT = 5 * 1000; // default timeout for any request
var warn = console.log; // switch to function(){} to disable
var debug = console.log; //function(){}; // switch to console.log to enable

exports.hash = function(string)
{
  return new dhash.Hash(string);
}

// simple handy wrapper utility to make a new keypair
exports.createKeys = function(mod, exp)
{
  var key = ursa.generatePrivateKey(mod, exp);
  return {public:key.toPublicPem("utf8"), private:key.toPrivatePem("utf8")};
}

// start a hashname listening and ready to go
exports.hashname = function(space, privateKey, args)
{
  if(!space || !privateKey) return undefined;
  if(!args) args = {};

  // configure defaults
  var self = {space:space, cb:{}, operators:[], watch:{}, lines:{}, lineq:[], seen:{}};
  // parse/validate the private key
  try {
    self.ukey = ursa.coercePrivateKey(privateKey);
    self.pubkey = self.ukey.toPublicPem("utf8");
  } catch(E) {
    warn("couldn't parse key:", E);
    return undefined;
  };
  self.hashname = new dhash.Hash(self.pubkey+space).toString();
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
  self.server.bind(self.port, self.ip);

  // try to set the correct address for logging, not important for telehash
  self.port = self.server.address().port;
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

  // set up methods (personal prefernce to do this explicitly vs. prototype pattern)
  self.myLookup = function(callback) { self.cb.lookup = callback };
  self.setOperators = function(addresses) {
    if(!Array.isArray(addresses)) return;
    self.operators = addresses.map(function(address){
      var op = seen(self, address);
      op.operator = true;
      return op.hashname;
    });
  };
  self.doWho = function(hn, callback) { doWho(self, hn, callback) };
  self.doLine = function(hn, callback) { doLine(self, hn, callback) };
  self.doStream = function(hn, callback) { return doStream(self, hn, callback) };
  self.doSockProxy = function(args, callback) { return doSockProxy(self, args, callback) };

  return self;
}

// ask hashname to open a socket to this ip:port
function doSockProxy(self, args, callback)
{
  if(!args || !args.hashname) return callback("no hashname");
  if(!args.to || !args.listen) return callback("need to and listen");
  self.doLine(args.hashname, function(err){
    if(err) return callback("line failed");
    var server = net.createServer(function(c) {
      console.log('server connected');
      var stream = doStream(self, args.hashname, function(err, packet, cbStream){
        if(packet.body) c.write(packet.body);
        if(packet.js.sock === "closed")
        {
          console.log("stream closed", packet.js.err||"");
          c.close();
        }
        cbStream();
      });
      console.log("SOCKSTREAM",stream, seen(self, args.hashname));
      var cErr;
      c.on('error', function(err){ err = cErr });
      c.on('close', function() {
        var closed = {"sock":"closed"};
        if(cErr) closed.err = cErr.toString();
        stream.send(closed);
        console.log('server disconnected');
      });
      c.on('data', function(data){
        stream.send({}, data);
      });
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

function getStream(self, to, id)
{
  if(!to.streams) to.streams = {};
  if(id && to.streams[id]) return to.streams[id];

  // new stream
  var stream = {inq:[], outq:[], inSeq:0, outSeq:0, inDone:-1, outConfirmed:0, inDups:0, lastAck:-1}
  stream.id = id || dhash.quick();
  stream.to = to;
  stream.q = async.queue(function(packet, cbQ){
    inStreamSeries(self, stream, packet, cbQ);
  }, 1);
  stream.send = function(js, body){ sendStream(self, stream, {js:js, body:body}) };
  to.streams[stream.id] = stream;
  return stream;
}

function sendStream(self, stream, packet)
{
  if(stream.outq > 100) return warn("dropping outgoing packet since the stream buffer is too large", stream.id, packet.to);

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
  
  // any misses timer gets cancelled
  if(stream.missTimeout)
  {
    clearTimeout(stream.missTimeout);
    stream.missTimeout = false;
  }
  
  send(self, stream.to, packet);
}

// perform a who request
function doWho(self, hashname, callback)
{
  // this will add the callback to any outstanding who requests
  var watch = keywatch(self, "who "+hashname, callback, 10*1000);
  
  // don't perform another request if there's already one running
  if(watch.callbacks.length > 1) return;

  var key;
  // ask operators sequentially in random order
  async.forEachSeries(self.operators.sort(function(){ return Math.random()-0.5; }), function(op, cbOps){
    var op = seen(self, op);
    var packet = {js:{who:hashname}};
    packet.sign = true;
    keywatch(self, "key "+hashname, function(err, value){
      if(value) key = value;
      cbOps(value); // stops async when we get a value
    }, 3*1000); // smaller timeout for operators, they should be fast
    send(self, op, packet);
  }, function(){
    if(!key) return watch.done("not found");
    watch.done(null, key);
  });
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

// add the proper line or open+signature
function addLine(self, to, packet)
{
  // if we've sent an open and have a line, just use that
  if(to.openSent && to.line) return packet.js.line = to.line;

  // make sure to send a signed open
  to.openSent = true;
  if(!to.open) to.open = dhash.quick(); // gen random secret
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

// open a line to this hashname
function doLine(self, hn, callback)
{
  // might have it already
  if(self.lines[hn]) return callback();

  function good(to){
    if(to.line) return callback();

    // only callback when it's fully open
    keywatch(self, "line "+hn, callback);

    // this triggers a response to make the line open
    var packet = {js:{seek:to.hashname}};
    addLine(self, to, packet);
    send(self, to, packet);
  }

  // operators we already have an address for
  if(seen(self, hn).operator) return good(seen(self, hn));

  // we don't know this hn, seek it and watch for an answer
  keywatch(self, "see "+hn, function(err, address){
    if(err) return callback(err);
    good(seen(self, address));
  });

  seek(self, hn);
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
      if(to.via) packet.js.via = to.via.hashname;
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
function parseAddress(str)
{
  if(typeof str !== "string")
  {
    warn("invalid address", str);
    return {};
  }
  var parts = str.split(",");
  return {hashname:parts[0], ip:parts[1], port:parseInt(parts[2]), address:str};
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
  if(typeof to !== "object") return {}; // could be bad data, empty object allows for .X checks
  if(to.hashname === self.hashname) return self; // so we can check === self
  var ret = self.seen[to.hashname];
  if(!ret) {
    ret = self.seen[to.hashname] = to;
    ret.at = Date.now();
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
    signed.js.sig = self.ukey.hashAndSign("md5", buf).toString("base64");
    buf = encode(self, to, signed);
    packet = signed;
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
  debug("INCOMING", self.hashname, packet.id, "packet from", packet.from, packet.js, packet.body && packet.body.length);

  // signed packets must be processed and verified straight away
  if(packet.js.sig) inSig(self, packet);

  // make sure any to is us (for multihosting)
  if(packet.js.to)
  {
    if(packet.js.to !== self.hashname) return warn("packet for", packet.js.to, "is not us");
    delete packet.js.to;
  }

  // "key" responses are always public and trusted since they are self-verifiable
  if(packet.js.key) inKey(self, packet);

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
    delete packet.js.line;
  }

  // any via must be validated as someone we're connected to
  if(packet.js.via)
  {
    var via = seen(self, packet.js.via);
    if(!via.line) return warn("invalid via of", packet.js.via, "from", packet.from);
    packet.via = via;
    delete packet.js.via;
  }

  // copy back their sender name if we don't have one yet for the "to" on answers
  if(!packet.from.hashname && dhash.isSHA1(packet.js.from)) packet.from.hashname = packet.js.from;

  // answer who/see here so we have the best from info to decide if we care
  if(packet.js.who) inWho(self, packet);
  if(packet.js.see) inSee(self, packet);

  // everything else must have some level of from trust!
  if(!packet.line && !packet.signed && !packet.via) return inApp(self, packet);

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

  packet.seq = parseInt(packet.js.seq);
  if(!(packet.seq >= 0)) return warn("invalid sequence on stream", packet.js.seq, stream.id, packet.from);
  stream.inSeq = packet.seq;

  // so, if there's a lot of "gap" or or dups coming in, be kind and send an update
  if(packet.seq - stream.outConfirmed > 30 || stream.inDups) sendStream(self, stream, {js:{}});

  // track and drop duplicate packets
  if(packet.seq <= stream.inDone || stream.inq[packet.seq - (stream.inDone+1)]) return stream.inDups++;

  // process any valid newer incoming ack/miss
  var ack = parseInt(packet.js.ack);
  var miss = Array.isArray(packet.js.miss) ? packet.js.miss : [];
  if(miss.length > 100) return warn("too many misses", miss.length, stream.id, packet.from);
  if(ack > stream.lastAck && ack <= stream.outSeq)
  {
    stream.lastAck = ack;
    // rebuild outq, only keeping missed/newer packets
    var outq = [];
    stream.outq.forEach(function(pold){
      if(pold.seq <= ack && !miss.indexOf(pold.seq)) return; // confirmed!
      outq.push(pold);
      if(!miss.indexOf(pold.seq)) return;
      // resend misses but not too frequently
      if(Date.now() - pold.resentAt < 5*1000) return;
      pold.resentAt = Date.now();
      send(self, stream.to, pold);
    });
    stream.outq = outq;    
  }
  
  // drop out of bounds
  if(packet.seq - stream.inDone > 100) return warn("stream too far behind, dropping", stream.id, packet.from);

  // stash this seq and process any in sequence
  packet.stream = stream;
  stream.inq[packet.seq - (stream.inDone+1)] = packet;
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
  
  // no missing packets be done, cancel any timer now too
  if(stream.inq.length === 0) {
    if(stream.missTimeout) {
      clearTimeout(stream.missTimeout);
      stream.missTimeout = false;
    }
    return;
  }

  // is there any missing packets? send notice in a few seconds
  if(!stream.missTimeout) stream.missTimeout = setTimeout(function(){
    sendStream(self, stream, {js:{}}); // it'll fill in empty packet w/ misses
  }, 2*1000);
}

// worker on the ordered-packet-queue processing
function inStreamSeries(self, stream, packet, callback)
{
  console.log("SSERIES", typeof stream.handler, typeof stream.sock, packet.js.sock);
  if(stream.handler) return stream.handler(self, packet, callback);
  if(packet.js.sock || stream.sock) return inSock(self, packet, callback);
  if(packet.js.req || stream.proxy) return inProxy(self, packet, callback);

  // anything leftover in a stream, pass along to app
  if(!self.inAnyStream) return callback();
  self.inAnyStream(null, packet, callback);
}

function inSock(self, packet, callback)
{
  // socket already created, handle connected/errors/closed
  if(packet.stream.sock)
  {
    // TODO handle errors/closing
    if(packet.js.sock) console.log("stream sock", packet.js.sock);

    // send along any data
    if(packet.body) packet.stream.sock.write(packet.body);

    return callback();
  }
  
  // incoming socket signalling
  if(packet.js.err) warn("incoming sock error", packet.js.err);
  if(packet.js.sock === "closed") {
    if(packet.stream.sock) packet.stream.sock.close();
    return callback();
  }

  // new socket proxy request!

  // TODO see if the requested ip:port is whitelisted
  var parts = packet.js.sock.split(":");
  var ip = parts[0];
  var port = parseInt(parts[1]);
  if(!(port > 0 && port < 65536))
  {
    packet.stream.send({sock:"closed", err:"invalid address"});
    return callback();
  }
  
  // officially create the proxy
  packet.stream.sock = net.connect({host:ip, port:port}, function(){
    if(packet.body) packet.stream.sock.write(packet.body); // attached body is optional, send it now
    packet.stream.send({sock:"open"}); // signal open
    callback();
  });
  packet.stream.sock.on('data', function(data){
    packet.stream.send({}, data);
  });
  packet.stream.sock.on('error', function(err){
    packet.stream.sockErr = err;
  });
  packet.stream.sock.on('close', function(){
    var closed = {sock:"closed"};
    if(packet.stream.sockErr) closed.err = packet.stream.sockErr.toString();
    packet.stream.send(closed);
  });
}

function inProxy(self, packet, callback)
{
  // if .req, validate/stash it
  // if .body, buffer it (for now)
  // if .done, do it
  callback();
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
  var from = seen(self, signed.js.from);

  // if a signed packet has a key, it might be the one for this signature, so process it :)
  if(signed.js.key) inKey(self, signed);

  // where we handle validation if/when there's a key
  function keyed(err, pubkey)
  {
    if(!pubkey) return warn("signed packet, no public key for", from.hashname, "from", packet.from, err);

    // validate packet.js.sig against packet.body
    try {
      var ukey = ursa.coercePublicKey(pubkey);
      valid = ukey.hashAndVerify("md5", body, sig, "base64");
      if(!valid) return warn("invalid signature from:", packet.from);
    }catch(E){
      return warn("crypto failed for", packet.from, E);
    }

    // make sure our values are correct/current
    updateAddress(from, packet.from.ip, packet.from.port);
    from.pubkey = pubkey;

    // process body as a new packet with a real from
    signed.signed = signed.from = from;
    incoming(self, signed);
  }

  // see if we have the key already by chance
  if(from.pubkey) return keyed(null, from.pubkey);

  // if we are the operator or have a lookup function, use that
  if(self.cb.lookup) return self.cb.lookup(from.hashname, keyed);

  // go ask an operator
  doWho(self, from.hashname, keyed);
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

// return a see to anyone closer
function inSeek(self, packet)
{
  if(!dhash.isSHA1(packet.js.seek)) return warn("invalid seek of ", packet.js.seek, "from:", packet.from);

  // now see if we have anyone to recommend
  var answer = {js:{see:[]}};
  if(packet.js.seek === self.hashname) answer.js.see.push(self.address);
  if(self.seen[packet.js.seek] && self.seen[packet.js.seek].line) answer.js.see.push(self.seen[packet.js.seek].address);
  // TODO DHT distance sort into .see
  
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
  if(!packet.from.hashname) return warn("unsigned open from", packet.from);

  // store the (new) open value for line generation
  if(packet.from.opened !== packet.js.open)
  {
    packet.from.opened = packet.js.open;
    packet.from.openSent = false; // trigger resending them our open since it's a new one from them
  }
  delete packet.js.open;

  // may need to generate our open secret yet
  if(!packet.from.open) packet.from.open = dhash.quick();

  // line is the hash of the two opens joined in sorted order
  packet.from.line = dhash.quick([packet.from.opened, packet.from.open].sort().join(""));

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
  var watch = self.watch["key "+hashname];
  if(!watch) return warn("unknown key", hashname, "from", packet.from);

  // some sanity checks
  if(!packet.body) return warn("missing key body from", packet.from);
  var seq = parseInt(packet.js.seq || 0);
  if(seq === NaN || seq < 0 || seq > 10) return warn("invalid seq", packet.js.seq, packet.from);
  delete packet.js.seq;

  watch.parts[seq] = packet.body.toString("utf8");

  // check if it's a valid public key yet, bail if not
  var key = watch.parts.join("");
  try { ursa.coercePublicKey(key) } catch(E) { return; };
  
  // have a key, validate it's for this hashname!
  if(hashname !== dhash.quick(key+self.space)) return warn("key+space hashname mismatch", hashname, "from", packet.from);
  seen(self, hashname).pubkey = key; // save all public keys we get back
  watch.done(null, key);
}

function inWho(self, packet)
{
  // TODO - do we care to enforce signature validation?

  function valued(err, key)
  {
    if(err || !key) return warn("key lookup fail for", body.hashname, err);

    // split into 1k chunks max
    var chunks = [].concat.apply([], key.split('').map(function(x,i){ return i%1000 ? [] : key.slice(i,i+1000) }));
    for(var i = 0; i < chunks.length; i++)
    {
      send(self, packet.from, {js:{key:packet.js.who, seq:i}, body:chunks[i]});
    }
  }
  
  if(packet.js.who === self.hashname) return valued(null, self.pubkey);
  if(self.cb.lookup) return self.cb.lookup(packet.js.who, valued);
  
  delete packet.js.who;
}

// simple test rigging to replace builtins
exports.test = function(outgoing)
{
  send = outgoing;
  return {incoming:incoming, inStream:inStream, doStream:doStream};
}