var dgram = require('dgram');
var slib = require('./switch');
var hlib = require('./hash');

// high level exported functions

// init({port:42424, seeds:['1.2.3.4:5678]}) - pass in custom settings other than defaults, optional but if used must be called first!
exports.init = getSelf;

// seed(function(err){}) - will start seeding to dht, calls back w/ error/timeout or after first contact
exports.seed = doSeed;

// listen({id:'asdf'}, function(telex){}) - give an id to listen to on the dHT, callback fires whenever incoming telexes arrive to it, should seed() first for best karma!
exports.listen = doListen;

// connect({id:'asdf', ...}, function(telex){}) - id to connect to, other data is sent along
exports.connect = doConnect;

// send('ip:port', {...}) - sends the given telex to the target ip:port, will attempt to find it and punch through any NATs, etc, but is lossy, no guarantees/confirmations
exports.send = doSend;

// as expected
exports.shutdown = doShutdown;

// internals

var self;

// init self, use this whenever it may not be init'd yet to be safe
function getSelf(arg)
{
    if(self) return self;
    self = arg || {};
    if(!self.seeds) self.seeds = ['208.68.163.247:42424'];

    // udp socket
    self.server = dgram.createSocket("udp4", incoming);

    // If bind port is not specified, pick a random open port.
    self.server.bind(self.port ? parseInt(self.port) : 0, self.ip || '0.0.0.0');
    self.nat = true; // better safe default

    // set up switch master callbacks
    slib.setCallbacks({data:doData, sock:self.server, news:doNews});

    // start timer to monitor all switches and drop any over thresholds and not in buckets
    self.scanTimeout = setInterval(scan, 25000); // every 25sec, so that it runs 2x in <60 (if behind a NAT to keep mappings alive)

    return self;
}

// process incoming datagram
function incoming(msg, rinfo)
{
    var from = rinfo.address + ":" + rinfo.port;
    try {
        var telex = JSON.parse(msg.toString());
    } catch(E) {
        return console.error("failed to parse "+msg.length+" bytes from "+from);
    }

    console.log("<--\t"+from+"\t"+msg.toString());
    // if we're seeded and don't know our identity yet, save it!
    if(self.seeding && !self.me && telex._to) {
        self.me = slib.getSwitch(telex._to);
        self.me.self = true; // flag to switch to not send to itself
        // TODO if me.ipp != local ipp from socket, set NAT mode (ping 1min vs 10min)
        clearTimeout(self.seedTimeout);
        delete self.seedTimeout;
        self.seeding();
    }
    slib.getSwitch(from).process(telex, msg.length);
}

// process a validated telex that has data, commands, etc to be handled
function doData(from, telex)
{
    console.log(from.ipp+" sent "+JSON.stringify(telex));
}

function doNews(s)
{
    console.log("new switch "+s.ipp);
    // if we're seeded n don't have enough active, say hi to EVERYONE!
    if(self.me) s.send({'+end':self.me.end});

    // TODO if we're actively listening, and this is closest yet, ask it immediately

}

function doSeed(callback)
{
    if(!callback) callback = function(){};
    if(self && self.seeding) return callback(); // already seeded

    // set up timer to maintain bucket list, flag active switches to keep
    getSelf().seeding = callback;
    // in 10 seconds, error out if nothing yet!
    self.seedTimeout = setTimeout(function(){
        self.seeding("timeout");
        delete self.seeding;
        delete self.seedTimeout;
    }, 10000);
    // loop all seeds, asking for furthest end from them to get the most diverse responses!
    self.seeds.forEach(function(ipp){
        var hash = new hlib.Hash(ipp);
        doSend(ipp, {'+end':hash.far()});
    });

    // TODO, get local IP addresses for non-NAT detection!
    // http://stackoverflow.com/questions/3653065/get-local-ip-address-in-node-js
}

function doListen(arg, callback)
{
    // tap with timer
    // set self.listens{}
}

function doConnect(arg, callback)
{
    // dial the end continuously, timer to re-dial closest, wait forever for response and call back
}

function doSend(to, telex)
{
    // TODO need to check switch first, if its open, via (pop), etc
    var s = slib.getSwitch(to);
    s.send(telex);
}

function doShutdown()
{
    clearTimeout(self.scanTimeout);
    if(self.seedTimeout) {
        self.seeding("shutdown"); // a callback still waiting?!
        delete self.seedTimeout;
    }
    // drop all switches
    slib.getSwitches().forEach(function(s){ s.drop() });
    self.server.close();
    self = undefined;
}

// scan all known switches regularly to keep a good network map alive and trim the rest
function scan()
{
    var all = slib.getSwitches();

    // first just cull any not healthy, easy enough
    all.forEach(function(s){
        if(!s.healthy()) s.drop();
    });
    all = slib.getSwitches();

    // if only us or nobody around, and we were seeded at one point, try again!
    if(all.length <= 1 && self.seeding && !self.seedTimeout)
    {
        delete self.seeding;
        if(self.me) self.me.drop(); // this will be stale if offline
        delete self.me;
        return doSeed();
    }

    // not seeding
    if(!self.seeding || !self.me) return;

    // TODO for any self.listens, ping top 5 nearest

    // TODO overall, ping first X of each bucket
    all.sort(function(a, b){
        return self.me.hash.distanceTo(a.hash) - self.me.hash.distanceTo(b.hash);
    });

    // create array of arrays (buckets) based on distance from self (the heart of kademlia)
    var distance = self.me.hash.distanceTo(all[0].hash); // first bucket
    var buckets = [];
    var bucket = [];
    all.forEach(function(s){
        var d2 = self.me.hash.distanceTo(s.hash);
        if(d2 == distance) return bucket.push(s);
        distance = d2;
        buckets.push(bucket);
        bucket = [];
    });

    // TODO for congested buckets have a sort preference towards stable, and have a max cap and drop rest (to help avoid a form of local flooding)
    // for now, ping everyone!
    buckets.forEach(function(bucket){
        bucket.forEach(function(s){
            if(s.ATsent > Date.now() - 30) return; // don't need to ping if already sent them something in the last 30sec
            s.send({"+end":self.me.end}); // TODO, best dht mesh balance is probably to generate a random hash this distance away, but greedy +end of us is always smart/safe
        })
    });
}