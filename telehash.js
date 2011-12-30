// high level exported functions

// seed({seeds:['1.2.3.4:5678]}) - optional arg to give custom seeds, otherwise uses defaults
exports.seed = seed;

// listen({id:'asdf'}, function(telex){}) - give an id to listen to on the dHT, callback fires whenever incoming telexes arrive to it
exports.listen = listen;

// connect({id:'asdf', ...}, function(telex){}) - id to connect to, other data is sent along
exports.connect = connect;

// send('ip:port', {...}) - sends the given telex to the target ip:port, will attempt to find it and punch through any NATs, etc, but is lossy, no guarantees/confirmations
exports.send = send;

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

    // If bind port is not specified, pick a random open port.
    port = arg.port ? parseInt(arg.port) : 0;

    self.server = dgram.createSocket("udp4", incoming);

    return _self;
}

// process incoming datagram
function incoming(msg, rinfo)
{
    // get sender ipp, find switch and deliver to it's incoming
}

function seed(arg)
{

}

function listen(arg)
{

}

function connect(arg)
{

}

function send(arg)
{

}
