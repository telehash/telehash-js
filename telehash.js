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
    self.server.bind(self.port ? parseInt(self.port) : 0);

    // set up switch master callbacks
    slib.setCallbacks({data:doData, sock:self.server, news:doNews});

    // TODO start timer to monitor all switches and destruct any over thresholds and not in buckets
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
    if(self.seedCB && !self.me && telex._to) {
        self.me = slib.getSwitch(telex._to);
        clearTimeout(self.seedTimeout);
        self.seedCB();
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
    // set up timer to maintain bucket list, flag active switches to keep
    getSelf().seedCB = callback;
    // in 10 seconds, error out if nothing yet!
    self.seedTimeout = setTimeout(function(){
        self.seedCB("timeout");
        delete self.seedCB;
    }, 10000);
    // loop all seeds, asking for furthest end from them to get the most diverse responses!
    self.seeds.forEach(function(ipp){
        var hash = new hlib.Hash(ipp);
        doSend(ipp, {'+end':hash.far()});
    });
}

function doListen(arg, callback)
{

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
