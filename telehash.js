var dgram = require("dgram");
var os = require("os");
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
  var self = {space:space, cb:{}, operators:[], watch:{}, lines:{}, seen:{}};
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
  self.server = dgram.createSocket("udp4", function(msg, rinfo){
    var packet = decode(msg);
    if(!packet) return warn("failed to decode a packet from", rinfo.address, rinfo.port, msg.toString());
    packet.from = {ip:rinfo.address, port:rinfo.port};
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
  self.doWho = function(hn, callback) { who(self, hn, callback) };
  self.doLine = function(hn, callback) { line(self, hn, callback) };

  return self;
}

// perform a who request
function who(self, hn, callback)
{
  var key;
  // ask operators sequentially in random order
  async.forEachSeries(self.operators.sort(function(){ return Math.random()-0.5; }), function(op, cbOps){
    var op = seen(self, op);
    var packet = {js:{}}
    addSignature(self, packet, {hashname:hn, to:op.hashname}, "who");
    keywatch(self, "key "+packet.js.who, function(err, value){
      if(value) key = value;
      seen(self, hn).pubkey = value; // cache all public keys we get back
      cbOps(value); // stops async when we get a value
    });
    send(self, op, packet);
  }, function(){
    if(!key) return callback("not found");
    callback(null, key);
  });
}

// shared way to add a signature to any packet
function addSignature(self, packet, base, type)
{
  base.from = self.hashname;
  base.space = self.space;
  base.x = Date.now() + 10000;
  packet.body = new Buffer(JSON.stringify(base));
  packet.js.sig = self.ukey.hashAndSign("md5", packet.body).toString("base64");
  if(type) packet.js[type] = dhash.quick(packet.js.sig);  
}

// combine the incoming/outgoing open values to make a line and save it
function setLine(self, hn)
{
  // line is the hash of the two opens joined in sorted order
  hn.line = dhash.quick([hn.opened, hn.open].sort().join(""));
  self.lines[hn.line] = hn;
  var watch = self.watch["line "+hn.hashname];
  if(watch) watch.done();
  return hn.line;
}

// add the proper line or open+signature
function addLine(self, to, packet)
{
  if(to.line) return packet.js.line = to.line;

  // no matter what we have to sign it now (in case the first packet was dropped)
  addSignature(self, packet, {to:to.hashname}, "open");

  // now, if they sent us an open and this is our first response, calculate the line and send it
  if(to.opened) {
    to.open = packet.js.open;
    packet.js.line = setLine(self, to);
    return;
  }

  // if we already sent an open value, always use that one for tracking
  if(to.open) packet.js.open = to.open;
  else to.open = packet.js.open; // save for any subsequent packets
}

// ask open lines for an address
function seek(self, hash)
{
  // take a random max of three lines and ask them all (TODO use the DHT distance stuff)
  var ask = Object.keys(self.lines).sort(function(){ return Math.random()-0.5; }).slice(0,3);

  // ask them all
  ask.forEach(function(line){
    var to = self.lines[line];
    var packet = {js:{seek:hash}};
    addLine(self, to, packet);
    send(self, to, packet);
  });
}

// open a line to this hashname
function line(self, hn, callback)
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

function keywatch(self, key, callback)
{
  var timeout = setTimeout(function(){done("timeout")}, REQUEST_TIMEOUT);
  function done(err, value)
  {
    if(!timeout) return; // re-entered by accident if answer came after timeout
    clearTimeout(timeout);
    timeout = false;
    delete self.watch[key];
    callback(err, value);
  }
  
  return self.watch[key] = {done:done, parts:[]};
}

// create a wire writeable buffer from a packet
function encode(packet)
{
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

  // if there's a line and it's not added, add it, convenience
  if(to.line && !packet.js.line) addLine(self, to, packet);

  // if there's no line but we know the recipient via someone, always add it
  if(!to.line && to.via) {
    packet.js.via = to.via.hashname;
    // unsigned packets require these too
    if(!packet.js.sig)
    {
      packet.js.to = to.hashname;
      packet.js.from = self.hashname;      
    }
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

  var buf = encode(packet);
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
  debug("INCOMING", self.hashname, "packet from", packet.from, packet.js, packet.body && packet.body.length);

  // anon packets have a to that must be validated
  if(packet.js.to)
  {
    if(packet.js.to !== self.hashname) return warn("packet for", packet.js.to, "is not us");
    delete packet.js.to;
  }

  // which keys have been "processed"
  packet.ignore = {};

  // these are all the ad-hoc packet types
  if(packet.js.via) inVia(self, packet);
  if(packet.js.sig) inSig(self, packet);
  if(packet.js.who) inWho(self, packet);
  if(packet.js.key) inKey(self, packet);
  if(packet.js.popped) inPopped(self, packet);
  
  // opens may have to be async validated before continuing
  checkOpen(self, packet, function(){

    if(packet.js.line) inLine(self, packet);

    // these require a line, via, or signature
    if(packet.line || packet.via || packet.signed)
    {
      if(packet.js.see) inSee(self, packet);
      if(packet.js.seek) inSeek(self, packet);
      if(packet.js.pop) inPop(self, packet);      
    }

    // only proceed if there's a line
    if(!packet.line) return inAny(self, packet);

    if(packet.js.popping) inPopping(self, packet);

    // only proceed if there's a stream
    if(!packet.stream) return inAny(self, packet);    
  });;
}

// just validate any sig if possible, convenience
function inSig(self, packet)
{
  packet.ignore.sig = true;
  // TODO validate if key, set packet.signed = hn;
}

// validate any via
function inVia(self, packet)
{
  packet.ignore.via = true;
  packet.via = self.lines[packet.js.via];
  if(!packet.via) return warn("invalid via of", packet.js.via, "from", packet.from);
}

// NAT is open
function inPopped(self, packet)
{
  packet.ignore.popped = true;
  
  var popped = seen(self, packet.js.from);
  if(!popped.popping) return warn("popped when not popping", packet.js.popped, "from", packet.from);
  
  // make sure we use the ip/port we received from (could be different)
  popped.ip = packet.from.ip;
  popped.port = packet.from.port;
  
  // resend the first packet, this clears .popping too
  send(self, popped, popped.popping);
}

// someone's trying to connect to us
function inPopping(self, packet)
{
  packet.ignore.popping = true;
  var to = seen(self, packet.js.popping);
  if((Date.now() - to.sentAt) < 60*1000) return; // we already sent them something recently
  send(self, to, {js:{popped:true, to:to.hashname, from:self.hashname}});
}

// be the middleman to help NAT hole punch
function inPop(self, packet)
{
  packet.ignore.pop = packet.ignore.from = true;
  if(!Array.isArray(packet.js.pop) || packet.js.pop.length == 0) return warn("invalid pop of", packet.js.pop, "from", packet.from);
  if(!dhash.isSHA1(packet.js.from)) return warn("invalid pop from of", packet.js.from, "from", packet.from);

  packet.js.pop.forEach(function(address){
    var pop = seen(self, address);
    if(!pop.line) return warn("pop requested for", address, "but no line, from", packet.from);
    var popping = {js:{popping:[packet.js.from, packet.from.ip, packet.from.port].join(',')}};
    addLine(self, pop, popping);
    send(self, pop, popping);
  });
}

// return a see to anyone closer
function inSeek(self, packet)
{
  packet.ignore.seek = true;
  if(!dhash.isSHA1(packet.js.seek)) return warn("invalid seek of ", packet.js.seek, "from:", packet.from);

  // construct response
  var answer = {js:{see:[]}};
  if(packet.line) addLine(self, packet.line, answer); // if a line is present add it
  else answer.js.via = self.hashname;

  // now see if we have anyone to recommend
  if(packet.js.seek === self.hashname) answer.js.see.push(self.address);
  if(self.seen[packet.js.seek] && self.seen[packet.js.seek].line) answer.js.see.push(self.seen[packet.js.seek].address);
  
  send(self, packet.from, answer); // send to the source ip:port, could be different than the line which is ok
}

// any packet can have a .see, anything might want to know
function inSee(self, packet)
{
  packet.ignore.see = true;
  if(!Array.isArray(packet.js.see)) return warn("invalid see of ", packet.js.see, "from:", packet.from);
  
  // line/sig or via required
  var via = packet.line || packet.signed;
  if(!via) via = seen(self, packet.js.via);
  if(!via.line) return warn("invalid via of", packet.js.via, "from", packet.from);

  packet.js.see.forEach(function(address){
    var see = seen(self, address);
    see.via = via;
    // check if anyone is waiting for this one specifically
    var watch = self.watch["see "+see.hashname];
    if(watch) watch.done(null, see);
    // TODO also check anyone watching for ones closer to recurse
  });
}

function inAny(self, packet)
{
  // optionally send it up to the app if there's any data that isn't processed yet
}

// see if there's an open to process async
function checkOpen(self, packet, callback)
{
  if(!packet.js.open) return callback();

  packet.ignore.open = true;

  // first, parse the body
  var body;
  try { body = JSON.parse(packet.body.toString()) } catch(E) { return callback(warn("invalid body from", packet.from)); }
  var from = seen(self, body.from);

  // where we handle validation
  function keyed(err, pubkey)
  {
    if(!pubkey) return callback(warn("line request but couldn't find the public key for", from.hashname, err));

    // validate packet.js.sig against packet.body
    try {
      var ukey = ursa.coercePublicKey(pubkey);
      valid = ukey.hashAndVerify("md5", packet.body, packet.js.sig, "base64");
      if(!valid) return callback(warn("invalid open signature from:", packet.from));
    }catch(E){
      return callback(warn("crypto failed open for", packet.from, E));
    }

    // make sure our values are correct/current
    from.ip = packet.from.ip;
    from.port = packet.from.port;
    from.address = [from.hashname, from.ip, from.port].join(",");
    from.pubkey = pubkey;
    from.opened = packet.js.open;
    // in case it's a new open, replacing old line
    if(from.line)
    {
      delete from.line
      delete from.open;      
    }

    // if we've already sent an open, calculate line now
    if(from.open) setLine(self, from);
    
    // the line is open for this packet
    packet.line = from;

    return callback();
  }

  // see if we have the key already by chance
  if(from.pubkey) return keyed(null, from.pubkey);

  // if we are the operator or have a lookup function, use that
  if(self.cb.lookup) return self.cb.lookup(from.hashname, keyed);

  // go ask an operator
  who(self, from.hashname, keyed);
}

function inLine(self, packet)
{
  packet.ignore.line = true;
  // a matching line is required
  packet.line = self.lines[packet.js.line];
  if(!packet.line) return warn("unknown line from", packet.from);
}

function inKey(self, packet)
{
  packet.ignore.key = true;
  var watch = self.watch["key "+packet.js.key];
  if(!watch) return warn("unknown key from", packet.from);

  // some sanity checks
  if(!packet.body) return warn("missing key body from", packet.from);
  var seq = parseInt(packet.js.seq || 0);
  if(seq === NaN || seq < 0 || seq > 10) return warn("invalid seq", packet.js.seq, packet.from);

  watch.parts[seq] = packet.body.toString("utf8");

  // check if it's a valid public key yet
  var key = watch.parts.join("");
  try { ursa.coercePublicKey(key) } catch(E) { return warn(E) };
  watch.done(null, key);
}

function inWho(self, packet)
{
  packet.ignore.who = true;
  var body;
  try { body = JSON.parse(packet.body.toString()) } catch(E) { return warn("invalid body from", packet.from); }
  
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
  
  if(body.hashname === self.hashname) return valued(null, self.pubkey);
  if(self.cb.lookup) return self.cb.lookup(body.hashname, valued);
}
