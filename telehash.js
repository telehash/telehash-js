var dgram = require('dgram');
var slib = require('./switch');

// high level exported functions

// seed({seeds:['1.2.3.4:5678]}) - optional arg to give custom seeds, otherwise uses defaults
exports.seed = doSeed;

// listen({id:'asdf'}, function(telex){}) - give an id to listen to on the dHT, callback fires whenever incoming telexes arrive to it
exports.listen = doListen;

// connect({id:'asdf', ...}, function(telex){}) - id to connect to, other data is sent along
exports.connect = doConnect;

// send('ip:port', {...}) - sends the given telex to the target ip:port, will attempt to find it and punch through any NATs, etc, but is lossy, no guarantees/confirmations
exports.send = doSend;

// init({port:5678}) - must be called first, optional args to bind udp socket to
exports.init = self;

// internals

var _self;
var seeds = ['208.68.163.247:42424'];

// get self or create/init if none
function self(arg)
{
    if(_self) return _self;
    _self = {};
    if(!arg) arg = {};

    // set up switch master callbacks
    slib.setCallbacks({data:doData, send:doSend});

    // udp socket
    _self.server = dgram.createSocket("udp4", incoming);

    // If bind port is not specified, pick a random open port.
    _self.server.bind(arg.port ? parseInt(arg.port) : 0);

    // TODO start timer to monitor all switches and destruct any over thresholds and not in buckets
    return _self;
}

// process incoming datagram
function incoming(msg, rinfo)
{
    var from = rinfo.address + ":" + rinfo.port;
    try {
        var t = JSON.parse(msg.toString());
    } catch(E) {
        return console.error("failed to parse "+msg.length+" bytes from "+from);
    }

    slib.getSwitch(from).
    // get sender ipp, find switch and deliver to it's incoming
    console.error(msg);
}

// process a validated telex that has data, commands, etc to be handled
function doData(telex)
{

}

function doSeed(arg)
{

}

function doListen(arg)
{

}

function doConnect(arg)
{

}

function doSend(arg)
{

}
